import * as THREE from "three";
import { WALL_HEIGHT } from "@shared/maps";

// Moonlit windows on exterior walls. A window is mounted on a wall tile whose
// interior side (one cardinal neighbor) is walkable floor and whose exterior
// side (the opposite neighbor) is out of bounds or solid wall with nothing
// beyond — i.e. the wall faces the outside world rather than another room.
//
// Each window is a recessed frame around an emissive pane tinted cold blue, so
// it reads as moonlight even though the scene has no real exterior. The pane is
// emissive-only (it adds no PointLight by default) to keep the light budget
// free; the caller may register a small spill light per window if desired.
//
// Geometry is merged into a single frame mesh + a single pane mesh (two draw
// calls total regardless of window count) since all frames share one material
// and all panes share one material.

export type WindowPlacement = {
  /** World-space center of the pane (on the wall face). */
  x: number;
  y: number;
  z: number;
  /** Inward normal (unit) pointing from wall into the room. */
  nx: number;
  nz: number;
  rotationY: number;
};

type Tiles = { width: number; height: number; tiles: string[][] };

const FLOORISH = new Set([".", ",", ":", ";", "S", "X", "K", "H", "B", "N", "E"]);

function isFloorish(t: Tiles, x: number, z: number): boolean {
  if (z < 0 || z >= t.height || x < 0 || x >= t.width) return false;
  return FLOORISH.has(t.tiles[z][x]);
}

function isWall(t: Tiles, x: number, z: number): boolean {
  if (z < 0 || z >= t.height || x < 0 || x >= t.width) return true; // OOB = solid
  return t.tiles[z][x] === "W";
}

/**
 * Returns true when the tile on the far side of an exterior wall is "the
 * outside" — out of bounds, or a wall whose own far neighbor is also OOB/wall
 * (so we're not punching a window into an interior partition).
 */
function facesOutside(t: Tiles, wx: number, wz: number, dx: number, dz: number): boolean {
  const ex = wx + dx;
  const ez = wz + dz;
  if (ex < 0 || ez < 0 || ex >= t.width || ez >= t.height) return true;
  // Exterior neighbor must be solid wall (not a room), and the tile beyond it
  // must also be solid/OOB so we don't look into an adjacent interior room.
  if (t.tiles[ez][ex] !== "W") return false;
  return isWall(t, ex + dx, ez + dz);
}

export function buildWindows(
  parsed: Tiles,
  tileSize: number,
  rng: () => number
): { group: THREE.Group; placements: WindowPlacement[] } {
  const group = new THREE.Group();
  group.name = "windows";

  const interiorDirs = [
    { dx: 1, dz: 0, rotY: Math.PI / 2 },
    { dx: -1, dz: 0, rotY: -Math.PI / 2 },
    { dx: 0, dz: 1, rotY: 0 },
    { dx: 0, dz: -1, rotY: Math.PI },
  ];

  const placements: WindowPlacement[] = [];
  const usedTiles = new Set<string>();

  for (let z = 0; z < parsed.height; z++) {
    for (let x = 0; x < parsed.width; x++) {
      if (parsed.tiles[z][x] !== "W") continue;
      if (usedTiles.has(`${x},${z}`)) continue;
      for (const dir of interiorDirs) {
        const ix = x + dir.dx;
        const iz = z + dir.dz;
        // Interior side must be walkable floor.
        if (!isFloorish(parsed, ix, iz)) continue;
        // Exterior side (opposite the interior) must face outside.
        if (!facesOutside(parsed, x, z, -dir.dx, -dir.dz)) continue;
        // Sparse: only ~28% of eligible exterior faces get a window so they
        // read as deliberate openings, not a glass curtain wall.
        if (rng() > 0.28) continue;

        const cx = x * tileSize + tileSize / 2;
        const cz = z * tileSize + tileSize / 2;
        // Pane sits just proud of the interior wall face.
        const faceOffset = tileSize / 2 - 0.06;
        const px = cx + dir.dx * faceOffset;
        const pz = cz + dir.dz * faceOffset;
        const py = WALL_HEIGHT * 0.55;
        placements.push({
          x: px,
          y: py,
          z: pz,
          nx: dir.dx,
          nz: dir.dz,
          rotationY: dir.rotY,
        });
        usedTiles.add(`${x},${z}`);
        break; // one window per wall tile
      }
    }
  }

  if (placements.length === 0) return { group, placements };

  // ── Merged pane mesh (emissive moonlight) ──────────────────────────────
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0x0a1020,
    emissive: 0x5878b0,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.0,
  });
  const paneW = tileSize * 0.5;
  const paneH = WALL_HEIGHT * 0.5;
  const paneGeo = new THREE.PlaneGeometry(paneW, paneH);
  const paneMesh = new THREE.InstancedMesh(paneGeo, paneMat, placements.length);
  paneMesh.name = "window_panes";

  // ── Frame mesh (wood mullions + surround) merged per window ────────────
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x241a12,
    roughness: 0.85,
    metalness: 0.04,
  });
  // Build a single-window frame geometry, then instance it.
  const frameGeo = buildFrameGeometry(paneW, paneH);
  const frameMesh = new THREE.InstancedMesh(frameGeo, frameMat, placements.length);
  frameMesh.name = "window_frames";
  frameMesh.castShadow = false;
  frameMesh.receiveShadow = true;

  const tmp = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    tmp.position.set(p.x, p.y, p.z);
    tmp.rotation.set(0, p.rotationY, 0);
    tmp.updateMatrix();
    paneMesh.setMatrixAt(i, tmp.matrix);
    frameMesh.setMatrixAt(i, tmp.matrix);
  }
  paneMesh.instanceMatrix.needsUpdate = true;
  frameMesh.instanceMatrix.needsUpdate = true;

  group.add(paneMesh);
  group.add(frameMesh);
  return { group, placements };
}

// Cross-mullion + surround for one window, centered at origin in the XY plane
// (matches PlaneGeometry orientation; rotated with the pane by the instance
// matrix). Slight +Z offset keeps the frame proud of the pane.
function buildFrameGeometry(paneW: number, paneH: number): THREE.BufferGeometry {
  const t = 0.06; // mullion thickness
  const d = 0.08; // depth proud of pane
  const halfW = paneW / 2;
  const halfH = paneH / 2;
  const boxes: { x: number; y: number; w: number; h: number }[] = [
    // Surround
    { x: 0, y: halfH, w: paneW + t * 2, h: t },
    { x: 0, y: -halfH, w: paneW + t * 2, h: t },
    { x: -halfW, y: 0, w: t, h: paneH + t * 2 },
    { x: halfW, y: 0, w: t, h: paneH + t * 2 },
    // Cross mullions
    { x: 0, y: 0, w: paneW, h: t * 0.7 },
    { x: 0, y: 0, w: t * 0.7, h: paneH },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, d);
    g.translate(b.x, b.y, d / 2);
    const ni = g.toNonIndexed();
    const p = ni.attributes.position.array as Float32Array;
    const n = ni.attributes.normal.array as Float32Array;
    const u = ni.attributes.uv.array as Float32Array;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
    for (let i = 0; i < u.length; i++) uvs.push(u[i]);
    g.dispose();
    ni.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
