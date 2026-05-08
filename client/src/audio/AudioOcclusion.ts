// client/src/audio/AudioOcclusion.ts
// Cheap audio occlusion: walk a straight line from sound source to listener
// in tile-grid coordinates, count how many wall tiles the line crosses, and
// return that as an occlusion value. AudioWorld.tickOcclusion runs this at
// ~8Hz per spatial source and lerps the resulting volume into the panner.
//
// Each "wall crossing" adds 35% to the occlusion (capped at 95%) — so one
// wall is muffled but still audible, two walls is barely there, three walls
// is essentially silent. The detection treats consecutive wall tiles as a
// single thick wall (the +inWall+ guard) so a 1-tile-thick partition isn't
// double-counted with neighboring walls in the line.

import type { ParsedMap } from "@shared/maps";

const OCCLUSION_PER_WALL = 0.35;
const MAX_OCCLUSION = 0.95;
const STEP = 0.25;

/**
 * Walks a straight line from (sx, sz) to (lx, lz) in world units, counts
 * how many distinct wall tile spans it crosses. Returns occlusion 0..1.
 */
export function computeOcclusion(
  parsed: ParsedMap,
  tileSize: number,
  sx: number,
  sz: number,
  lx: number,
  lz: number,
): number {
  const dx = lx - sx;
  const dz = lz - sz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.01) return 0;
  const steps = Math.ceil(dist / STEP);
  const stepX = dx / steps;
  const stepZ = dz / steps;

  let walls = 0;
  let inWall = false;
  let cx = sx;
  let cz = sz;
  for (let i = 0; i < steps; i++) {
    cx += stepX;
    cz += stepZ;
    const tx = Math.floor(cx / tileSize);
    const tz = Math.floor(cz / tileSize);
    if (tz < 0 || tz >= parsed.height || tx < 0 || tx >= parsed.width) continue;
    const isWall = parsed.tiles[tz][tx] === "W";
    if (isWall && !inWall) {
      walls++;
      inWall = true;
    } else if (!isWall) {
      inWall = false;
    }
  }
  return Math.min(MAX_OCCLUSION, walls * OCCLUSION_PER_WALL);
}
