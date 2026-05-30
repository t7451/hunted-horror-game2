// client/src/world/WallDecals.ts
//
// Sparse decal sprites (cracks, stains, peeling paper, scratches) on walls
// adjacent to floor tiles. Plane geometries pushed slightly proud of the
// wall surface with polygonOffset to avoid z-fighting against the merged
// wall meshes from WallBuilder.

import * as THREE from "three";
import { isDecorFloorTile, type ParsedMap } from "@shared/maps";

const DECAL_KINDS = ["crack", "stain", "peel", "scratch", "lath"] as const;
type DecalKind = (typeof DECAL_KINDS)[number];

const DECAL_COLORS: Record<DecalKind, number> = {
  crack: 0x0f0908,
  stain: 0x2a1810,
  peel: 0x5a4a3a,
  scratch: 0x1a1410,
  // Lath patch is rendered as a small dark backing rectangle; horizontal
  // wood strips are stacked on top of it as a sibling mesh per placement.
  lath: 0x1a0f08,
};

// Per-kind opacity, fixed at construction time. Pooling materials by kind
// (instead of one-per-decal) keeps Three.js batching working and stops the
// material count from scaling with decal density.
const DECAL_OPACITY: Record<DecalKind, number> = {
  crack: 0.7,
  stain: 0.55,
  peel: 0.45,
  scratch: 0.65,
  lath: 0.95,
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
      lath: this._makeMaterial("lath"),
    };

    for (let z = 0; z < parsed.height; z++) {
      for (let x = 0; x < parsed.width; x++) {
        if (!isDecorFloorTile(parsed.tiles[z][x])) continue;
        for (const n of NEIGHBORS) {
          const nx = x + n.dx;
          const nz = z + n.dz;
          if (nz < 0 || nz >= parsed.height || nx < 0 || nx >= parsed.width)
            continue;
          if (parsed.tiles[nz][nx] !== "W") continue;
          if (rng() > DECAL_DENSITY) continue;

          // Suppress lath to ~35% of its uniform rate — exposed lath is the
          // strongest visual statement (a chunk of plaster has fallen away)
          // and overuse would dominate the Victorian read. Effective lath
          // density is ~(1/N) * 0.35 of DECAL_DENSITY (~1% of wall edges
          // for N=5 kinds at DECAL_DENSITY=0.15); the rejected lath picks
          // fall through to "stain" so the overall decal density is
          // unchanged.
          let kind = DECAL_KINDS[Math.floor(rng() * DECAL_KINDS.length)];
          if (kind === "lath" && rng() > 0.35) {
            kind = "stain";
          }
          const w = 0.5 + rng() * 0.8;
          const h = 0.4 + rng() * 0.9;
          const geo = new THREE.PlaneGeometry(w, h);
          this.geometries.push(geo);

          const mesh = new THREE.Mesh(geo, matByKind[kind]);
          const tileCx = (x + 0.5) * tileSize;
          const tileCz = (z + 0.5) * tileSize;
          const cy = 0.5 + rng() * 1.6;
          mesh.position.set(
            tileCx + n.dx * surfaceDist,
            cy,
            tileCz + n.dz * surfaceDist
          );
          mesh.rotation.y = n.rot;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          group.add(mesh);

          // For lath patches, layer horizontal wood strips proud of the
          // dark backing so the broken-plaster reveal reads in 3D rather
          // than as a flat texture.
          if (kind === "lath") {
            const lathMat = this._getLathStripMaterial();
            const stripCount = 3 + Math.floor(rng() * 3);
            const stripH = h / (stripCount * 1.6);
            const gap = (h - stripCount * stripH) / (stripCount + 1);
            for (let s = 0; s < stripCount; s++) {
              const stripGeo = new THREE.PlaneGeometry(w * 0.92, stripH);
              this.geometries.push(stripGeo);
              const stripMesh = new THREE.Mesh(stripGeo, lathMat);
              const yOffsetLocal =
                -h / 2 + gap + s * (stripH + gap) + stripH / 2;
              // Offset the strip slightly proud of the backing along the
              // wall normal so polygonOffset can keep them depth-stable.
              stripMesh.position.set(
                tileCx + n.dx * (surfaceDist + 0.008),
                cy + yOffsetLocal,
                tileCz + n.dz * (surfaceDist + 0.008)
              );
              stripMesh.rotation.y = n.rot;
              stripMesh.castShadow = false;
              stripMesh.receiveShadow = false;
              group.add(stripMesh);
            }
          }
        }
      }
    }
  }

  private _lathStripMat: THREE.MeshStandardMaterial | null = null;

  private _getLathStripMaterial(): THREE.MeshStandardMaterial {
    if (this._lathStripMat) return this._lathStripMat;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a4a2a,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this._lathStripMat = mat;
    this.materials.push(mat);
    return mat;
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
