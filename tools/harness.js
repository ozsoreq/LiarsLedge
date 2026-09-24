/* Loads the DOM-free game modules into Node for tests and tuning. */
'use strict';
const path = require('path');

const SRC = ['util.js', 'config.js', 'physics.js', 'level.js', 'sim.js', 'narrator.js'];
for (const f of SRC) require(path.join(__dirname, '..', 'src', f));

const LL = globalThis.LL;

/* A scripted climber that follows the generated route using only the same
 * inputs a player has: cursor, two buttons, pull up. */
class Bot {
  constructor(sim) {
    this.sim = sim;
    this.route = sim.level.holds.filter((h) => h.route || h.tag === 'fsRail' || h.tag === 'summitRail');
    this.log = [];
  }

  /* Intents are per hand; translate them to physical buttons and cursor the way a
   * player who has learned the tells would (swapped hands, mirrored cursor). */
  inp(o) {
    const s = this.sim;
    const r = Object.assign({ dx: 0, dy: 0, btn: [false, false], wheel: 0, pullKey: 0 }, o);
    const want = r.btn, phys = [false, false];
    for (let h = 0; h < 2; h++) {
      if (!want[h]) continue;
      let b = -1;
      for (let k = 0; k < 2; k++) if (this.prevPhys && this.prevPhys[k] && s.btnMap[k] === h) b = k;
      if (b < 0) b = s.flags.swap ? 1 - h : h;
      phys[b] = true;
    }
    this.prevPhys = phys;
    r.btn = phys;
    if (r.abs && s.flags.mirror) { const c = s.chest(); r.abs = { x: 2 * c.x - r.abs.x, y: r.abs.y }; }
    return r;
  }

  run(seconds, stepFn) {
    const n = Math.round(seconds / LL.C.DT);
    for (let i = 0; i < n; i++) {
      const r = stepFn(i);
      if (r === false) return false;
    }
    return true;
  }

  gripHeld(h) { return this.sim.hands[h].state === 'grip' ? this.sim.hands[h].hold : null; }

  nextTarget() {
    const s = this.sim;
    let top = -1;
    for (let h = 0; h < 2; h++) { const g = this.gripHeld(h); if (g) top = Math.max(top, g.y0); }
    const c = s.chest();
    if (top < 0) top = c.y;
    // nearest route hold above the highest grip that is reachable
    let best = null;
    for (const h of this.route) {
      if (h.y0 <= top + 0.05 || !s.holdUsable(h) || h.type === 'fake' || h.type === 'painted') continue;
      if (h.y0 > top + 1.6) break;
      if (!best || h.y0 < best.y0) best = h;
    }
    return best;
  }

  // Choose which hand moves where: the best real hold that moves us up without crossing arms.
  plan() {
    const s = this.sim;
    const held = [this.gripHeld(0), this.gripHeld(1)];
    const top = Math.max(held[0] ? held[0].y0 : -1e9, held[1] ? held[1].y0 : -1e9);
    let best = null;
    for (let m = 0; m < 2; m++) {
      const hh = held[1 - m];
      if (!hh) continue;
      if (held[m] && held[1 - m] && held[m] !== held[1 - m] && held[m].y0 > held[1 - m].y0 + 0.3) continue; // move the lower hand
      for (const h of s.level.holdsIn(top - 0.9, top + 1.3)) {
        if (!s.holdUsable(h) || h === held[0] || h === held[1] || h.y0 > s.level.veilY) continue;
        if (!(h.type === 'normal' || h.type === 'tellLie' || (h.type === 'shy' && h.tamed))) continue;
        // where the moving shoulder ends up after a full lock-off on the holding arm
        const sx = hh.x + (m === 1 ? 0.4 : -0.4), sy = hh.y - 0.34;
        if (Math.hypot(h.x - sx, h.y - sy) > 1.04) continue;
        if (m === 0 && h.x > hh.x + 0.25) continue;
        if (m === 1 && h.x < hh.x - 0.25) continue;
        const gain = h.y0 - top;
        const score = gain + (h.route ? 0.25 : 0) - 0.15 * Math.abs(h.x - hh.x) - (gain < 0.05 ? 1 : 0);
        if (!best || score > best.score) best = { m, h, score };
      }
    }
    return best;
  }

  nextTarget() {
    const p = this.plan();
    if (p && p.score > -1.8) return p.h;
    return this.routeTarget();
  }

  // Next route hold above the highest grip (used for dyno gaps).
  routeTarget() {
    const s = this.sim;
    let top = -1;
    for (let h = 0; h < 2; h++) { const g = this.gripHeld(h); if (g) top = Math.max(top, g.y0); }
    if (top < 0) top = s.chest().y;
    let best = null;
    for (const h of this.route) {
      if (h.y0 <= top + 0.05 || !s.holdUsable(h) || h.type === 'fake' || h.type === 'painted') continue;
      if (h.y0 > top + 1.6) break;
      if (!best || h.y0 < best.y0) best = h;
    }
    return best;
  }

  // One move. Returns false if it failed.
  move() {
    const s = this.sim, C = LL.C;
    const p = this.plan();
    const oneHand = !this.gripHeld(0) !== !this.gripHeld(1);
    const thr = oneHand ? -1.8 : -0.9;
    let target, mover;
    if (p && p.score > thr) { target = p.h; mover = p.m; }
    else {
      const g0 = this.gripHeld(0), g1 = this.gripHeld(1);
      if (g0 && g1 && g0 !== g1 && !this.matched) {
        // stuck with crossed or spread hands: match onto the upper hold
        mover = g0.y0 < g1.y0 ? 0 : 1;
        target = mover === 0 ? g1 : g0;
        this.matched = true;
      } else {
        target = this.routeTarget();
        if (!target) return false;
        mover = g0 && !g1 ? 1 : g1 && !g0 ? 0 : (target.x0 < s.chest().x ? 0 : 1);
        // standing on a ledge we can use whichever hand suits the hold
        if (s.body.supported() >= 0) mover = target.x0 < s.chest().x ? 0 : 1;
        this.matched = false;
      }
    }
    if (p && p.score > thr) this.matched = false;
    const holder = 1 - mover;
    const gap = this.gripHeld(holder) ? Math.hypot(target.x0 - this.gripHeld(holder).x0, target.y0 - this.gripHeld(holder).y0) : 0;
    const dyno = gap > 1.15;
    const btn = [false, false];
    let t = 0, ok = false;
    // Rest first if tired and supported.
    if (Math.min(s.hands[0].st, s.hands[1].st) < 0.45 && s.body.supported() >= 0) {
      this.run(2.5, () => { s.step(this.inp({})); });
    }
    // Tired on the wall: shake out one arm at a time.
    const g0 = this.gripHeld(0), g1 = this.gripHeld(1);
    if (g0 && g1 && Math.min(s.hands[0].st, s.hands[1].st) < 0.3) {
      for (let k = 0; k < 3; k++) {
        const w = s.hands[0].st < s.hands[1].st ? 0 : 1;
        if (s.hands[1 - w].st < 0.25) break;
        const hold = this.gripHeld(w);
        if (!hold || !this.gripHeld(1 - w)) break;
        const b = [w === 0, w === 1];
        this.run(1.6, () => {
          const hp = s.handPos(w);
          s.step(this.inp({ btn: b, abs: { x: hold.x + (hp.x - hold.x) * 0.2, y: hold.y + 0.02 } }));
        });
        this.run(0.3, () => {
          const hp = s.handPos(w);
          if (Math.hypot(hp.x - hold.x, hp.y - hold.y) < hold.r * 0.5) return false;
          s.step(this.inp({ btn: b, abs: { x: hold.x, y: hold.y } }));
        });
        s.step(this.inp({ abs: { x: hold.x, y: hold.y } }));
      }
      return true;
    }
    if (dyno) {
      // lock off, then jump with both hands toward the target
      this.run(0.9, () => { s.step(this.inp({ pullKey: 1, abs: { x: target.x, y: target.y } })); });
      let released = false;
      this.run(1.4, () => {
        const hp = s.handPos(mover);
        const near = Math.hypot(hp.x - target.x, hp.y - target.y) < target.r * 0.7;
        const b = [true, true];
        if (near) { b[mover === 0 ? 0 : 1] = false; }
        s.step(this.inp({ btn: b, abs: { x: target.x, y: target.y } }));
        if (near) { released = true; return false; }
      });
      // let the other hand grab the nearest hold too
      this.run(0.2, () => { s.step(this.inp({ btn: [mover === 1, mover === 0], abs: { x: target.x + (holder === 0 ? -0.3 : 0.3), y: target.y - 0.3 } })); });
      this.run(0.05, () => { s.step(this.inp({ abs: { x: target.x, y: target.y } })); });
      return this.gripHeld(mover) === target || this.gripHeld(holder) === target;
    }
    const orig = this.gripHeld(mover);
    btn[mover] = true;
    let aim = target;
    this.run(1.8, () => {
      const hp = s.handPos(mover);
      const far = Math.hypot(aim.x - s.shoulderPos(mover).x, aim.y - s.shoulderPos(mover).y) > C.ARM_MAX - 0.08;
      const near = Math.hypot(hp.x - aim.x, hp.y - aim.y) < aim.r * 0.6;
      t += C.DT;
      if (near) { ok = true; return false; }
      // failed reach: retreat to the hold we came from
      if (t > 1.3 && orig && aim === target) aim = orig;
      s.step(this.inp({ btn: btn.slice(), pullKey: far && aim === target ? 1 : 0, abs: { x: aim.x, y: aim.y } }));
    });
    // release -> grip
    s.step(this.inp({ abs: { x: aim.x, y: aim.y } }));
    const got = this.gripHeld(mover) === target;
    if (got) {
      // let the lower arm hang long again so the next move starts relaxed
      this.run(0.15, () => { s.step(this.inp({ pullKey: -1, abs: { x: target.x, y: target.y } })); });
    }
    return got;
  }

  // If nothing is held, try to grab whatever route holds are near.
  recover() {
    const s = this.sim;
    const c = s.chest();
    let best = null, bd = 1e9;
    for (const h of this.route) {
      if (!s.holdUsable(h) || h.type !== 'normal') continue;
      const d = Math.hypot(h.x - c.x, h.y - (c.y + 0.6));
      if (d < bd) { bd = d; best = h; }
    }
    if (!best || bd > 4) { this.run(0.5, () => s.step(this.inp({}))); return; }
    const m = best.x < c.x ? 0 : 1;
    const b = [m === 0, m === 1];
    this.run(3.0, () => {
      const hp = s.handPos(m);
      if (Math.hypot(hp.x - best.x, hp.y - best.y) < best.r * 0.6) return false;
      s.step(this.inp({ btn: b, abs: { x: best.x, y: best.y } }));
    });
    s.step(this.inp({ abs: { x: best.x, y: best.y } }));
  }
}

module.exports = { LL, Bot };
