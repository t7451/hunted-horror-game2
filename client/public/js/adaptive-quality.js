// Adaptive quality controller. Samples FPS over rolling 2s windows and
// steps a tier state machine (high -> medium -> low -> minimum) with
// hysteresis. Applies pixel ratio cap and shadow map size to the global
// THREE.WebGLRenderer (window.renderer) when present.
//
// Events emitted on window.EventBus:
//   quality:changed { tier, pixelRatioCap, shadowMapSize }
//
// Listens for:
//   settings:changed { preset } where preset in {auto, low, medium, high}.
//   A non-auto preset pauses auto-stepping; 'auto' resumes.
(function () {
  'use strict';
  if (window.AdaptiveQuality) return;

  const TIERS = {
    high:    { pixelRatioCap: 2,    shadowMapSize: 2048 },
    medium:  { pixelRatioCap: 1.5,  shadowMapSize: 1024 },
    low:     { pixelRatioCap: 1,    shadowMapSize: 512 },
    minimum: { pixelRatioCap: 0.85, shadowMapSize: 256 }
  };
  const ORDER = ['high', 'medium', 'low', 'minimum'];

  const WINDOW_MS = 2000;
  const DOWN_FPS = 38;
  const DOWN_WINDOWS = 2;
  const UP_FPS = 58;
  const UP_WINDOWS = 6;

  let currentTier = 'high';
  let paused = false;
  let active = false;

  let windowStart = 0;
  let windowFrames = 0;
  let slowStreak = 0;
  let fastStreak = 0;
  let rafId = 0;

  function bus() { return window.EventBus; }

  function applyTier(tier) {
    const cfg = TIERS[tier];
    if (!cfg) return;
    try {
      const r = window.renderer;
      if (r && typeof r.setPixelRatio === 'function') {
        const dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio) || 1;
        r.setPixelRatio(Math.min(dpr, cfg.pixelRatioCap));
      }
      if (r && r.shadowMap && r.shadowMap.enabled) {
        r.shadowMap.mapSize = cfg.shadowMapSize;
      }
    } catch (e) { /* never throw */ }
  }

  function setTier(tier) {
    if (!TIERS[tier] || tier === currentTier) return;
    currentTier = tier;
    slowStreak = 0;
    fastStreak = 0;
    applyTier(tier);
    try {
      const b = bus();
      if (b && typeof b.emit === 'function') {
        b.emit('quality:changed', {
          tier: currentTier,
          pixelRatioCap: TIERS[currentTier].pixelRatioCap,
          shadowMapSize: TIERS[currentTier].shadowMapSize
        });
      }
    } catch (e) { /* ignore */ }
  }

  function stepDown() {
    const i = ORDER.indexOf(currentTier);
    if (i >= 0 && i < ORDER.length - 1) setTier(ORDER[i + 1]);
  }
  function stepUp() {
    const i = ORDER.indexOf(currentTier);
    if (i > 0) setTier(ORDER[i - 1]);
  }

  function onFrame(now) {
    if (!active) return;
    if (!windowStart) windowStart = now;
    windowFrames++;
    const elapsed = now - windowStart;
    if (elapsed >= WINDOW_MS) {
      const fps = (windowFrames * 1000) / elapsed;
      windowFrames = 0;
      windowStart = now;
      if (!paused) {
        if (fps < DOWN_FPS) {
          slowStreak++;
          fastStreak = 0;
          if (slowStreak >= DOWN_WINDOWS) stepDown();
        } else if (fps >= UP_FPS) {
          fastStreak++;
          slowStreak = 0;
          if (fastStreak >= UP_WINDOWS) stepUp();
        } else {
          slowStreak = 0;
          fastStreak = 0;
        }
      }
    }
    rafId = requestAnimationFrame(onFrame);
  }

  function activate() {
    if (active) return;
    active = true;
    windowStart = 0;
    windowFrames = 0;
    applyTier(currentTier);
    rafId = requestAnimationFrame(onFrame);
  }

  function waitForRenderer() {
    let waited = 0;
    const interval = 1000;
    const limit = 30000;
    function tick() {
      if (window.renderer) { activate(); return; }
      waited += interval;
      if (waited >= limit) { activate(); return; }
      setTimeout(tick, interval);
    }
    tick();
  }

  function onSettingsChanged(payload) {
    try {
      const preset = payload && payload.preset;
      if (!preset || preset === 'auto') {
        paused = false;
      } else if (TIERS[preset]) {
        paused = true;
        setTier(preset);
      } else {
        paused = true;
      }
    } catch (e) { /* ignore */ }
  }

  function subscribeBus() {
    try {
      const b = bus();
      if (b && typeof b.subscribe === 'function') {
        b.subscribe('settings:changed', onSettingsChanged);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  if (!subscribeBus()) {
    let tries = 0;
    const id = setInterval(function () {
      tries++;
      if (subscribeBus() || tries > 30) clearInterval(id);
    }, 1000);
  }

  window.AdaptiveQuality = {
    getTier: function () { return currentTier; },
    forceTier: function (name) {
      if (TIERS[name]) { paused = true; setTier(name); }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForRenderer);
  } else {
    waitForRenderer();
  }
})();
