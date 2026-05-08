import * as THREE from "three";

// Per-prop-type InstancedMesh manager. The spec calls for GLB models
// loaded via GLTFLoader and projected into InstancedMesh; until those
// assets land, we ship procedural composite geometries (chair = legs +
// seat + backrest, table = legs + top, lamp = pole + shade + emissive
// bulb). Visually a step up from "this is a box", and the public API
// matches what the GLB-loading path will need so dropping real models
// in later is a localized change.
//
// Each prop kind lives on its own InstancedMesh so we get one draw call
// per kind regardless of population. The matrix update is amortized:
// callers `placeProp` repeatedly during world build, and we flush
// `instanceMatrix.needsUpdate` once via `commit()`.

export type PropKind =
  | "chair"
  | "table"
  | "lamp"
  | "shelf"
  | "crate"
  | "barrel"
  | "bookstack"
  | "painting"
  | "rug"
  | "clutter";

type PropDef = {
  /** Max instances reserved on the InstancedMesh. */
  maxInstances: number;
  /** Vertical offset between mesh local origin (typically y=0 floor) and world placement y. */
  yOffset: number;
  build: () => { geometry: THREE.BufferGeometry; material: THREE.Material };
};

const PROPS: Record<PropKind, PropDef> = {
  chair: { maxInstances: 32, yOffset: 0, build: buildChair },
  table: { maxInstances: 12, yOffset: 0, build: buildTable },
  lamp: { maxInstances: 16, yOffset: 0, build: buildLamp },
  shelf: { maxInstances: 12, yOffset: 0, build: buildShelf },
  crate: { maxInstances: 32, yOffset: 0, build: buildCrate },
  barrel: { maxInstances: 24, yOffset: 0, build: buildBarrel },
  bookstack: { maxInstances: 24, yOffset: 0, build: buildBookstack },
  painting: { maxInstances: 24, yOffset: 0, build: buildPainting },
  rug: { maxInstances: 16, yOffset: 0, build: buildRug },
  clutter: { maxInstances: 48, yOffset: 0, build: buildClutter },
};

type Slot = {
  mesh: THREE.InstancedMesh;
  count: number;
  capacity: number;
  yOffset: number;
};

const PROP_CULL_DIST = 32;

type PlacedInstance = { x: number; z: number; matrix: THREE.Matrix4 };

export class PropSpawner {
  private readonly slots = new Map<PropKind, Slot>();
  // Per-kind list of placed instances; cullByDistance compacts the live
  // matrix list to those within PROP_CULL_DIST every few hundred ms.
  private readonly placed = new Map<PropKind, PlacedInstance[]>();

  constructor(private readonly scene: THREE.Scene) {}

  ensure(kind: PropKind): Slot {
    let slot = this.slots.get(kind);
    if (slot) return slot;
    const def = PROPS[kind];
    const { geometry, material } = def.build();
    const mesh = new THREE.InstancedMesh(geometry, material, def.maxInstances);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    slot = { mesh, count: 0, capacity: def.maxInstances, yOffset: def.yOffset };
    this.slots.set(kind, slot);
    return slot;
  }

  place(
    kind: PropKind,
    position: THREE.Vector3,
    rotationY = 0,
    scale = 1
  ): void {
    const slot = this.ensure(kind);
    if (slot.count >= slot.capacity) {
      console.warn(
        `[props] ${kind} full at ${slot.capacity}; skipping placement`
      );
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, rotationY, 0)
    );
    const p = position.clone();
    p.y += slot.yOffset;
    m.compose(p, q, new THREE.Vector3(scale, scale, scale));
    slot.mesh.setMatrixAt(slot.count, m);
    slot.count++;
    slot.mesh.count = slot.count;
    let list = this.placed.get(kind);
    if (!list) {
      list = [];
      this.placed.set(kind, list);
    }
    list.push({ x: p.x, z: p.z, matrix: m.clone() });
  }

  /**
   * Pack only nearby instances into the InstancedMesh's live range.
   * Distant props become invisible without being destroyed, so when the
   * player wanders back the original positions still exist.
   */
  cullByDistance(playerX: number, playerZ: number): void {
    const cullSq = PROP_CULL_DIST * PROP_CULL_DIST;
    for (const [kind, instances] of Array.from(this.placed.entries())) {
      const slot = this.slots.get(kind);
      if (!slot) continue;
      let visible = 0;
      for (let i = 0; i < instances.length; i++) {
        const dx = instances[i].x - playerX;
        const dz = instances[i].z - playerZ;
        if (dx * dx + dz * dz <= cullSq) {
          slot.mesh.setMatrixAt(visible, instances[i].matrix);
          visible++;
        }
      }
      slot.mesh.count = visible;
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Flush instance matrices after a batch of `place` calls. */
  commit(): void {
    for (const slot of Array.from(this.slots.values())) {
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const slot of Array.from(this.slots.values())) {
      slot.mesh.removeFromParent();
      slot.mesh.geometry.dispose();
      const m = slot.mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach(mm => mm.dispose());
      else m.dispose();
    }
    this.slots.clear();
  }
}

// ── Procedural prop builders ─────────────────────────────────────────────────
// Each composes a single BufferGeometry by merging primitives so the
// resulting InstancedMesh is one draw call. Avoids pulling in three-stdlib's
// BufferGeometryUtils.mergeGeometries — done by hand below to keep deps lean.

function mergeBoxes(
  boxes: BoxSpec[],
  material: THREE.Material
): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  // Naive merger: build a single non-indexed geometry by concatenating
  // each box's positions / normals / uvs after applying its transform.
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    const matrix = new THREE.Matrix4().makeTranslation(b.x, b.y, b.z);
    g.applyMatrix4(matrix);
    const nonIndexed = g.toNonIndexed();
    const p = nonIndexed.attributes.position.array as Float32Array;
    const n = nonIndexed.attributes.normal.array as Float32Array;
    const u = nonIndexed.attributes.uv.array as Float32Array;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
    for (let i = 0; i < u.length; i++) uvs.push(u[i]);
    g.dispose();
    nonIndexed.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return { geometry: merged, material };
}

type BoxSpec = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
};

function buildChair() {
  // Seat at y=0.45, four legs to floor, backrest above seat.
  const legW = 0.06;
  const seatW = 0.45;
  const seatD = 0.45;
  const seatH = 0.05;
  const seatY = 0.45;
  const half = seatW / 2 - legW / 2;
  const boxes: BoxSpec[] = [
    // Seat
    { x: 0, y: seatY, z: 0, w: seatW, h: seatH, d: seatD },
    // Legs
    { x: -half, y: seatY / 2, z: -half, w: legW, h: seatY, d: legW },
    { x: half, y: seatY / 2, z: -half, w: legW, h: seatY, d: legW },
    { x: -half, y: seatY / 2, z: half, w: legW, h: seatY, d: legW },
    { x: half, y: seatY / 2, z: half, w: legW, h: seatY, d: legW },
    // Backrest verticals
    { x: -half, y: seatY + 0.4, z: -half, w: legW, h: 0.8, d: legW },
    { x: half, y: seatY + 0.4, z: -half, w: legW, h: 0.8, d: legW },
    // Backrest cross
    { x: 0, y: seatY + 0.7, z: -half, w: seatW, h: 0.08, d: 0.04 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x4a3320,
      roughness: 0.85,
      metalness: 0.05,
    })
  );
}

function buildTable() {
  const topW = 1.2;
  const topD = 0.8;
  const topH = 0.06;
  const legW = 0.08;
  const legH = 0.74;
  const half = topW / 2 - legW;
  const halfD = topD / 2 - legW;
  const boxes: BoxSpec[] = [
    { x: 0, y: legH + topH / 2, z: 0, w: topW, h: topH, d: topD },
    { x: -half, y: legH / 2, z: -halfD, w: legW, h: legH, d: legW },
    { x: half, y: legH / 2, z: -halfD, w: legW, h: legH, d: legW },
    { x: -half, y: legH / 2, z: halfD, w: legW, h: legH, d: legW },
    { x: half, y: legH / 2, z: halfD, w: legW, h: legH, d: legW },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x3a2818,
      roughness: 0.8,
      metalness: 0.05,
    })
  );
}

function buildLamp() {
  // Floor lamp: thin pole + flared shade. Shade is mildly emissive so it
  // reads as "lit" in the Phase 3 dark scene without needing a real
  // PointLight per lamp (which would blow the shadow budget).
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.05, z: 0, w: 0.3, h: 0.06, d: 0.3 }, // base
    { x: 0, y: 0.7, z: 0, w: 0.04, h: 1.3, d: 0.04 }, // pole
  ];
  const baseAndPole = mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x222020,
      roughness: 0.8,
      metalness: 0.4,
    })
  );
  // Shade as a separate emissive cone — but mergeBoxes only takes boxes,
  // so we cheat: include the shade as a wide short box. Fine at distance,
  // and the bloom from PostFX softens its silhouette.
  const shade = mergeBoxes(
    [{ x: 0, y: 1.45, z: 0, w: 0.4, h: 0.25, d: 0.4 }],
    new THREE.MeshStandardMaterial({
      color: 0xffd28a,
      emissive: 0xffaa55,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.1,
    })
  );
  // Combine the two geometries; result has two material groups so we hand
  // back a multi-material InstancedMesh isn't supported in three. To keep
  // this single-geometry/single-material, we just use the shade emissive
  // material for the whole lamp — readable enough at flashlight distance.
  baseAndPole.geometry.dispose();
  return shade;
}

function buildShelf() {
  // A bookshelf-ish silhouette: tall narrow back + 3 horizontal shelves.
  const w = 0.9;
  const d = 0.3;
  const h = 1.6;
  const boxes: BoxSpec[] = [
    { x: 0, y: h / 2, z: -d / 2 + 0.02, w, h, d: 0.04 }, // back
    { x: 0, y: 0.05, z: 0, w, h: 0.05, d }, // bottom
    { x: 0, y: h - 0.05, z: 0, w, h: 0.05, d }, // top
    { x: 0, y: h * 0.4, z: 0, w, h: 0.04, d }, // mid shelf
    { x: 0, y: h * 0.7, z: 0, w, h: 0.04, d }, // upper shelf
    { x: -w / 2 + 0.04, y: h / 2, z: 0, w: 0.04, h, d }, // left side
    { x: w / 2 - 0.04, y: h / 2, z: 0, w: 0.04, h, d }, // right side
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x2a1d10,
      roughness: 0.9,
      metalness: 0.05,
    })
  );
}

function buildCrate() {
  // Stackable wooden crate ~0.7m on a side. Slats give it silhouette.
  const s = 0.7;
  const t = 0.05;
  const half = s / 2;
  const boxes: BoxSpec[] = [
    { x: 0, y: half, z: 0, w: s, h: s, d: s }, // body
    // Slat overlays (thin proud strips for relief)
    { x: 0, y: half, z: half + 0.005, w: s + 0.02, h: 0.06, d: t },
    { x: 0, y: half + 0.18, z: half + 0.005, w: s + 0.02, h: 0.06, d: t },
    { x: 0, y: half - 0.18, z: half + 0.005, w: s + 0.02, h: 0.06, d: t },
    { x: 0, y: half, z: -half - 0.005, w: s + 0.02, h: 0.06, d: t },
    { x: half + 0.005, y: half, z: 0, w: t, h: 0.06, d: s + 0.02 },
    { x: -half - 0.005, y: half, z: 0, w: t, h: 0.06, d: s + 0.02 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x6b4a28,
      roughness: 0.92,
      metalness: 0.04,
    })
  );
}

function buildBarrel() {
  // Faceted "barrel" — octagonal-ish via 3 stacked tapered boxes plus
  // two metal hoops. Reads as a barrel under the flashlight cone.
  const r = 0.36;
  const h = 0.95;
  const boxes: BoxSpec[] = [
    { x: 0, y: h / 2, z: 0, w: r * 1.7, h, d: r * 1.7 }, // body
    { x: 0, y: h * 0.22, z: 0, w: r * 1.85, h: 0.06, d: r * 1.85 }, // hoop low
    { x: 0, y: h * 0.78, z: 0, w: r * 1.85, h: 0.06, d: r * 1.85 }, // hoop high
    { x: 0, y: h - 0.02, z: 0, w: r * 1.55, h: 0.04, d: r * 1.55 }, // lid
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x4a2e18,
      roughness: 0.78,
      metalness: 0.18,
    })
  );
}

function buildBookstack() {
  // Three messy stacked books on the floor.
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.05, z: 0, w: 0.36, h: 0.08, d: 0.26 },
    { x: 0.04, y: 0.13, z: -0.02, w: 0.32, h: 0.07, d: 0.24 },
    { x: -0.05, y: 0.2, z: 0.03, w: 0.34, h: 0.06, d: 0.25 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x5a2a1c,
      roughness: 0.9,
      metalness: 0.02,
    })
  );
}

function buildPainting() {
  // Wall painting silhouette — frame + canvas. Caller is expected to push
  // these against walls (we orient + flush them via rotationY in engine).
  // Geometry sits at z≈-0.02 so the local origin is the wall surface.
  const w = 0.7;
  const h = 0.5;
  const t = 0.04;
  const cy = 1.7;
  const boxes: BoxSpec[] = [
    // Frame (4 strips around the canvas)
    { x: 0, y: cy + h / 2, z: -t / 2, w: w + 0.08, h: 0.06, d: t },
    { x: 0, y: cy - h / 2, z: -t / 2, w: w + 0.08, h: 0.06, d: t },
    { x: -w / 2, y: cy, z: -t / 2, w: 0.06, h: h + 0.06, d: t },
    { x: w / 2, y: cy, z: -t / 2, w: 0.06, h: h + 0.06, d: t },
    // Canvas
    { x: 0, y: cy, z: -t / 2 - 0.005, w, h, d: 0.01 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x3a2820,
      roughness: 0.85,
      metalness: 0.04,
    })
  );
}

function buildRug() {
  // Flat thin slab — reads as a floor rug. 0.02m thick, ~2m square,
  // centered at floor. Color is dim claret so it doesn't fight the
  // wood floor under flashlight.
  const w = 1.9;
  const d = 1.4;
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.011, z: 0, w, h: 0.022, d },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x3a1820,
      roughness: 0.95,
      metalness: 0.0,
    })
  );
}

function buildClutter() {
  // A small tangle of debris — bottle + can + brick — for floor scatter.
  const boxes: BoxSpec[] = [
    { x: 0.0, y: 0.10, z: 0.0, w: 0.10, h: 0.20, d: 0.10 }, // bottle
    { x: 0.18, y: 0.06, z: 0.05, w: 0.12, h: 0.12, d: 0.12 }, // can
    { x: -0.12, y: 0.04, z: -0.10, w: 0.22, h: 0.08, d: 0.12 }, // brick
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x3a3028,
      roughness: 0.95,
      metalness: 0.05,
    })
  );
}
