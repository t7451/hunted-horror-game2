// Browser-side player profile, customization, and idempotent stats.
// Persists to localStorage; emits events on window.EventBus when present.
//
// Events emitted:
//   profile:loaded   { profile }
//   profile:updated  { profile, patch }
//   profile:reset    { profile }
//   profile:run-begin{ runId, meta }
//   profile:result   { runId, result, score, timeMs, difficulty, stats, isNew }
//   profile:achievement { id, label }
(function () {
  'use strict';
  const KEY = 'hunted.profile.v1';
  const SCHEMA = 1;
  const bus = () => window.EventBus;

  const CHARACTERS = [
    { id: 'ghost',     label: '👻', name: 'Ghost' },
    { id: 'survivor',  label: '🧍', name: 'Survivor' },
    { id: 'detective', label: '🕵', name: 'Detective' },
    { id: 'kid',       label: '🧒', name: 'Kid' },
    { id: 'medic',     label: '🩺', name: 'Medic' },
    { id: 'rebel',     label: '🤘', name: 'Rebel' },
  ];
  const COLORS = ['#00e5ff', '#ff3333', '#00ff88', '#ffcc66', '#c177ff', '#ff7ab6'];

  const ACHIEVEMENTS = [
    { id: 'first_run',     label: 'First Run',     test: s => s.totalPlayed >= 1 },
    { id: 'first_escape',  label: 'First Escape',  test: s => s.wins >= 1 },
    { id: 'survivor_3',    label: 'Survivor x3',   test: s => s.wins >= 3 },
    { id: 'veteran_10',    label: 'Veteran',       test: s => s.totalPlayed >= 10 },
    { id: 'unbreakable',   label: 'Unbreakable',   test: s => s.streakWins >= 3 },
    { id: 'speedrunner',   label: 'Speedrunner',   test: s => s.bestTimeMs && s.bestTimeMs < 60_000 },
    { id: 'hard_escape',   label: 'Hard Escape',   test: s => s.winsByDifficulty?.hard >= 1 },
    { id: 'daily_dweller', label: 'Daily Dweller', test: s => s.dailyStreak >= 3 },
  ];

  function randomToken(length) {
    const bytes = new Uint8Array(length);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      const seed = `${Date.now().toString(36)}${performance.now().toString(36)}`;
      for (let i = 0; i < bytes.length; i++) bytes[i] = seed.charCodeAt(i % seed.length);
    }
    return Array.from(bytes, byte => (byte % 36).toString(36)).join('');
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + randomToken(10);
  }
  function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
  function safeParse(raw) { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }

  function defaults() {
    return {
      schema: SCHEMA,
      uid: uuid(),
      name: 'Ghost_' + randomToken(4).toUpperCase(),
      character: CHARACTERS[0].id,
      color: COLORS[0],
      createdAt: Date.now(),
      stats: {
        wins: 0, losses: 0, totalPlayed: 0,
        bestTimeMs: null, bestScore: 0,
        streakWins: 0,
        winsByDifficulty: { easy: 0, normal: 0, hard: 0 },
        playsByDifficulty: { easy: 0, normal: 0, hard: 0 },
        dailyStreak: 0, lastPlayedDay: null,
      },
      processedRuns: [],
      achievements: [],
    };
  }

  let state = (() => {
    const loaded = safeParse(localStorage.getItem(KEY));
    if (loaded && loaded.schema === SCHEMA && loaded.uid) {
      const d = defaults();
      return { ...d, ...loaded, stats: { ...d.stats, ...(loaded.stats || {}) } };
    }
    const d = defaults();
    save(d);
    return d;
  })();
  let _runId = null;

  function save(s = state) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }
  function get() { return state; }

  function update(patch) {
    state = { ...state, ...patch };
    save();
    render();
    bus()?.emit('profile:updated', { profile: state, patch });
  }

  function setCharacter(id) {
    if (!CHARACTERS.find(c => c.id === id)) return;
    update({ character: id });
  }
  function setColor(c) { if (COLORS.includes(c)) update({ color: c }); }

  function reset() {
    state = defaults();
    save();
    render();
    bus()?.emit('profile:reset', { profile: state });
  }

  function beginRun({ mode, asMonster, difficulty }) {
    _runId = uuid();
    state.lastRunMeta = { mode, asMonster, difficulty, startedAt: Date.now() };
    save();
    bus()?.emit('profile:run-begin', { runId: _runId, meta: state.lastRunMeta });
    return _runId;
  }
  function currentRunId() { return _runId; }

  function rememberRun(runId) {
    if (!runId) return false;
    if (state.processedRuns.includes(runId)) return false;
    state.processedRuns.push(runId);
    if (state.processedRuns.length > 100) state.processedRuns.shift();
    return true;
  }

  function bumpDailyStreak() {
    const today = todayKey();
    if (state.stats.lastPlayedDay === today) return;
    const yest = todayKey(new Date(Date.now() - 86400000));
    state.stats.dailyStreak = state.stats.lastPlayedDay === yest
      ? (state.stats.dailyStreak || 0) + 1
      : 1;
    state.stats.lastPlayedDay = today;
  }

  function checkAchievements() {
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.includes(a.id)) continue;
      try { if (a.test(state.stats)) { state.achievements.push(a.id); newly.push(a); } }
      catch {}
    }
    return newly;
  }

  function recordResult({ runId, result, score, timeMs, difficulty }) {
    const isNew = rememberRun(runId);
    if (!isNew) {
      render();
      bus()?.emit('profile:result', { runId, result, score, timeMs, difficulty, stats: state.stats, isNew: false });
      return;
    }
    const s = state.stats;
    s.totalPlayed += 1;
    if (difficulty && s.playsByDifficulty[difficulty] != null) s.playsByDifficulty[difficulty] += 1;

    if (result === 'escaped') {
      s.wins += 1;
      s.streakWins = (s.streakWins || 0) + 1;
      if (difficulty && s.winsByDifficulty[difficulty] != null) s.winsByDifficulty[difficulty] += 1;
      if (typeof timeMs === 'number' && timeMs > 0 && (!s.bestTimeMs || timeMs < s.bestTimeMs)) s.bestTimeMs = timeMs;
      if (typeof score === 'number' && score > (s.bestScore || 0)) s.bestScore = score;
    } else {
      s.losses += 1;
      s.streakWins = 0;
    }

    bumpDailyStreak();
    const newly = checkAchievements();
    save();
    render();

    bus()?.emit('profile:result', { runId, result, score, timeMs, difficulty, stats: s, isNew: true });
    newly.forEach(a => {
      toast('Unlocked: ' + a.label);
      bus()?.emit('profile:achievement', { id: a.id, label: a.label });
    });
  }

  function fmtMs(ms) {
    if (!ms) return '--:--';
    const t = Math.floor(ms / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }

  function toast(text) {
    const el = document.getElementById('unlock-toast');
    if (!el) return;
    el.textContent = '★ ' + text;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ── Rendering (lobby UI) ──────────────────────────────────────────
  function renderCharacterRow() {
    const row = document.getElementById('char-row');
    if (!row) return;
    row.innerHTML = '';
    CHARACTERS.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'char-btn' + (c.id === state.character ? ' active' : '');
      b.title = c.name;
      b.textContent = c.label;
      b.onclick = () => setCharacter(c.id);
      row.appendChild(b);
    });
  }
  function renderColorRow() {
    const row = document.getElementById('color-row');
    if (!row) return;
    row.innerHTML = '';
    COLORS.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-swatch' + (c === state.color ? ' active' : '');
      b.style.background = c;
      b.style.color = c;
      b.onclick = () => setColor(c);
      row.appendChild(b);
    });
  }
  function renderStatsBlock() {
    const el = document.getElementById('lobby-stats');
    if (!el) return;
    const s = state.stats;
    if (s.totalPlayed === 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `
      <span class="ls-label">Played</span><span class="ls-value">${s.totalPlayed}</span>
      <span class="ls-label">Wins</span><span class="ls-value">${s.wins}</span>
      <span class="ls-label">Losses</span><span class="ls-value">${s.losses}</span>
      <span class="ls-label">Win streak</span><span class="ls-value">${s.streakWins || 0}</span>
      <span class="ls-label">Best time</span><span class="ls-value">${fmtMs(s.bestTimeMs)}</span>
      <span class="ls-label">Best score</span><span class="ls-value">${s.bestScore || 0}</span>
    `;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('stat-wins', s.wins);
    set('stat-losses', s.losses);
    set('stat-best-time', fmtMs(s.bestTimeMs));
    set('stat-total', s.totalPlayed);
  }
  function renderStreakBanner() {
    const el = document.getElementById('streak-banner');
    if (!el) return;
    const d = state.stats.dailyStreak || 0;
    el.textContent = d >= 2 ? `🔥 ${d}-day streak — keep it alive` : '';
  }
  function renderAchievements() {
    const el = document.getElementById('achievements-block');
    if (!el) return;
    el.innerHTML = ACHIEVEMENTS.map(a => {
      const got = state.achievements.includes(a.id);
      return `<span class="ach-badge${got ? '' : ' locked'}">${got ? '★' : '☆'} ${a.label}</span>`;
    }).join('');
  }
  function render() {
    const input = document.getElementById('nameInput');
    if (input && document.activeElement !== input && !input.value) input.value = state.name;
    renderCharacterRow();
    renderColorRow();
    renderStatsBlock();
    renderStreakBanner();
    renderAchievements();
  }

  function init() {
    render();
    const input = document.getElementById('nameInput');
    if (input) {
      if (!input.value) input.value = state.name;
      input.addEventListener('change', () => {
        const v = (input.value || '').trim();
        if (v) update({ name: v.slice(0, 20) });
      });
    }
    const resetBtn = document.getElementById('reset-profile-btn');
    if (resetBtn) resetBtn.onclick = () => {
      if (confirm('Reset profile, stats, and achievements? This cannot be undone.')) Profile.reset();
    };
    bus()?.emit('profile:loaded', { profile: state });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Profile = { get, update, setCharacter, setColor, reset, beginRun, currentRunId, recordResult, CHARACTERS, COLORS };
})();
