/* Liar's Ledge — a small in-browser level editor (F2).
 * Place / delete holds, ledges, nets and painted panels; export and import
 * the wall as JSON. Edits are kept in localStorage and loaded on start. */
(function (LL) {
  'use strict';

  const U = LL.U;

  const TOOLS = [
    { id: 'normal', label: 'Hold' },
    { id: 'fake', label: 'Fake hold' },
    { id: 'shy', label: 'Shy hold' },
    { id: 'painted', label: 'Painted hold' },
    { id: 'tellLie', label: 'Tell-lie hold' },
    { id: 'ledge', label: 'Ledge' },
    { id: 'net', label: 'Net' },
    { id: 'panel', label: 'Painted panel' },
    { id: 'delete', label: 'Delete' }
  ];

  const E = {
    G: null, tool: 'normal', radius: 0.16, grip: 1.1,
    m: { x: 0, y: 0, sx: 0, sy: 0 }, drag: null, pan: null, keys: {}, saveT: null
  };

  E.open = function (G) {
    E.G = G;
    const ui = document.getElementById('editor-ui');
    ui.classList.remove('hidden');
    document.getElementById('game').classList.add('editing');
    G.renderer.debug = true;
    E.render();
  };

  E.close = function (playFrom) {
    const G = E.G;
    document.getElementById('editor-ui').classList.add('hidden');
    document.getElementById('game').classList.remove('editing');
    G.renderer.debug = new URLSearchParams(location.search).has('debug');
    G.onEditorClose(playFrom);
  };

  E.render = function () {
    const ui = document.getElementById('editor-ui');
    const L = E.G.level;
    ui.innerHTML = '';
    const h = document.createElement('div');
    h.innerHTML = '<h3>Level editor</h3><div>' + L.holds.length + ' holds · ' + L.ledges.length + ' ledges · ' +
      L.panels.length + ' panels' + (L.custom ? ' · <b style="color:var(--accent)">custom</b>' : '') + '</div>';
    ui.appendChild(h);
    const tools = document.createElement('div');
    tools.className = 'tools';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.textContent = t.label;
      if (t.id === E.tool) b.className = 'on';
      b.onclick = () => { E.tool = t.id; E.render(); };
      tools.appendChild(b);
    }
    ui.appendChild(tools);
    const size = document.createElement('label');
    size.innerHTML = 'Hold size <span id="ed-r">' + E.radius.toFixed(2) + ' m</span>';
    const range = document.createElement('input');
    range.type = 'range'; range.min = 0.09; range.max = 0.24; range.step = 0.01; range.value = E.radius;
    range.oninput = () => { E.radius = +range.value; document.getElementById('ed-r').textContent = E.radius.toFixed(2) + ' m'; };
    size.appendChild(range);
    ui.appendChild(size);

    const row = document.createElement('div');
    row.className = 'row';
    const btn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; if (cls) b.className = cls; row.appendChild(b); };
    btn('Play from here', () => E.close(Math.max(0.5, E.G.renderer.cam.y - 2.3)));
    btn('Export JSON', E.exportJSON);
    btn('Import JSON', E.importJSON);
    btn('Reset to generated wall', E.reset);
    btn('Close', () => E.close());
    ui.appendChild(row);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = 'Click to place · drag for ledges, nets, panels<br>Right-drag or W/S to pan · wheel to scroll<br>PageUp/PageDown ±50 m · F2 to close<br>Outlines show the truth: <span style="color:#ff4d4d">fake</span> <span style="color:#ffd84d">shy</span> <span style="color:#c77dff">painted</span> <span style="color:#4dff88">tell-lie</span>';
    ui.appendChild(hint);
  };

  E.changed = function () {
    const G = E.G;
    G.level.custom = true;
    G.level.finalize();
    clearTimeout(E.saveT);
    E.saveT = setTimeout(() => { G.store.set(G.KEY_LEVEL, G.level.toJSON()); G.save(); }, 300);
    E.render();
  };

  E.mouse = function (e, kind) {
    const R = E.G.renderer;
    const w = R.toWorld(e.clientX, e.clientY);
    E.m.x = w.x; E.m.y = w.y; E.m.sx = e.clientX; E.m.sy = e.clientY;
    if (e.target && e.target.closest && e.target.closest('#editor-ui') && kind !== 'move' && kind !== 'up') return;
    if (kind === 'down') {
      if (e.button === 2 || e.button === 1) { E.pan = { sx: e.clientX, sy: e.clientY, cx: R.cam.x, cy: R.cam.y }; return; }
      if (e.button !== 0) return;
      if (['ledge', 'net', 'panel'].includes(E.tool)) { E.drag = { x: w.x, y: w.y }; return; }
      if (E.tool === 'delete') return E.remove(w.x, w.y);
      const L = E.G.level;
      if (Math.abs(w.x) > LL.C.WALL_HALF - 0.1) return;
      const h = LL.Level.makeHold(w.x, w.y, { type: E.tool, r: E.radius, grip: U.clamp(E.radius * 8, 0.7, 1.6) }, Math.random());
      L.holds.push(h);
      E.changed();
    } else if (kind === 'move') {
      if (E.pan) {
        const s = R.scale;
        R.cam.x = E.pan.cx - (e.clientX - E.pan.sx) / s;
        R.cam.y = E.pan.cy + (e.clientY - E.pan.sy) / s;
      }
    } else if (kind === 'up') {
      if (E.pan) { E.pan = null; return; }
      if (E.drag) {
        const d = E.drag; E.drag = null;
        const L = E.G.level;
        if (E.tool === 'panel') {
          const p = { x1: Math.min(d.x, w.x), x2: Math.max(d.x, w.x), y1: Math.min(d.y, w.y), y2: Math.max(d.y, w.y), tears: [] };
          if (p.x2 - p.x1 > 0.4 && p.y2 - p.y1 > 0.4) L.panels.push(p);
        } else {
          const x1 = Math.min(d.x, w.x), x2 = Math.max(d.x, w.x);
          if (x2 - x1 > 0.3) L.ledges.push({ x1: x1, x2: x2, y: d.y, type: E.tool === 'net' ? 'net' : 'ledge', broken: false });
        }
        E.changed();
      }
    }
  };

  E.remove = function (x, y) {
    const L = E.G.level;
    let best = -1, bd = 0.45;
    L.holds.forEach((h, i) => { const d = U.dist(h.x, h.y, x, y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) {
      const h = L.holds[best];
      for (let k = 0; k < 2; k++) if (E.G.sim.hands[k].hold === h) E.G.sim._release(k, false);
      L.holds.splice(best, 1);
      return E.changed();
    }
    const li = L.ledges.findIndex((l) => l.type !== 'ground' && x >= l.x1 && x <= l.x2 && Math.abs(l.y - y) < 0.35);
    if (li >= 0) { L.ledges.splice(li, 1); return E.changed(); }
    const pi = L.panels.findIndex((p) => x >= p.x1 && x <= p.x2 && y >= p.y1 && y <= p.y2);
    if (pi >= 0) { L.panels.splice(pi, 1); return E.changed(); }
  };

  E.wheel = function (e) {
    const R = E.G.renderer;
    R.cam.y -= (e.deltaY / (e.deltaMode === 1 ? 3 : 100)) * 1.5;
  };

  E.key = function (e, down) {
    E.keys[e.key.toLowerCase()] = down;
    if (!down) return;
    const R = E.G.renderer;
    if (e.key === 'PageUp') R.cam.y += 50;
    if (e.key === 'PageDown') R.cam.y = Math.max(0, R.cam.y - 50);
    if (e.key === 'Escape') E.close();
  };

  E.exportJSON = function () {
    const json = JSON.stringify(E.G.level.toJSON(), null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'liars-ledge-wall.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  E.importJSON = function () {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      f.text().then((t) => {
        try {
          const L = LL.Level.fromJSON(JSON.parse(t));
          E.swapLevel(L);
          E.changed();
        } catch (err) { alert('Could not load that file: ' + err.message); }
      });
    };
    inp.click();
  };

  E.reset = function () {
    if (!confirm('Discard your edits and restore the generated wall?')) return;
    E.G.store.del(E.G.KEY_LEVEL);
    E.swapLevel(LL.Level.generate(LL.C.SEED));
    E.render();
  };

  E.swapLevel = function (L) {
    const G = E.G;
    const h = G.sim.height();
    G.level = L;
    G.sim = new LL.Sim(L);
    const said = G.guide.serialize();
    G.guide = new LL.Guide(G.sim);
    G.guide.restore(said);
    G.sim.teleport(Math.max(0.5, h));
  };

  E.draw = function () {
    const G = E.G, R = G.renderer, ctx = R.ctx;
    const dt = 1 / 60;
    let v = 0;
    if (E.keys.w || E.keys.arrowup) v += 1;
    if (E.keys.s || E.keys.arrowdown) v -= 1;
    R.cam.y = Math.max(-2, R.cam.y + v * 14 * dt);
    R.cam.view = 12;
    R.cam.shakeX = R.cam.shakeY = 0;
    R.draw(G.sim, null, { hideCursor: true });
    R.worldT();
    // metre grid
    const y0 = Math.floor(R.cam.y - 8), y1 = Math.ceil(R.cam.y + 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.01;
    for (let y = y0; y <= y1; y++) { ctx.beginPath(); ctx.moveTo(-LL.C.WALL_HALF, y); ctx.lineTo(LL.C.WALL_HALF, y); ctx.stroke(); }
    // placement preview
    const m = E.m;
    if (E.drag) {
      ctx.strokeStyle = '#f3c56b'; ctx.lineWidth = 0.04;
      if (E.tool === 'panel') ctx.strokeRect(E.drag.x, E.drag.y, m.x - E.drag.x, m.y - E.drag.y);
      else { ctx.beginPath(); ctx.moveTo(E.drag.x, E.drag.y); ctx.lineTo(m.x, E.drag.y); ctx.stroke(); }
    } else if (E.tool !== 'delete' && !['ledge', 'net', 'panel'].includes(E.tool)) {
      ctx.strokeStyle = 'rgba(243,197,107,0.8)'; ctx.lineWidth = 0.025;
      ctx.beginPath(); ctx.arc(m.x, m.y, E.radius, 0, Math.PI * 2); ctx.stroke();
    } else if (E.tool === 'delete') {
      ctx.strokeStyle = 'rgba(255,90,90,0.8)'; ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.moveTo(m.x - 0.15, m.y - 0.15); ctx.lineTo(m.x + 0.15, m.y + 0.15); ctx.moveTo(m.x - 0.15, m.y + 0.15); ctx.lineTo(m.x + 0.15, m.y - 0.15); ctx.stroke();
    }
    R.screenT();
    ctx.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'right';
    ctx.fillText('y ' + m.y.toFixed(2) + ' m   x ' + m.x.toFixed(2), R.W - 20, R.H - 20);
  };

  LL.Editor = E;
})(globalThis.LL = globalThis.LL || {});
