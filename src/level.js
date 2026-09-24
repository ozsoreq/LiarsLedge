/* Liar's Ledge — the wall.
 * A deterministic generator builds one continuous 600 m wall: a guaranteed
 * route of real holds, rest ledges, and (from Zone 2 up) the lies around it.
 * Levels serialise to plain JSON so the in-browser editor can export/import. */
(function (LL) {
  'use strict';

  const U = LL.U;

  // Per-zone generator parameters.
  const ZP = {
    1: { dy: [0.42, 0.62], drift: 0.55, maxStep: 0.82, r: [0.17, 0.21], grip: [1.25, 1.55], ledge: [7, 11], ledgeW: [2.6, 4.2], junk: 0.45 },
    2: { dy: [0.48, 0.68], drift: 0.65, maxStep: 0.86, r: [0.14, 0.19], grip: [1.0, 1.3], ledge: [10, 15], ledgeW: [2.2, 3.6], junk: 0.4, fake: 0.13, shy: 0.08 },
    3: { dy: [0.5, 0.7], drift: 0.75, maxStep: 0.88, r: [0.13, 0.17], grip: [0.9, 1.2], ledge: [12, 17], ledgeW: [1.9, 3.2], junk: 0.35, fake: 0.1, shy: 0.07, net: 0.3, panel: [16, 24] },
    4: { dy: [0.52, 0.72], drift: 0.8, maxStep: 0.9, r: [0.12, 0.16], grip: [0.8, 1.1], ledge: [13, 19], ledgeW: [1.7, 2.9], junk: 0.35, fake: 0.1, shy: 0.08, panel: [34, 48] },
    5: { dy: [0.55, 0.74], drift: 0.8, maxStep: 0.92, r: [0.11, 0.15], grip: [0.72, 1.0], ledge: [14, 20], ledgeW: [1.5, 2.6], junk: 0.3, fake: 0.12, shy: 0.1, panel: [28, 40] }
  };

  const REACH = 0.97;   // generous margin under ARM_MAX (1.1)

  // UI-lie bands (Zone 4 introduces them, Zone 5 mixes them).
  const BANDS = [
    { type: 'swap', y1: 336, y2: 347 },
    { type: 'stamLie', y1: 351, y2: 372 },
    { type: 'mirror', y1: 360, y2: 371 },
    { type: 'swap', y1: 385, y2: 397 },
    { type: 'altLie', y1: 392, y2: 428, offset: 100 },
    { type: 'mirror', y1: 412, y2: 424 },
    { type: 'stamLie', y1: 432, y2: 452 },
    { type: 'swap', y1: 455, y2: 467 },
    { type: 'mirror', y1: 470, y2: 478 },
    { type: 'swap', y1: 504, y2: 514 },
    { type: 'mirror', y1: 519, y2: 527 },
    { type: 'stamLie', y1: 538, y2: 556 },
    { type: 'altLie', y1: 575, y2: 596, offset: -42 },
    { type: 'swap', y1: 586, y2: 592 }
  ];

  class Level {
    constructor() {
      this.holds = [];
      this.ledges = [];
      this.panels = [];
      this.bands = [];
      this.veilY = Infinity;   // holds above this are hidden until the fake summit collapses
      this.custom = false;
    }

    finalize() {
      this.holds.sort((a, b) => a.y0 - b.y0);
      this.holds.forEach((h, i) => (h.id = i));
      this.ledges.sort((a, b) => a.y - b.y);
      this.ledges.forEach((l, i) => (l.id = i));
      this._ys = this.holds.map((h) => h.y0);
      return this;
    }

    _lower(y) {
      const a = this._ys;
      let lo = 0, hi = a.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < y) lo = m + 1; else hi = m; }
      return lo;
    }

    // Holds whose base position lies in [y1, y2] (shy holds wander < 1.5 m).
    holdsIn(y1, y2, out) {
      out = out || [];
      out.length = 0;
      for (let i = this._lower(y1 - 1.5); i < this.holds.length && this._ys[i] <= y2 + 1.5; i++) out.push(this.holds[i]);
      return out;
    }

    ledgesIn(y1, y2, solidOnly, out) {
      out = out || [];
      out.length = 0;
      for (const l of this.ledges) {
        if (l.y < y1) continue;
        if (l.y > y2) break;
        if (solidOnly && (l.type === 'painted' || l.broken)) continue;
        out.push(l);
      }
      return out;
    }

    isHidden(h, fakeSummitDone) {
      return !fakeSummitDone && h.y0 > this.veilY;
    }

    bandsAt(y) {
      const f = { swap: false, mirror: false, stamLie: false, altLie: 0 };
      for (const b of this.bands) {
        if (y < b.y1 || y > b.y2) continue;
        if (b.type === 'altLie') f.altLie = b.offset;
        else f[b.type] = true;
      }
      return f;
    }

    panelAt(x, y) {
      for (const p of this.panels) if (x >= p.x1 && x <= p.x2 && y >= p.y1 && y <= p.y2) return p;
      return null;
    }

    toJSON() {
      return {
        format: 'liars-ledge-level', version: 1,
        veilY: this.veilY === Infinity ? null : this.veilY,
        holds: this.holds.map((h) => {
          const o = { x: +h.x0.toFixed(3), y: +h.y0.toFixed(3), r: +h.r.toFixed(3), grip: +h.grip.toFixed(2), type: h.type };
          if (h.route) o.route = true;
          if (h.tag) o.tag = h.tag;
          return o;
        }),
        ledges: this.ledges.map((l) => ({ x1: +l.x1.toFixed(2), x2: +l.x2.toFixed(2), y: +l.y.toFixed(3), type: l.type })),
        panels: this.panels.map((p) => ({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 })),
        bands: this.bands.map((b) => Object.assign({}, b))
      };
    }

    static fromJSON(j) {
      if (!j || j.format !== 'liars-ledge-level') throw new Error('Not a Liar\'s Ledge level file');
      const L = new Level();
      L.custom = true;
      L.veilY = j.veilY == null ? Infinity : j.veilY;
      let seed = 1;
      for (const h of j.holds) L.holds.push(makeHold(h.x, h.y, h, (seed = (seed * 16807) % 2147483647) / 2147483647));
      for (const l of j.ledges) L.ledges.push({ x1: l.x1, x2: l.x2, y: l.y, type: l.type || 'ledge', broken: false });
      for (const p of j.panels || []) L.panels.push({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, tears: [] });
      for (const b of j.bands || []) L.bands.push(Object.assign({}, b));
      return L.finalize();
    }
  }

  function makeHold(x, y, o, seed) {
    return {
      id: -1, x: x, y: y, x0: x, y0: y,
      r: o.r || 0.15, grip: o.grip || 1, type: o.type || 'normal',
      route: !!o.route, tag: o.tag || null, seed: seed,
      gone: false, respawnT: 0, crumbleT: -1, tamed: false,
      wob: 0, fleeT: -1, fled: 0, fleeDir: 1, calmT: 0
    };
  }

  /* ---------------------------------------------------------------- */

  function generate(seed) {
    const C = LL.C;
    const R = U.rng(seed == null ? C.SEED : seed);
    const L = new Level();
    const WX = C.WALL_HALF - 0.55;
    const H = L.holds;

    const add = (x, y, o) => {
      const h = makeHold(x, y, o || {}, R());
      H.push(h);
      return h;
    };
    const inPanel = (x, y, pad) => {
      pad = pad || 0;
      for (const p of L.panels) if (x >= p.x1 - pad && x <= p.x2 + pad && y >= p.y1 - pad && y <= p.y2 + pad) return p;
      return null;
    };
    const free = (x, y, d) => {
      if (Math.abs(x) > WX) return false;
      for (let i = H.length - 1, n = 0; i >= 0 && n < 80; i--, n++) {
        if (U.dist(H[i].x0, H[i].y0, x, y) < d) return false;
      }
      return !inPanel(x, y, 0.2);
    };
    const removeNear = (x, y, d, keep) => {
      for (let i = H.length - 1; i >= 0; i--) {
        const h = H[i];
        if (h === keep || h.route) continue;
        if (U.dist(h.x0, h.y0, x, y) < d) H.splice(i, 1);
      }
    };
    const clearLine = (x1, x2, ly) => {
      for (let i = H.length - 1; i >= 0; i--) {
        const h = H[i];
        if (!h.route && h.x0 > x1 - 0.2 && h.x0 < x2 + 0.2 && Math.abs(h.y0 - ly) < 0.25) H.splice(i, 1);
      }
    };
    const addLedge = (cx, ly, w, type, full) => {
      let x1 = full ? -C.WALL_HALF : U.clamp(cx - w / 2, -C.WALL_HALF + 0.1, C.WALL_HALF - 0.1 - w);
      let x2 = full ? C.WALL_HALF : x1 + w;
      if (!full) {
        // never slice through a painted panel
        for (const p of L.panels) {
          if (ly < p.y1 - 0.3 || ly > p.y2 + 0.3) continue;
          if (cx < p.x1) x2 = Math.min(x2, p.x1 - 0.15); else x1 = Math.max(x1, p.x2 + 0.15);
        }
      }
      const l = { x1: x1, x2: x2, y: ly, type: type || 'ledge', broken: false };
      L.ledges.push(l);
      clearLine(x1, x2, ly);
      return l;
    };
    const holdStyle = (zp) => ({ r: R.range(zp.r[0], zp.r[1]), grip: R.range(zp.grip[0], zp.grip[1]) });

    L.ledges.push({ x1: -60, x2: 60, y: 0, type: 'ground', broken: false });

    // Starting holds: the climber begins hanging from these, feet on the ground.
    add(-0.33, 1.95, { r: 0.21, grip: 1.6, route: true, tag: 'startL' });
    add(0.33, 1.95, { r: 0.21, grip: 1.6, route: true, tag: 'startR' });
    // Boulders at the foot of the wall, so a climber lying on the ground can always start again.
    for (let bx = -WX + 0.3; bx < WX; bx += R.range(0.7, 1.0)) {
      if (Math.abs(bx) < 0.6) continue;
      add(bx, R.range(0.95, 1.3), { r: R.range(0.18, 0.22), grip: 1.5 });
    }

    // Hand-authored set pieces, keyed by approximate ledge height.
    const pieces = [
      { y: 44, w: 3.2, fn: pieceDyno, tag: 'dyno1' },
      { y: 81.5, w: 4.2, fn: pieceGalleryGate },
      { y: 94, w: 3.4, fn: pieceShyIntro },
      { y: 204.5, w: 2.8, fn: pieceStageIntro },
      { y: 211.5, w: 3.0, fn: null },
      { y: 334, w: 3.4, fn: null },
      { y: 358, w: 3.0, fn: null },
      { y: 390.5, w: 3.0, fn: null },
      { y: 491, w: 2.6, fn: pieceDyno, tag: 'dyno2' },
      { y: 515.5, w: 2.4, fn: pieceDyno, tag: 'dyno3' },
      { y: C.CATCH_LEDGE, full: true, fn: null },
      { y: C.FAKE_SUMMIT, full: true, type: 'fakeSummit', fn: pieceFakeSummit },
      { y: 582.5, w: 2.6, fn: pieceTellLie }
    ];
    let pi = 0;

    let x = 0, y = 1.95, side = 1;
    let prev = { x0: 0.33, y0: 1.95 };
    let nextLedge = R.range(7, 10);
    let nextPanel = 216 + R.range(0, 6);
    let panel = null;         // active panel the route must avoid
    let noDecoy = 0;
    const ctx = { L, R, add, removeNear, free, addLedge, holdStyle, C };

    while (y < C.TOP - 0.25) {
      const Z = LL.zoneAt(y), zp = ZP[Z.id];

      // Start a painted panel beside the route.
      if (zp.panel && y >= nextPanel && !(y > C.CATCH_LEDGE - 6 && y < C.FAKE_SUMMIT + 3)) {
        panel = makePanel(ctx, x, y, zp);
        nextPanel = y + R.range(zp.panel[0], zp.panel[1]);
      }
      if (panel && y > panel.y2 + 0.5) panel = null;

      // Next route hold.
      const dy = R.range(zp.dy[0], zp.dy[1]);
      let nx = U.clamp(x + R.range(-zp.drift, zp.drift), -WX + 0.6, WX - 0.6);
      if (Math.abs(nx) > WX - 1.5) nx -= Math.sign(nx) * R.range(0, 0.5); // drift back toward the middle
      if (panel) {
        if (panel.side > 0) nx = Math.min(nx, panel.x1 - 0.75);
        else nx = Math.max(nx, panel.x2 + 0.75);
      }
      side = -side;
      let hx = nx + side * 0.28, hy = y + dy;
      // Guarantee reachability: the hand on `side` takes this hold while the other
      // hand is locked off on the previous one, so measure from that shoulder.
      const sx = prev.x0 + side * 0.4, sy = prev.y0 - C.ARM_MIN;
      hx = U.clamp(hx, sx - 0.45, sx + 0.45);
      const maxUp = Math.sqrt(REACH * REACH - (hx - sx) * (hx - sx));
      hy = Math.min(hy, sy + maxUp);
      let d = U.dist(prev.x0, prev.y0, hx, hy);
      if (d > zp.maxStep) {
        const k = zp.maxStep / d;
        hx = prev.x0 + (hx - prev.x0) * k;
        hy = prev.y0 + (hy - prev.y0) * k;
      }
      nx = hx - side * 0.28;
      const st = holdStyle(zp);
      const route = add(hx, hy, { r: st.r, grip: st.grip, route: true });
      x = nx; y = hy; prev = route;

      // Ledges: forced set pieces first, then the regular rest spots.
      const piece = pieces[pi];
      const noLedgeZone = y - 0.82 > C.CATCH_LEDGE - 0.5 && y - 0.82 < C.FAKE_SUMMIT + 0.5;
      if (piece && y - 0.82 >= piece.y) {
        pi++;
        const ly = piece.full ? piece.y : y - 0.82;
        const ledge = addLedge(route.x0, ly, piece.w || 3, piece.type, piece.full);
        ctx.x = x; ctx.y = y; ctx.side = side; ctx.hold = route; ctx.ledge = ledge; ctx.tag = piece.tag; ctx.prev = route;
        if (piece.full) {
          // bring the route hold to sit just above a full-width ledge
          route.y = route.y0 = ly + 0.82;
          route.x = route.x0;
          ctx.y = y = route.y0;
        }
        if (piece.fn) piece.fn(ctx);
        if (ctx.panel) { panel = ctx.panel; ctx.panel = null; }
        x = ctx.x; y = ctx.y; side = ctx.side; prev = ctx.prev;
        noDecoy = ctx.noDecoy || 1; ctx.noDecoy = 0;
        nextLedge = y + R.range(zp.ledge[0], zp.ledge[1]);
        continue;
      } else if (y - 0.82 >= nextLedge && !noLedgeZone) {
        const w = R.range(zp.ledgeW[0], zp.ledgeW[1]);
        const isNet = zp.net && R.chance(zp.net);
        addLedge(route.x0 + R.range(-0.4, 0.4), y - 0.82, isNet ? w + 1.6 : w, isNet ? 'net' : 'ledge');
        nextLedge = y + R.range(zp.ledge[0], zp.ledge[1]);
      }

      if (noDecoy > 0) { noDecoy--; continue; }

      // Extra real holds: texture and alternative lines.
      if (R.chance(zp.junk)) {
        const jx = x + R.range(-2.3, 2.3), jy = y + R.range(-0.3, 0.3);
        if (free(jx, jy, 0.55)) {
          const js = holdStyle(zp);
          add(jx, jy, { r: js.r * 0.9, grip: js.grip * 0.9 });
        }
      }

      // The lies: decoys placed where they look *more* attractive than the route.
      if (zp.fake || zp.shy) {
        const roll = R();
        let type = null;
        if (roll < zp.fake) type = 'fake';
        else if (roll < zp.fake + zp.shy) type = 'shy';
        if (type) {
          const dx = R.sign() * R.range(0.35, 0.7), ddy = R.range(0.12, 0.38);
          const tx = route.x0 + dx, ty = route.y0 + ddy;
          if (free(tx, ty, 0.4)) {
            const s = holdStyle(zp);
            add(tx, ty, { type: type, r: Math.min(0.21, s.r * 1.2), grip: s.grip });
            // Mid-game combo: a shy hold sitting right beside a fake one.
            if (Z.id >= 3 && R.chance(0.25)) {
              const cx = tx + Math.sign(dx) * 0.5, cy = ty + R.range(-0.1, 0.2);
              if (free(cx, cy, 0.38)) add(cx, cy, { type: type === 'fake' ? 'shy' : 'fake', r: s.r * 1.15, grip: s.grip });
            }
          }
        }
      }
    }

    // The real summit: a plateau and a row of top-out holds.
    const summit = addLedge(0, C.TOP, 0, 'summit', true);
    summit.x1 = -C.WALL_HALF - 1; summit.x2 = C.WALL_HALF + 1;
    for (let r = 0; r < 3; r++) {
      const ry = C.TOP + 0.45 + r * 0.55;
      for (let rx = -WX + 0.3 + (r % 2) * 0.35; rx < WX; rx += 0.75) add(rx, ry, { r: 0.17, grip: 1.3, tag: 'summitRail' });
    }

    L.bands = BANDS.map((b) => Object.assign({}, b));
    return L.finalize();
  }

  function makePanel(ctx, x, y, zp) {
    const { L, R, add, C } = ctx;
    let s = x > 1 ? -1 : x < -1 ? 1 : R.sign();
    let near = x + s * 1.0, far = x + s * R.range(2.8, 3.6);
    const lim = C.WALL_HALF - 0.15;
    far = U.clamp(far, -lim, lim);
    if (Math.abs(far - near) < 1.6) {
      s = -s; near = x + s * 1.0; far = U.clamp(x + s * 3.2, -lim, lim);
      if (Math.abs(far - near) < 1.6) return null;
    }
    const h = R.range(3.6, 5);
    const p = { x1: Math.min(near, far), x2: Math.max(near, far), y1: y + 0.2, y2: y + 0.2 + h, tears: [], side: s };
    L.panels.push(p);
    clearPanel(L, p);
    // Painted holds: a generous, obvious ladder. Every one of them is a picture.
    const n = Math.floor(h / 0.55);
    for (let i = 0; i < n; i++) {
      const hx = U.lerp(p.x1 + 0.35, p.x2 - 0.35, (i % 2 ? 0.3 : 0.7) + R.range(-0.15, 0.15));
      add(hx, p.y1 + 0.35 + i * 0.55, { type: 'painted', r: R.range(0.17, 0.21), grip: 1.4 });
    }
    if (R.chance(0.6)) {
      const py = p.y1 + h * R.range(0.35, 0.6);
      L.ledges.push({ x1: p.x1 + 0.2, x2: p.x2 - 0.2, y: py, type: 'painted', broken: false });
    }
    return p;
  }

  function clearPanel(L, p) {
    const H = L.holds;
    for (let i = H.length - 1; i >= 0; i--) {
      const h = H[i];
      if (h.route || h.type === 'painted') continue;
      if (h.x0 > p.x1 - 0.25 && h.x0 < p.x2 + 0.25 && h.y0 > p.y1 - 0.25 && h.y0 < p.y2 + 0.25) H.splice(i, 1);
    }
  }

  /* ---- set pieces ------------------------------------------------ */

  // Zone 1/5: a gap you can only close with a dyno, over a ledge.
  function pieceDyno(ctx) {
    const { add, removeNear, hold } = ctx;
    hold.tag = 'dynoStart';
    const tx = hold.x0 + ctx.side * -0.2, ty = hold.y0 + 1.32;
    removeNear((hold.x0 + tx) / 2, (hold.y0 + ty) / 2, 1.0);
    const t = add(tx, ty, { r: 0.2, grip: 1.4, route: true, tag: ctx.tag || 'dyno' });
    ctx.prev = t; ctx.x = tx; ctx.y = ty; ctx.noDecoy = 2;
  }

  // "The first hold that crumbles, placed 1 m above a safe ledge."
  function pieceGalleryGate(ctx) {
    const { add, hold, ledge } = ctx;
    const cx = (ledge.x1 + ledge.x2) / 2;
    hold.x = hold.x0 = cx - 0.62;
    hold.y = hold.y0 = ledge.y + 0.78;
    add(cx + 0.12, ledge.y + 1.02, { type: 'fake', r: 0.22, grip: 1.3, tag: 'firstFake' });
    ctx.x = hold.x0; ctx.y = hold.y0; ctx.prev = hold; ctx.noDecoy = 3;
  }

  function pieceShyIntro(ctx) {
    const { add, hold, ledge } = ctx;
    const cx = (ledge.x1 + ledge.x2) / 2;
    const s = hold.x0 > cx ? -1 : 1;
    add(hold.x0 + s * 0.75, ledge.y + 1.0, { type: 'shy', r: 0.22, grip: 1.3, tag: 'firstShy' });
    ctx.noDecoy = 2;
  }

  // A backdrop right next to a rest ledge: swing into it, see scaffolding.
  function pieceStageIntro(ctx) {
    const { L, add, hold, ledge, C } = ctx;
    const cx = (ledge.x1 + ledge.x2) / 2;
    const s = hold.x0 > cx ? -1 : 1;
    const x1 = s > 0 ? ledge.x2 + 0.05 : Math.max(-C.WALL_HALF + 0.1, ledge.x1 - 2.8);
    const x2 = s > 0 ? Math.min(C.WALL_HALF - 0.1, ledge.x2 + 2.85) : ledge.x1 - 0.05;
    const p = { x1: x1, x2: x2, y1: ledge.y - 0.6, y2: ledge.y + 3.8, tears: [], side: s, tag: 'firstPanel' };
    L.panels.push(p);
    clearPanel(L, p);
    ctx.panel = p;
    for (let i = 0; i < 7; i++) {
      add(U.lerp(x1 + 0.4, x2 - 0.4, i % 2 ? 0.25 : 0.7), ledge.y + 0.55 + i * 0.5, { type: 'painted', r: 0.2, grip: 1.5, tag: i === 0 ? 'firstPainted' : null });
    }
    ctx.noDecoy = 5;
  }

  function pieceFakeSummit(ctx) {
    const { L, add, hold, ledge, C } = ctx;
    ledge.type = 'fakeSummit';
    const WX = C.WALL_HALF - 0.55;
    for (let r = 0; r < 2; r++) {
      const ry = ledge.y + 0.5 + r * 0.72;
      for (let rx = -WX + 0.4 + r * 0.35; rx < WX; rx += 0.8) {
        if (Math.abs(rx - hold.x0) < 0.45 && Math.abs(ry - hold.y0) < 0.45) continue;
        add(rx, ry, { r: 0.17, grip: 1.3, tag: 'fsRail' });
      }
    }
    L.veilY = ledge.y + 1.6;
    ctx.noDecoy = 3;
  }

  // Late game: a hold that shows the fake-hold tell but is the only way up.
  function pieceTellLie(ctx) {
    const { hold, removeNear } = ctx;
    hold.type = 'tellLie';
    hold.tag = 'tellLie';
    hold.r = 0.17; hold.grip = 1.1;
    removeNear(hold.x0, hold.y0, 1.6, hold);
    ctx.prev = hold; ctx.noDecoy = 3;
  }

  Level.generate = generate;
  Level.makeHold = makeHold;
  LL.Level = Level;
})(globalThis.LL = globalThis.LL || {});
