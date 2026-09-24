/* Liar's Ledge — bootstrap: input, loop, menus, saving. */
(function (LL) {
  'use strict';

  const U = LL.U, C = LL.C;
  const KEY_SAVE = 'liarsledge.save.v1';
  const KEY_LEVEL = 'liarsledge.level.v1';
  const KEY_SETTINGS = 'liarsledge.settings.v1';
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  const settings = Object.assign({ muted: false, sens: 1 }, store.get(KEY_SETTINGS) || {});

  const G = LL.game = {
    mode: 'title',
    level: null, sim: null, guide: null,
    renderer: new LL.Renderer(canvas),
    sound: new LL.Sound(),
    settings: settings,
    store: store,
    KEY_LEVEL: KEY_LEVEL
  };
  G.renderer.debug = DEBUG;
  G.sound.muted = settings.muted;

  /* ---- level & game lifecycle ------------------------------------------- */
  function loadLevel() {
    const custom = store.get(KEY_LEVEL);
    if (custom && !params.has('generated')) {
      try { return LL.Level.fromJSON(custom); } catch (e) { console.warn('Custom level ignored:', e); }
    }
    return LL.Level.generate(C.SEED);
  }
  function levelSig(level) { return level.custom ? 'custom:' + level.holds.length : 'gen:' + C.SEED; }

  G.newGame = function (keepLevel) {
    if (!keepLevel || !G.level) G.level = loadLevel();
    else resetLevelState(G.level);
    G.sim = new LL.Sim(G.level);
    G.guide = new LL.Guide(G.sim);
    G.guide.start(true);
    G.renderer.cam.x = 0; G.renderer.cam.y = 1.6;
    G.renderer.fx.length = 0;
    G.sound.silenced = false;
    if (G.sound.ctx) G.sound.music.gain.setTargetAtTime(0.32, G.sound.ctx.currentTime, 1);
    save();
  };

  function resetLevelState(level) {
    for (const h of level.holds) {
      h.gone = false; h.crumbleT = -1; h.tamed = false; h.fled = 0; h.fleeT = -1; h.x = h.x0; h.y = h.y0;
    }
    for (const l of level.ledges) l.broken = false;
    for (const p of level.panels) p.tears.length = 0;
  }

  function loadGame() {
    const s = store.get(KEY_SAVE);
    G.level = loadLevel();
    G.sim = new LL.Sim(G.level);
    G.guide = new LL.Guide(G.sim);
    if (s && s.levelSig === levelSig(G.level) && G.sim.restore(s.sim)) {
      G.guide.restore(s.guide);
      const c = G.sim.chest();
      G.renderer.cam.x = c.x; G.renderer.cam.y = c.y;
      return true;
    }
    G.guide.start(true);
    return false;
  }

  function save() {
    if (!G.sim) return;
    store.set(KEY_SAVE, { sim: G.sim.serialize(), guide: G.guide.serialize(), levelSig: levelSig(G.level), at: Date.now() });
  }
  G.save = save;

  /* ---- input ---------------------------------------------------------- */
  const input = { dx: 0, dy: 0, btn: [false, false], wheel: 0, keys: {}, abs: null, locked: false, lockFailed: false };
  G.input = input;

  function wantLock() {
    if (!canvas.requestPointerLock || input.locked) return;
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => (input.lockFailed = true)); } catch (e) { input.lockFailed = true; }
      });
    } catch (e) { input.lockFailed = true; }
  }

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked && G.mode === 'play') pause();
  });
  document.addEventListener('pointerlockerror', () => { input.lockFailed = true; });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (G.mode === 'editor') return LL.Editor.mouse(e, 'down');
    if (G.mode !== 'play') return;
    e.preventDefault();
    if (!input.locked && !input.lockFailed) wantLock();
    if (e.button === 0) input.btn[0] = true;
    if (e.button === 2) input.btn[1] = true;
    G.sound.init();
  });
  window.addEventListener('mouseup', (e) => {
    if (G.mode === 'editor') return LL.Editor.mouse(e, 'up');
    if (e.button === 0) input.btn[0] = false;
    if (e.button === 2) input.btn[1] = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (G.mode === 'editor') return LL.Editor.mouse(e, 'move');
    if (input.locked) { input.dx += e.movementX; input.dy += e.movementY; }
    else {
      if (input.abs) { input.dx += e.clientX - input.abs.x; input.dy += e.clientY - input.abs.y; }
      input.abs = { x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (G.mode === 'editor') return LL.Editor.wheel(e);
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100;
    input.wheel -= U.clamp(e.deltaY / unit, -3, 3);
  }, { passive: false });
  window.addEventListener('blur', () => { input.btn[0] = input.btn[1] = false; input.keys = {}; });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.key === 'F2') { e.preventDefault(); return G.mode === 'editor' ? LL.Editor.close() : openEditor(); }
    if (G.mode === 'editor') return LL.Editor.key(e, true);
    input.keys[k] = true;
    if (k === 'p' && G.mode === 'play') { document.exitPointerLock && document.exitPointerLock(); pause(); }
    if (k === 'm') setMuted(!settings.muted);
    if (k === '`') G.renderer.debug = !G.renderer.debug;
    if (DEBUG && G.mode === 'play') {
      if (e.key === 'PageUp') G.sim.teleport(G.sim.height() + 20);
      if (e.key === 'PageDown') G.sim.teleport(Math.max(1, G.sim.height() - 20));
      if (k === 'g') G.god = !G.god;
    }
    if (['arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (G.mode === 'editor') return LL.Editor.key(e, false);
    input.keys[e.key.toLowerCase()] = false;
  });

  /* ---- menus ------------------------------------------------------------ */
  function show(id) {
    $('overlay').classList.toggle('hidden', !id);
    for (const p of ['title', 'pause', 'confirm']) $(p).classList.toggle('hidden', p !== id);
  }

  function play() {
    G.mode = 'play';
    show(null);
    G.sound.init();
    G.sound.setMuted(settings.muted);
    input.btn[0] = input.btn[1] = false;
    input.dx = input.dy = input.wheel = 0;
    input.lockFailed = false;
    wantLock();
  }

  function pause() {
    if (G.mode !== 'play') return;
    G.mode = 'pause';
    input.btn[0] = input.btn[1] = false;
    const s = G.sim;
    // The pause screen tells the truth. (It isn't part of the wall.)
    $('pause-height').textContent = Math.floor(s.height()) + ' m';
    $('pause-stats').textContent = 'Best ' + Math.floor(s.best) + ' m · ' + U.fmtTime(s.time) + ' climbing · ' + s.falls + ' falls';
    show('pause');
    save();
  }

  function refreshTitle(hasSave) {
    const b = $('btn-continue');
    if (hasSave && G.sim.time > 1) {
      b.classList.remove('hidden');
      b.textContent = 'Continue · ' + Math.floor(G.sim.height()) + ' m';
      $('btn-new').classList.remove('primary');
    } else {
      b.classList.add('hidden');
      $('btn-new').classList.add('primary');
      $('btn-new').textContent = 'Begin the climb';
    }
    if (G.level.custom) $('title-note').textContent = 'Custom wall loaded from the editor · Mouse required';
  }

  function setMuted(m) {
    settings.muted = m;
    $('opt-sound').checked = !m;
    G.sound.setMuted(m);
    store.set(KEY_SETTINGS, settings);
  }

  function openEditor() {
    if (document.exitPointerLock) document.exitPointerLock();
    G.mode = 'editor';
    show(null);
    LL.Editor.open(G);
  }
  G.onEditorClose = function (playFrom) {
    if (playFrom != null) { G.sim.teleport(playFrom); play(); }
    else { G.mode = 'play'; pause(); }
  };

  $('btn-continue').onclick = () => { play(); G.guide.start(false); };
  $('btn-new').onclick = () => {
    if (G.sim.time > 1 && G.sim.best > 3) { $('confirm-text').textContent = 'Your climb (best ' + Math.floor(G.sim.best) + ' m) will be lost.'; G.confirmFrom = 'title'; show('confirm'); return; }
    G.newGame(true);
    play();
  };
  $('btn-resume').onclick = play;
  $('btn-restart').onclick = () => { $('confirm-text').textContent = 'You are at ' + Math.floor(G.sim.height()) + ' m. The ground is at 0.'; G.confirmFrom = 'pause'; show('confirm'); };
  $('btn-confirm-yes').onclick = () => { G.newGame(true); play(); };
  $('btn-confirm-no').onclick = () => show(G.confirmFrom === 'title' ? 'title' : 'pause');
  $('btn-editor').onclick = openEditor;
  $('opt-sound').checked = !settings.muted;
  $('opt-sound').onchange = (e) => setMuted(!e.target.checked);
  $('opt-sens').value = settings.sens;
  $('opt-sens').oninput = (e) => { settings.sens = +e.target.value; store.set(KEY_SETTINGS, settings); };

  window.addEventListener('resize', () => G.renderer.resize());
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); if (G.mode === 'play') pause(); } });

  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('touch-warning').classList.remove('hidden');

  /* ---- loop ------------------------------------------------------------- */
  let last = performance.now(), acc = 0, saveT = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const R = G.renderer, sim = G.sim;

    if (G.mode === 'play') {
      acc += dt;
      const k = settings.sens / R.scale;         // screen pixels → metres at the current zoom
      let first = true;
      const pullKey = (input.keys.w || input.keys.arrowup ? 1 : 0) - (input.keys.s || input.keys.arrowdown ? 1 : 0);
      while (acc >= C.DT) {
        acc -= C.DT;
        const inp = {
          dx: first ? input.dx * k : 0,
          dy: first ? -input.dy * k : 0,
          btn: input.btn.slice(),
          wheel: first ? input.wheel : 0,
          pullKey: pullKey,
          abs: !input.locked && input.abs ? R.toWorld(input.abs.x, input.abs.y) : null
        };
        if (first) { input.dx = input.dy = input.wheel = 0; first = false; }
        sim.step(inp);
        if (G.god) for (const h of sim.hands) h.st = 1;
      }
      dispatch();
      G.guide.update(dt);
      saveT += dt;
      if (saveT > 3) { saveT = 0; save(); }
    }

    if (G.mode !== 'editor') R.follow(sim, dt);
    R.update(G.mode === 'play' ? dt : dt * 0.25);

    // honest audio state (the grip hum follows real grips)
    let grips = 0, stMin = 1;
    for (const h of sim.hands) if (h.state === 'grip') { grips++; stMin = Math.min(stMin, h.st); }
    G.sound.update(dt, {
      vy: sim.body.chestVel().y, grips: G.mode === 'play' ? grips : 0, stamina: stMin,
      height: sim.height(), zone: sim.zone, silent: G.guide.silent
    });

    if (G.mode === 'editor') LL.Editor.draw();
    else R.draw(sim, G.guide, { hideCursor: G.mode !== 'play' });

    // screen blur: fake falls lie loudly, real fast falls blur a little
    const v = sim.body.chestVel();
    const blur = Math.max(R.fakeFallT > 0 ? 3 * (R.fakeFallT / 1.35) : 0, U.clamp((-v.y - 12) / 10, 0, 1) * 1.2);
    const f = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
    if (canvas.style.filter !== f) canvas.style.filter = f;

    requestAnimationFrame(frame);
  }

  function dispatch() {
    const S = G.sound, sim = G.sim;
    for (const e of sim.events) {
      G.renderer.onEvent(e, sim);
      G.guide.onEvent(e);
      switch (e.type) {
        case 'grip': S.grip(e.hold); break;
        case 'release': S.release(); break;
        case 'miss': S.miss(); break;
        case 'slip': S.slip(); break;
        case 'catch': S.catch_(); break;
        case 'crumble': S.crumble(); break;
        case 'shyFlee': S.shyFlee(); break;
        case 'tame': S.tame(); break;
        case 'painted': S.tear(); break;
        case 'thud': S.thud(e.v, e.net); break;
        case 'swap': S.chime(); break;
        case 'mirror': case 'stamLie': case 'altLie': if (sim.zone >= 4) S.glitch(); break;
        case 'dyno': S.dyno(); break;
        case 'fakeFall': S.fakeWhoosh(); break;
        case 'credits': S.credits = true; S.swell(); break;
        case 'collapse': S.credits = false; S.rumble(); S.cutMusic(); break;
        case 'summit': save(); break;
      }
    }
    sim.events.length = 0;
  }

  /* ---- boot ------------------------------------------------------------- */
  const hadSave = loadGame();
  refreshTitle(hadSave);
  if (params.has('at')) {
    const at = parseFloat(params.get('at'));
    if (at > 0) G.sim.teleport(at);
  }
  if (params.has('play')) play();
  else show('title');
  requestAnimationFrame(frame);
})(globalThis.LL = globalThis.LL || {});
