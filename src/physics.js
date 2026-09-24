/* Liar's Ledge — Verlet ragdoll.
 * Pillar 2: the body and gravity never cheat. Everything deceptive lives
 * elsewhere; this file only knows points, sticks, ropes and ledges. */
(function (LL) {
  'use strict';

  const U = LL.U;

  const NAMES = ['head', 'neck', 'lSh', 'rSh', 'pelvis', 'lHip', 'rHip',
    'lHand', 'rHand', 'lKnee', 'rKnee', 'lFoot', 'rFoot'];
  const P = {};
  NAMES.forEach((n, i) => (P[n] = i));

  // Rest pose relative to the pelvis.
  const REST = {
    head: [0, 0.8], neck: [0, 0.6], lSh: [-0.2, 0.54], rSh: [0.2, 0.54],
    pelvis: [0, 0], lHip: [-0.12, -0.04], rHip: [0.12, -0.04],
    lHand: [-0.32, 1.3], rHand: [0.32, 1.3],
    lKnee: [-0.14, -0.48], rKnee: [0.14, -0.48],
    lFoot: [-0.15, -0.93], rFoot: [0.15, -0.93]
  };
  const MASS = {
    head: 5, neck: 6, lSh: 8, rSh: 8, pelvis: 14, lHip: 6, rHip: 6,
    lHand: 1.2, rHand: 1.2, lKnee: 5, rKnee: 5, lFoot: 3, rFoot: 3
  };
  const TORSO = ['head', 'neck', 'lSh', 'rSh', 'pelvis', 'lHip', 'rHip'];
  // Points whose contact with a ledge counts as "resting".
  const SUPPORT = [P.pelvis, P.lHip, P.rHip, P.lFoot, P.rFoot, P.lKnee, P.rKnee];

  class Ragdoll {
    constructor(px, py) {
      const n = NAMES.length;
      this.n = n;
      this.x = new Float64Array(n);
      this.y = new Float64Array(n);
      this.ox = new Float64Array(n);
      this.oy = new Float64Array(n);
      this.sy = new Float64Array(n);   // y at step start (for one-way ledges)
      this.vin = new Float64Array(n);  // vertical velocity before collision
      this.im = new Float64Array(n);
      this.baseIm = new Float64Array(n);
      this.contact = new Int32Array(n).fill(-1);
      this.torso = TORSO.map((k) => P[k]);
      for (let i = 0; i < n; i++) {
        const r = REST[NAMES[i]];
        this.x[i] = this.ox[i] = px + r[0];
        this.y[i] = this.oy[i] = py + r[1];
        this.im[i] = this.baseIm[i] = 1 / MASS[NAMES[i]];
      }
      this.sticks = [];
      const link = (a, b) => {
        const ra = REST[a], rb = REST[b];
        this.sticks.push([P[a], P[b], Math.hypot(ra[0] - rb[0], ra[1] - rb[1])]);
      };
      for (let i = 0; i < TORSO.length; i++)
        for (let j = i + 1; j < TORSO.length; j++) link(TORSO[i], TORSO[j]);
      link('lHip', 'lKnee'); link('lKnee', 'lFoot');
      link('rHip', 'rKnee'); link('rKnee', 'rFoot');
      // [a, b, min, max] — keeps dead-weight legs from folding through themselves
      this.limits = [
        [P.lHip, P.lFoot, 0.42, 0.97], [P.rHip, P.rFoot, 0.42, 0.97],
        [P.lKnee, P.rKnee, 0.14, 9], [P.lFoot, P.rFoot, 0.12, 9],
        [P.lKnee, P.neck, 0.55, 9], [P.rKnee, P.neck, 0.55, 9]
      ];
      // Arms are ropes: max length only. Elbows are drawn with IK.
      this.arms = [
        { sh: P.lSh, hand: P.lHand, len: LL.C.ARM_MAX, pinned: false, px: 0, py: 0, target: null },
        { sh: P.rSh, hand: P.rHand, len: LL.C.ARM_MAX, pinned: false, px: 0, py: 0, target: null }
      ];
    }

    chest() {
      return { x: (this.x[P.neck] + this.x[P.pelvis]) * 0.5, y: (this.y[P.neck] + this.y[P.pelvis]) * 0.5 };
    }
    vel(i) {
      return { x: (this.x[i] - this.ox[i]) / LL.C.DT, y: (this.y[i] - this.oy[i]) / LL.C.DT };
    }
    chestVel() {
      const a = this.vel(P.neck), b = this.vel(P.pelvis);
      return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    }

    pin(h, x, y) {
      const a = this.arms[h];
      a.pinned = true; a.px = x; a.py = y; a.target = null;
      this.im[a.hand] = 0;
      this.x[a.hand] = this.ox[a.hand] = x;
      this.y[a.hand] = this.oy[a.hand] = y;
    }
    unpin(h) {
      const a = this.arms[h];
      a.pinned = false;
      this.im[a.hand] = this.baseIm[a.hand];
    }

    // Instant velocity change for every free point (used by the dyno).
    kick(vx, vy) {
      const dt = LL.C.DT;
      for (let i = 0; i < this.n; i++) {
        if (this.im[i] === 0) continue;
        this.ox[i] -= vx * dt;
        this.oy[i] -= vy * dt;
      }
    }

    translate(dx, dy) {
      for (let i = 0; i < this.n; i++) {
        if (this.im[i] === 0) continue;
        this.x[i] += dx; this.y[i] += dy;
      }
    }

    /* One fixed step.
     * env.ax/ay — extra acceleration on the torso (swing drag)
     * env.damp  — velocity retention
     * env.ledges — candidate ledges [{x1,x2,y,type}] (solid ones only) */
    step(env) {
      const C = LL.C, dt = C.DT, dt2 = dt * dt, n = this.n;
      const x = this.x, y = this.y, ox = this.ox, oy = this.oy, im = this.im;
      const damp = env.damp;
      const isTorso = this._isTorso || (this._isTorso = (() => {
        const t = new Uint8Array(n); TORSO.forEach((k) => (t[P[k]] = 1)); return t;
      })());

      // Core: a torsional spring that keeps the torso upright (the climber's muscles).
      let spin = 0, ccx = 0, ccy = 0;
      if (env.core) {
        ccx = (x[P.neck] + x[P.pelvis]) * 0.5; ccy = (y[P.neck] + y[P.pelvis]) * 0.5;
        const th = Math.atan2(x[P.neck] - x[P.pelvis], y[P.neck] - y[P.pelvis]);
        const tho = Math.atan2(ox[P.neck] - ox[P.pelvis], oy[P.neck] - oy[P.pelvis]);
        let dth = th - tho;
        if (dth > Math.PI) dth -= 2 * Math.PI; else if (dth < -Math.PI) dth += 2 * Math.PI;
        spin = U.clamp(env.core * th + 4 * dth / dt, -28, 28);
      }

      const kin = this._kin || (this._kin = new Uint8Array(n));
      kin.fill(0);
      for (const a of this.arms) if (!a.pinned && a.target) kin[a.hand] = 1;

      for (let i = 0; i < n; i++) {
        this.sy[i] = y[i];
        if (im[i] === 0) continue;
        if (kin[i]) { ox[i] = x[i]; oy[i] = y[i]; continue; }
        const vx = (x[i] - ox[i]) * damp, vy = (y[i] - oy[i]) * damp;
        ox[i] = x[i]; oy[i] = y[i];
        let ax = 0, ay = -C.GRAVITY;
        if (isTorso[i]) {
          ax += env.ax; ay += env.ay;
          if (spin) { ax += -(y[i] - ccy) * spin; ay += (x[i] - ccx) * spin; }
        }
        x[i] += vx + ax * dt2;
        y[i] += vy + ay * dt2;
        this.vin[i] = (y[i] - oy[i]) / dt;
      }

      // Reaching hands are driven toward their target (already clamped to reach).
      for (const a of this.arms) {
        if (a.pinned || !a.target) continue;
        const hx = x[a.hand], hy = y[a.hand];
        const k = 1 - Math.exp(-C.HAND_SPEED * dt);
        let dx = (a.target.x - hx) * k, dy = (a.target.y - hy) * k;
        const m = Math.hypot(dx, dy), maxStep = 11 * dt;
        if (m > maxStep) { dx *= maxStep / m; dy *= maxStep / m; }
        x[a.hand] = hx + dx; y[a.hand] = hy + dy;
      }

      this.contact.fill(-1);
      const ledges = env.ledges;
      for (let it = 0; it < C.ITER; it++) {
        for (const s of this.sticks) this._stick(s[0], s[1], s[2], s[2]);
        for (const l of this.limits) this._stick(l[0], l[1], l[2], l[3]);
        for (const a of this.arms) {
          if (a.pinned) { x[a.hand] = a.px; y[a.hand] = a.py; }
          this._stick(a.sh, a.hand, 0.12, a.len);
        }
        this._collide(ledges);
      }

      // Final rope pass: a taut arm is a hard limit, so translate the whole body.
      for (let pass = 0; pass < 3; pass++) {
        for (const a of this.arms) {
          if (!a.pinned) continue;
          const dx = a.px - x[a.sh], dy = a.py - y[a.sh], d = Math.hypot(dx, dy);
          if (d > a.len) { const c = (d - a.len) / d; this.translate(dx * c, dy * c); }
        }
      }
      this._collide(ledges);

      // Contact response: friction and (for nets) bounce.
      for (let i = 0; i < n; i++) {
        const li = this.contact[i];
        if (li < 0 || im[i] === 0) continue;
        const L = ledges[li];
        ox[i] = x[i] - (x[i] - ox[i]) * (L.type === 'net' ? 0.8 : 0.5);
        const vin = this.vin[i];
        if (L.type === 'net' && vin < -2.5) oy[i] = y[i] + vin * 0.45 * dt;
        else oy[i] = y[i];
      }

      // Keep the climber near the wall horizontally.
      const lim = C.WALL_HALF + 0.8;
      for (let i = 0; i < n; i++) {
        if (x[i] < -lim) { x[i] = -lim; ox[i] = x[i]; }
        else if (x[i] > lim) { x[i] = lim; ox[i] = x[i]; }
      }
    }

    _stick(a, b, min, max) {
      const x = this.x, y = this.y, im = this.im;
      const dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.hypot(dx, dy) || 1e-6;
      let target;
      if (d > max) target = max; else if (d < min) target = min; else return;
      const w = im[a] + im[b];
      if (w === 0) return;
      const c = (d - target) / d / w;
      x[a] += dx * c * im[a]; y[a] += dy * c * im[a];
      x[b] -= dx * c * im[b]; y[b] -= dy * c * im[b];
    }

    _collide(ledges) {
      if (!ledges || !ledges.length) return;
      const x = this.x, y = this.y;
      for (let i = 0; i < this.n; i++) {
        if (this.im[i] === 0) continue;
        const arm = i === P.lHand ? this.arms[0] : i === P.rHand ? this.arms[1] : null;
        if (arm && arm.target) continue; // a reaching hand floats in front of the wall
        for (let k = 0; k < ledges.length; k++) {
          const L = ledges[k];
          if (x[i] < L.x1 || x[i] > L.x2) continue;
          if (this.sy[i] >= L.y - 0.02 && y[i] < L.y) {
            y[i] = L.y;
            this.contact[i] = k;
          }
        }
      }
    }

    supported() {
      for (const i of SUPPORT) if (this.contact[i] >= 0) return this.contact[i];
      return -1;
    }

    serialize() {
      return { x: Array.from(this.x), y: Array.from(this.y), ox: Array.from(this.ox), oy: Array.from(this.oy) };
    }
    restore(s) {
      if (!s || !s.x || s.x.length !== this.n) return false;
      for (let i = 0; i < this.n; i++) {
        this.x[i] = s.x[i]; this.y[i] = s.y[i]; this.ox[i] = s.ox[i]; this.oy[i] = s.oy[i];
      }
      return true;
    }
  }

  Ragdoll.P = P;
  Ragdoll.NAMES = NAMES;
  LL.Ragdoll = Ragdoll;
})(globalThis.LL = globalThis.LL || {});
