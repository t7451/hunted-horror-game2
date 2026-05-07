// Win/Death screen stat deltas. Renders a small badge block summarizing what
// changed between the snapshot taken at run start and the stats after the run.
// Idempotent: safe to load twice.
(function () {
  'use strict';
  if (window.WinDeltas && window.WinDeltas.__loaded) return;

  let _pre = null;
  let _last = null;

  function snapshot() {
    try {
      return JSON.parse(JSON.stringify(window.Profile.get().stats));
    } catch {
      return null;
    }
  }

  function hookProfile() {
    const P = window.Profile;
    if (!P || !P.beginRun) return false;
    if (P.beginRun.__delta_wrapped) return true;
    const orig = P.beginRun.bind(P);
    const wrapped = function (args) {
      _pre = snapshot();
      return orig(args);
    };
    wrapped.__delta_wrapped = true;
    P.beginRun = wrapped;
    return true;
  }

  function tryHook() {
    if (hookProfile()) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (hookProfile() || tries >= 50) clearInterval(iv);
    }, 100);
  }

  function injectStyle() {
    if (document.getElementById('win-deltas-style')) return;
    const css = `
      .win-deltas{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:10px 0 6px;max-width:90vw}
      .win-deltas .wd-badge{font-size:.7rem;letter-spacing:.08em;padding:5px 10px;border-radius:4px;font-weight:700;background:rgba(0,229,255,.12);color:#00e5ff;border:1px solid rgba(0,229,255,.35);text-transform:uppercase}
      .win-deltas .wd-badge.wd-gold{background:rgba(255,204,102,.14);color:#ffcc66;border-color:rgba(255,204,102,.45);text-shadow:0 0 8px rgba(255,204,102,.4)}
      .win-deltas .wd-badge.wd-muted{background:rgba(102,102,119,.18);color:#aab;border-color:rgba(170,170,187,.35)}
    `;
    const el = document.createElement('style');
    el.id = 'win-deltas-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function computeDeltas(pre, post) {
    const out = { items: [], summary: {} };
    if (!post) return out;
    const p = pre || {};
    if ((post.wins || 0) > (p.wins || 0)) {
      out.items.push({ kind: 'win', text: '+1 WIN', gold: false });
      out.summary.wonRun = true;
    }
    const preBest = p.bestTimeMs;
    const postBest = post.bestTimeMs;
    if (postBest != null && (preBest == null || postBest < preBest)) {
      out.items.push({ kind: 'best-time', text: '★ NEW BEST TIME!', gold: true });
      out.summary.newBestTime = true;
    }
    if ((post.bestScore || 0) > (p.bestScore || 0)) {
      out.items.push({ kind: 'best-score', text: '★ NEW HIGH SCORE!', gold: true });
      out.summary.newBestScore = true;
    }
    const preStreak = p.streakWins || 0;
    const postStreak = post.streakWins || 0;
    if (postStreak > preStreak) {
      out.items.push({ kind: 'streak', text: '+STREAK (NOW ' + postStreak + ')', gold: false });
      out.summary.streak = postStreak;
    } else if (postStreak === 0 && preStreak > 0) {
      out.items.push({ kind: 'streak-end', text: 'STREAK ENDED AT ' + preStreak, gold: false, muted: true });
      out.summary.streakEnded = preStreak;
    }
    const preAch = new Set((p.achievements) || []);
    const postAch = (post.achievements) || [];
    const unlocked = postAch.filter((id) => !preAch.has(id));
    if (unlocked.length) {
      for (const id of unlocked) {
        out.items.push({ kind: 'achievement', text: '★ UNLOCKED: ' + id, gold: true });
      }
      out.summary.unlocked = unlocked.slice();
    }
    return out;
  }

  function render(target, deltas) {
    if (!target) return;
    const existing = target.querySelector('.win-deltas');
    if (existing) existing.remove();
    if (!deltas.items.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'win-deltas';
    for (const it of deltas.items) {
      const b = document.createElement('span');
      b.className = 'wd-badge' + (it.gold ? ' wd-gold' : '') + (it.muted ? ' wd-muted' : '');
      b.textContent = it.text;
      wrap.appendChild(b);
    }
    target.appendChild(wrap);
  }

  function handleShow(which) {
    injectStyle();
    // Profile may not exist yet (very early init). Guard.
    if (!window.Profile) return;
    const post = snapshot();
    const deltas = computeDeltas(_pre, post);
    _last = { which, deltas, pre: _pre, post };
    const target = document.getElementById(which === 'win' ? 'win-screen' : 'death-screen');
    render(target, deltas);
    try {
      window.EventBus && window.EventBus.emit && window.EventBus.emit('result:deltas', {
        which,
        items: deltas.items,
        summary: deltas.summary,
      });
    } catch {}
  }

  function watchScreens() {
    const win = document.getElementById('win-screen');
    const death = document.getElementById('death-screen');
    if (!win && !death) return false;
    const observed = new WeakMap();
    const make = (el, which) => {
      if (!el) return;
      observed.set(el, el.classList.contains('show'));
      const mo = new MutationObserver(() => {
        const was = observed.get(el);
        const now = el.classList.contains('show');
        observed.set(el, now);
        if (now && !was) handleShow(which);
      });
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    };
    make(win, 'win');
    make(death, 'death');
    return true;
  }

  function init() {
    tryHook();
    if (!watchScreens()) {
      // DOM not ready yet — wait.
      document.addEventListener('DOMContentLoaded', watchScreens, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.WinDeltas = {
    __loaded: true,
    last: () => _last,
    _compute: computeDeltas,
  };
})();
