// Daily Challenge banner — date-seeded modifier of the day, with soft tracking
// for the observable challenges ('streak2', 'iron'). Idempotent on reload.
(function () {
  'use strict';
  if (window.DailyChallenge) return;

  const bus = () => window.EventBus;
  const profile = () => window.Profile;

  const MODIFIERS = [
    { id: 'no-sprint', label: 'No Sprint',       desc: 'Win without sprinting' },
    { id: 'speed',     label: 'Speed Demon',     desc: 'Escape in under 90 seconds' },
    { id: 'silent',    label: 'Silent Step',     desc: 'Win on Hard difficulty' },
    { id: 'streak2',   label: 'Back-to-back',    desc: 'Win 2 in a row today' },
    { id: 'morning',   label: 'Early Bird',      desc: 'Play before noon local' },
    { id: 'no-hide',   label: 'Out in the Open', desc: 'Win without using a hiding spot' },
    { id: 'flawless',  label: 'Flawless',        desc: 'Win with 100% sanity' },
    { id: 'iron',      label: 'Iron Will',       desc: 'Win after losing 2+ times today' }
  ];

  function todayKey(d) {
    d = d || new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickModifier(dateKey) {
    const rng = mulberry32(hashSeed('hunted-daily-' + dateKey));
    const idx = Math.floor(rng() * MODIFIERS.length);
    return MODIFIERS[idx];
  }

  const LOCAL_KEY = 'hunted.daily.local.v1';
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && typeof obj === 'object') return obj;
    } catch (e) {}
    return {};
  }
  function saveLocal(v) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch (e) {}
  }
  function getDayBucket() {
    const all = loadLocal();
    const k = todayKey();
    if (!all[k]) all[k] = { wins: 0, losses: 0, lastResult: null };
    // prune older days to keep storage small
    Object.keys(all).forEach(key => { if (key !== k) delete all[key]; });
    return { all, k, bucket: all[k] };
  }

  function eligibility(modId) {
    const { bucket } = getDayBucket();
    if (modId === 'streak2') {
      // need 2 wins in a row today
      const winStreakToday = bucket.lastResult === 'win' ? bucket.wins : 0;
      return {
        progress: Math.min(winStreakToday, 2),
        target: 2,
        met: winStreakToday >= 2
      };
    }
    if (modId === 'iron') {
      // 2+ losses today, then a win
      const hasIron = bucket.losses >= 2 && bucket.lastResult === 'win';
      return {
        progress: bucket.losses >= 2 ? (hasIron ? 2 : 1) : 0,
        target: 2,
        met: hasIron
      };
    }
    // Aspirational — no automatic tracking.
    return { progress: 0, target: 1, met: false, aspirational: true };
  }

  function isCompletedToday() {
    const p = profile() && profile().get && profile().get();
    if (!p || !p.dailyChallenges) return false;
    const k = todayKey();
    return !!(p.dailyChallenges[k] && p.dailyChallenges[k].id);
  }

  function markComplete(modId) {
    const p = profile();
    if (!p || !p.update || !p.get) return false;
    const cur = p.get().dailyChallenges || {};
    const k = todayKey();
    if (cur[k]) return false;
    const next = Object.assign({}, cur, { [k]: { id: modId, completedAt: Date.now() } });
    p.update({ dailyChallenges: next });
    return true;
  }

  function toast(text) {
    const el = document.getElementById('unlock-toast');
    if (!el) return;
    el.textContent = '★ ' + text;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function ensureStyles() {
    if (document.getElementById('daily-challenge-styles')) return;
    const css = document.createElement('style');
    css.id = 'daily-challenge-styles';
    css.textContent = [
      '#daily-challenge{width:min(300px,88vw);margin:6px auto 0;padding:8px 10px;',
      'border:1px solid #6a4ea0;border-radius:6px;background:rgba(40,20,70,.55);',
      'color:#d8c7ff;font-size:.7rem;letter-spacing:.06em;text-align:center;',
      'box-shadow:0 0 12px rgba(120,80,200,.25)}',
      '#daily-challenge .dc-head{color:#c9aaff;font-size:.62rem;letter-spacing:.18em;margin-bottom:3px}',
      '#daily-challenge .dc-label{color:#fff;font-weight:bold;font-size:.78rem;letter-spacing:.08em}',
      '#daily-challenge .dc-desc{color:#aa9bd0;font-size:.66rem;margin-top:2px}',
      '#daily-challenge .dc-pill{display:inline-block;margin-top:5px;padding:2px 8px;border-radius:10px;',
      'font-size:.6rem;letter-spacing:.16em;border:1px solid currentColor}',
      '#daily-challenge .dc-pill.locked{color:#776a99}',
      '#daily-challenge .dc-pill.progress{color:#ffcc66}',
      '#daily-challenge .dc-pill.complete{color:#7fffa6;text-shadow:0 0 8px rgba(127,255,166,.5)}'
    ].join('');
    document.head.appendChild(css);
  }

  function ensureBanner() {
    let el = document.getElementById('daily-challenge');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'daily-challenge';
    const status = document.getElementById('lobby-status');
    const lobby = document.getElementById('lobby');
    if (status && status.parentNode) status.parentNode.insertBefore(el, status);
    else if (lobby) lobby.appendChild(el);
    else document.body.appendChild(el);
    return el;
  }

  let _lastRenderKey = null;
  function render() {
    ensureStyles();
    const el = ensureBanner();
    const mod = pickModifier(todayKey());
    const completed = isCompletedToday();
    const elig = eligibility(mod.id);
    let pillClass = 'locked';
    let pillText = 'LOCKED';
    if (completed) {
      pillClass = 'complete';
      pillText = 'COMPLETE ★ +50 BONUS';
    } else if (!elig.aspirational && elig.progress > 0) {
      pillClass = 'progress';
      pillText = 'IN PROGRESS';
    }
    const key = mod.id + '|' + pillClass;
    if (key === _lastRenderKey && el.firstChild) return;
    _lastRenderKey = key;
    el.innerHTML = [
      '<div class="dc-head">🌙 DAILY CHALLENGE</div>',
      '<div class="dc-label">' + escapeHtml(mod.label) + '</div>',
      '<div class="dc-desc">' + escapeHtml(mod.desc) + '</div>',
      '<div class="dc-pill ' + pillClass + '">' + pillText + '</div>'
    ].join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function checkAndComplete() {
    if (isCompletedToday()) { render(); return; }
    const mod = pickModifier(todayKey());
    const elig = eligibility(mod.id);
    if (elig.met) {
      if (markComplete(mod.id)) {
        toast('Daily Challenge: ' + mod.label);
      }
    }
    render();
  }

  function onResult(result) {
    if (!result) return;
    const { all, bucket } = getDayBucket();
    const win = result === 'escaped' || result === 'win';
    if (win) { bucket.wins = (bucket.wins || 0) + 1; bucket.lastResult = 'win'; }
    else { bucket.losses = (bucket.losses || 0) + 1; bucket.lastResult = 'loss'; }
    saveLocal(all);
    checkAndComplete();
  }

  function lobbyVisible() {
    const lobby = document.getElementById('lobby');
    if (!lobby) return false;
    if (lobby.classList && lobby.classList.contains('hidden')) return false;
    const style = window.getComputedStyle(lobby);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function startPolling() {
    if (startPolling._t) return;
    startPolling._t = setInterval(() => {
      if (lobbyVisible()) checkAndComplete();
    }, 3000);
  }

  function init() {
    render();
    const b = bus();
    if (b && typeof b.on === 'function') {
      b.on('result:deltas', payload => {
        const r = payload && (payload.result || payload.outcome);
        onResult(r);
      });
      b.on('profile:result', payload => {
        const r = payload && payload.result;
        onResult(r);
      });
      b.on('profile:updated', () => render());
      b.on('profile:reset', () => render());
    }
    startPolling();
  }

  function today() {
    const mod = pickModifier(todayKey());
    return { id: mod.id, label: mod.label, desc: mod.desc, completed: isCompletedToday() };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.DailyChallenge = { today, _render: render, _onResult: onResult };
})();
