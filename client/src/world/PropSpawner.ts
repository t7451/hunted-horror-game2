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
  | "bed"
  | "sofa"
  | "counter"
  | "bathtub"
  | "candles"
  | "ritual"
  | "clutter";

type PropDef = {
  /** Max instances reserved on the InstancedMesh. */
  maxInstances: number;
  /** Vertical offset between mesh local origin (typically y=0 floor) and world placement y. */
  yOffset: number;
  build: () => { geometry: THREE.BufferGeometry; material: THREE.Material };
};

// Caps sized for the larger Phase-2 maps (40×23 → 44×27 floor plans).
// One InstancedMesh per kind, so growing these costs only pre-allocated
// matrix slots, not draw calls. Values are the realistic upper bound a
// kind hits at PROP_DENSITY 0.30 across the biggest map.
const PROPS: Record<PropKind, PropDef> = {
  chair: { maxInstances: 64, yOffset: 0, build: buildChair },
  table: { maxInstances: 28, yOffset: 0, build: buildTable },
  lamp: { maxInstances: 32, yOffset: 0, build: buildLamp },
  shelf: { maxInstances: 28, yOffset: 0, build: buildShelf },
  crate: { maxInstances: 72, yOffset: 0, build: buildCrate },
  barrel: { maxInstances: 56, yOffset: 0, build: buildBarrel },
  bookstack: { maxInstances: 48, yOffset: 0, build: buildBookstack },
  painting: { maxInstances: 56, yOffset: 0, build: buildPainting },
  rug: { maxInstances: 32, yOffset: 0, build: buildRug },
  bed: { maxInstances: 12, yOffset: 0, build: buildBed },
  sofa: { maxInstances: 12, yOffset: 0, build: buildSofa },
  counter: { maxInstances: 36, yOffset: 0, build: buildCounter },
  bathtub: { maxInstances: 8, yOffset: 0, build: buildBathtub },
  candles: { maxInstances: 48, yOffset: 0, build: buildCandles },
  ritual: { maxInstances: 20, yOffset: 0, build: buildRitual },
  clutter: { maxInstances: 112, yOffset: 0, build: buildClutter },
};

type Slot = {
  mesh: THREE.InstancedMesh;
  count: number;
  capacity: number;
  yOffset: number;
};

const PROP_CULL_DIST = 32;
let lampShadeTexture: THREE.CanvasTexture | null = null;

function getLampShadeTexture(): THREE.CanvasTexture {
  if (lampShadeTexture) return lampShadeTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    lampShadeTexture = new THREE.CanvasTexture(canvas);
    return lampShadeTexture;
  }

  ctx.fillStyle = "#c2ad86";
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    const band = 18 + Math.sin(y * 0.34) * 12;
    ctx.fillStyle = `rgba(55,36,18,${(0.06 + band / 255).toFixed(3)})`;
    ctx.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 4) {
    ctx.fillStyle = "rgba(70,48,26,0.10)";
    ctx.fillRect(x, 0, 1, 128);
  }

  lampShadeTexture = new THREE.CanvasTexture(canvas);
  lampShadeTexture.wrapS = THREE.RepeatWrapping;
  lampShadeTexture.wrapT = THREE.RepeatWrapping;
  lampShadeTexture.repeat.set(1.2, 2.6);
  lampShadeTexture.colorSpace = THREE.SRGBColorSpace;
  lampShadeTexture.needsUpdate = true;
  return lampShadeTexture;
}

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
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(b.x, b.y, b.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(b.rx ?? 0, b.ry ?? 0, b.rz ?? 0)
      ),
      new THREE.Vector3(1, 1, 1)
    );
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
  rx?: number;
  ry?: number;
  rz?: number;
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
    // Armrests — horizontal slats bridging the back post to a short front post
    { x: -half, y: seatY + 0.22, z: 0, w: legW * 1.4, h: legW * 0.9, d: seatD * 0.78 },
    { x: half, y: seatY + 0.22, z: 0, w: legW * 1.4, h: legW * 0.9, d: seatD * 0.78 },
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
  // Apron: thin skirt boards that join the legs just under the tabletop —
  // makes the table read as carpentered rather than four sticks under a slab.
  const apronH = 0.12;
  const apronT = 0.04;
  const apronY = legH - apronH / 2;
  const apronInset = legW + apronT / 2;
  const boxes: BoxSpec[] = [
    { x: 0, y: legH + topH / 2, z: 0, w: topW, h: topH, d: topD },
    { x: -half, y: legH / 2, z: -halfD, w: legW, h: legH, d: legW },
    { x: half, y: legH / 2, z: -halfD, w: legW, h: legH, d: legW },
    { x: -half, y: legH / 2, z: halfD, w: legW, h: legH, d: legW },
    { x: half, y: legH / 2, z: halfD, w: legW, h: legH, d: legW },
    { x: 0, y: apronY, z: -halfD + apronInset - legW, w: topW - legW * 2, h: apronH, d: apronT },
    { x: 0, y: apronY, z: halfD - apronInset + legW, w: topW - legW * 2, h: apronH, d: apronT },
    { x: -half + apronInset - legW, y: apronY, z: 0, w: apronT, h: apronH, d: topD - legW * 2 },
    { x: half - apronInset + legW, y: apronY, z: 0, w: apronT, h: apronH, d: topD - legW * 2 },
    // Floor stretcher — a central cross-piece near the floor ties the legs
    // and makes the silhouette read as hand-crafted joinery.
    { x: 0, y: 0.22, z: 0, w: topW - legW * 2.4, h: legW * 0.65, d: legW * 0.65 },
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
  return mergeBoxes(
    [
      { x: 0, y: 0.05, z: 0, w: 0.3, h: 0.06, d: 0.3 },
      { x: 0, y: 0.72, z: 0, w: 0.04, h: 1.38, d: 0.04 },
      { x: 0, y: 1.32, z: 0, w: 0.14, h: 0.05, d: 0.14 },
      { x: 0, y: 1.47, z: 0, w: 0.42, h: 0.27, d: 0.42 },
      { x: 0, y: 1.38, z: 0, w: 0.37, h: 0.025, d: 0.37 },
      { x: 0, y: 1.56, z: 0, w: 0.37, h: 0.025, d: 0.37 },
      { x: 0, y: 1.44, z: 0, w: 0.1, h: 0.1, d: 0.1 },
    ],
    new THREE.MeshStandardMaterial({
      map: getLampShadeTexture(),
      color: 0xcab896,
      emissive: 0x2d1a08,
      emissiveIntensity: 0.16,
      roughness: 0.72,
      metalness: 0.08,
    })
  );
}

function buildShelf() {
  // A bookshelf-ish silhouette: tall narrow back + 3 horizontal shelves,
  // populated with a deterministic row of book volumes per level. Books
  // share the shelf material — under flashlight that reads as a row of
  // dark leather spines, which is what we want.
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

  // Books — three rows, on each horizontal shelf surface. Deterministic
  // jitter per slot keeps tilts/heights consistent across all instances
  // (props are instanced — every shelf shares one geometry).
  const shelfYs = [0.05 + 0.025 + 0.005, h * 0.4 + 0.02 + 0.005, h * 0.7 + 0.02 + 0.005];
  const slots = 9;
  const slotW = (w - 0.16) / slots;
  for (let row = 0; row < shelfYs.length; row++) {
    const baseY = shelfYs[row];
    let xCursor = -w / 2 + 0.08;
    for (let i = 0; i < slots; i++) {
      const seed = Math.sin(row * 12.9898 + i * 78.233) * 43758.5453;
      const jitter = seed - Math.floor(seed); // 0..1
      // Skip ~15% of slots so the row isn't perfectly full.
      if (jitter < 0.15) {
        xCursor += slotW;
        continue;
      }
      const bookH = 0.18 + jitter * 0.10;
      const bookW = slotW * (0.78 + jitter * 0.18);
      const bookD = 0.18 + (1 - jitter) * 0.06;
      boxes.push({
        x: xCursor + slotW / 2,
        y: baseY + bookH / 2,
        z: 0.01,
        w: bookW,
        h: bookH,
        d: bookD,
      });
      xCursor += slotW;
    }
  }
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
    { x: 0, y: h * 0.18, z: 0, w: r * 1.88, h: 0.055, d: r * 1.88 }, // hoop low
    { x: 0, y: h * 0.50, z: 0, w: r * 1.90, h: 0.055, d: r * 1.90 }, // hoop mid
    { x: 0, y: h * 0.82, z: 0, w: r * 1.88, h: 0.055, d: r * 1.88 }, // hoop high
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
  const w = 0.72;
  const h = 0.56;
  const t = 0.04;
  const cy = 1.7;
  const boxes: BoxSpec[] = [
    // Frame (4 strips around the canvas)
    { x: 0, y: cy + h / 2, z: -t / 2, w: w + 0.08, h: 0.06, d: t },
    { x: 0, y: cy - h / 2, z: -t / 2, w: w + 0.08, h: 0.06, d: t },
    { x: -w / 2, y: cy, z: -t / 2, w: 0.06, h: h + 0.06, d: t },
    { x: w / 2, y: cy, z: -t / 2, w: 0.06, h: h + 0.06, d: t },
    // Canvas + crude portrait relief
    { x: 0, y: cy, z: -t / 2 - 0.005, w, h, d: 0.01 },
    { x: 0, y: cy + h * 0.22, z: -t / 2 - 0.008, w: w * 0.26, h: h * 0.28, d: 0.008 },
    { x: 0, y: cy - h * 0.1, z: -t / 2 - 0.008, w: w * 0.52, h: h * 0.35, d: 0.008 },
    { x: -w * 0.22, y: cy, z: -t / 2 - 0.006, w: w * 0.28, h: h * 0.7, d: 0.006 },
    { x: w * 0.22, y: cy, z: -t / 2 - 0.006, w: w * 0.28, h: h * 0.7, d: 0.006 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x1c0e08,
      emissive: 0x180808,
      emissiveIntensity: 0.04,
      roughness: 0.65,
      metalness: 0.0,
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

function buildBed() {
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.18, z: 0, w: 1.3, h: 0.22, d: 2.0 },
    { x: 0, y: 0.36, z: 0.08, w: 1.22, h: 0.2, d: 1.65 },
    { x: 0, y: 0.52, z: -0.65, w: 1.1, h: 0.16, d: 0.35 },
    { x: 0, y: 0.62, z: -1.05, w: 1.38, h: 0.9, d: 0.12 },
    { x: 0, y: 0.34, z: 1.04, w: 1.34, h: 0.32, d: 0.1 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x5a3028,
      roughness: 0.88,
      metalness: 0.02,
    })
  );
}

function buildSofa() {
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.28, z: 0, w: 1.8, h: 0.3, d: 0.78 },
    { x: 0, y: 0.68, z: -0.34, w: 1.9, h: 0.82, d: 0.16 },
    { x: -0.94, y: 0.52, z: 0.03, w: 0.18, h: 0.58, d: 0.78 },
    { x: 0.94, y: 0.52, z: 0.03, w: 0.18, h: 0.58, d: 0.78 },
    { x: -0.45, y: 0.52, z: 0.08, w: 0.75, h: 0.18, d: 0.62 },
    { x: 0.45, y: 0.52, z: 0.08, w: 0.75, h: 0.18, d: 0.62 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x3a1820,
      roughness: 0.92,
      metalness: 0.01,
    })
  );
}

function buildCounter() {
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.42, z: 0, w: 1.3, h: 0.78, d: 0.58 },
    { x: 0, y: 0.84, z: 0, w: 1.42, h: 0.08, d: 0.66 },
    { x: -0.24, y: 0.45, z: 0.31, w: 0.38, h: 0.42, d: 0.035 },
    { x: 0.24, y: 0.45, z: 0.31, w: 0.38, h: 0.42, d: 0.035 },
    { x: 0, y: 1.18, z: -0.26, w: 1.2, h: 0.55, d: 0.12 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x4a321f,
      roughness: 0.82,
      metalness: 0.04,
    })
  );
}

function buildBathtub() {
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.22, z: 0, w: 1.35, h: 0.24, d: 0.72 },
    { x: 0, y: 0.52, z: -0.39, w: 1.38, h: 0.58, d: 0.12 },
    { x: 0, y: 0.52, z: 0.39, w: 1.38, h: 0.58, d: 0.12 },
    { x: -0.72, y: 0.52, z: 0, w: 0.12, h: 0.58, d: 0.72 },
    { x: 0.72, y: 0.52, z: 0, w: 0.12, h: 0.58, d: 0.72 },
    { x: 0.48, y: 0.92, z: -0.32, w: 0.14, h: 0.18, d: 0.08 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0xb8b0a0,
      roughness: 0.5,
      metalness: 0.02,
    })
  );
}

function buildCandles() {
  // Clustered floor candles: three uneven wax pillars on a shallow dish with
  // small upright flame slivers. Kept as one instanced geometry/material.
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.015, z: 0, w: 0.54, h: 0.03, d: 0.34 },
    { x: -0.18, y: 0.18, z: -0.04, w: 0.09, h: 0.32, d: 0.09 },
    { x: 0.0, y: 0.25, z: 0.06, w: 0.1, h: 0.46, d: 0.1 },
    { x: 0.18, y: 0.13, z: -0.02, w: 0.08, h: 0.24, d: 0.08 },
    { x: -0.18, y: 0.36, z: -0.04, w: 0.045, h: 0.1, d: 0.025, ry: Math.PI / 4 },
    { x: 0.0, y: 0.5, z: 0.06, w: 0.05, h: 0.12, d: 0.03, ry: Math.PI / 4 },
    { x: 0.18, y: 0.27, z: -0.02, w: 0.04, h: 0.08, d: 0.025, ry: Math.PI / 4 },
    // A few wax drips break up the columns so they don't read as posts.
    { x: -0.22, y: 0.24, z: -0.04, w: 0.025, h: 0.12, d: 0.02 },
    { x: 0.04, y: 0.34, z: 0.1, w: 0.025, h: 0.16, d: 0.02 },
  ];
  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0xffd6a0,
      emissive: 0xff6a24,
      emissiveIntensity: 0.16,
      roughness: 0.62,
      metalness: 0.02,
    })
  );
}

function buildRitual() {
  // Low occult floor set-piece: a raised center stone, star strokes, and five
  // short marker candles around it. Floor-only to avoid wall-placement rules.
  const boxes: BoxSpec[] = [
    { x: 0, y: 0.045, z: 0, w: 0.42, h: 0.09, d: 0.42 },
    { x: 0, y: 0.03, z: 0, w: 1.24, h: 0.018, d: 0.04, ry: 0 },
    { x: 0, y: 0.031, z: 0, w: 1.24, h: 0.018, d: 0.04, ry: Math.PI * 0.4 },
    { x: 0, y: 0.032, z: 0, w: 1.24, h: 0.018, d: 0.04, ry: Math.PI * 0.8 },
    { x: 0, y: 0.033, z: 0, w: 1.24, h: 0.018, d: 0.04, ry: Math.PI * 1.2 },
    { x: 0, y: 0.034, z: 0, w: 1.24, h: 0.018, d: 0.04, ry: Math.PI * 1.6 },
  ];

  const markerRadius = 0.66;
  for (let i = 0; i < 5; i++) {
    const a = i * ((Math.PI * 2) / 5) + Math.PI / 10;
    boxes.push({
      x: Math.cos(a) * markerRadius,
      y: 0.12,
      z: Math.sin(a) * markerRadius,
      w: 0.06,
      h: 0.2,
      d: 0.06,
    });
    boxes.push({
      x: Math.cos(a) * markerRadius,
      y: 0.25,
      z: Math.sin(a) * markerRadius,
      w: 0.035,
      h: 0.06,
      d: 0.025,
      ry: Math.PI / 4,
    });
  }

  return mergeBoxes(
    boxes,
    new THREE.MeshStandardMaterial({
      color: 0x4a1014,
      emissive: 0x2a0508,
      emissiveIntensity: 0.08,
      roughness: 0.9,
      metalness: 0.02,
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
