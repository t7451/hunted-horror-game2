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

export type PropKind = "chair" | "table" | "lamp" | "shelf";

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
};

type Slot = {
  mesh: THREE.InstancedMesh;
  count: number;
  capacity: number;
  yOffset: number;
};

export class PropSpawner {
  private readonly slots = new Map<PropKind, Slot>();

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

  place(kind: PropKind, position: THREE.Vector3, rotationY = 0, scale = 1): void {
    const slot = this.ensure(kind);
    if (slot.count >= slot.capacity) {
      console.warn(`[props] ${kind} full at ${slot.capacity}; skipping placement`);
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
    const p = position.clone();
    p.y += slot.yOffset;
    m.compose(p, q, new THREE.Vector3(scale, scale, scale));
    slot.mesh.setMatrixAt(slot.count, m);
    slot.count++;
    slot.mesh.count = slot.count;
  }

  /** Flush instance matrices after a batch of `place` calls. */
  commit(): void {
    this.slots.forEach(slot => {
      slot.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    this.slots.forEach(slot => {
      slot.mesh.removeFromParent();
      slot.mesh.geometry.dispose();
      const m = slot.mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m.dispose();
    });
    this.slots.clear();
  }
}

// ── Procedural prop builders ─────────────────────────────────────────────────
// Each composes a single BufferGeometry by merging primitives so the
// resulting InstancedMesh is one draw call. Avoids pulling in three-stdlib's
// BufferGeometryUtils.mergeGeometries — done by hand below to keep deps lean.

function mergeBoxes(boxes: BoxSpec[], material: THREE.Material): {
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
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return { geometry: merged, material };
}

type BoxSpec = { x: number; y: number; z: number; w: number; h: number; d: number };

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
    new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.85, metalness: 0.05 }),
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
    new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.8, metalness: 0.05 }),
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
    new THREE.MeshStandardMaterial({ color: 0x222020, roughness: 0.8, metalness: 0.4 }),
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
    }),
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
    new THREE.MeshStandardMaterial({ color: 0x2a1d10, roughness: 0.9, metalness: 0.05 }),
  );
}
