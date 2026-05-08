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
const COLUMN_WIDTH = 0.16;
const COLUMN_DEPTH = 0.28;
const PLINTH_HEIGHT = 0.22;
const KEYSTONE_HEIGHT = 0.28;

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

        const columnGeo = new THREE.BoxGeometry(
          horizontal ? COLUMN_DEPTH : COLUMN_WIDTH,
          jambHeight,
          horizontal ? COLUMN_WIDTH : COLUMN_DEPTH
        );
        const column = new THREE.Mesh(columnGeo, material);
        column.position.copy(mesh.position);
        column.castShadow = true;
        column.receiveShadow = true;
        group.add(column);
        geometries.push(columnGeo);

        const plinthGeo = new THREE.BoxGeometry(
          horizontal ? COLUMN_DEPTH * 1.15 : COLUMN_WIDTH * 1.35,
          PLINTH_HEIGHT,
          horizontal ? COLUMN_WIDTH * 1.35 : COLUMN_DEPTH * 1.15
        );
        const plinth = new THREE.Mesh(plinthGeo, material);
        plinth.position.set(mesh.position.x, PLINTH_HEIGHT / 2, mesh.position.z);
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        group.add(plinth);
        geometries.push(plinthGeo);
      }

      // A small center keystone turns the flat header into a readable arch
      // without adding curved geometry or extra collision complexity.
      const keystoneGeo = new THREE.BoxGeometry(
        horizontal ? FRAME_DEPTH * 1.15 : COLUMN_WIDTH,
        KEYSTONE_HEIGHT,
        horizontal ? COLUMN_WIDTH : FRAME_DEPTH * 1.15
      );
      const keystone = new THREE.Mesh(keystoneGeo, material);
      keystone.position.set(cx, WALL_HEIGHT - KEYSTONE_HEIGHT / 2, cz);
      keystone.castShadow = true;
      keystone.receiveShadow = true;
      group.add(keystone);
      geometries.push(keystoneGeo);
    }
  }

  return { group, geometries };
}
