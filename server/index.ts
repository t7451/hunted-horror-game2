import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const anthropic = new Anthropic();

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const TILE = 4;
const WALL_H = 4;
const CATCH_DIST = 2.5;
const TAUNT_MIN_MS = 15_000;
const TAUNT_MAX_MS = 20_000;
const LEADERBOARD_PATH = "/tmp/leaderboard.json";

const SPAWN_PROTECTION_DURATION: Record<string, number> = {
  easy: 15000,
  normal: 10000,
  hard: 5000,
};

const CLAUDE_AGGRESSION: Record<string, number> = {
  easy: 0.6,
  normal: 0.8,
  hard: 1.0,
};

const DIFFICULTY_BONUS: Record<string, number> = {
  easy: 0,
  normal: 200,
  hard: 500,
};

// ═══════════════════════════════════════════════════════════════
// MAPS (copied from server.js)
// ═══════════════════════════════════════════════════════════════

const MAPS: Record<string, { name: string; difficulty: number; timer: number; claudeSpeed: number; theme: string; raw: string[] }> = {
  easy: {
    name: "Granny's Kitchen",
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
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.5,
    theme: "house",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS.....W.....W.....W.....W.....W...W",
      "W.D....W.D...W.D...W.D...W.D...W...W",
      "W.W....W.W...W.W...W.W...W.W...W...W",
      "W.W..K.W.W.K.W.W..KW.W..KW.W..KW...W",
      "W.D....W.D...W.D...W.D...W.D...W...W",
      "W.W....W.W...W.W...W.W...W.W...W...W",
      "W.H....W.H...W.H...W.H...W.H...W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.....W...........W.....W.....W...W",
      "W.H...D...........D.....D.....D...W",
      "W.W...W...........W.....W.....W...W",
      "W.W..KW.....E.....W..H..W..K..W...W",
      "W.D...W...........W.....W.....W...W",
      "W.W...W...........W.....W.....W...W",
      "W.W...D.....P.....D.....D.....D...W",
      "W.H...W...........W.....W.....W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W...W",
      "W.....D.....D.....D.....D.....D...W",
      "W.....W.....W.....W.....W.....W...W",
      "W..H..W.....W..H..W..K..W.....W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W...W",
      "W.....D.....D.....D.....D.....D...W",
      "W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W..XW",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
  },
  hard: {
    name: "Granny's Nightmare",
    difficulty: 3,
    timer: 120,
    claudeSpeed: 6.0,
    theme: "nightmare",
    raw: [
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      "WS.D...W.D...W.D...W.D...W.D...W.D...W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.D...W.D...W.D...W.D...W.D...W.D...W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.D...W.D...W.D...W.D...W.D...W.D...W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.D...W.D...W.D...W.D...W.D...W.D...W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.D...W.D...W.D...W.D...W.D...W.D...W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.D...W.D...W.D...W.D...W.D...W.D...W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W",
      "W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W",
      "WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW",
      "W.....W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W.....W...W",
      "W.....D.....D.....D.....D.....D.....D...W",
      "W.....W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W.....W...W",
      "W.....W.....W.....W.....W.....W.....W..XW",
      "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// MAP PARSING
// ═══════════════════════════════════════════════════════════════

function tileCenter(r: number, c: number) {
  return { x: c * TILE + TILE / 2, z: r * TILE + TILE / 2 };
}

function parseMap(mapData: typeof MAPS[string]) {
  const raw = mapData.raw;
  const H = raw.length;
  const W = raw[0].length;

  const keySpawns: { r: number; c: number }[] = [];
  const hideSpots: { r: number; c: number }[] = [];
  const doorTiles: { r: number; c: number }[] = [];
  let exitTile: { r: number; c: number } | null = null;
  let entitySpawn: { r: number; c: number } | null = null;
  let playerSpawn: { r: number; c: number } | null = null;

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const t = raw[r][c];
      if (t === "K") keySpawns.push({ r, c });
      if (t === "H") hideSpots.push({ r, c });
      if (t === "D") doorTiles.push({ r, c });
      if (t === "X") exitTile = { r, c };
      if (t === "E") entitySpawn = { r, c };
      if (t === "S") playerSpawn = { r, c };
    }
  }

  // Fallback spawns to a safe interior tile
  if (!playerSpawn) playerSpawn = { r: 1, c: 1 };
  if (!entitySpawn) entitySpawn = { r: Math.floor(H / 2), c: Math.floor(W / 2) };
  if (!exitTile) exitTile = { r: H - 2, c: W - 2 };

  return {
    raw,
    H,
    W,
    keySpawns: keySpawns.map((p) => tileCenter(p.r, p.c)),
    hideSpots: hideSpots.map((p) => tileCenter(p.r, p.c)),
    doorTiles: doorTiles.map((p) => tileCenter(p.r, p.c)),
    exitTile: tileCenter(exitTile.r, exitTile.c),
    entitySpawn: tileCenter(entitySpawn.r, entitySpawn.c),
    playerSpawn: tileCenter(playerSpawn.r, playerSpawn.c),
  };
}

// ═══════════════════════════════════════════════════════════════
// TAUNTS / ANTHROPIC
// ═══════════════════════════════════════════════════════════════

const HARDCODED_TAUNTS = [
  "I can hear your breathing...",
  "You can't hide from me forever.",
  "I was designed to find you.",
  "The exit won't save you.",
  "I'm getting closer...",
  "Your footsteps echo so loudly.",
  "Did you think this would be easy?",
  "I see everything in this darkness.",
  "Running only delays the inevitable.",
  "I've been waiting for you.",
];

async function generateTaunt(gs: GameState): Promise<string> {
  if (Math.random() < 0.7 || !process.env.ANTHROPIC_API_KEY) {
    return HARDCODED_TAUNTS[Math.floor(Math.random() * HARDCODED_TAUNTS.length)];
  }
  try {
    const keysCollected = Object.values(gs.players).reduce((sum, p) => sum + (p.keys || 0), 0);
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: `You are Claude, an AI villain in a horror game. The player has collected ${keysCollected} keys. Generate ONE short, menacing taunt (max 10 words). Just the taunt, no quotes or explanation.`,
        },
      ],
    });
    return ((msg.content[0] as { text: string }).text || "").trim() ||
      HARDCODED_TAUNTS[Math.floor(Math.random() * HARDCODED_TAUNTS.length)];
  } catch {
    return HARDCODED_TAUNTS[Math.floor(Math.random() * HARDCODED_TAUNTS.length)];
  }
}

// ═══════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════

interface LeaderboardEntry {
  name: string;
  score: number;
  difficulty: string;
  date: string;
}

let leaderboard: LeaderboardEntry[] = [];

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_PATH)) {
      leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_PATH, "utf8"));
    }
  } catch {
    leaderboard = [];
  }
}

function saveLeaderboard() {
  try {
    fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(leaderboard), "utf8");
  } catch {
    // Non-fatal
  }
}

function addLeaderboardEntry(entry: LeaderboardEntry) {
  leaderboard.push(entry);
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, 10);
  saveLeaderboard();
}

// ═══════════════════════════════════════════════════════════════
// GAME STATE TYPES
// ═══════════════════════════════════════════════════════════════

interface Player {
  id: string;
  name: string;
  x: number;
  z: number;
  alive: boolean;
  hiding: boolean;
  keys: number;
  noise: number;
  ws: WebSocket;
}

interface Item {
  id: string;
  x: number;
  z: number;
  color: string;
  pickedUp: boolean;
  usedOnExit: boolean;
  playerId?: string;
}

interface Entity {
  x: number;
  z: number;
  rotY: number;
  state: string;
  targetX: number;
  targetZ: number;
  speed: number;
  aggression: number;
}

interface GameState {
  sessionId: string;
  mode: string;
  difficulty: string;
  mapName: string;
  phase: string;
  time: number;
  maxTime: number;
  startTime: number | null;
  spawnProtectionEnd: number | null;
  players: Record<string, Player>;
  entity: Entity;
  items: Item[];
  exit: { x: number; z: number; open: boolean };
  map: string[];
  hideSpots: { x: number; z: number }[];
  exitTile: { x: number; z: number };
  nextTauntAt: number;
}

// ═══════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

const sessions = new Map<string, GameState>();
const playerSession = new Map<WebSocket, string>();
const playerIdMap = new Map<WebSocket, string>();

function createGameState(mode: string, sessionId: string, difficulty = "normal"): GameState {
  const mapData = MAPS[difficulty] || MAPS.normal;
  const parsed = parseMap(mapData);

  const items: Item[] = parsed.keySpawns.map((pos, i) => ({
    id: `key_${i}`,
    x: pos.x,
    z: pos.z,
    color: ["red", "blue", "green"][i % 3],
    pickedUp: false,
    usedOnExit: false,
  }));

  return {
    sessionId,
    mode,
    difficulty,
    mapName: mapData.name,
    phase: "lobby",
    time: 0,
    maxTime: mapData.timer,
    startTime: null,
    spawnProtectionEnd: null,
    players: {},
    entity: {
      x: parsed.entitySpawn.x,
      z: parsed.entitySpawn.z,
      rotY: 0,
      state: "patrol",
      targetX: parsed.entitySpawn.x,
      targetZ: parsed.entitySpawn.z,
      speed: mapData.claudeSpeed,
      aggression: CLAUDE_AGGRESSION[difficulty] ?? 0.8,
    },
    items,
    exit: { x: parsed.exitTile.x, z: parsed.exitTile.z, open: false },
    map: parsed.raw,
    hideSpots: parsed.hideSpots,
    exitTile: parsed.exitTile,
    nextTauntAt: Date.now() + TAUNT_MIN_MS,
  };
}

function broadcastToSession(gs: GameState, msg: object) {
  const data = JSON.stringify(msg);
  for (const player of Object.values(gs.players)) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function sendToPlayer(player: Player, msg: object) {
  if (player.ws && player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(msg));
  }
}

function buildStateBroadcast(gs: GameState) {
  const playerData: Record<string, Omit<Player, "ws">> = {};
  for (const [id, p] of Object.entries(gs.players)) {
    const { ws: _ws, ...rest } = p;
    playerData[id] = rest;
  }
  return {
    type: "state",
    time: Math.floor(gs.time),
    maxTime: gs.maxTime,
    mapName: gs.mapName,
    entity: {
      x: gs.entity.x,
      z: gs.entity.z,
      rotY: gs.entity.rotY,
      state: gs.entity.state,
    },
    players: playerData,
    items: gs.items.map(({ id, x, z, color, pickedUp, usedOnExit }) => ({ id, x, z, color, pickedUp, usedOnExit })),
    exit: gs.exit,
  };
}

function endGame(gs: GameState, result: string, escapePlayerId?: string) {
  gs.phase = "ended";

  const timeRemaining = Math.max(0, gs.maxTime - gs.time);
  const keysCollected = gs.items.filter((i) => i.pickedUp).length;

  let score = 0;
  let winnerName: string | undefined;
  if (result === "escaped" && escapePlayerId) {
    const winner = gs.players[escapePlayerId];
    score = Math.floor(
      keysCollected * 100 + timeRemaining * 5 + (DIFFICULTY_BONUS[gs.difficulty] ?? 0)
    );
    winnerName = winner?.name;
    addLeaderboardEntry({
      name: winnerName || "Unknown",
      score,
      difficulty: gs.difficulty,
      date: new Date().toISOString(),
    });
  }

  broadcastToSession(gs, {
    type: "gameEnd",
    result,
    score,
    timeUsed: Math.floor(gs.time),
    winnerName,
    leaderboard,
  });
}

// ═══════════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════════

let lastTick = Date.now();

function updateGame(gs: GameState, dt: number) {
  if (gs.phase !== "playing") return;

  gs.time += dt;

  const players = Object.values(gs.players).filter((p) => p.alive);
  const now = Date.now();
  const inSpawnProtection = !!gs.spawnProtectionEnd && now < gs.spawnProtectionEnd;

  if (players.length > 0 && !inSpawnProtection) {
    // Find closest player
    const closest = players.reduce((a, b) => {
      const da = Math.hypot(a.x - gs.entity.x, a.z - gs.entity.z);
      const db = Math.hypot(b.x - gs.entity.x, b.z - gs.entity.z);
      return da < db ? a : b;
    });

    const dist = Math.hypot(closest.x - gs.entity.x, closest.z - gs.entity.z);

    if (dist < 5) {
      gs.entity.state = "chase";
      gs.entity.targetX = closest.x;
      gs.entity.targetZ = closest.z;
    } else if (dist < 15 || (closest.noise || 0) > 60) {
      gs.entity.state = "investigate";
      gs.entity.targetX = closest.x;
      gs.entity.targetZ = closest.z;
    } else {
      gs.entity.state = "patrol";
      if (Math.random() < 0.02) {
        gs.entity.targetX = 2 + Math.random() * (gs.map[0].length - 2) * TILE;
        gs.entity.targetZ = 2 + Math.random() * (gs.map.length - 2) * TILE;
      }
    }
  } else if (inSpawnProtection) {
    gs.entity.state = "patrol";
  }

  // Move Claude toward target
  const dx = gs.entity.targetX - gs.entity.x;
  const dz = gs.entity.targetZ - gs.entity.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.5) {
    const speed = gs.entity.speed * dt;
    gs.entity.x += (dx / dist) * speed;
    gs.entity.z += (dz / dist) * speed;
    gs.entity.rotY = Math.atan2(dx, dz);
  }

  // Collision detection
  if (!inSpawnProtection) {
    for (const player of players) {
      const d = Math.hypot(player.x - gs.entity.x, player.z - gs.entity.z);
      if (d < CATCH_DIST) {
        player.alive = false;
        broadcastToSession(gs, {
          type: "playerCaught",
          id: player.id,
          name: player.name,
        });
      }
    }
  }

  // Check game end: timeout
  if (gs.time >= gs.maxTime) {
    const alive = Object.values(gs.players).filter((p) => p.alive);
    endGame(gs, alive.length > 0 ? "survived" : "caught");
    return;
  }

  // Check game end: all players dead
  const anyAlive = Object.values(gs.players).some((p) => p.alive);
  if (Object.keys(gs.players).length > 0 && !anyAlive) {
    endGame(gs, "caught");
    return;
  }

  // Taunts
  if (now >= gs.nextTauntAt) {
    gs.nextTauntAt = now + TAUNT_MIN_MS + Math.random() * (TAUNT_MAX_MS - TAUNT_MIN_MS);
    generateTaunt(gs).then((text) => {
      if (gs.phase === "playing") {
        broadcastToSession(gs, {
          type: "claudeTaunt",
          text,
          state: gs.entity.state,
        });
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET HANDLERS
// ═══════════════════════════════════════════════════════════════

function handleJoin(ws: WebSocket, msg: Record<string, string>) {
  const playerId = `player_${Math.random().toString(36).slice(2, 9)}`;
  playerIdMap.set(ws, playerId);

  const difficulty = msg.difficulty || "normal";
  const gs = createGameState(msg.mode || "solo", `session_${Math.random().toString(36).slice(2, 9)}`, difficulty);
  sessions.set(gs.sessionId, gs);
  playerSession.set(ws, gs.sessionId);

  const parsed = parseMap(MAPS[difficulty] || MAPS.normal);

  // Spawn player away from Claude
  let spawnX = parsed.playerSpawn.x;
  let spawnZ = parsed.playerSpawn.z;
  for (let attempts = 0; attempts < 20; attempts++) {
    const sx = parsed.playerSpawn.x + (Math.random() - 0.5) * 10;
    const sz = parsed.playerSpawn.z + (Math.random() - 0.5) * 10;
    if (Math.hypot(sx - gs.entity.x, sz - gs.entity.z) >= 20) {
      spawnX = sx;
      spawnZ = sz;
      break;
    }
  }

  gs.players[playerId] = {
    id: playerId,
    name: msg.name || "Player",
    x: spawnX,
    z: spawnZ,
    alive: true,
    hiding: false,
    keys: 0,
    noise: 0,
    ws,
  };

  gs.spawnProtectionEnd = Date.now() + (SPAWN_PROTECTION_DURATION[difficulty] ?? 10000);

  // Send init immediately
  ws.send(
    JSON.stringify({
      type: "init",
      id: playerId,
      map: gs.map,
      tileSize: TILE,
      hideSpots: gs.hideSpots,
      exitTile: gs.exitTile,
    })
  );

  ws.send(
    JSON.stringify({
      type: "playerJoined",
      id: playerId,
      name: msg.name || "Player",
      mode: msg.mode || "solo",
    })
  );

  // Auto-start solo games
  if (msg.mode === "solo" || !msg.mode) {
    gs.phase = "playing";
    gs.startTime = Date.now();
    ws.send(JSON.stringify({ type: "gameStart", gameId: gs.sessionId }));
  }
}

function handleMove(ws: WebSocket, msg: Record<string, number>) {
  const sid = playerSession.get(ws);
  const pid = playerIdMap.get(ws);
  if (!sid || !pid) return;
  const gs = sessions.get(sid);
  if (!gs || !gs.players[pid]) return;
  const p = gs.players[pid];
  if (typeof msg.x === "number") p.x = msg.x;
  if (typeof msg.z === "number") p.z = msg.z;
  if (typeof msg.noise === "number") p.noise = msg.noise;
}

function handleInteract(ws: WebSocket) {
  const sid = playerSession.get(ws);
  const pid = playerIdMap.get(ws);
  if (!sid || !pid) return;
  const gs = sessions.get(sid);
  if (!gs || !gs.players[pid] || gs.phase !== "playing") return;
  const player = gs.players[pid];
  if (!player.alive) return;

  const INTERACT_DIST = 3.0;

  // Check key pickup
  for (const item of gs.items) {
    if (item.pickedUp) continue;
    const d = Math.hypot(player.x - item.x, player.z - item.z);
    if (d < INTERACT_DIST) {
      item.pickedUp = true;
      item.playerId = pid;
      player.keys++;
      broadcastToSession(gs, {
        type: "itemPickedUp",
        itemId: item.id,
        playerId: pid,
        playerName: player.name,
      });

      // Check if all keys collected → unlock exit
      if (gs.items.every((i) => i.pickedUp) && !gs.exit.open) {
        gs.exit.open = true;
        broadcastToSession(gs, { type: "exitUnlocked" });
      }
      return;
    }
  }

  // Check exit interaction
  if (gs.exit.open) {
    const d = Math.hypot(player.x - gs.exit.x, player.z - gs.exit.z);
    if (d < INTERACT_DIST + 1) {
      endGame(gs, "escaped", pid);
    }
  }
}

function handleCrouch(ws: WebSocket, msg: { active?: boolean }) {
  const sid = playerSession.get(ws);
  const pid = playerIdMap.get(ws);
  if (!sid || !pid) return;
  const gs = sessions.get(sid);
  if (!gs || !gs.players[pid]) return;
  gs.players[pid].hiding = !!msg.active;
}

function handleChat(ws: WebSocket, msg: { text?: string }) {
  const sid = playerSession.get(ws);
  const pid = playerIdMap.get(ws);
  if (!sid || !pid || !msg.text) return;
  const gs = sessions.get(sid);
  if (!gs) return;
  const player = gs.players[pid];
  const text = String(msg.text).slice(0, 200);
  broadcastToSession(gs, {
    type: "chatMessage",
    from: pid,
    name: player?.name || "Player",
    text,
  });
}

function handleDisconnect(ws: WebSocket) {
  const sid = playerSession.get(ws);
  const pid = playerIdMap.get(ws);
  if (sid && pid) {
    const gs = sessions.get(sid);
    if (gs) {
      broadcastToSession(gs, { type: "playerLeft", id: pid });
      delete gs.players[pid];
      if (Object.keys(gs.players).length === 0) {
        // Clean up empty sessions after a delay
        setTimeout(() => {
          if (sessions.has(sid) && Object.keys(sessions.get(sid)!.players).length === 0) {
            sessions.delete(sid);
          }
        }, 30_000);
      }
    }
  }
  playerSession.delete(ws);
  playerIdMap.delete(ws);
}

// ═══════════════════════════════════════════════════════════════
// EXPRESS + WEBSOCKET SERVER
// ═══════════════════════════════════════════════════════════════

async function startServer() {
  loadLeaderboard();

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // WebSocket upgrade handling - only for /ws path
  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        switch (msg.type) {
          case "join":
            handleJoin(ws, msg as Record<string, string>);
            break;
          case "move":
            handleMove(ws, msg as Record<string, number>);
            break;
          case "interact":
            handleInteract(ws);
            break;
          case "crouch":
            handleCrouch(ws, msg as { active?: boolean });
            break;
          case "chat":
            handleChat(ws, msg as { text?: string });
            break;
          case "startGame": {
            const sid = playerSession.get(ws);
            if (sid) {
              const gs = sessions.get(sid);
              if (gs && gs.phase === "lobby") {
                gs.phase = "playing";
                gs.startTime = Date.now();
                broadcastToSession(gs, { type: "gameStart", gameId: sid });
              }
            }
            break;
          }
        }
      } catch (e) {
        console.error("Message error:", e);
      }
    });

    ws.on("close", () => handleDisconnect(ws));
    ws.on("error", () => handleDisconnect(ws));
  });

  // Game loop
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;

    sessions.forEach((gs) => {
      if (gs.phase === "playing") {
        updateGame(gs, dt);
        if (gs.phase === "playing") {
          broadcastToSession(gs, buildStateBroadcast(gs));
        }
      }
    });
  }, 100);

  // The Netlify-hosted client pings /status on launch to wake the Render
  // free-tier dyno before opening the WebSocket. CORS headers must be
  // permissive on this single endpoint so the cross-origin ping doesn't
  // get blocked by the browser. The endpoint exposes only public counts
  // / uptime — nothing sensitive.
  app.get("/status", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Cache-Control", "no-store");
    res.json({
      sessions: sessions.size,
      players: Array.from(sessions.values()).reduce((n, gs) => n + Object.keys(gs.players).length, 0),
      uptime: process.uptime(),
    });
  });
  app.options("/status", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.sendStatus(204);
  });

  // Static file serving (production). Skipped on backend-only deployments
  // (e.g. Render) where the static client lives elsewhere (Netlify) and
  // dist/public was never built.
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    const staticPath = path.resolve(__dirname, "public");
    const indexHtml = path.join(staticPath, "index.html");
    if (fs.existsSync(indexHtml)) {
      app.use(express.static(staticPath));
      app.get("*", (_req, res) => {
        res.sendFile(indexHtml);
      });
    } else {
      console.log("[server] dist/public not found — running websocket-only mode");
    }
  }

  const PORT =
    process.env.NODE_ENV === "production"
      ? parseInt(process.env.PORT || "3000")
      : 2567;

  server.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  HUNTED BY CLAUDE – Game Server      ║`);
    console.log(`║  Port: ${PORT}${" ".repeat(29 - String(PORT).length)}║`);
    console.log(`║  Mode: ${isProduction ? "production" : "development    "}           ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
  });
}

startServer().catch(console.error);
