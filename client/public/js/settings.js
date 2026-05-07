// Browser-side graphics settings panel.
// Persists settings via Profile and broadcasts changes on EventBus.
//
// Events emitted:
//   settings:changed { settings }
(function () {
  'use strict';
  if (window.Settings) return;

  const PRESETS = {
    auto:   { pixelRatioCap: 0,   shadows: true,  fog: true,  particles: true  },
    low:    { pixelRatioCap: 1,   shadows: false, fog: false, particles: false },
    medium: { pixelRatioCap: 1.5, shadows: true,  fog: true,  particles: false },
    high:   { pixelRatioCap: 2,   shadows: true,  fog: true,  particles: true  },
  };
  const PRESET_NAMES = ['auto', 'low', 'medium', 'high'];
  const DEFAULTS = { preset: 'auto', ...PRESETS.auto };

  const bus = () => window.EventBus;
  const profile = () => window.Profile;

  function readStored() {
    const p = profile();
    if (!p || typeof p.get !== 'function') return null;
    const s = p.get();
    return s && s.settings ? s.settings : null;
  }

  function persist(patch) {
    const p = profile();
    if (!p || typeof p.update !== 'function' || typeof p.get !== 'function') return;
    const cur = p.get().settings || {};
    p.update({ settings: { ...cur, ...patch } });
  }

  function normalize(settings) {
    const merged = { ...DEFAULTS, ...(settings || {}) };
    if (!PRESETS[merged.preset]) merged.preset = 'auto';
    const presetVals = PRESETS[merged.preset];
    return { ...presetVals, ...merged };
  }

  let current = normalize(readStored());

  function get() {
    return { ...current };
  }

  function set(patch) {
    current = normalize({ ...current, ...patch });
    persist(current);
    if (bus()) bus().emit('settings:changed', { settings: get() });
    refreshActive();
  }

  function getPreset() {
    return current.preset;
  }

  function setPreset(name) {
    if (!PRESETS[name]) return;
    set({ preset: name, ...PRESETS[name] });
  }

  function injectStyles() {
    if (document.getElementById('settings-style')) return;
    const style = document.createElement('style');
    style.id = 'settings-style';
    style.textContent = `
      #settings-btn {
        margin-top: 8px;
        background: transparent;
        border: 1px solid #00e5ff;
        color: #00e5ff;
        padding: 6px 12px;
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 1px;
        cursor: pointer;
        border-radius: 2px;
      }
      #settings-btn:hover { background: rgba(0,229,255,0.12); }
      #settings-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.75);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      #settings-modal.show { display: flex; }
      #settings-modal .panel {
        background: #0a0f12;
        border: 1px solid #00e5ff;
        box-shadow: 0 0 24px rgba(0,229,255,0.25);
        color: #00e5ff;
        padding: 22px 26px;
        min-width: 280px;
        max-width: 90vw;
        font-family: monospace;
        text-align: center;
      }
      #settings-modal h2 {
        margin: 0 0 16px;
        letter-spacing: 3px;
        font-size: 16px;
      }
      #settings-modal .preset-row {
        display: flex;
        gap: 8px;
        justify-content: center;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      #settings-modal .preset-btn {
        background: transparent;
        border: 1px solid #00e5ff;
        color: #00e5ff;
        padding: 8px 14px;
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 1px;
        cursor: pointer;
        border-radius: 2px;
        text-transform: uppercase;
      }
      #settings-modal .preset-btn:hover { background: rgba(0,229,255,0.12); }
      #settings-modal .preset-btn.active {
        background: #00e5ff;
        color: #0a0f12;
        font-weight: bold;
      }
      #settings-modal .note {
        font-size: 11px;
        opacity: 0.7;
        margin: 8px 0 14px;
      }
      #settings-modal .close-btn {
        background: transparent;
        border: 1px solid #00e5ff;
        color: #00e5ff;
        padding: 6px 18px;
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 1px;
        cursor: pointer;
        border-radius: 2px;
      }
      #settings-modal .close-btn:hover { background: rgba(0,229,255,0.12); }
    `;
    document.head.appendChild(style);
  }

  function refreshActive() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const active = getPreset();
    modal.querySelectorAll('.preset-btn').forEach(btn => {
      if (btn.dataset.preset === active) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  function buildModal() {
    if (document.getElementById('settings-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const h = document.createElement('h2');
    h.textContent = 'GRAPHICS';
    panel.appendChild(h);
    const row = document.createElement('div');
    row.className = 'preset-row';
    PRESET_NAMES.forEach(name => {
      const b = document.createElement('button');
      b.className = 'preset-btn';
      b.dataset.preset = name;
      b.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      b.addEventListener('click', () => setPreset(name));
      row.appendChild(b);
    });
    panel.appendChild(row);
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'Auto adapts to your device';
    panel.appendChild(note);
    const close = document.createElement('button');
    close.className = 'close-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => modal.classList.remove('show'));
    panel.appendChild(close);
    modal.appendChild(panel);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
    document.body.appendChild(modal);
  }

  function injectButton() {
    const profileBlock = document.getElementById('profile-block');
    if (!profileBlock) return;
    if (document.getElementById('settings-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'settings-btn';
    btn.type = 'button';
    btn.textContent = 'Settings';
    btn.addEventListener('click', () => {
      const modal = document.getElementById('settings-modal');
      if (modal) {
        refreshActive();
        modal.classList.add('show');
      }
    });
    profileBlock.appendChild(btn);
  }

  function init() {
    injectStyles();
    buildModal();
    injectButton();
    refreshActive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-read in case Profile loaded after this script.
  const stored = readStored();
  if (stored) current = normalize(stored);

  if (bus()) bus().emit('settings:changed', { settings: get() });

  window.Settings = { get, set, getPreset, setPreset, PRESETS };
})();
