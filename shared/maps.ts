// Shared map definitions used by client renderer and server simulation.
// Tile legend:
//   W = wall, D = door, S = player spawn, X = exit, K = key,
//   H = hiding spot, E = enemy (Observer) spawn, '.' = floor,
//   B = battery (refills flashlight charge), N = note (lore page collectible).

export type ColorProfile = {
  fogColor: number;
  fogDensity: number;
  ambientColor: number;
  ambientIntensity: number;
  hemiSky: number;
  hemiGround: number;
};

export type MapDef = {
  name: string;
  summary: string;
  difficulty: number;
  timer: number;
  claudeSpeed: number;
  theme: "kitchen" | "house" | "nightmare";
  raw: string[];
  /** Tile-coord waypoints the Observer cycles through when not chasing. */
  patrolWaypoints: { x: number; z: number }[];
  /** Per-map color identity: fog, ambient, hemisphere fill. */
  colorProfile: ColorProfile;
};

export const TILE_SIZE = 4;
export const WALL_HEIGHT = 4;

export const MAP_KEYS = ["easy", "normal", "hard"] as const;
export type MapKey = (typeof MAP_KEYS)[number];

export const MAPS: Record<MapKey, MapDef> = {
  easy: {
    name: "The Farmhouse",
    summary:
      "Wood-floored rooms — bedroom, bathroom, kitchen — connected by a creaking hallway.",
    difficulty: 1,
    timer: 240,
    claudeSpeed: 3.0,
    theme: "kitchen",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // 0
      "WS....W..H..W..........N.....W", // 1 bedroom | bathroom | living
      "W.....W.....W..............W.W", // 2
      "W.....D.....D..............W.W", // 3
      "W..K..W..B..W..............W.W", // 4
      "WWDWWWWWWDWWWWWWWWWWDWWWWWWW.W", // 5
      "W..H........W........W.....D.W", // 6 hallway
      "W...N.......D........D.....W.W", // 7
      "W...........W........W.....W.W", // 8
      "WWWWWWWWWWWWW........WWWWWWW.W", // 9
      "W.....W.....W........W.......W", // 10
      "W..H..W..K..W........W..B....W", // 11 pantry | dining | kitchen
      "W.....D.....D........D...K...W", // 12
      "W.....W.....W........W.......W", // 13
      "WWWDWWWWWDWWWWWWDWWWWWWWWDWWWW", // 14
      "W....W..W....W.E.....W..W....W", // 15 exit corridor (segmented)
      "W....W..W....W....N..W..W....W", // 16
      "W....D..D....D.......D..D...XW", // 17
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // 18
    ],
    // Observer cycles through hallway and kitchen when player hides.
    patrolWaypoints: [
      { x: 6, z: 7 },
      { x: 14, z: 7 },
      { x: 22, z: 7 },
      { x: 22, z: 12 },
      { x: 14, z: 12 },
      { x: 6, z: 12 },
    ],
    // Warm amber, oil-lamp glow.
    colorProfile: {
      fogColor: 0x18120a,
      fogDensity: 0.038,
      ambientColor: 0x2a1a10,
      ambientIntensity: 0.18,
      hemiSky: 0x4a3018,
      hemiGround: 0x180c04,
    },
  },
  normal: {
    name: "The Mill",
    summary:
      "Tighter L-shaped halls and grain rooms. The Observer prowls the central spine.",
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.2,
    theme: "house",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // 0
      "WS...W..K..W..H..W..N.W..K...W", // 1
      "W....W.....W.....W....W......W", // 2
      "W....D.....D.....D....W..H...W", // 3
      "W....W.....W.....W....W......W", // 4
      "WWDWWWWWDWWWWWDWWWWDWWWWWWWWWW", // 5
      "W..H.....W........D..........W", // 6 spine hallway
      "W........D...K....W......B...W", // 7
      "W........W........W..........W", // 8
      "WWWWWWWWWW.WWWWWWWWWWWWWWWDWWW", // 9 narrow pinch
      "W....W...........W....W......W", // 10
      "W..H.W....E......D....W..H...W", // 11 main hall (Observer spawn)
      "W....D......N....W....D......W", // 12
      "W....W...........W....W......W", // 13
      "WWWWWWWWDWWWWWWWWWWDWWWWWWWWWW", // 14
      "W....W..W....W....W..W....W..W", // 15 segmented south corridor
      "W..K.D..D..B.D..K.D..D....D..W", // 16
      "W....W..W..N.W....W..W....W.XW", // 17
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // 18
    ],
    patrolWaypoints: [
      { x: 5, z: 6 },
      { x: 14, z: 7 },
      { x: 24, z: 6 },
      { x: 24, z: 11 },
      { x: 14, z: 11 },
      { x: 5, z: 11 },
    ],
    // Cold steel blue, fluorescent.
    colorProfile: {
      fogColor: 0x0e1418,
      fogDensity: 0.046,
      ambientColor: 0x101820,
      ambientIntensity: 0.14,
      hemiSky: 0x26364f,
      hemiGround: 0x080a10,
    },
  },
  hard: {
    name: "The Basement",
    summary:
      "A boiler-room maze. Few hiding spots, blind corners, and a fast Observer.",
    difficulty: 3,
    timer: 120,
    claudeSpeed: 5.4,
    theme: "nightmare",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // 0
      "WS.WN.K..W....W..K..W..H...W.W", // 1
      "W..W.....W....W.....W......W.W", // 2
      "W..D.....W....D.....W......D.W", // 3
      "W..W.WWWWW....W.WWWWW.WWWW.W.W", // 4
      "W..W.W...D....D...W...W..K.W.W", // 5
      "W..W.W...W....W...W...W....W.W", // 6
      "WWDWWW.WWWWDWWWWW.WWW.W.WWWWWW", // 7
      "W..H...W....K....D....W......W", // 8
      "W......D.....E...W....D..H...W", // 9 Observer chamber
      "W..B...W.........W....W......W", // 10
      "WWWWWW.WWWWWWWWWWWWWWWWWWWWWWW", // 11 spine pinch
      "W....W.W..N.W....W....W..K...W", // 12
      "W..H.D.D....D....D....D......W", // 13
      "W....W.W....W....W....W......W", // 14
      "WWDWWWWWDWWWWWDWWWWWDWWWWWWDWW", // 15
      "W....W.....W..B..W..N..W.....W", // 16
      "W..K.D.....D..H..D.....D....XW", // 17
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // 18
    ],
    patrolWaypoints: [
      { x: 7, z: 9 },
      { x: 16, z: 9 },
      { x: 24, z: 9 },
      { x: 24, z: 13 },
      { x: 14, z: 13 },
      { x: 5, z: 13 },
      { x: 5, z: 17 },
      { x: 24, z: 17 },
    ],
    // Sickly red-black boiler menace.
    colorProfile: {
      fogColor: 0x0a0808,
      fogDensity: 0.058,
      ambientColor: 0x180808,
      ambientIntensity: 0.10,
      hemiSky: 0x3a0a0a,
      hemiGround: 0x100404,
    },
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
  /** Battery pickups — refill flashlight charge. */
  batteries: { x: number; z: number }[];
  /** Note pickups — lore pages, count toward map total. */
  notes: { x: number; z: number }[];
};

export function parseMap(map: MapDef): ParsedMap {
  const rows: string[] = [];
  let width = 0;
  map.raw.forEach(row => {
    const trimmed = row.trim();
    rows.push(trimmed);
    width = Math.max(width, trimmed.length);
  });
  const tiles = rows.map(row => row.padEnd(width, "W").split(""));
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
    batteries: [],
    notes: [],
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
        case "B":
          result.batteries.push({ x, z });
          break;
        case "N":
          result.notes.push({ x, z });
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
