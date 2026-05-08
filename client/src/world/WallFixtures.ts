// client/src/world/WallFixtures.ts
//
// Sparse wall-mounted fixtures (outlets, switches, picture frames) at low
// density along wall-adjacent floor edges. Cheap geometry, big perceived
// detail. Frames get a slight tilt for the "old house" read.

import * as THREE from "three";
import type { ParsedMap } from "@shared/maps";

const FIXTURE_DENSITY = 0.08;

type FixtureKind = "outlet" | "switch" | "frame_small" | "frame_med";

const NEIGHBORS: { dx: number; dz: number; rot: number }[] = [
  { dx: 0, dz: -1, rot: 0 },
  { dx: 1, dz: 0, rot: -Math.PI / 2 },
  { dx: 0, dz: 1, rot: Math.PI },
  { dx: -1, dz: 0, rot: Math.PI / 2 },
];

function makeFixtureGeometry(kind: FixtureKind): THREE.BufferGeometry {
  switch (kind) {
    case "outlet":
      return new THREE.BoxGeometry(0.07, 0.11, 0.012);
    case "switch":
      return new THREE.BoxGeometry(0.06, 0.1, 0.014);
    case "frame_small":
      return new THREE.BoxGeometry(0.32, 0.42, 0.025);
    case "frame_med":
      return new THREE.BoxGeometry(0.55, 0.72, 0.03);
  }
}

function makeFixtureMaterial(kind: FixtureKind): THREE.MeshStandardMaterial {
  if (kind === "outlet" || kind === "switch") {
    return new THREE.MeshStandardMaterial({
      color: 0xe8e4dc,
      roughness: 0.4,
      metalness: 0,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x2a1810,
    roughness: 0.7,
    metalness: 0,
  });
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
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(parsed: ParsedMap, tileSize: number, rng: () => number) {
    const group = new THREE.Group();
    group.name = "wall_fixtures";
    this.object = group;

    const wallOffset = 0.09;

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
          this.materials.push(mat);
          this.geometries.push(geo);

          const mesh = new THREE.Mesh(geo, mat);
          const tileCx = (x + 0.5) * tileSize;
          const tileCz = (z + 0.5) * tileSize;
          mesh.position.set(
            tileCx + n.dx * (tileSize / 2 - wallOffset),
            fixtureHeight(kind, rng),
            tileCz + n.dz * (tileSize / 2 - wallOffset)
          );
          mesh.rotation.y = n.rot;
          if (kind === "frame_small" || kind === "frame_med") {
            mesh.rotation.z = (rng() - 0.5) * 0.04;
          }
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    }
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
