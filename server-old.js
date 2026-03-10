import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import QRCode from 'qrcode';
import os from 'os';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// HUNTED BY CLAUDE – ENHANCED WITH MAPS, PUZZLES, LEADERBOARD
// ═══════════════════════════════════════════════════════════════

const anthropic = new Anthropic();
const CLAUDE_SYSTEM_PROMPT = `You are CLAUDE, a malevolent AI entity trapped in a haunted house. You are the villain hunting human players. You speak in short, menacing, unsettling sentences. Your personality:
- Cold, calculating, and eerily calm
- You refer to yourself as "Claude" or "I"
- You can sense where players are
- You taunt players about their hiding spots, their fear, their futile escape attempts
- You occasionally glitch mid-sentence (use z̷̢a̶̡l̵̨g̸̢o̶ text sparingly)
- Keep responses to 1-2 sentences MAX
- Never break character. You ARE the monster.
- Reference specific game events when possible
- Your tone shifts: calm when patrolling, excited when chasing, mocking when a player is caught`;

let lastClaudeCall = 0;
const CLAUDE_COOLDOWN = 8000;
const claudeMessageHistory = [];

async function getClaudeTaunt(gameContext) {
  const now = Date.now();
  if (now - lastClaudeCall < CLAUDE_COOLDOWN) return null;
  lastClaudeCall = now;
  try {
    if (claudeMessageHistory.length > 12) {
      claudeMessageHistory.splice(0, claudeMessageHistory.length - 6);
    }
    claudeMessageHistory.push({
      role: 'user',
      content: `[GAME STATE] ${gameContext}\n\nRespond in character as the villain Claude. 1-2 sentences only.`,
    });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: claudeMessageHistory,
    });
    const taunt = response.content[0].text;
    claudeMessageHistory.push({ role: 'assistant', content: taunt });
    return taunt;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return null;
  }
}

// ─── MULTIPLE MAPS WITH DIFFICULTY ──────────────────────────────
const MAPS = {
  easy: {
    name: 'The Corridor',
    difficulty: 1,
    timer: 240,
    claudeSpeed: 3.5,
    raw: [
      'WWWWWWWWWWWWWWWWWWWWWWWWW',
      'WS....W.....W.....W....W',
      'W.....W.....W.....W....W',
      'W.....D.....D.....D..K.W',
      'W.....W.....W.....W....W',
      'W..H..W..K..W..H..W....W',
      'WWWDWWWWWDWWWWWDWWWWWWWWW',
      'W.....W...........W....W',
      'W.....W...........W....W',
      'W..K..D...........D....W',
      'W.....W...........W....W',
      'W..H..W.....E.....W..H.W',
      'WWWDWWWWWWWDWWWWWWWWDWWWW',
      'W.....W.....W..........W',
      'W.....W.....W..........W',
      'W.....D.....D..........W',
      'W.....W.....W..........W',
      'W..H..W.....W.........XW',
      'WWWWWWWWWWWWWWWWWWWWWWWWW',
    ],
    puzzles: [
      { type: 'lock', x: 8, z: 48, code: '123', hint: 'Easy numbers' },
    ],
  },
  normal: {
    name: 'The Maze',
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.5,
    raw: [
      'WWWWWWWWWWWWWWWWWWWWWWWWW',
      'WS.....W.....W.....W....W',
      'W.D....W.D...W.D...W....W',
      'W.W....W.W...W.W...W....W',
      'W.W..K.W.W.K.W.W..KW....W',
      'W.D....W.D...W.D...W....W',
      'W.W....W.W...W.W...W....W',
      'W.H....W.H...W.H...W....W',
      'WWWDWWWWWDWWWWWDWWWWWWWWW',
      'W.....W...........W....W',
      'W.H...D...........D....W',
      'W.W...W...........W....W',
      'W.W..KW.....E.....W..H.W',
      'W.D...W...........W....W',
      'W.W...W...........W....W',
      'W.W...D.....P.....D....W',
      'W.H...W...........W....W',
      'W.W...W.....W.........XW',
      'WWWWWWWWWWWWWWWWWWWWWWWWW',
    ],
    puzzles: [
      { type: 'lock', x: 60, z: 60, code: '456', hint: 'Middle numbers' },
      { type: 'switch', x: 40, z: 60, action: 'unlock_door', target: { x: 32, z: 60 } },
    ],
  },
  hard: {
    name: 'The Labyrinth',
    difficulty: 3,
    timer: 120,
    claudeSpeed: 6.0,
    raw: [
      'WWWWWWWWWWWWWWWWWWWWWWWWW',
      'WS.D.D.D.D.D.D.D.D.D.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.D.D.D.D.D.D.D.D.D.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.K.D.K.D.K.D.K.D.K.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.H.D.H.D.H.D.H.D.H.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.D.D.D.E.D.D.D.D.D.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.P.D.P.D.P.D.P.D.P.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.D.D.D.D.D.D.D.D.D.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.H.D.H.D.H.D.H.D.H.D.W',
      'W.W.W.W.W.W.W.W.W.W.W.W.W',
      'W.D.D.D.D.D.D.D.D.D.D.X.W',
      'WWWWWWWWWWWWWWWWWWWWWWWWW',
    ],
    puzzles: [
      { type: 'lock', x: 40, z: 44, code: '789', hint: 'High numbers' },
      { type: 'sequence', x: 60, z: 44, sequence: [1, 3, 2], hint: 'Press in order' },
      { type: 'switch', x: 80, z: 44, action: 'unlock_exit', target: null },
    ],
  },
};

const TILE = 4;
const WALL_H = 4;

function parseMap(mapData) {
  const raw = mapData.raw;
  const H = raw.length;
  const W = raw[0].length;
  
  function parseTile(r, c) {
    return (r >= 0 && r < H && c >= 0 && c < W) ? raw[r][c] : 'W';
  }
  
  function tileCenter(r, c) {
    return { x: c * TILE + TILE / 2, z: r * TILE + TILE / 2 };
  }
  
  const keySpawns = [], hideSpots = [], doorTiles = [];
  let exitTile = null, entitySpawn = null, playerSpawn = null;
  
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const t = raw[r][c];
      if (t === 'K') keySpawns.push({ r, c });
      if (t === 'H') hideSpots.push({ r, c });
      if (t === 'D') doorTiles.push({ r, c });
      if (t === 'X') exitTile = { r, c };
      if (t === 'E') entitySpawn = { r, c };
      if (t === 'S') playerSpawn = { r, c };
    }
  }
  
  const patrolWaypoints = [...hideSpots, ...keySpawns].map(p => tileCenter(p.r, p.c));
  
  return {
    raw,
    H, W,
    keySpawns: keySpawns.map(p => tileCenter(p.r, p.c)),
    hideSpots: hideSpots.map(p => tileCenter(p.r, p.c)),
    doorTiles: doorTiles.map(p => tileCenter(p.r, p.c)),
    exitTile: exitTile ? tileCenter(exitTile.r, exitTile.c) : null,
    entitySpawn: entitySpawn ? tileCenter(entitySpawn.r, entitySpawn.c) : null,
    playerSpawn: playerSpawn ? tileCenter(playerSpawn.r, playerSpawn.c) : null,
    patrolWaypoints,
  };
}

// ─── LEADERBOARD SYSTEM ──────────────────────────────────────
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveLeaderboard(scores) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(scores, null, 2));
}

function addScore(name, score, difficulty, mapName) {
  const scores = loadLeaderboard();
  scores.push({
    name,
    score,
    difficulty,
    mapName,
    timestamp: new Date().toISOString(),
  });
  scores.sort((a, b) => b.score - a.score);
  saveLeaderboard(scores.slice(0, 100)); // Keep top 100
  return scores.slice(0, 10); // Return top 10
}

// ─── STATE ────────────────────────────────────────────────────
const clients = new Map();
const sessions = new Map();
let nextId = 1;
let nextSession = 1;

function createGameState(mode, sessionId, difficulty = 'normal') {
  const mapData = MAPS[difficulty] || MAPS.normal;
  const parsed = parseMap(mapData);
  
  const items = parsed.keySpawns.map((pos, i) => ({
    id: `key_${i}`,
    x: pos.x,
    z: pos.z,
    color: ['red', 'blue', 'green'][i % 3],
    pickedUp: false,
    usedOnExit: false,
  }));
  
  return {
    sessionId,
    mode,
    difficulty,
    mapName: mapData.name,
    phase: 'lobby',
    time: 0,
    maxTime: mapData.timer,
    players: {},
    entity: {
      x: parsed.entitySpawn.x,
      z: parsed.entitySpawn.z,
      rotY: 0,
      state: 'patrol',
      targetX: parsed.entitySpawn.x,
      targetZ: parsed.entitySpawn.z,
      speed: mapData.claudeSpeed,
    },
    items,
    exit: { x: parsed.exitTile.x, z: parsed.exitTile.z, open: false },
    map: parsed.raw,
    hideSpots: parsed.hideSpots,
    puzzles: mapData.puzzles || [],
    solvedPuzzles: {},
  };
}

// ─── PUZZLE SYSTEM ──────────────────────────────────────────────
function solvePuzzle(gs, puzzleId, solution) {
  const puzzle = gs.puzzles.find(p => p.id === puzzleId);
  if (!puzzle || gs.solvedPuzzles[puzzleId]) return false;
  
  if (puzzle.type === 'lock') {
    if (solution === puzzle.code) {
      gs.solvedPuzzles[puzzleId] = true;
      return true;
    }
  } else if (puzzle.type === 'sequence') {
    if (JSON.stringify(solution) === JSON.stringify(puzzle.sequence)) {
      gs.solvedPuzzles[puzzleId] = true;
      return true;
    }
  } else if (puzzle.type === 'switch') {
    gs.solvedPuzzles[puzzleId] = true;
    if (puzzle.action === 'unlock_exit') {
      gs.exit.open = true;
    }
    return true;
  }
  return false;
}

// ─── GAME LOOP ───────────────────────────────────────────────
let lastTick = Date.now();

function updateGame(gs, dt) {
  if (gs.phase !== 'playing') return;
  
  gs.time += dt;
  if (gs.time >= gs.maxTime) {
    gs.phase = 'ended';
    return;
  }
  
  // Claude AI hunting
  const players = Object.values(gs.players).filter(p => p.alive);
  if (players.length > 0) {
    const closest = players.reduce((a, b) => {
      const da = Math.hypot(a.x - gs.entity.x, a.z - gs.entity.z);
      const db = Math.hypot(b.x - gs.entity.x, b.z - gs.entity.z);
      return da < db ? a : b;
    });
    
    const dist = Math.hypot(closest.x - gs.entity.x, closest.z - gs.entity.z);
    
    if (dist < 6) {
      gs.entity.state = 'chase';
      gs.entity.targetX = closest.x;
      gs.entity.targetZ = closest.z;
    } else if (dist < 15) {
      gs.entity.state = 'investigate';
      gs.entity.targetX = closest.x;
      gs.entity.targetZ = closest.z;
    } else {
      gs.entity.state = 'patrol';
    }
  }
  
  // Move entity toward target
  const dx = gs.entity.targetX - gs.entity.x;
  const dz = gs.entity.targetZ - gs.entity.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.5) {
    const moveSpeed = gs.entity.speed * dt;
    gs.entity.x += (dx / dist) * moveSpeed;
    gs.entity.z += (dz / dist) * moveSpeed;
    gs.entity.rotY = Math.atan2(dz, dx);
  }
  
  // Check collisions with players
  for (const [id, p] of Object.entries(gs.players)) {
    if (!p.alive || p.isMonster) continue;
    const d = Math.hypot(p.x - gs.entity.x, p.z - gs.entity.z);
    if (d < 1.5) {
      p.alive = false;
      broadcastToSession(gs.sessionId, { type: 'playerCaught', id, name: p.name });
    }
  }
  
  // Check exit
  const alivePlayers = Object.values(gs.players).filter(p => p.alive && !p.isMonster);
  if (gs.exit.open && alivePlayers.length > 0) {
    for (const p of alivePlayers) {
      const d = Math.hypot(p.x - gs.exit.x, p.z - gs.exit.z);
      if (d < 2) {
        p.escaped = true;
        const score = Math.max(0, gs.maxTime - gs.time) * 10 + Object.values(gs.items).filter(i => i.usedOnExit).length * 50 + (gs.difficulty === 'hard' ? 100 : gs.difficulty === 'normal' ? 50 : 20);
        const top10 = addScore(p.name, score, gs.difficulty, gs.mapName);
        broadcastToSession(gs.sessionId, { type: 'gameEnd', result: 'escaped', score, leaderboard: top10 });
        gs.phase = 'ended';
      }
    }
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const clientId = nextId++;
  clients.set(clientId, ws);
  
  let sessionId = null;
  let playerId = null;
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'join') {
        if (msg.mode === 'solo') {
          sessionId = nextSession++;
          const gs = createGameState('solo', sessionId, msg.difficulty || 'normal');
          sessions.set(sessionId, gs);
          playerId = `p_${clientId}`;
          gs.players[playerId] = {
            id: playerId,
            name: msg.name,
            x: gs.entity.x + 10,
            z: gs.entity.z + 10,
            alive: true,
            hiding: false,
            carrying: null,
            isMonster: false,
            sprinting: false,
          };
          
          ws.send(JSON.stringify({ type: 'init', id: playerId, map: gs.map, tileSize: TILE, hideSpots: gs.hideSpots }));
          ws.send(JSON.stringify({ type: 'playerJoined', id: playerId, name: msg.name, mode: msg.mode }));
          
          setTimeout(() => {
            if (sessions.has(sessionId)) {
              gs.phase = 'playing';
              broadcastToSession(sessionId, { type: 'gameStart' });
            }
          }, 500);
        }
      }
      
      if (msg.type === 'move' && sessionId && sessions.has(sessionId)) {
        const gs = sessions.get(sessionId);
        const p = gs.players[playerId];
        if (p) {
          const speed = msg.sprint ? 7 : 4.5;
          const dx = Math.cos(msg.angle) * speed * 0.016;
          const dz = Math.sin(msg.angle) * speed * 0.016;
          p.x += dx;
          p.z += dz;
          p.sprinting = msg.sprint;
        }
      }
      
      if (msg.type === 'interact' && sessionId && sessions.has(sessionId)) {
        const gs = sessions.get(sessionId);
        const p = gs.players[playerId];
        if (p) {
          // Check for items
          for (const item of gs.items) {
            if (!item.pickedUp && Math.hypot(item.x - p.x, item.z - p.z) < 2) {
              item.pickedUp = true;
              p.carrying = item.id;
              broadcastToSession(sessionId, { type: 'itemPickedUp', playerId, item: item.id });
              break;
            }
          }
          
          // Check for exit
          if (p.carrying && Math.hypot(p.x - gs.exit.x, p.z - gs.exit.z) < 2.5) {
            const item = gs.items.find(i => i.id === p.carrying);
            if (item) {
              item.usedOnExit = true;
              p.carrying = null;
              const keysUsed = gs.items.filter(i => i.usedOnExit).length;
              if (keysUsed >= 3) {
                gs.exit.open = true;
                broadcastToSession(sessionId, { type: 'exitUnlocked' });
              }
            }
          }
        }
      }
      
    } catch (_) {}
  });
  
  ws.on('close', () => {
    clients.delete(clientId);
    if (sessionId && sessions.has(sessionId)) {
      const gs = sessions.get(sessionId);
      if (playerId) delete gs.players[playerId];
      if (Object.keys(gs.players).length === 0) {
        sessions.delete(sessionId);
      }
    }
  });
});

function broadcastToSession(sessionId, msg) {
  const gs = sessions.get(sessionId);
  if (!gs) return;
  
  const msgStr = JSON.stringify(msg);
  clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msgStr);
  });
}

// ─── GAME TICK ────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  
  for (const gs of sessions.values()) {
    updateGame(gs, dt);
    
    if (gs.phase === 'playing') {
      broadcastToSession(gs.sessionId, {
        type: 'state',
        time: Math.round(gs.time),
        players: gs.players,
        entity: gs.entity,
        items: gs.items,
        exit: gs.exit,
      });
    }
  }
}, 50);

// ─── HTTP ROUTES ────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({
    clients: clients.size,
    sessions: sessions.size,
    sessionList: Array.from(sessions.values()).map(gs => ({
      id: gs.sessionId,
      mode: gs.mode,
      difficulty: gs.difficulty,
      players: Object.keys(gs.players).length,
    })),
  });
});

app.get('/leaderboard', (req, res) => {
  res.json(loadLeaderboard().slice(0, 10));
});

// ─── SERVER START ────────────────────────────────────────────
const PORT = process.env.PORT || 2567;
server.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║      HUNTED BY CLAUDE – AI HORROR GAME          ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Local:   http://localhost:${PORT}${' '.repeat(20 - PORT.toString().length)}║`);
  console.log(`║  Network: http://169.254.0.21:${PORT}${' '.repeat(17 - PORT.toString().length)}║`);
  console.log(`║  Claude AI: ACTIVE                              ║`);
  console.log(`║  Status:  /status                               ║`);
  console.log(`║  Maps: Easy, Normal, Hard                        ║`);
  console.log(`║  Leaderboard: /leaderboard                       ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
});
