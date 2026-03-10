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
// HUNTED – GRANNY-STYLE HORROR GAME SERVER
// ═══════════════════════════════════════════════════════════════

// ─── MAP ───────────────────────────────────────────────────────
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

// Parse static map features
const keySpawns = [], hideSpots = [], doorTiles = [];
let exitTile = null, entitySpawn = null, playerSpawn = null;

for (let r = 0; r < MAP_H; r++) {
  for (let c = 0; c < MAP_W; c++) {
    const t = MAP_RAW[r][c];
    if (t === 'K') keySpawns.push({ r, c });
    if (t === 'H') hideSpots.push({ r, c });
    if (t === 'D') doorTiles.push({ r, c });
    if (t === 'X') exitTile = { r, c };
    if (t === 'E') entitySpawn = { r, c };
    if (t === 'S') playerSpawn = { r, c };
  }
}

const patrolWaypoints = [...hideSpots, ...keySpawns].map(p => tileCenter(p.r, p.c));

// ─── STATE ────────────────────────────────────────────────────
// Each solo player gets their OWN private game session.
// Co-op / asymmetric players share a session keyed by a room code.
// For simplicity: solo = private session per connection, others share global.

const clients = new Map();      // id → { ws, id, sessionId }
const sessions = new Map();     // sessionId → gameState
let nextId = 1;
let nextSession = 1;

// ─── GAME STATE FACTORY ───────────────────────────────────────
function createGameState(mode, sessionId) {
  const sp = tileCenter(playerSpawn.r, playerSpawn.c);
  const ep = tileCenter(entitySpawn.r, entitySpawn.c);
  const isSolo = mode === 'solo';

  return {
    sessionId,
    mode,
    isSolo,
    phase: 'lobby',
    players: {},
    entity: {
      x: ep.x,
      z: ep.z,
      targetX: ep.x,
      targetZ: ep.z,
      state: 'patrol',
      stateTimer: 5,
      chaseTargetId: null,
      patrolIndex: 0,
      speed: 3.5,
      controlledBy: null,
      detectionRange: 14,
      noiseMultiplier: 1.2,
      chaseMemory: 12,
      memory: {},
      rotY: 0,
    },
    items: keySpawns.map((k, i) => ({
      id: `key_${i}_${sessionId}`,
      type: 'key',
      color: ['red', 'blue', 'green'][i % 3],
      ...tileCenter(k.r, k.c),
      pickedUp: false,
      usedOnExit: false,
    })),
    doors: doorTiles.map((d, i) => ({
      id: `door_${i}_${sessionId}`,
      r: d.r, c: d.c,
      open: false,
      locked: Math.random() < 0.5,
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
    maxTime: isSolo ? 180 : 240,
    difficulty: 1.0,
    gameLoop: null,
    lastTick: Date.now(),
  };
}

// ─── BROADCAST HELPERS ────────────────────────────────────────
function broadcastToSession(sessionId, msg) {
  const data = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.sessionId === sessionId && client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

function sendToClient(id, msg) {
  const client = clients.get(id);
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(msg));
  }
}

function broadcastStateForSession(gs) {
  broadcastToSession(gs.sessionId, {
    type: 'state',
    time: Math.max(0, gs.maxTime - gs.time),
    players: gs.players,
    entity: gs.entity,
    items: gs.items,
    doors: gs.doors,
    exit: gs.exit,
    phase: gs.phase,
  });
}

// ─── GRANNY AI ────────────────────────────────────────────────
function updateGrannyAI(gs, dt) {
  if (!gs || gs.phase !== 'playing') return;
  const e = gs.entity;
  if (e.controlledBy) return;

  e.stateTimer -= dt;

  const alivePlayers = Object.values(gs.players).filter(p => p.alive && !p.isMonster);
  const visiblePlayers = alivePlayers.filter(p => !p.hiding);

  // Update memory
  for (const p of visiblePlayers) {
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist < e.detectionRange * 1.5) {
      e.memory[p.id] = { x: p.x, z: p.z, time: gs.time };
    }
  }

  // Process noise events
  while (gs.noiseEvents.length > 0) {
    const noise = gs.noiseEvents.shift();
    const dist = Math.hypot(noise.x - e.x, noise.z - e.z);
    const hearingRange = noise.radius * TILE * e.noiseMultiplier;
    if (dist < hearingRange && e.state !== 'chase') {
      e.state = 'investigate';
      e.targetX = noise.x;
      e.targetZ = noise.z;
      e.stateTimer = 6 + Math.random() * 3;
    }
  }

  // Line of sight detection
  for (const p of visiblePlayers) {
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist < e.detectionRange) {
      e.state = 'chase';
      e.chaseTargetId = p.id;
      e.stateTimer = e.chaseMemory + Math.random() * 3;
      e.memory[p.id] = { x: p.x, z: p.z, time: gs.time };
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
      e.speed = 3.0 * gs.difficulty;
      break;
    }
    case 'investigate': {
      if (e.stateTimer <= 0) { e.state = 'patrol'; e.stateTimer = 5; }
      e.speed = 4.0 * gs.difficulty;
      if (Math.hypot(e.targetX - e.x, e.targetZ - e.z) < 1) e.stateTimer = Math.min(e.stateTimer, 2);
      break;
    }
    case 'chase': {
      const target = gs.players[e.chaseTargetId];
      if (!target || !target.alive || e.stateTimer <= 0) {
        e.state = 'patrol'; e.stateTimer = 5;
      } else {
        e.targetX = target.x;
        e.targetZ = target.z;
        e.speed = (5.5 + gs.difficulty * 1.5);
        const dist = Math.hypot(target.x - e.x, target.z - e.z);
        if (dist < 1.5 && !target.hiding) {
          target.alive = false;
          broadcastToSession(gs.sessionId, { type: 'playerCaught', id: target.id, name: target.name });
          // Check if all players dead
          const anyAlive = Object.values(gs.players).some(p => p.alive && !p.isMonster);
          if (!anyAlive) {
            gs.phase = 'ended';
            broadcastToSession(gs.sessionId, { type: 'gameEnd', result: 'caught' });
            stopSession(gs);
          }
        }
      }
      break;
    }
  }

  // Move entity
  const dx = e.targetX - e.x;
  const dz = e.targetZ - e.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.5) {
    e.x += (dx / dist) * e.speed * dt;
    e.z += (dz / dist) * e.speed * dt;
    e.rotY = Math.atan2(dx, dz);
  }
}

// ─── GAME TICK ────────────────────────────────────────────────
function makeGameTick(gs) {
  return function gameTick() {
    const now = Date.now();
    const dt = Math.min((now - gs.lastTick) / 1000, 0.1);
    gs.lastTick = now;

    if (!gs || gs.phase !== 'playing') return;

    gs.time += dt;
    gs.difficulty = Math.min(2.0, 1.0 + gs.time / gs.maxTime);

    if (gs.time >= gs.maxTime) {
      gs.phase = 'ended';
      broadcastToSession(gs.sessionId, { type: 'gameEnd', result: 'escaped', reason: 'time' });
      stopSession(gs);
      return;
    }

    updateGrannyAI(gs, dt);
    broadcastStateForSession(gs);
  };
}

function startSession(gs) {
  if (gs.gameLoop) clearInterval(gs.gameLoop);
  gs.phase = 'playing';
  gs.lastTick = Date.now();
  gs.gameLoop = setInterval(makeGameTick(gs), 1000 / 20); // 20 ticks/sec
  broadcastToSession(gs.sessionId, { type: 'gameStart', mode: gs.mode });
}

function stopSession(gs) {
  if (gs.gameLoop) { clearInterval(gs.gameLoop); gs.gameLoop = null; }
}

// ─── WEBSOCKET ────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const id = String(nextId++);
  clients.set(id, { ws, id, sessionId: null });

  console.log(`[+] Client ${id} connected (${clients.size} total)`);

  // Send init immediately so client can build the map
  ws.send(JSON.stringify({
    type: 'init',
    id,
    map: MAP_RAW,
    tileSize: TILE,
    wallHeight: WALL_H,
    hideSpots: hideSpots.map(h => tileCenter(h.r, h.c)),
    exitTile: exitTile ? tileCenter(exitTile.r, exitTile.c) : null,
  }));

  ws.on('message', (raw) => {
    try {
      handleMessage(id, JSON.parse(raw));
    } catch (e) {
      console.error('Msg error:', e.message);
    }
  });

  ws.on('close', () => {
    const client = clients.get(id);
    if (client && client.sessionId) {
      const gs = sessions.get(client.sessionId);
      if (gs) {
        if (gs.players[id]) {
          if (gs.players[id].isMonster) gs.entity.controlledBy = null;
          delete gs.players[id];
          broadcastToSession(gs.sessionId, { type: 'playerLeft', id });
        }
        // Clean up empty sessions
        const remaining = Object.keys(gs.players).length;
        if (remaining === 0) {
          stopSession(gs);
          sessions.delete(gs.sessionId);
          console.log(`Session ${gs.sessionId} cleaned up`);
        }
      }
    }
    clients.delete(id);
    console.log(`[-] Client ${id} disconnected (${clients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error(`WS error for ${id}:`, err.message);
  });
});

// ─── MESSAGE HANDLER ──────────────────────────────────────────
function handleMessage(id, msg) {
  const client = clients.get(id);
  if (!client) return;

  // ── JOIN ──
  if (msg.type === 'join') {
    const mode = msg.mode || 'solo';
    const isSolo = mode === 'solo';

    let gs;
    if (isSolo) {
      // Solo: always a fresh private session
      const sid = String(nextSession++);
      gs = createGameState(mode, sid);
      sessions.set(sid, gs);
      client.sessionId = sid;
    } else {
      // Co-op / asymmetric: find or create a shared session for this mode
      let found = null;
      for (const [sid, s] of sessions) {
        if (s.mode === mode && s.phase === 'lobby') { found = s; break; }
      }
      if (!found) {
        const sid = String(nextSession++);
        found = createGameState(mode, sid);
        sessions.set(sid, found);
      }
      gs = found;
      client.sessionId = gs.sessionId;
    }

    const sp = tileCenter(playerSpawn.r, playerSpawn.c);
    const ep = tileCenter(entitySpawn.r, entitySpawn.c);
    const isMonster = mode === 'asymmetric' && msg.asMonster && !gs.entity.controlledBy;

    gs.players[id] = {
      id,
      name: msg.name || `Player_${id}`,
      x: isMonster ? ep.x : sp.x + (Math.random() - 0.5) * 3,
      z: isMonster ? ep.z : sp.z + (Math.random() - 0.5) * 3,
      rotY: 0,
      alive: true,
      hiding: false,
      carrying: null,
      isMonster,
      escaped: false,
      sprinting: false,
    };

    if (isMonster) gs.entity.controlledBy = id;

    broadcastToSession(gs.sessionId, {
      type: 'playerJoined',
      id,
      name: msg.name,
      isMonster,
      mode: gs.mode,
    });

    // Send current state to the new player
    sendToClient(id, {
      type: 'state',
      time: Math.max(0, gs.maxTime - gs.time),
      players: gs.players,
      entity: gs.entity,
      items: gs.items,
      doors: gs.doors,
      exit: gs.exit,
      phase: gs.phase,
    });

    // Auto-start solo immediately
    if (isSolo) {
      startSession(gs);
    }

    console.log(`Player ${id} (${msg.name}) joined session ${gs.sessionId} [${mode}]`);
    return;
  }

  // All other messages need a session
  const gs = client.sessionId ? sessions.get(client.sessionId) : null;
  if (!gs) return;

  // ── START GAME (host button) ──
  if (msg.type === 'startGame') {
    if (gs.phase === 'lobby') startSession(gs);
    return;
  }

  // ── MOVE ──
  if (msg.type === 'move') {
    const p = gs.players[id];
    if (!p || !p.alive) return;
    const speed = p.isMonster ? 6 : (msg.sprint ? 7 : 4.5);
    p.x += Math.cos(msg.angle) * speed * 0.05;
    p.z += Math.sin(msg.angle) * speed * 0.05;
    p.rotY = msg.rotY || 0;
    p.sprinting = !!msg.sprint;

    // Noise event
    gs.noiseEvents.push({
      x: p.x, z: p.z,
      radius: msg.sprint ? 4 : 2,
      time: gs.time,
    });

    // If monster is controlled by player, move entity
    if (p.isMonster && gs.entity.controlledBy === id) {
      gs.entity.x = p.x;
      gs.entity.z = p.z;
      gs.entity.rotY = p.rotY;
    }
    return;
  }

  // ── INTERACT ──
  if (msg.type === 'interact') {
    const p = gs.players[id];
    if (!p || !p.alive) return;

    // Pick up keys
    for (const item of gs.items) {
      if (!item.pickedUp && Math.hypot(p.x - item.x, p.z - item.z) < 2.5) {
        item.pickedUp = true;
        p.carrying = item.id;
        broadcastToSession(gs.sessionId, { type: 'itemPickedUp', playerId: id, itemId: item.id });
        break;
      }
    }

    // Use key on exit
    if (!gs.exit.open) {
      const distToExit = Math.hypot(p.x - gs.exit.x, p.z - gs.exit.z);
      if (distToExit < 2.5) {
        const heldKeys = gs.items.filter(i => i.pickedUp && !i.usedOnExit);
        if (heldKeys.length >= gs.exit.keysNeeded) {
          heldKeys.slice(0, gs.exit.keysNeeded).forEach(k => { k.usedOnExit = true; });
          gs.exit.open = true;
          broadcastToSession(gs.sessionId, { type: 'exitUnlocked' });
        }
      }
    }

    // Walk through open exit
    if (gs.exit.open) {
      const distToExit = Math.hypot(p.x - gs.exit.x, p.z - gs.exit.z);
      if (distToExit < 2.5) {
        p.escaped = true;
        p.alive = false;
        broadcastToSession(gs.sessionId, { type: 'playerEscaped', id, name: p.name });
        const anyStillIn = Object.values(gs.players).some(pl => pl.alive && !pl.isMonster);
        if (!anyStillIn) {
          gs.phase = 'ended';
          broadcastToSession(gs.sessionId, { type: 'gameEnd', result: 'escaped', reason: 'exit' });
          stopSession(gs);
        }
      }
    }
    return;
  }

  // ── CROUCH ──
  if (msg.type === 'crouch') {
    const p = gs.players[id];
    if (p) p.hiding = !!msg.active;
    return;
  }

  // ── RESTART ──
  if (msg.type === 'restart') {
    stopSession(gs);
    sessions.delete(gs.sessionId);
    broadcastToSession(gs.sessionId, { type: 'restart' });
    return;
  }
}

// ─── QR CODE ──────────────────────────────────────────────────
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

app.get('/status', (req, res) => {
  res.json({
    clients: clients.size,
    sessions: sessions.size,
    sessionList: [...sessions.entries()].map(([sid, gs]) => ({
      id: sid, mode: gs.mode, phase: gs.phase,
      players: Object.keys(gs.players).length,
    })),
  });
});

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 2567;

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║         HUNTED – HORROR ESCAPE GAME             ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}                 ║`);
  console.log(`║  Network: http://${ip}:${PORT}             ║`);
  console.log('║  Status:  /status                               ║');
  console.log('║  QR Code: /qr                                   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
