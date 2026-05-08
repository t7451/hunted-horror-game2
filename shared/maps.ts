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
    name: "Ravenshade Farmhouse",
    summary:
      "A believable farmhouse with bedrooms, parlor, pantry, cellar stairs, mudroom closets, creaky service halls and a back-porch escape route.",
    difficulty: 1,
    timer: 240,
    claudeSpeed: 3.0,
    theme: "kitchen",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS,,,,,,,,,W,,,,,,,,,,,,W,,,,,,,,,,,,,,,,W",
      "W,,,,,,,H,,W,,,,,N,,,,,,W,,,,,,,,,,,B,,,,W",
      "W,,,,,,,,,,D,,,,,,,,,,,,D,,,,,,,,,,,,,,,,W",
      "W,,,,,,,,,,W,,,,,,,,,,,,W,,,,,,,,,,,,,,,,W",
      "WWWWWDWWWWWWWWWWWDWWWWWWWWWWWWWDWWWWWWWWWW",
      "W;;;;;;;;;;W............W::::::::::::::::W",
      "W;;;;;;;;;;W............W::::::::::::::::W",
      "W;;;;;;;;;;W........E...W::::::::N:::::::W",
      "W;WWDWWW;;;D............D::::::::::::::::W",
      "W;;;;;;W;;;W............W::::::::::::::::W",
      "W;;;K;;D;;;W.......H....W::::::::::::K:::W",
      "W;;;;;;W;;;W............W::::::::::::::::W",
      "WWWWWWWWDWWWWWWWWWWWWDWWWWWWWWWWWWDWWWWWWW",
      "W...............W,,,,,,,,,,,,W;;;;;W;;;;;W",
      "W...............W,,,,,,,,,,,,W;;;;;W;;;;;W",
      "W....B..........W,,,,N,,,,,,,W;;;H;D;;;;;W",
      "W...............W,,,,,,,,,,,,D;;;;;W;;;;;W",
      "W.WWWWWDWWWWWWW.D,,,,,,,,,,,,W;;;;;W;;;;;W",
      "W.........W.....W,,,,,,,,,,,,W;WWWWWDWWW;W",
      "W.........D.....W,,,,,,,,,,,,W;;;;;;;;;;;W",
      "W.........W..K..W,,,,,,,,,,,,D;;;;;;;;K;;W",
      "W.........W.....W,,,,,,,,H,,,W;;;;;;;;;X;W",
      "W.........W.....W,,,,,,,,,,,,W;;;;;;;;;;;W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
    // The enemy patrols the bedrooms, parlor, kitchen, cellar approach and porch run.
    // The enemy loops the foyer, dining wing, atrium, library, servant rooms and conservatory.
    patrolWaypoints: [
      { x: 6, z: 3 },
      { x: 18, z: 3 },
      { x: 33, z: 8 },
      { x: 20, z: 8 },
      { x: 5, z: 11 },
      { x: 8, z: 16 },
      { x: 22, z: 17 },
      { x: 35, z: 21 },
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
    name: "Blackwood Manor",
    summary:
      "A manor floor with a foyer, study, library, dining wing, atrium loop, servant rooms and a broken conservatory exit.",
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.2,
    theme: "house",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS,,,,,,,,,,,,,W..............W,,,,,,,,,,,,,,W",
      "W,,,,N,,,,,,,,,W..............W,,,,,B,,,,,,,,W",
      "W,WWWWWWWWWDWW,D......H.......D,WWDWWWWWWWWW,W",
      "W,,,,,,,,,,,K,,W..............W,,,,,,,,,,,,,,W",
      "W,,,,,,,,,,,,,,W..............W,,,,,,,,,,,K,,W",
      "WWWWWWWDWWWWWWWWWWWWWWDWWWWWWWWWWWWWWWDWWWWWWW",
      "W;;;;;;;;;;;;.:W::::::::::::::W:.............W",
      "W;;;;;;;;;;;;.:W::::K:::::::::W:.............W",
      "W;;;H;;;;;;;;.:W::::::::::::::W:.............W",
      "W;;;;;;;;;;;;.:D:WWWWWDWWWWWW:D:..H..........W",
      "W;;;;;;;;;;;;.:W:W::::::::::W:W:.............W",
      "W;;;;;;;;;N;;.:W:W:::::E::::W:W:..........N..W",
      "W;;;;;;;;;;;;.:W:W::::::::::W:W:.............W",
      "WWWWWDWWWWWWWWWWWDWWWWDWWWWWDWWWWWWWWWWWDWWWWW",
      "W.......W......W,W,,,,,,,,,,W,W;;;;;;;W;;;;;;W",
      "W.......W......W,W,,,,,,,B,,W,W;;;;;;;W;;;;;;W",
      "W.......W......W,W,,,,,,,,,,W,W;;;B;;;W;;;;;;W",
      "W...K...D......W,WWWWWDWWWWWW,W;;;;;;;D;;;;;;W",
      "W.......W......W,,,,,,,,,,,,,,W;;;;;;;W;;;;;;W",
      "W.WWWWWDWWWWWW.D,,,,,,,,,,,,,,D;;;;;;;W;;;;;;W",
      "W.......W......W,,,,,,,,,,,,,,W;WWWWWDWWWWWW;W",
      "W.......W......W,,,,,N,,,,,,,,W;;;;;;;W;;H;;;W",
      "W.......D......W,,,,,,,,,,,,,,W;;;;;;;D;;;;;;W",
      "W.......W...H..W,,,,,,,,,,,K,,W;;;;;;;W;;;;X;W",
      "W.......W......W,,,,,,,,,,,,,,W;;;;;;;W;;;;;;W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
    // The enemy sweeps ward cells, operating rooms, service tunnels and the utility exit.
    patrolWaypoints: [
      { x: 8, z: 4 },
      { x: 23, z: 4 },
      { x: 38, z: 5 },
      { x: 36, z: 10 },
      { x: 23, z: 12 },
      { x: 5, z: 10 },
      { x: 6, z: 19 },
      { x: 22, z: 20 },
      { x: 39, z: 23 },
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
    name: "Saint Orison Sanitarium",
    summary:
      "A harsh asylum/catacomb hybrid with ward cells, operating rooms, service tunnels, locked alcoves and a deep utility exit.",
    difficulty: 3,
    timer: 120,
    claudeSpeed: 5.4,
    theme: "nightmare",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS::::::::::::::W;;;;;;;;;;;;;;W:::::::::::::::W",
      "W:::N:::::::::::W;;;;;H;;;;;;;;W:::K:::::::::::W",
      "W:::::::::::::::W;;;;;;;;;;;;;;W:::::::::::::::W",
      "W:WWWDWWWWWWDWW:D;WWWWWWDWWWWW;D:WWWWWDWWWWWWW:W",
      "W:::::::::::::::W;;;;;;;;;;;;;;W:::::::::::::::W",
      "W::::::::::::K::W;;;;;;;;;;;B;;W::::::::::::H::W",
      "W:::::::::::::::W;;;;;;;;;;;;;;W:::::::::::::::W",
      "WWWWWWDWWWWWWWWWWWWWWWWDWWWWWWWWWWWWWWWWDWWWWWWW",
      "W......W....W...W::::::W:::::::W.;;;;W;;;;;W;;;W",
      "W..B...W....W...W:::N::W:::::::W.;N;;D;;;;;W;;;W",
      "W......D....D...W::::::D:::::::W.;;;;W;;;;;W;;;W",
      "W......W....W...D:WWWWWWWWWWWW:W.;;;;W;;;;KW;;;W",
      "W.WWWWWWWDWWWWW.W::::::W:::::::D.WWWDWWWWWWWDWWW",
      "W......W..H.W...W::::::WE:K::::W.;;;;W;;;;;D;;;W",
      "W......W....W...W::::::W:::::::W.;;;;W;;;;;W;;;W",
      "W.WWDWWWWWWWDWW.W:WWDWWWWWWDWW:W.;;;;D;;;;;W;;;W",
      "W......D....W...W::::::W:::::::W.WWWWWWWDWWWDWWW",
      "W......W....WK..W::::::D:::::H:W.;;;;W;;;;;W;B;W",
      "W......W....W...W::::::W:::::::W.;;;;W;;;;;W;;;W",
      "WWWWWWWWDWWWWWWWWWWWWWWWDWWWWWWWWWWWWWWDWWWWWWWW",
      "W;;;;W;;;;;;;;;;W.........W....W:::::::::W:::::W",
      "W;;;;W;;;;N;;;;;W....B....W....W:::::::::W:K:::W",
      "W;;;;W;;;;;;;;;;W.........W....W:::N:::::D:::::W",
      "W;WWWWDWWWWDWWW;D.WWWWDWWWWWWW.D:WWWWDWWWWWWDWWW",
      "W;;;;W;;;;;;;;;;W.........D....W:::::::::W:::::W",
      "W;;H;D;;;;;;;;;;W.........W..H.W:::::::::W:::X:W",
      "W;;;;W;;;;;;;;K;W.........W....W:::::::::W:::::W",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
    patrolWaypoints: [
      { x: 5, z: 6 },
      { x: 23, z: 6 },
      { x: 39, z: 6 },
      { x: 40, z: 12 },
      { x: 24, z: 14 },
      { x: 8, z: 14 },
      { x: 8, z: 22 },
      { x: 23, z: 23 },
      { x: 39, z: 24 },
      { x: 44, z: 26 },
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
