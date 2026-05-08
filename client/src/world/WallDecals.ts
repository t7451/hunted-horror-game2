// client/src/world/WallDecals.ts
//
// Sparse decal sprites (cracks, stains, peeling paper, scratches) on walls
// adjacent to floor tiles. Plane geometries pushed slightly proud of the
// wall surface with polygonOffset to avoid z-fighting against the merged
// wall meshes from WallBuilder.

import * as THREE from "three";
import type { ParsedMap } from "@shared/maps";

const DECAL_KINDS = ["crack", "stain", "peel", "scratch"] as const;
type DecalKind = (typeof DECAL_KINDS)[number];

const DECAL_COLORS: Record<DecalKind, number> = {
  crack: 0x0f0908,
  stain: 0x2a1810,
  peel: 0x5a4a3a,
  scratch: 0x1a1410,
};

// Per-kind opacity, fixed at construction time. Pooling materials by kind
// (instead of one-per-decal) keeps Three.js batching working and stops the
// material count from scaling with decal density.
const DECAL_OPACITY: Record<DecalKind, number> = {
  crack: 0.7,
  stain: 0.55,
  peel: 0.45,
  scratch: 0.65,
};

// Per-wall-adjacent-floor-edge probability of placing a decal.
const DECAL_DENSITY = 0.15;

// Mirrors WallBuilder.WALL_THICKNESS — duplicated to avoid a cross-module
// import cycle. If you change one, change both.
const WALL_THICKNESS = 0.18;

const NEIGHBORS: { dx: number; dz: number; rot: number }[] = [
  { dx: 0, dz: -1, rot: 0 },
  { dx: 1, dz: 0, rot: -Math.PI / 2 },
  { dx: 0, dz: 1, rot: Math.PI },
  { dx: -1, dz: 0, rot: Math.PI / 2 },
];

export class WallDecals {
  readonly object: THREE.Group;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(parsed: ParsedMap, tileSize: number, rng: () => number) {
    const group = new THREE.Group();
    group.name = "wall_decals";
    this.object = group;

    // Distance from a floor tile center to the wall surface facing it.
    // WallBuilder centers a thin wall on the wall TILE center, so the wall
    // surface sits at `tileSize - WALL_THICKNESS / 2` from the floor center.
    // A 0.005 inset keeps the decal plane just inside the wall surface so
    // polygonOffset has room to shadow-bias against z-fighting.
    const surfaceDist = tileSize - WALL_THICKNESS / 2 - 0.005;

    // One material per kind, reused across every placed decal.
    const matByKind: Record<DecalKind, THREE.MeshStandardMaterial> = {
      crack: this._makeMaterial("crack"),
      stain: this._makeMaterial("stain"),
      peel: this._makeMaterial("peel"),
      scratch: this._makeMaterial("scratch"),
    };

    for (let z = 0; z < parsed.height; z++) {
      for (let x = 0; x < parsed.width; x++) {
        if (parsed.tiles[z][x] !== ".") continue;
        for (const n of NEIGHBORS) {
          const nx = x + n.dx;
          const nz = z + n.dz;
          if (nz < 0 || nz >= parsed.height || nx < 0 || nx >= parsed.width)
            continue;
          if (parsed.tiles[nz][nx] !== "W") continue;
          if (rng() > DECAL_DENSITY) continue;

          const kind = DECAL_KINDS[Math.floor(rng() * DECAL_KINDS.length)];
          const w = 0.5 + rng() * 0.8;
          const h = 0.4 + rng() * 0.9;
          const geo = new THREE.PlaneGeometry(w, h);
          this.geometries.push(geo);

          const mesh = new THREE.Mesh(geo, matByKind[kind]);
          const tileCx = (x + 0.5) * tileSize;
          const tileCz = (z + 0.5) * tileSize;
          mesh.position.set(
            tileCx + n.dx * surfaceDist,
            0.5 + rng() * 1.6,
            tileCz + n.dz * surfaceDist
          );
          mesh.rotation.y = n.rot;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          group.add(mesh);
        }
      }
    }
  }

  private _makeMaterial(kind: DecalKind): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: DECAL_COLORS[kind],
      transparent: true,
      opacity: DECAL_OPACITY[kind],
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    });
    this.materials.push(mat);
    return mat;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    while (this.object.children.length)
      this.object.remove(this.object.children[0]);
  }
}
