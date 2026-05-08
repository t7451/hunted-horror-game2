// Shared map definitions used by client renderer and server simulation.
// Tile legend:
//   W = wall, D = door, S = player spawn, X = exit, K = key,
//   H = hiding spot, E = enemy (Observer) spawn, '.' = floor (wood),
//   B = battery (refills flashlight charge), N = note (lore page collectible),
//   ',' = carpet floor, ':' = stone floor, ';' = creaky floor.
// Surface chars are walkable like '.' — they only affect footstep audio
// (see FootstepSystem + getSurface).

export type SurfaceKind = "wood" | "carpet" | "stone" | "creaky";

/** Return the FootstepSystem surface kind for a map tile char. */
export function getSurface(tile: string): SurfaceKind {
  switch (tile) {
    case ",":
      return "carpet";
    case ":":
      return "stone";
    case ";":
      return "creaky";
    default:
      return "wood";
  }
}

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
      "Bedrooms, bath, study and parlor connect to a creaking hallway, kitchen wing, mudroom closets and an exit corridor.",
    difficulty: 1,
    timer: 240,
    claudeSpeed: 3.0,
    theme: "kitchen",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS....W..H..W..N..W.....W............W.W",
      "W.....W.....W.....W.....W..H.........W.W",
      "W.....D.....D.....D.....D............D.W",
      "W..K..W..B..W.....W..N..W..K.........W.W",
      "WWDWWWWWWDWWWWDWWWWWWDWWWWWWWWDWWWWWWWDW",
      "W..H........................W.....W....W",
      "W...........................D.....D....W",
      "W...N....................N..W..K..W....W",
      "WWWWWWWWWWWWDWWWWWWWWWWWWWWDWWWWWWWWWW.W",
      "W....W..H..W............W.H..W.........W",
      "W....W.....D............W....D.........W",
      "W..H.D.....W..K....N....D....W..B..K...W",
      "W....W.....W............W....D.........W",
      "W....W.....W..H.........W....W.........W",
      "WWWWWWWDWWWWWWWWWDWWWWWWWWDWWWWWWWWWWWWW",
      "W....W....W....W..B..W...W....W....W..KW",
      "W....D....D....D.....D...D....D....D...W",
      "W..K.W..N.W....W.....W...W..H.W....W...W",
      "WWWWWWWWWWWWWDWWWWWWWWWWWWWWWWWWWWWDWWWW",
      "W..............E.....W................XW",
      "W..N........H........D....B......H.....W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
    // Observer sweeps the hallway, kitchen wing, mudroom and exit run.
    patrolWaypoints: [
      { x: 6, z: 7 },
      { x: 16, z: 7 },
      { x: 26, z: 7 },
      { x: 32, z: 12 },
      { x: 18, z: 12 },
      { x: 6, z: 12 },
      { x: 12, z: 17 },
      { x: 26, z: 17 },
      { x: 32, z: 21 },
      { x: 12, z: 21 },
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
      "Six grain rooms feed a tight L-shaped spine, central operations floor and segmented boiler corridor before the exit.",
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.2,
    theme: "house",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS....W..K..W..H..W..N..W..B..W..K..W..H.W",
      "W.....W.....W.....W.....W.....W.....W....W",
      "W.....W.....W.....W.....W.....W.....W....W",
      "W..N..W..H..W..K..W..H..W..N..W..H..W..K.W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWW",
      "W..H...W..............W.......H......W...W",
      "W......D....K.....N...D.....H........D...W",
      "W..N...W..............W..K...........W.H.W",
      "WWWDWWWWWWWDWWWWWDWWWWWWWDWWWWWWWDWWWWWDWW",
      "W..H.W......W..K...W...H..W.N..W..H.W....W",
      "W....D...N..D......D...K..D....D....D....W",
      "W.K..W......W...H..W...E..W..H.W.N..W....W",
      "W....D...H..D......D......D....D....D.B..W",
      "W..N.W..K...W...H..W......W.K..W....W.H..W",
      "WWWDWWWWDWWWWWWDWWWWWWDWWWWWDWWWWDWWWWWDWW",
      "W..H.W....W..B.W....W..N..W..H.W....W..K.W",
      "W....D..K.D....D....D.....D....D.N..D....W",
      "W..N.W..H.W..K.W....W..B..W..H.W....W..H.W",
      "WWWDWWWWDWWWWWWWWWDWWWWWWWWWDWWWWWWWWWWDWW",
      "W..K..W.......N......W......H.......N....W",
      "W..B..D.......H......D......B..........X.W",
      "W..H..W.......K......W......N.......H....W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
    patrolWaypoints: [
      { x: 4, z: 7 },
      { x: 14, z: 7 },
      { x: 26, z: 7 },
      { x: 38, z: 7 },
      { x: 28, z: 12 },
      { x: 16, z: 12 },
      { x: 4, z: 12 },
      { x: 14, z: 17 },
      { x: 26, z: 17 },
      { x: 38, z: 17 },
      { x: 12, z: 21 },
      { x: 30, z: 21 },
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
      "A boiler-room maze of cells, a central Observer chamber, looping mid corridor, lower cells and a sub-basement before the exit.",
    difficulty: 3,
    timer: 120,
    claudeSpeed: 5.4,
    theme: "nightmare",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS.WN.K.W.H...W.K...W.H...W..N..W..K..W.H..W",
      "W..W....W.....W.....W.....W.....W.....W....W",
      "W..D....W.....D.....W.....D.....W.....D....W",
      "W..W.W..W..W..W..W..W..W..W..W..W..W..W....W",
      "W..D.WK.D..W..D.NW..D..W..D.HW..D..WB.D....W",
      "WH.W....W.K...W.....W.B...W.....W..H..W.N..W",
      "WWDWWWWWWWWDWWWWWWDWWWWWWWWDWWWWWWWDWWWWWDWW",
      "W.H....W....K.....W.....H...W...H...W...B..W",
      "W......D.....E....D....N....D...K...D....H.W",
      "W..B...W....N.....W......H..W...H...W...K..W",
      "WWWWWWDWWWWWWWWWWWWWWWDWWWWWWWWWWWWWWWDWWWWW",
      "W.H..W..N..W.B...W.H..W..K..W.H..W.N..W..H.W",
      "W.K..D..H..D.....D.N..D..H..D....D....D..B.W",
      "W.N..W..K..W.H...W.B..W..N..W.K..W.H..W..K.W",
      "WWDWWWWWDWWWWWDWWWWWDWWWWWWDWWWWWDWWWWWWWDWW",
      "W.H..W..B..W..N..W..K..W..H..W..N..W..B..WKW",
      "W.K..D.....D..H..D.....D..K..D.....D..N..D.W",
      "W.B..W..H..W..K..W..N..W..H..W..K..W..H..WHW",
      "WWWWDWWWWWWWWDWWWWWWWWWWWWDWWWWWWWWWWWWDWWWW",
      "W.H....W......N...B...W.....K......W....H..W",
      "W..K...D......H.......D.....B......D....N..W",
      "W.N....W......K...H...W.....H......W....B..W",
      "WWWWWWWWWWWWDWWWWWWWWWWWWWWWWWDWWWWWWWWWWWWW",
      "W..H........N.....W......B.........H.......W",
      "W..N........H.....D......K.........H.....X.W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
    patrolWaypoints: [
      { x: 6, z: 9 },
      { x: 18, z: 9 },
      { x: 30, z: 9 },
      { x: 40, z: 9 },
      { x: 30, z: 13 },
      { x: 16, z: 13 },
      { x: 6, z: 13 },
      { x: 8, z: 17 },
      { x: 22, z: 17 },
      { x: 36, z: 17 },
      { x: 14, z: 21 },
      { x: 28, z: 21 },
      { x: 38, z: 25 },
      { x: 8, z: 25 },
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
