// client/src/world/WallBuilder.ts
//
// Coalesces contiguous `W` tiles in a parsed map into a small set of run
// meshes with real thickness, top inset, per-meter UV repeat, and per-run
// 90° UV rotation. Replaces the per-tile InstancedMesh wall placement that
// produced visible seams, z-fighting, and identical-tile striping.
//
// One Group is returned — each run is its own Mesh so the runs share the
// wall material but stay independent for culling. Total mesh count is
// O(rooms+corridors), not O(wallTiles).

import * as THREE from "three";
import type { ParsedMap } from "@shared/maps";

const RUN_HEIGHT = 4.0; // matches WALL_HEIGHT in shared/maps.ts
const WALL_THICKNESS = 0.18;
const WALL_TOP_INSET = 0.02;

export type WallBuildResult = {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
};

type Run = {
  x: number;
  z: number;
  length: number;
  axis: "x" | "z";
};

function findRuns(parsed: ParsedMap): Run[] {
  const runs: Run[] = [];
  const consumed = new Set<string>();

  // Horizontal runs first — claim multi-tile rows so the dominant
  // architectural lines stay parallel to the world axes.
  for (let z = 0; z < parsed.height; z++) {
    let runStart = -1;
    for (let x = 0; x <= parsed.width; x++) {
      const isWall = x < parsed.width && parsed.tiles[z][x] === "W";
      if (isWall && runStart === -1) runStart = x;
      if ((!isWall || x === parsed.width) && runStart !== -1) {
        const length = x - runStart;
        if (length >= 2) {
          runs.push({ x: runStart, z, length, axis: "x" });
          for (let i = 0; i < length; i++) consumed.add(`${runStart + i},${z}`);
        }
        runStart = -1;
      }
    }
  }

  // Vertical runs next — claim remaining contiguous columns.
  for (let x = 0; x < parsed.width; x++) {
    let runStart = -1;
    for (let z = 0; z <= parsed.height; z++) {
      const key = `${x},${z}`;
      const isWall =
        z < parsed.height && parsed.tiles[z][x] === "W" && !consumed.has(key);
      if (isWall && runStart === -1) runStart = z;
      if ((!isWall || z === parsed.height) && runStart !== -1) {
        const length = z - runStart;
        runs.push({ x, z: runStart, length, axis: "z" });
        for (let i = 0; i < length; i++) consumed.add(`${x},${runStart + i}`);
        runStart = -1;
      }
    }
  }

  // Single-tile remainders (corner pieces, isolated walls).
  for (let z = 0; z < parsed.height; z++) {
    for (let x = 0; x < parsed.width; x++) {
      if (parsed.tiles[z][x] === "W" && !consumed.has(`${x},${z}`)) {
        runs.push({ x, z, length: 1, axis: "x" });
      }
    }
  }

  return runs;
}

/**
 * Box UVs are laid out as 6 face quads of 4 verts each (24 verts total),
 * face order: +X, -X, +Y, -Y, +Z, -Z. Index 0..7 are the side faces in the
 * "long" direction for x-axis runs / depth direction for z-axis runs.
 */
function applyUvRepeatAndRotation(
  geo: THREE.BufferGeometry,
  axis: "x" | "z",
  lengthW: number,
  rotIdx: number
): void {
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uvAttr) return;
  const repeatU = axis === "x" ? lengthW / 2 : 1;
  const repeatV = RUN_HEIGHT / 2;

  // Face index = floor(vert / 4). BoxGeometry order: 0:+X, 1:-X, 2:+Y, 3:-Y,
  // 4:+Z, 5:-Z. Apply U-axis repeat to side faces only (front/back/left/right
  // depending on run axis) so top/bottom keep their 0..1 mapping.
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const faceIdx = Math.floor(i / 4);
    const isSide = faceIdx !== 2 && faceIdx !== 3;
    if (isSide) uvAttr.setXY(i, u * repeatU, v * repeatV);
  }

  // Per-run 90° increment rotation, side faces only — breaks repeating-tile
  // banding when adjacent walls share a texture set.
  if (rotIdx > 0) {
    for (let face = 0; face < 6; face++) {
      if (face === 2 || face === 3) continue;
      const i = face * 4;
      const u0 = uvAttr.getX(i),
        v0 = uvAttr.getY(i);
      const u1 = uvAttr.getX(i + 1),
        v1 = uvAttr.getY(i + 1);
      const u2 = uvAttr.getX(i + 2),
        v2 = uvAttr.getY(i + 2);
      const u3 = uvAttr.getX(i + 3),
        v3 = uvAttr.getY(i + 3);
      if (rotIdx === 1) {
        uvAttr.setXY(i, u3, v3);
        uvAttr.setXY(i + 1, u0, v0);
        uvAttr.setXY(i + 2, u1, v1);
        uvAttr.setXY(i + 3, u2, v2);
      } else if (rotIdx === 2) {
        uvAttr.setXY(i, u2, v2);
        uvAttr.setXY(i + 1, u3, v3);
        uvAttr.setXY(i + 2, u0, v0);
        uvAttr.setXY(i + 3, u1, v1);
      } else {
        uvAttr.setXY(i, u1, v1);
        uvAttr.setXY(i + 1, u2, v2);
        uvAttr.setXY(i + 2, u3, v3);
        uvAttr.setXY(i + 3, u0, v0);
      }
    }
  }
  uvAttr.needsUpdate = true;
}

export function buildWalls(
  parsed: ParsedMap,
  tileSize: number,
  material: THREE.Material,
  options: { castShadow?: boolean; receiveShadow?: boolean } = {}
): WallBuildResult {
  const castShadow = options.castShadow ?? true;
  const receiveShadow = options.receiveShadow ?? true;
  const runs = findRuns(parsed);
  const group = new THREE.Group();
  group.name = "walls";
  const meshes: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  for (const run of runs) {
    const lengthW = run.length * tileSize;
    const sx = run.axis === "x" ? lengthW : WALL_THICKNESS;
    const sz = run.axis === "z" ? lengthW : WALL_THICKNESS;
    const sy = RUN_HEIGHT - WALL_TOP_INSET;
    const geo = new THREE.BoxGeometry(sx, sy, sz);

    const seed = (run.x * 73856093) ^ (run.z * 19349663);
    const rotIdx = (seed >>> 0) % 4;
    applyUvRepeatAndRotation(geo, run.axis, lengthW, rotIdx);

    const cx = (run.x + (run.axis === "x" ? run.length / 2 : 0.5)) * tileSize;
    const cz = (run.z + (run.axis === "z" ? run.length / 2 : 0.5)) * tileSize;

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx, sy / 2, cz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    meshes.push(mesh);
    geometries.push(geo);
  }

  return { group, meshes, geometries };
}
