// Shared map definitions used by client renderer and server simulation.
// Tile legend:
//   W = wall, D = door, S = player spawn, X = exit, K = key,
//   H = hiding spot, E = enemy (Claude) spawn, P = pickup, '.' = floor.

export type MapDef = {
  name: string;
  summary: string;
  difficulty: number;
  timer: number;
  claudeSpeed: number;
  theme: "kitchen" | "house" | "nightmare";
  raw: string[];
};

export const TILE_SIZE = 4;
export const WALL_HEIGHT = 4;

export const MAP_KEYS = ["easy", "normal", "hard"] as const;
export type MapKey = (typeof MAP_KEYS)[number];

export const MAPS: Record<MapKey, MapDef> = {
  easy: {
    name: "Granny's Kitchen",
    summary: "A shorter escape route with wide halls and slower pursuit.",
    difficulty: 1,
    timer: 240,
    claudeSpeed: 3.0,
    theme: "kitchen",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W...W",
      "W.....D.....D.....D.....D...W",
      "W.....W.....W.....W.....W...W",
      "W..H..W..K..W..H..W..K..W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W...W",
      "W..K..D.....D.....D.....D...W",
      "W.....W.....W.....W.....W...W",
      "W..H..W.....W..H..W.....W...W",
      "WWWDWWWWWWWWWWWDWWWWWDWWWWWWWW",
      "W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W...W",
      "W.....D.....D.....D.....D...W",
      "W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W..XW",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
  },
  normal: {
    name: "Granny's House",
    summary: "More keys, more closets, and Claude starts in the center hall.",
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.2,
    theme: "house",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS....W.....D.....W.....K....W",
      "W.....W.....W.....W..........W",
      "W..H..D..K..W..H..D....W.....W",
      "W.....W.....W.....W....W.....W",
      "WWWDWWWWWDWWWWWDWWWWDWWWWWDWWW",
      "W.....W.....W.....W....W.....W",
      "W..K..D.....D..E..D....D..H..W",
      "W.....W.....W.....W....W.....W",
      "WWWDWWWWWDWWWWWDWWWWDWWWWWDWWW",
      "W..H..W.....W.....W....W.....W",
      "W.....D..K..D.....D....D.....W",
      "W.....W.....W.....W....W..K..W",
      "WWWDWWWWWDWWWWWDWWWWDWWWWWDWWW",
      "W.....W.....W.....W....W.....W",
      "W..K..D.....D..H..D....D.....W",
      "W.....W.....W.....W....W...X.W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
  },
  hard: {
    name: "Granny's Nightmare",
    summary:
      "A tighter maze with less time, fewer safe closets, and faster Claude.",
    difficulty: 3,
    timer: 120,
    claudeSpeed: 5.4,
    theme: "nightmare",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS.D...W.D...W.....D...W.K...W",
      "W.W.W..W.W.W.W.WWW.W.W.W.W.W.W",
      "W.W.K..D...W.W...W...W.D...W.W",
      "W.W.WWWW.WWWDWWW.WWWWW.WWW.W.W",
      "W...W....W.....W.....W.....W.W",
      "WWW.W.WWWW.WWW.WWWWW.WWWWWDWWW",
      "W...D...K..W...D...E..W......W",
      "W.WWWWWWWWWW.WWWWWWW.WWWWWW.W",
      "W...W.....H..W.....W.....K...W",
      "WWW.W.WWWWWWWWDWWWWWDWWWWWWWWW",
      "W.K.W.....W.....W.....W......W",
      "W.W.WWWWW.W.WWW.W.WWW.W.WWW.W",
      "W...D.....D...H.D.....D...W..W",
      "WWW.WWWWWWWWWWWWWWW.WWWWWDWWW",
      "W.....W.....K.....W.....W....W",
      "W.WWW.W.WWWWWWWWW.WWW.W.WW.XW",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
  },
};

export type ParsedMap = {
  width: number;
  height: number;
  tiles: string[][];
  spawn: { x: number; z: number };
  exit: { x: number; z: number } | null;
  keys: { x: number; z: number }[];
  hides: { x: number; z: number }[];
  doors: { x: number; z: number }[];
  walls: { x: number; z: number }[];
  enemy: { x: number; z: number } | null;
};

export function parseMap(map: MapDef): ParsedMap {
  const width = Math.max(...map.raw.map(row => row.length));
  const tiles = map.raw.map(row => row.padEnd(width, "W").split(""));
  const height = tiles.length;
  const result: ParsedMap = {
    width,
    height,
    tiles,
    spawn: { x: 1, z: 1 },
    exit: null,
    keys: [],
    hides: [],
    doors: [],
    walls: [],
    enemy: null,
  };
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const c = tiles[z][x];
      switch (c) {
        case "W":
          result.walls.push({ x, z });
          break;
        case "D":
          result.doors.push({ x, z });
          break;
        case "K":
          result.keys.push({ x, z });
          break;
        case "H":
          result.hides.push({ x, z });
          break;
        case "S":
          result.spawn = { x, z };
          break;
        case "X":
          result.exit = { x, z };
          break;
        case "E":
          result.enemy = { x, z };
          break;
      }
    }
  }
  return result;
}

export function tileAt(parsed: ParsedMap, gx: number, gz: number): string {
  if (gz < 0 || gz >= parsed.height || gx < 0 || gx >= parsed.width) return "W";
  return parsed.tiles[gz][gx];
}

export function isBlocked(parsed: ParsedMap, gx: number, gz: number): boolean {
  const t = tileAt(parsed, gx, gz);
  return t === "W";
}
