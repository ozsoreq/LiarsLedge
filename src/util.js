/* Liar's Ledge — small math / random helpers shared by every module.
 * All game code lives on the global `LL` namespace so the game runs from
 * file:// without a bundler, and the simulation can be loaded in Node for tests. */
(function (LL) {
  'use strict';

  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.len = (x, y) => Math.hypot(x, y);
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.smooth = (t) => {
    t = U.clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Frame-rate independent exponential approach.
  U.damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);

  // mulberry32 — tiny deterministic PRNG so the wall is the same for everyone.
  U.rng = function (seed) {
    let s = seed >>> 0;
    const f = function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    f.sign = () => (f() < 0.5 ? -1 : 1);
    return f;
  };

  // Stateless hash noise in [0,1) for procedural visuals (wall facets, stars…).
  U.hash2 = function (i, j) {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  // Mix two #rrggbb colours.
  U.mix = function (c1, c2, t) {
    const a = U.hex(c1), b = U.hex(c2);
    const r = Math.round(U.lerp(a[0], b[0], t));
    const g = Math.round(U.lerp(a[1], b[1], t));
    const bl = Math.round(U.lerp(a[2], b[2], t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  };
  const hexCache = {};
  U.hex = function (c) {
    if (hexCache[c]) return hexCache[c];
    const n = parseInt(c.slice(1), 16);
    return (hexCache[c] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  };
  U.rgba = function (c, a) {
    const h = U.hex(c);
    return 'rgba(' + h[0] + ',' + h[1] + ',' + h[2] + ',' + a + ')';
  };

  U.fmtTime = function (s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + 'm ' + String(sec).padStart(2, '0') + 's';
  };

  LL.U = U;
})(globalThis.LL = globalThis.LL || {});
