import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import QRCode from 'qrcode';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// GRANNY-STYLE HORROR GAME SERVER
// Stealth, Puzzles, Permadeath, Tension-Based Gameplay
// ═══════════════════════════════════════════════════════════════

// ─── MAP: GRANNY'S HOUSE ───────────────────────────────────────
// W=wall, .=floor, D=door, H=hiding spot, K=key spawn, X=exit, S=player spawn, E=granny spawn
const MAP_RAW = [
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
];

const TILE = 4;
const WALL_H = 4;
const MAP_H = MAP_RAW.length;
const MAP_W = MAP_RAW[0].length;

function parseTile(r, c) {
  return (r >= 0 && r < MAP_H && c >= 0 && c < MAP_W) ? MAP_RAW[r][c] : 'W';
}

function tileCenter(r, c) {
  return { x: c * TILE + TILE / 2, z: r * TILE + TILE / 2 };
}

function isWalkable(r, c) {
  const t = parseTile(r, c);
  return t !== 'W';
}

// Parse map
const keySpawns = [], hideSpots = [], doorTiles = [];
let exitTile = null, entitySpawn = null, playerSpawn = null;

for (let r = 0; r < MAP_H; r++) {
  for (let c = 0; c < MAP_W; c++) {
    const t = MAP_RAW[r][c];
    if (t === 'K') keySpawns.push({ r, c });
    if (t === 'H') hideSpots.push({ r, c });
    if (t === 'D') doorTiles.push({ r, c, open: false });
    if (t === 'X') exitTile = { r, c };
    if (t === 'E') entitySpawn = { r, c };
    if (t === 'S') playerSpawn = { r, c };
  }
}

// ─── GAME STATE ───────────────────────────────────────────────
let gameState = null;
let gameLoop = null;
let nextId = 1;
const clients = new Map();

function createGameState(mode) {
  const sp = tileCenter(playerSpawn.r, playerSpawn.c);
  const ep = tileCenter(entitySpawn.r, entitySpawn.c);
  const isSolo = mode === 'solo' || mode === 'solo_brain';

  return {
    mode,
    isSolo,
    phase: 'lobby',
    players: {},
    entity: {
      x: ep.x,
      z: ep.z,
      targetX: ep.x,
      targetZ: ep.z,
      state: 'patrol', // patrol, investigate, chase, hunt
      stateTimer: 0,
      chaseTargetId: null,
      patrolIndex: 0,
      speed: 3.5,
      controlledBy: null,
      visible: true,
      type: 'granny',
      memory: {},
      detectionRange: 15,
      noiseMultiplier: 1.2,
      chaseMemory: 12,
      canOpenDoors: true,
    },
    items: keySpawns.map((k, i) => ({
      id: `key_${i}`,
      type: 'key',
      color: ['red', 'blue', 'green'][i % 3],
      r: k.r,
      c: k.c,
      ...tileCenter(k.r, k.c),
      pickedUp: false,
      usedOnExit: false,
    })),
    doors: doorTiles.map((d, i) => ({
      id: `door_${i}`,
      r: d.r,
      c: d.c,
      open: false,
      locked: Math.random() < 0.6, // 60% of doors are locked
    })),
    exit: {
      ...exitTile,
      ...tileCenter(exitTile.r, exitTile.c),
      keysNeeded: 3,
      keysUsed: 0,
      open: false,
    },
    noiseEvents: [],
    time: 0,
    maxTime: isSolo ? 180 : 240, // 3-4 minutes
    difficulty: 1.0, // Scales with time
  };
}

const patrolWaypoints = [...hideSpots, ...keySpawns].map(p => tileCenter(p.r, p.c));

// ─── GRANNY AI ───────────────────────────────────────────────
function updateGrannyAI(dt) {
  if (!gameState || gameState.phase !== 'playing') return;

  const e = gameState.entity;
  if (e.controlledBy) return;

  e.stateTimer -= dt;

  const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.isMonster);
  const visiblePlayers = alivePlayers.filter(p => !p.hiding);

  // Update memory
  for (const p of visiblePlayers) {
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist < e.detectionRange * 1.5) {
      e.memory[p.id] = { x: p.x, z: p.z, time: gameState.time, hiding: false };
    }
  }

  // Process noise events
  while (gameState.noiseEvents.length > 0) {
    const noise = gameState.noiseEvents.shift();
    const dist = Math.hypot(noise.x - e.x, noise.z - e.z);
    const hearingRange = noise.radius * TILE * e.noiseMultiplier;
    if (dist < hearingRange) {
      if (e.state !== 'chase') {
        e.state = 'investigate';
        e.targetX = noise.x;
        e.targetZ = noise.z;
        e.stateTimer = 6 + Math.random() * 3;
      }
    }
  }

  // Check line of sight
  for (const p of visiblePlayers) {
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist < e.detectionRange) {
      e.state = 'chase';
      e.chaseTargetId = p.id;
      e.stateTimer = e.chaseMemory + Math.random() * 3;
      e.memory[p.id] = { x: p.x, z: p.z, time: gameState.time, hiding: false };
      break;
    }
  }

  // State machine
  switch (e.state) {
    case 'patrol': {
      if (e.stateTimer <= 0) {
        e.patrolIndex = (e.patrolIndex + 1) % patrolWaypoints.length;
        e.stateTimer = 8 + Math.random() * 6;
        const wp = patrolWaypoints[e.patrolIndex];
        e.targetX = wp.x;
        e.targetZ = wp.z;
      }
      e.speed = 3.0;
      break;
    }

    case 'investigate': {
      if (e.stateTimer <= 0) {
        e.state = 'patrol';
        e.stateTimer = 5 + Math.random() * 4;
      }
      e.speed = 4.0;
      if (Math.hypot(e.targetX - e.x, e.targetZ - e.z) < 1) {
        e.stateTimer = Math.min(e.stateTimer, 2);
      }
      break;
    }

    case 'chase': {
      const target = gameState.players[e.chaseTargetId];
      if (!target || !target.alive || e.stateTimer <= 0) {
        e.state = 'patrol';
        e.stateTimer = 5 + Math.random() * 4;
      } else {
        e.targetX = target.x;
        e.targetZ = target.z;
        e.speed = 5.5 + gameState.difficulty * 1.5;
        const dist = Math.hypot(target.x - e.x, target.z - e.z);
        if (dist < 1.5) {
          target.alive = false;
          broadcast({ type: 'playerCaught', id: target.id, name: target.name });
        }
      }
      break;
    }
  }

  // Movement
  if (e.targetX !== null && e.targetZ !== null) {
    const dx = e.targetX - e.x;
    const dz = e.targetZ - e.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.5) {
      const moveX = (dx / dist) * e.speed * dt;
      const moveZ = (dz / dist) * e.speed * dt;
      e.x += moveX;
      e.z += moveZ;
    }
  }
}

// ─── GAME TICK ───────────────────────────────────────────────
function gameTick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (!gameState || gameState.phase !== 'playing') return;

  gameState.time += dt;
  gameState.difficulty = Math.min(2.0, 1.0 + gameState.time / gameState.maxTime);

  // Check if time's up
  if (gameState.time >= gameState.maxTime) {
    gameState.phase = 'won';
    broadcast({ type: 'gameEnd', result: 'escaped', reason: 'time' });
    clearInterval(gameLoop);
    gameLoop = null;
  }

  // Update Granny AI
  updateGrannyAI(dt);

  // Broadcast state
  broadcastState();
}

function broadcastState() {
  const state = {
    type: 'state',
    time: gameState.maxTime - gameState.time,
    players: gameState.players,
    entity: gameState.entity,
    items: gameState.items,
    doors: gameState.doors,
    exit: gameState.exit,
    phase: gameState.phase,
  };

  for (const client of clients.values()) {
    client.ws.send(JSON.stringify(state));
  }
}

function broadcast(msg) {
  for (const client of clients.values()) {
    client.ws.send(JSON.stringify(msg));
  }
}

// ─── WEBSOCKET HANDLING ───────────────────────────────────────
wss.on('connection', (ws) => {
  const id = String(nextId++);
  clients.set(id, { ws, id });
  console.log(`Player ${id} connected (${clients.size} total)`);

  ws.send(JSON.stringify({
    type: 'init',
    id,
    map: MAP_RAW,
    tileSize: TILE,
    wallHeight: WALL_H,
    hideSpots: hideSpots.map(h => ({ r: h.r, c: h.c })),
    exitTile: exitTile,
    gameState: gameState ? {
      phase: gameState.phase,
      mode: gameState.mode,
      players: Object.keys(gameState.players).map(pid => ({
        id: pid,
        name: gameState.players[pid].name,
      })),
    } : null,
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(id, msg);
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    if (gameState && gameState.players[id]) {
      if (gameState.players[id].isMonster) {
        gameState.entity.controlledBy = null;
      }
      delete gameState.players[id];
      broadcast({ type: 'playerLeft', id });
    }
    console.log(`Player ${id} disconnected (${clients.size} remaining)`);
    if (clients.size === 0) {
      if (gameLoop) clearInterval(gameLoop);
      gameState = null;
      nextId = 1;
    }
  });
});

function handleMessage(id, msg) {
  if (msg.type === 'join') {
    if (!gameState) {
      gameState = createGameState(msg.mode || 'solo');
    }

    const sp = tileCenter(playerSpawn.r, playerSpawn.c);
    const isMonster = msg.mode === 'asymmetric' && msg.asMonster && !gameState.entity.controlledBy;
    const ep = tileCenter(entitySpawn.r, entitySpawn.c);

    gameState.players[id] = {
      id,
      name: msg.name || `Player ${id}`,
      x: isMonster ? ep.x : sp.x + (Math.random() - 0.5) * 4,
      z: isMonster ? ep.z : sp.z + (Math.random() - 0.5) * 4,
      rotY: 0,
      alive: true,
      hiding: false,
      carrying: null,
      isMonster,
      escaped: false,
      sprinting: false,
      noiseLevel: 0,
      sanity: 100,
    };

    if (isMonster) {
      gameState.entity.controlledBy = id;
    }

    broadcast({
      type: 'playerJoined',
      id,
      name: msg.name,
      isMonster,
      mode: gameState.mode,
    });

    broadcastState();

    if (gameState.isSolo && gameState.phase === 'lobby') {
      gameState.phase = 'playing';
      lastTick = Date.now();
      if (gameLoop) clearInterval(gameLoop);
      gameLoop = setInterval(gameTick, 1000 / TICK_RATE);
      broadcast({ type: 'gameStart', mode: gameState.mode });
    }
  }

  if (msg.type === 'startGame') {
    if (gameState && gameState.phase === 'lobby') {
      gameState.phase = 'playing';
      lastTick = Date.now();
      if (gameLoop) clearInterval(gameLoop);
      gameLoop = setInterval(gameTick, 1000 / TICK_RATE);
      broadcast({ type: 'gameStart', mode: gameState.mode });
    }
  }

  if (msg.type === 'move') {
    if (gameState && gameState.players[id]) {
      const p = gameState.players[id];
      const speed = msg.sprint ? 7 : 4.5;
      const px = Math.cos(msg.angle) * speed * 0.033;
      const pz = Math.sin(msg.angle) * speed * 0.033;
      p.x += px;
      p.z += pz;
      p.rotY = msg.rotY;
      p.sprinting = msg.sprint;
      
      // Generate noise
      if (msg.sprint) {
        gameState.noiseEvents.push({
          x: p.x,
          z: p.z,
          radius: 4,
          time: gameState.time,
        });
      } else {
        gameState.noiseEvents.push({
          x: p.x,
          z: p.z,
          radius: 2,
          time: gameState.time,
        });
      }
    }
  }

  if (msg.type === 'interact') {
    if (gameState && gameState.players[id]) {
      const p = gameState.players[id];
      // Check for nearby items or doors
      for (const item of gameState.items) {
        if (!item.pickedUp && Math.hypot(p.x - item.x, p.z - item.z) < 1.5) {
          item.pickedUp = true;
          p.carrying = item.id;
          broadcast({ type: 'itemPickedUp', playerId: id, itemId: item.id });
        }
      }
    }
  }

  if (msg.type === 'crouch') {
    if (gameState && gameState.players[id]) {
      gameState.players[id].hiding = msg.active;
    }
  }

  if (msg.type === 'restart') {
    gameState = null;
    for (const [cid, client] of clients) {
      client.ws.send(JSON.stringify({ type: 'restart' }));
    }
  }
}

// ─── QR CODE ENDPOINT ───────────────────────────────────────────
app.get('/qr', async (req, res) => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}`;
  try {
    const qr = await QRCode.toDataURL(url, { width: 400, margin: 2 });
    res.json({ url, qr });
  } catch (e) {
    res.json({ url, qr: null });
  }
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── START SERVER ───────────────────────────────────────────────
const PORT = process.env.PORT || 2567;
let lastTick = Date.now();

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║       👵  GRANNY - HORROR ESCAPE GAME  👵          ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}                 ║`);
  console.log(`║  Network: http://${ip}:${PORT}             ║`);
  console.log('║                                                  ║');
  console.log('║  Share the Network URL with players on           ║');
  console.log('║  the same WiFi to join!                          ║');
  console.log('║                                                  ║');
  console.log('║  Or visit /qr for a scannable QR code.           ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
