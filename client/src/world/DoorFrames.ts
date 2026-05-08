// client/src/world/DoorFrames.ts
//
// Wood-frame geometry around every `D` tile: a top header + two side jambs,
// thin and tight to the doorway. Determines axis from the surrounding
// wall pattern (walls north + south = horizontal door, else vertical).

import * as THREE from "three";
import { WALL_HEIGHT, type ParsedMap } from "@shared/maps";

const FRAME_THICKNESS = 0.08;
const FRAME_DEPTH = 0.22;
const FRAME_WIDTH_OUTSET = 0.06;

export type DoorFrameResult = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
};

export function buildDoorFrames(
  parsed: ParsedMap,
  tileSize: number,
  material: THREE.Material
): DoorFrameResult {
  const group = new THREE.Group();
  group.name = "door_frames";
  const geometries: THREE.BufferGeometry[] = [];

  for (let z = 0; z < parsed.height; z++) {
    for (let x = 0; x < parsed.width; x++) {
      if (parsed.tiles[z][x] !== "D") continue;

      const wallN = z > 0 && parsed.tiles[z - 1][x] === "W";
      const wallS = z < parsed.height - 1 && parsed.tiles[z + 1][x] === "W";
      // Door is "horizontal" (faces E/W) if walls clamp it on N+S.
      const horizontal = wallN && wallS;

      const cx = (x + 0.5) * tileSize;
      const cz = (z + 0.5) * tileSize;
      const span = tileSize + FRAME_WIDTH_OUTSET * 2;

      // Top header
      {
        const geo = new THREE.BoxGeometry(
          horizontal ? FRAME_DEPTH : span,
          FRAME_THICKNESS,
          horizontal ? span : FRAME_DEPTH
        );
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(cx, WALL_HEIGHT - FRAME_THICKNESS / 2, cz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        geometries.push(geo);
      }

      // Side jambs
      const jambHeight = WALL_HEIGHT - FRAME_THICKNESS;
      for (const side of [-1, 1]) {
        const geo = new THREE.BoxGeometry(
          horizontal ? FRAME_DEPTH : FRAME_THICKNESS,
          jambHeight,
          horizontal ? FRAME_THICKNESS : FRAME_DEPTH
        );
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(
          horizontal ? cx : cx + side * (span / 2),
          jambHeight / 2,
          horizontal ? cz + side * (span / 2) : cz
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        geometries.push(geo);
      }
    }
  }

  return { group, geometries };
}
