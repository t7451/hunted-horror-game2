// Minimal pub/sub event bus.
// Keeps game logic decoupled: producers `emit`, consumers `on`/`once`.
// Listeners are isolated — a thrown handler doesn't break siblings.
(function () {
  'use strict';
  const listeners = new Map(); // event -> Set<fn>

  function on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = listeners.get(event);
    if (!set) { set = new Set(); listeners.set(event, set); }
    set.add(fn);
    return () => off(event, fn);
  }

  function off(event, fn) {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  }

  function once(event, fn) {
    const unsub = on(event, (payload) => {
      unsub();
      try { fn(payload); } catch (e) { console.error('[bus]', event, e); }
    });
    return unsub;
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot so handlers can unsubscribe during iteration.
    [...set].forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[bus]', event, e); }
    });
  }

  function clear(event) {
    if (event) listeners.delete(event);
    else listeners.clear();
  }

  window.EventBus = { on, off, once, emit, clear };
})();
