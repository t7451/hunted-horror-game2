// First-run guided tutorial walkthrough.
// Wires up the existing #tutorial-overlay markup, persists completion via Profile,
// emits 'tutorial:complete' on EventBus, and provides Tutorial.show()/reset().
(function () {
  'use strict';
  if (window.Tutorial) return;

  const STEPS = [
    { title: 'Welcome to HUNTED', body: 'You are trapped in Claude\'s domain. Survive the night.' },
    { title: 'Move + Look', body: 'WASD to move, mouse or right thumbstick to look around. Shift to sprint.' },
    { title: 'Find the Keys', body: 'Collect glowing keys scattered through the map. Each unlocks part of the exit.' },
    { title: 'Hide from Claude', body: 'Press C (or HIDE button) to crouch into hiding spots. Hold still — Claude hears your noise.' },
    { title: 'Escape', body: 'Reach the exit before time runs out. Good luck.' },
  ];

  const bus = () => window.EventBus;
  const profile = () => window.Profile;

  let stepIdx = 0;

  function $(id) { return document.getElementById(id); }

  function render() {
    const step = STEPS[stepIdx];
    const title = $('tutorial-title');
    const text = $('tutorial-text');
    const next = $('tutorial-next');
    if (title) title.textContent = step.title;
    if (text) text.textContent = step.body;
    if (next) next.textContent = stepIdx === STEPS.length - 1 ? 'Got it' : 'Next';
  }

  function open() {
    const overlay = $('tutorial-overlay');
    if (!overlay) return;
    stepIdx = 0;
    render();
    overlay.classList.add('show');
  }

  function close() {
    const overlay = $('tutorial-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  function complete() {
    try { profile()?.update({ tutorialCompleted: true }); } catch {}
    close();
    ensureReplayLink();
    bus()?.emit('tutorial:complete');
  }

  function onNext() {
    if (stepIdx >= STEPS.length - 1) {
      complete();
      return;
    }
    stepIdx += 1;
    render();
  }

  function onSkip() {
    complete();
  }

  function ensureReplayLink() {
    const block = $('profile-block');
    if (!block) return;
    if (document.getElementById('tutorial-replay-link')) return;
    const p = profile();
    if (!p || !p.get().tutorialCompleted) return;
    const a = document.createElement('a');
    a.id = 'tutorial-replay-link';
    a.href = '#';
    a.textContent = 'Replay tutorial';
    a.style.color = '#445';
    a.style.fontSize = '.6rem';
    a.style.letterSpacing = '.15em';
    a.style.textAlign = 'center';
    a.style.marginTop = '4px';
    a.style.textDecoration = 'underline';
    a.style.cursor = 'pointer';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      open();
    });
    block.appendChild(a);
  }

  function wire() {
    const next = $('tutorial-next');
    const skip = $('tutorial-skip');
    if (next && !next.dataset.tutorialWired) {
      next.dataset.tutorialWired = '1';
      next.addEventListener('click', onNext);
    }
    if (skip && !skip.dataset.tutorialWired) {
      skip.dataset.tutorialWired = '1';
      skip.addEventListener('click', onSkip);
    }
  }

  function lobbyVisible() {
    const lobby = $('lobby');
    if (!lobby) return false;
    if (lobby.classList.contains('hidden')) return false;
    return true;
  }

  function init() {
    wire();
    const p = profile();
    const completed = !!(p && p.get().tutorialCompleted);
    if (completed) {
      ensureReplayLink();
      return;
    }
    if (lobbyVisible()) {
      open();
    } else {
      // Wait briefly for lobby to appear.
      const obs = new MutationObserver(() => {
        if (lobbyVisible()) {
          obs.disconnect();
          open();
        }
      });
      const lobby = $('lobby');
      if (lobby) obs.observe(lobby, { attributes: true, attributeFilter: ['class'] });
      else open();
    }
  }

  function reset() {
    try { profile()?.update({ tutorialCompleted: false }); } catch {}
    const link = document.getElementById('tutorial-replay-link');
    if (link) link.remove();
  }

  window.Tutorial = { show: open, reset };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
