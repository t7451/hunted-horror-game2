// client/src/world/WallFixtures.ts
//
// Sparse wall-mounted fixtures (outlets, switches, picture frames) at low
// density along wall-adjacent floor edges. Cheap geometry, big perceived
// detail. Frames get a slight tilt for the "old house" read.

import * as THREE from "three";
import type { ParsedMap } from "@shared/maps";

const FIXTURE_DENSITY = 0.08;

// Mirrors WallBuilder.WALL_THICKNESS — duplicated to avoid a cross-module
// import cycle. If you change one, change both.
const WALL_THICKNESS = 0.18;

type FixtureKind = "outlet" | "switch" | "frame_small" | "frame_med";

const NEIGHBORS: { dx: number; dz: number; rot: number }[] = [
  { dx: 0, dz: -1, rot: 0 },
  { dx: 1, dz: 0, rot: -Math.PI / 2 },
  { dx: 0, dz: 1, rot: Math.PI },
  { dx: -1, dz: 0, rot: Math.PI / 2 },
];

// Module-scoped caches: one geometry and one material per fixture kind.
// Hundreds of placed fixtures share the same Three.js resources, which keeps
// the renderer's draw-call batching working and avoids redundant GPU
// allocations. Both caches are torn down by disposeFixtureCache() if the
// engine ever needs to drop them.
const _geoCache = new Map<FixtureKind, THREE.BufferGeometry>();
const _matCache = new Map<FixtureKind, THREE.MeshStandardMaterial>();

function makeFixtureGeometry(kind: FixtureKind): THREE.BufferGeometry {
  const cached = _geoCache.get(kind);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  switch (kind) {
    case "outlet":
      geo = new THREE.BoxGeometry(0.07, 0.11, 0.012);
      break;
    case "switch":
      geo = new THREE.BoxGeometry(0.06, 0.1, 0.014);
      break;
    case "frame_small":
      geo = new THREE.BoxGeometry(0.32, 0.42, 0.025);
      break;
    case "frame_med":
      geo = new THREE.BoxGeometry(0.55, 0.72, 0.03);
      break;
  }
  _geoCache.set(kind, geo);
  return geo;
}

function makeFixtureMaterial(kind: FixtureKind): THREE.MeshStandardMaterial {
  const cached = _matCache.get(kind);
  if (cached) return cached;
  const mat =
    kind === "outlet" || kind === "switch"
      ? new THREE.MeshStandardMaterial({
          color: 0xe8e4dc,
          roughness: 0.4,
          metalness: 0,
        })
      : new THREE.MeshStandardMaterial({
          color: 0x2a1810,
          roughness: 0.7,
          metalness: 0,
        });
  _matCache.set(kind, mat);
  return mat;
}

export function disposeFixtureCache(): void {
  for (const g of _geoCache.values()) g.dispose();
  for (const m of _matCache.values()) m.dispose();
  _geoCache.clear();
  _matCache.clear();
}

function fixtureHeight(kind: FixtureKind, rng: () => number): number {
  switch (kind) {
    case "outlet":
      return 0.32;
    case "switch":
      return 1.25;
    case "frame_small":
    case "frame_med":
      return 1.4 + rng() * 0.3;
  }
}

export class WallFixtures {
  readonly object: THREE.Group;
  // Geometries/materials are owned by the module-scoped caches above and
  // shared across every WallFixtures instance — disposeFixtureCache()
  // releases them once the engine tears down, not on per-instance dispose().

  constructor(parsed: ParsedMap, tileSize: number, rng: () => number) {
    const group = new THREE.Group();
    group.name = "wall_fixtures";
    this.object = group;

    // Distance from a floor tile center to the wall surface facing it.
    // WallBuilder centers a thin wall on the wall TILE center, so the wall
    // surface sits at `tileSize - WALL_THICKNESS / 2` from the floor center.
    // The 0.002 inset keeps the fixture mounted just inside the surface
    // without breaking depth ordering against the wall mesh.
    const surfaceDist = tileSize - WALL_THICKNESS / 2 - 0.002;

    for (let z = 0; z < parsed.height; z++) {
      for (let x = 0; x < parsed.width; x++) {
        if (parsed.tiles[z][x] !== ".") continue;
        for (const n of NEIGHBORS) {
          const nx = x + n.dx;
          const nz = z + n.dz;
          if (nz < 0 || nz >= parsed.height || nx < 0 || nx >= parsed.width)
            continue;
          if (parsed.tiles[nz][nx] !== "W") continue;
          if (rng() > FIXTURE_DENSITY) continue;

          const r = rng();
          let kind: FixtureKind;
          if (r < 0.4) kind = "outlet";
          else if (r < 0.6) kind = "switch";
          else if (r < 0.85) kind = "frame_small";
          else kind = "frame_med";

          const geo = makeFixtureGeometry(kind);
          const mat = makeFixtureMaterial(kind);

          const mesh = new THREE.Mesh(geo, mat);
          const tileCx = (x + 0.5) * tileSize;
          const tileCz = (z + 0.5) * tileSize;
          mesh.position.set(
            tileCx + n.dx * surfaceDist,
            fixtureHeight(kind, rng),
            tileCz + n.dz * surfaceDist
          );
          mesh.rotation.y = n.rot;
          // Picture frames are large enough that the soft drop-shadow under
          // them is the player's main "this is mounted on the wall" cue
          // under flashlight light. Outlets/switches stay shadow-skipped —
          // they're too small to read meaningfully and the saved draws
          // matter at high fixture counts.
          const isFrame = kind === "frame_small" || kind === "frame_med";
          if (isFrame) {
            mesh.rotation.z = (rng() - 0.5) * 0.04;
          }
          mesh.castShadow = isFrame;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    }
  }

  dispose(): void {
    // Geometries/materials are pooled at module scope; releasing them per
    // instance would invalidate other live instances. Just clear the group.
    while (this.object.children.length)
      this.object.remove(this.object.children[0]);
  }
}
