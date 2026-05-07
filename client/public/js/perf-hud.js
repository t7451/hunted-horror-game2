// Floating performance HUD overlay. Toggle with `P`.
// Shows FPS, frame ms, draw calls, triangles, and adaptive quality tier.
(function () {
  'use strict';
  if (window.PerfHUD) return;

  const STYLE_ID = 'perf-hud-style';
  const EL_ID = 'perf-hud';
  const UPDATE_INTERVAL_MS = 250;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${EL_ID} {
        position: fixed;
        top: 8px;
        left: 8px;
        z-index: 99999;
        font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace;
        color: #d8fbff;
        background: rgba(0, 0, 0, 0.62);
        border: 1px solid #00e5ff;
        border-radius: 4px;
        padding: 4px 8px;
        pointer-events: none;
        white-space: pre;
        letter-spacing: 0.2px;
        display: none;
      }
      #${EL_ID}.visible { display: block; }
    `;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureEl() {
    let el = document.getElementById(EL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = EL_ID;
    el.textContent = 'FPS — | ms — | Draws — | Tris — | Tier —';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function readSettings() {
    try { return window.Profile?.get?.()?.settings || {}; } catch { return {}; }
  }

  function persistVisible(v) {
    try {
      const prev = readSettings();
      window.Profile?.update?.({ settings: { ...prev, perfHud: !!v } });
    } catch {}
  }

  function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = (a.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || a.isContentEditable;
  }

  function fmtNum(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  let visible = false;
  let el = null;
  let tierStr = '—';
  let acc = 0;
  let frames = 0;
  let last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let lastFps = 0;
  let lastFrameMs = 0;

  function readTier() {
    try {
      const t = window.AdaptiveQuality?.getTier?.();
      if (t != null) tierStr = String(t);
    } catch {}
  }

  function render() {
    if (!el) return;
    let draws = '—', tris = '—';
    try {
      const r = window.renderer;
      if (r && r.info) {
        draws = fmtNum(r.info.render?.calls);
        tris = fmtNum(r.info.render?.triangles);
      }
    } catch {}
    const fps = lastFps ? lastFps.toFixed(0) : '—';
    const ms = lastFrameMs ? lastFrameMs.toFixed(1) : '—';
    el.textContent = `FPS ${fps} | ${ms} ms | Draws ${draws} | Tris ${tris} | Tier ${tierStr}`;
  }

  function loop(now) {
    const dt = now - last;
    last = now;
    acc += dt;
    frames += 1;
    if (acc >= UPDATE_INTERVAL_MS) {
      lastFps = (frames * 1000) / acc;
      lastFrameMs = acc / frames;
      acc = 0;
      frames = 0;
      if (visible) render();
    }
    requestAnimationFrame(loop);
  }

  function setVisible(v, persist) {
    visible = !!v;
    if (el) el.classList.toggle('visible', visible);
    if (visible) render();
    if (persist) persistVisible(visible);
  }

  function toggle() { setVisible(!visible, true); }

  function onKey(e) {
    if (e.key !== 'p' && e.key !== 'P') return;
    if (isTyping()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    toggle();
  }

  function init() {
    injectStyle();
    el = ensureEl();
    readTier();
    const s = readSettings();
    setVisible(!!s.perfHud, false);
    window.addEventListener('keydown', onKey);
    try {
      window.EventBus?.on?.('quality:changed', () => {
        readTier();
        if (visible) render();
      });
    } catch {}
    last = performance.now();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.PerfHUD = {
    show: () => setVisible(true, true),
    hide: () => setVisible(false, true),
    toggle,
    isVisible: () => visible,
  };
})();
