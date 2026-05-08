// client/src/game/pathfinding.ts
// A* on the parsed tile grid. Called by engine.ts every 0.5 seconds
// (not every frame) to compute the Observer's path to the player.
//
// Returns world-space waypoints (center of each tile). The engine follows
// them sequentially, popping each waypoint when within 0.5 world units.
//
// Supports 8-directional movement with corner-cutting prevention so the
// Observer can't clip diagonally through wall junctions.
//
// Capped at MAX_ITERATIONS to prevent frame spikes on large maps. If the
// cap is hit, the partial result is discarded and the engine falls back to
// a direct beeline for one update cycle — this is visible as a momentary
// straight-line approach and is acceptable at 0.5s update frequency.

import { isBlocked, TILE_SIZE, type ParsedMap } from "@shared/maps";

type Node = {
  x: number;
  z: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
};

const MAX_ITERATIONS = 1200;
const DIAGONAL_COST = 1.414;
const CARDINAL_COST = 1.0;

// 8-directional neighbor offsets: [dx, dz, cost]
const DIRS: [number, number, number][] = [
  [1, 0, CARDINAL_COST],
  [-1, 0, CARDINAL_COST],
  [0, 1, CARDINAL_COST],
  [0, -1, CARDINAL_COST],
  [1, 1, DIAGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
];

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  // Octile distance — admissible for 8-directional A*
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return CARDINAL_COST * Math.max(dx, dz) + (DIAGONAL_COST - CARDINAL_COST) * Math.min(dx, dz);
}

function key(x: number, z: number): number {
  // Pack into a single int for fast Map key. Assumes map < 512 tiles wide.
  return (z << 9) | x;
}

function tileOf(worldCoord: number): number {
  return Math.floor(worldCoord / TILE_SIZE);
}

function tileCenter(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

/**
 * Find a path from world-space (startX, startZ) to (goalX, goalZ).
 *
 * @returns Array of world-space waypoints to follow (excluding start),
 *          empty array if already at goal, or null if no path found.
 */
export function findPath(
  parsed: ParsedMap,
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  closedTiles?: Set<string>
): { x: number; z: number }[] | null {
  const sx = tileOf(startX);
  const sz = tileOf(startZ);
  const gx = tileOf(goalX);
  const gz = tileOf(goalZ);

  // Treat slammed doors as walls during the search.
  const isClosed = (x: number, z: number) =>
    isBlocked(parsed, x, z) || (closedTiles?.has(`${x},${z}`) ?? false);

  if (sx === gx && sz === gz) return [];
  if (isClosed(gx, gz)) {
    // Goal is in a wall or closed door — try adjacent open tile.
    const adj = findNearestOpen(parsed, gx, gz);
    if (!adj) return null;
    return findPath(
      parsed,
      startX,
      startZ,
      tileCenter(adj.x),
      tileCenter(adj.z),
      closedTiles
    );
  }

  // Open set as a flat array — small maps (<30×18) make this fast enough
  // without a proper heap. Upgrade to a binary heap if maps grow to 60+×60+.
  const open: Node[] = [];
  const openMap = new Map<number, Node>();
  const closedMap = new Map<number, Node>();

  const startNode: Node = {
    x: sx, z: sz,
    g: 0, h: heuristic(sx, sz, gx, gz),
    f: 0, parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.push(startNode);
  openMap.set(key(sx, sz), startNode);

  let iterations = 0;

  while (open.length > 0 && iterations++ < MAX_ITERATIONS) {
    // Pop lowest-f node
    let lowestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[lowestIdx].f) lowestIdx = i;
    }
    const current = open[lowestIdx];
    open.splice(lowestIdx, 1);
    openMap.delete(key(current.x, current.z));
    closedMap.set(key(current.x, current.z), current);

    if (current.x === gx && current.z === gz) {
      return reconstructPath(current);
    }

    for (const [dx, dz, cost] of DIRS) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      const nkey = key(nx, nz);

      if (closedMap.has(nkey)) continue;
      if (isClosed(nx, nz)) continue;

      // Corner-cutting prevention: don't allow diagonal if either cardinal
      // neighbor is blocked — prevents sliding through wall junctions.
      if (dx !== 0 && dz !== 0) {
        if (isClosed(current.x + dx, current.z)) continue;
        if (isClosed(current.x, current.z + dz)) continue;
      }

      const g = current.g + cost;
      const existing = openMap.get(nkey);

      if (existing && g >= existing.g) continue;

      const node: Node = {
        x: nx, z: nz,
        g,
        h: heuristic(nx, nz, gx, gz),
        f: g + heuristic(nx, nz, gx, gz),
        parent: current,
      };

      if (existing) {
        // Update in place — splice out old, push updated
        const idx = open.indexOf(existing);
        if (idx !== -1) open.splice(idx, 1);
      }
      open.push(node);
      openMap.set(nkey, node);
    }
  }

  return null;
}

function reconstructPath(end: Node): { x: number; z: number }[] {
  const path: { x: number; z: number }[] = [];
  let n: Node | null = end;
  while (n) {
    path.unshift({ x: tileCenter(n.x), z: tileCenter(n.z) });
    n = n.parent;
  }
  return path.slice(1); // drop start tile
}

function findNearestOpen(
  parsed: ParsedMap,
  gx: number,
  gz: number
): { x: number; z: number } | null {
  // BFS outward from blocked goal to find nearest open tile
  const visited = new Set<number>();
  const queue: [number, number][] = [[gx, gz]];
  visited.add(key(gx, gz));
  let depth = 0;
  while (queue.length > 0 && depth++ < 8) {
    const [cx, cz] = queue.shift()!;
    for (const [dx, dz] of [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ] as [number, number][]) {
      const nx = cx + dx;
      const nz = cz + dz;
      const nkey = key(nx, nz);
      if (visited.has(nkey)) continue;
      visited.add(nkey);
      if (!isBlocked(parsed, nx, nz)) return { x: nx, z: nz };
      queue.push([nx, nz]);
    }
  }
  return null;
}
