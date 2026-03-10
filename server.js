import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic();

// ═══════════════════════════════════════════════════════════════
// SPAWN PROTECTION & IMPROVED AI
// ═══════════════════════════════════════════════════════════════

const SPAWN_PROTECTION_DURATION = {
  easy: 15000,
  normal: 10000,
  hard: 5000
};

const CLAUDE_AGGRESSION = {
  easy: 0.6,
  normal: 0.8,
  hard: 1.0
};

// ─── MULTIPLE MAPS WITH DIFFICULTY ──────────────────────────────
const MAPS = {
  easy: {
    name: 'Granny\'s Kitchen',
    difficulty: 1,
    timer: 240,
    claudeSpeed: 3.0,
    theme: 'kitchen',
    raw: [
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WS.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W...W',
      'W.....D.....D.....D.....D...W',
      'W.....W.....W.....W.....W...W',
      'W..H..W..K..W..H..W..K..W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W...W',
      'W..K..D.....D.....D.....D...W',
      'W.....W.....W.....W.....W...W',
      'W..H..W.....W..H..W.....W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W...W',
      'W.....D.....D.....D.....D...W',
      'W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W..XW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    ],
  },
  normal: {
    name: 'Granny\'s House',
    difficulty: 2,
    timer: 180,
    claudeSpeed: 4.5,
    theme: 'house',
    raw: [
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WS.....W.....W.....W.....W.....W...W',
      'W.D....W.D...W.D...W.D...W.D...W...W',
      'W.W....W.W...W.W...W.W...W.W...W...W',
      'W.W..K.W.W.K.W.W..KW.W..KW.W..KW...W',
      'W.D....W.D...W.D...W.D...W.D...W...W',
      'W.W....W.W...W.W...W.W...W.W...W...W',
      'W.H....W.H...W.H...W.H...W.H...W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.....W...........W.....W.....W...W',
      'W.H...D...........D.....D.....D...W',
      'W.W...W...........W.....W.....W...W',
      'W.W..KW.....E.....W..H..W..K..W...W',
      'W.D...W...........W.....W.....W...W',
      'W.W...W...........W.....W.....W...W',
      'W.W...D.....P.....D.....D.....D...W',
      'W.H...W...........W.....W.....W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W...W',
      'W.....D.....D.....D.....D.....D...W',
      'W.....W.....W.....W.....W.....W...W',
      'W..H..W.....W..H..W..K..W.....W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W...W',
      'W.....D.....D.....D.....D.....D...W',
      'W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W..XW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    ],
  },
  hard: {
    name: 'Granny\'s Nightmare',
    difficulty: 3,
    timer: 120,
    claudeSpeed: 6.0,
    theme: 'nightmare',
    raw: [
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'WS.D...W.D...W.D...W.D...W.D...W.D...W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.D...W.D...W.D...W.D...W.D...W.D...W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.D...W.D...W.D...W.D...W.D...W.D...W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.D...W.D...W.D...W.D...W.D...W.D...W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.D...W.D...W.D...W.D...W.D...W.D...W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.D...W.D...W.D...W.D...W.D...W.D...W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.KW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.D.D..W.D.D.W.D.D.W.D.D.W.D.D.W.D.D.W...W',
      'W.W.W..W.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'W.W.W.HW.W.W.W.W.W.W.W.W.W.W.W.W.W.W.W...W',
      'WWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWDWWWWWWWW',
      'W.....W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W.....W...W',
      'W.....D.....D.....D.....D.....D.....D...W',
      'W.....W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W.....W...W',
      'W.....W.....W.....W.....W.....W.....W..XW',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    ],
  },
};

const TILE = 4;
const WALL_H = 4;

function parseMap(mapData) {
  const raw = mapData.raw;
  const H = raw.length;
  const W = raw[0].length;
  
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
  
  return {
    raw,
    H, W,
    keySpawns: keySpawns.map(p => tileCenter(p.r, p.c)),
    hideSpots: hideSpots.map(p => tileCenter(p.r, p.c)),
    doorTiles: doorTiles.map(p => tileCenter(p.r, p.c)),
    exitTile: exitTile ? tileCenter(exitTile.r, exitTile.c) : null,
    entitySpawn: entitySpawn ? tileCenter(entitySpawn.r, entitySpawn.c) : null,
    playerSpawn: playerSpawn ? tileCenter(playerSpawn.r, playerSpawn.c) : null,
  };
}

// ─── STATE ────────────────────────────────────────────────────
const clients = new Map();
const sessions = new Map();

function createGameState(mode, sessionId, difficulty = 'normal') {
  const mapData = MAPS[difficulty] || MAPS.normal;
  const parsed = parseMap(mapData);
  
  const items = parsed.keySpawns.map((pos, i) => ({
    id: `key_${i}`,
    x: pos.x,
    z: pos.z,
    color: ['red', 'blue', 'green'][i % 3],
    pickedUp: false,
  }));
  
  return {
    sessionId,
    mode,
    difficulty,
    mapName: mapData.name,
    phase: 'lobby',
    time: 0,
    maxTime: mapData.timer,
    startTime: null,
    spawnProtectionEnd: null,
    players: {},
    entity: {
      x: parsed.entitySpawn.x,
      z: parsed.entitySpawn.z,
      rotY: 0,
      state: 'patrol',
      targetX: parsed.entitySpawn.x,
      targetZ: parsed.entitySpawn.z,
      speed: mapData.claudeSpeed,
      aggression: CLAUDE_AGGRESSION[difficulty] || 0.8,
    },
    items,
    exit: { x: parsed.exitTile.x, z: parsed.exitTile.z, open: false },
    map: parsed.raw,
    hideSpots: parsed.hideSpots,
  };
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
  
  // Claude AI hunting with spawn protection
  const players = Object.values(gs.players).filter(p => p.alive);
  if (players.length > 0) {
    const now = Date.now();
    const inSpawnProtection = gs.spawnProtectionEnd && now < gs.spawnProtectionEnd;
    
    if (!inSpawnProtection) {
      // Find closest player
      const closest = players.reduce((a, b) => {
        const da = Math.hypot(a.x - gs.entity.x, a.z - gs.entity.z);
        const db = Math.hypot(b.x - gs.entity.x, b.z - gs.entity.z);
        return da < db ? a : b;
      });
      
      const dist = Math.hypot(closest.x - gs.entity.x, closest.z - gs.entity.z);
      
      // State machine
      if (dist < 5) {
        gs.entity.state = 'chase';
        gs.entity.targetX = closest.x;
        gs.entity.targetZ = closest.z;
      } else if (dist < 15 || (closest.noise || 0) > 60) {
        gs.entity.state = 'investigate';
        gs.entity.targetX = closest.x;
        gs.entity.targetZ = closest.z;
      } else {
        gs.entity.state = 'patrol';
        // Random patrol
        if (Math.random() < 0.02) {
          gs.entity.targetX = Math.random() * 100;
          gs.entity.targetZ = Math.random() * 72;
        }
      }
    } else {
      gs.entity.state = 'patrol';
    }
    
    // Move Claude
    const dx = gs.entity.targetX - gs.entity.x;
    const dz = gs.entity.targetZ - gs.entity.z;
    const dist = Math.hypot(dx, dz);
    
    if (dist > 0.5) {
      const speed = gs.entity.speed * dt;
      gs.entity.x += (dx / dist) * speed;
      gs.entity.z += (dz / dist) * speed;
    }
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let playerId = null;
  let sessionId = null;
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'join') {
        playerId = `player_${Math.random().toString(36).slice(2, 9)}`;
        
        // Create new session for solo
        if (msg.mode === 'solo' || !sessionId) {
          const gs = createGameState(msg.mode, `session_${Math.random().toString(36).slice(2, 9)}`, msg.difficulty || 'normal');
          sessionId = gs.sessionId;
          sessions.set(sessionId, gs);
        }
        
        const gs = sessions.get(sessionId);
        const parsed = parseMap(MAPS[gs.difficulty]);
        
        // Spawn player away from Claude
        let spawnX, spawnZ;
        do {
          spawnX = parsed.playerSpawn.x + (Math.random() - 0.5) * 10;
          spawnZ = parsed.playerSpawn.z + (Math.random() - 0.5) * 10;
        } while (Math.hypot(spawnX - gs.entity.x, spawnZ - gs.entity.z) < 20);
        
        gs.players[playerId] = {
          id: playerId,
          name: msg.name,
          x: spawnX,
          z: spawnZ,
          alive: true,
          sanity: 100,
          noise: 0,
          keys: 0,
          hiding: false,
          spawnProtectedUntil: Date.now() + SPAWN_PROTECTION_DURATION[gs.difficulty]
        };
        
        // Set spawn protection
        gs.spawnProtectionEnd = Date.now() + SPAWN_PROTECTION_DURATION[gs.difficulty];
        
        ws.send(JSON.stringify({
          type: 'playerJoined',
          id: playerId,
          name: msg.name,
          mode: msg.mode
        }));
        
        // Auto-start solo
        if (msg.mode === 'solo') {
          gs.phase = 'playing';
          gs.startTime = Date.now();
          ws.send(JSON.stringify({ type: 'gameStart', gameId: sessionId }));
        }
      }
      
      if (msg.type === 'move' && sessionId) {
        const gs = sessions.get(sessionId);
        if (gs && gs.players[playerId]) {
          gs.players[playerId].x = msg.x;
          gs.players[playerId].z = msg.z;
          if (msg.noise) gs.players[playerId].noise = msg.noise;
        }
      }
      
    } catch (e) {
      console.error('Message error:', e);
    }
  });
});

// Broadcast game state
setInterval(() => {
  const now = Date.now();
  sessions.forEach((gs) => {
    if (gs.phase === 'playing') {
      const dt = (now - lastTick) / 1000;
      updateGame(gs, dt);
      
      const state = {
        type: 'state',
        time: Math.floor(gs.time),
        entity: gs.entity,
        players: gs.players,
        phase: gs.phase
      };
      
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify(state));
        }
      });
    }
  });
  lastTick = now;
}, 100);

// ─── EXPRESS ────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({
    clients: wss.clients.size,
    sessions: sessions.size,
    uptime: process.uptime()
  });
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 2567;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║      HUNTED BY CLAUDE – AI HORROR GAME              ║
╠══════════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}                ║
║  Spawn Protection: ACTIVE                           ║
║  Claude AI: IMPROVED                                ║
║  Status:  /status                                   ║
╚══════════════════════════════════════════════════════╝
  `);
});
