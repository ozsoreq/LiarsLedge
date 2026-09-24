/* Liar's Ledge — the climb simulation (DOM-free, testable in Node).
 * Owns the climber's hands, stamina, the tricks' runtime state and all game
 * events. Rendering, audio and the narrator only *react* to `sim.events`. */
(function (LL) {
  'use strict';

  const U = LL.U, C = LL.C;
  const P = LL.Ragdoll.P;

  function mkHand(i) {
    return {
      i: i, state: 'grip', hold: null,
      len: C.ARM_MAX, lenTarget: C.ARM_MAX,
      st: 1, shown: 1, gripT: 0, taut: false
    };
  }

  class Sim {
    constructor(level) {
      this.level = level;
      this.events = [];
      this.time = 0;              // play time
      this.body = new LL.Ragdoll(0, 0.97);
      this.hands = [mkHand(0), mkHand(1)];
      this.cursor = { x: 0, y: 0.9 };   // offset from the chest
      this.rawHist = [];                 // raw mouse deltas for the cursor trail (mirror tell)
      this.btnMap = [0, 1];              // physical button -> hand, latched at press time
      this.btnPrev = [false, false];
      this.bothPrev = false;
      this.flags = { swap: false, mirror: false, stamLie: false, altLie: 0 };
      this.best = 0;
      this.falls = 0;
      this.bigFalls = 0;
      this.zone = 1;
      this.bestZone = 1;
      this.rest = 0;                     // seconds continuously supported
      this.airT = 0;
      this.fallPeak = 0;
      this.falling = false;
      this.fakeFall = 0;                 // seconds left of a fake fall
      this.fakeFallCD = 60;
      this.fakeFallCount = 0;
      this.fs = { active: false, t: 0, done: false, collapseT: -1 };
      this.finished = false;
      this.finishT = 0;
      this.idle = 0;
      this.pullDist = 0;
      this.dynos = 0;
      this.memo = {};                    // one-shot flags (first crumble, …)
      this._holdBuf = [];
      this._ledgeBuf = [];
      this._shyBuf = [];

      this._gripStart();
    }

    _gripStart() {
      const L = this.level.holds.find((h) => h.tag === 'startL');
      const R = this.level.holds.find((h) => h.tag === 'startR');
      if (L) this._grip(0, L, true);
      if (R) this._grip(1, R, true);
    }

    emit(type, data) {
      const e = data || {};
      e.type = type;
      this.events.push(e);
    }

    chest() { return this.body.chest(); }
    height() { return Math.max(0, this.body.y[P.pelvis] - 0.97); }
    shownHeight() { return this.height() + this.flags.altLie; }

    handPos(h) { const i = this.body.arms[h].hand; return { x: this.body.x[i], y: this.body.y[i] }; }
    shoulderPos(h) { const i = this.body.arms[h].sh; return { x: this.body.x[i], y: this.body.y[i] }; }
    cursorWorld() { const c = this.chest(); return { x: c.x + this.cursor.x, y: c.y + this.cursor.y }; }

    anyGrip() { return this.hands[0].state === 'grip' || this.hands[1].state === 'grip'; }

    holdUsable(h) {
      return !h.gone && !this.level.isHidden(h, this.fs.done) && !(h.tag === 'fsRail' && this.fs.done);
    }

    // Nearest usable hold under (x, y).
    holdAt(x, y) {
      const hs = this.level.holdsIn(y - 1, y + 1, this._holdBuf);
      let best = null, bd = 1e9;
      for (const h of hs) {
        if (!this.holdUsable(h)) continue;
        const d = U.dist(h.x, h.y, x, y);
        if (d <= h.r + C.GRIP_SLOP && d < bd) { bd = d; best = h; }
      }
      return best;
    }

    /* ------------------------------------------------------------ */

    step(inp) {
      const dt = C.DT;
      const body = this.body;
      this.time += dt;
      const chest = this.chest();
      const H = this.height();

      // --- zone & bands -------------------------------------------------
      const z = LL.zoneAt(H).id;
      if (z !== this.zone) {
        this.zone = z;
        if (z > this.bestZone) { this.bestZone = z; this.emit('zone', { zone: z, first: true }); }
      }
      const nf = this.level.bandsAt(H);
      if (nf.swap !== this.flags.swap) this.emit('swap', { on: nf.swap });
      if (nf.mirror !== this.flags.mirror) this.emit('mirror', { on: nf.mirror });
      if (nf.stamLie !== this.flags.stamLie) this.emit('stamLie', { on: nf.stamLie });
      if (nf.altLie !== this.flags.altLie) this.emit('altLie', { offset: nf.altLie });
      this.flags = nf;

      // --- cursor ---------------------------------------------------------
      let dx = inp.dx || 0, dy = inp.dy || 0;
      this.rawHist.push(dx, dy);
      if (this.rawHist.length > 40) this.rawHist.splice(0, this.rawHist.length - 40);
      if (inp.abs) {
        // absolute mode (no pointer lock): mirror the cursor around the chest
        this.cursor.x = (inp.abs.x - chest.x) * (nf.mirror ? -1 : 1);
        this.cursor.y = inp.abs.y - chest.y;
      } else {
        this.cursor.x += nf.mirror ? -dx : dx;
        this.cursor.y += dy;
      }
      const cl = U.len(this.cursor.x, this.cursor.y);
      if (cl > C.CURSOR_RADIUS) { this.cursor.x *= C.CURSOR_RADIUS / cl; this.cursor.y *= C.CURSOR_RADIUS / cl; }
      if (Math.abs(dx) + Math.abs(dy) > 0.001) this.idle = 0; else this.idle += dt;

      // --- buttons -> hands ----------------------------------------------
      const btn = inp.btn || [false, false];
      for (let b = 0; b < 2; b++) {
        if (btn[b] && !this.btnPrev[b]) this.btnMap[b] = nf.swap ? 1 - b : b;
        this.btnPrev[b] = btn[b];
      }
      const want = [false, false];
      for (let b = 0; b < 2; b++) if (btn[b]) want[this.btnMap[b]] = true;
      const both = want[0] && want[1];
      const wasGrip = this.anyGrip();

      for (let h = 0; h < 2; h++) {
        const hand = this.hands[h];
        if (want[h] && hand.state !== 'reach') {
          hand.lastLen = null;
          if (hand.state === 'grip') this._release(h, true);
          hand.state = 'reach';
          hand.len = hand.lenTarget = C.ARM_MAX;
          body.arms[h].len = C.ARM_MAX;
        } else if (!want[h] && hand.state === 'reach') {
          this._tryGrip(h);
        }
      }
      if (both && !this.bothPrev && wasGrip) this._dyno();
      this.bothPrev = both;

      // --- reach targets & swing ------------------------------------------
      const cw = this.cursorWorld();
      let ax = 0, ay = 0, nReach = 0, excessSum = 0;
      for (let h = 0; h < 2; h++) {
        const arm = body.arms[h];
        if (this.hands[h].state !== 'reach') { arm.target = null; continue; }
        const sh = this.shoulderPos(h);
        let tx = cw.x + (both ? (h === 0 ? -0.13 : 0.13) : 0), ty = cw.y;
        const ddx = tx - sh.x, ddy = ty - sh.y, d = U.len(ddx, ddy) || 1e-6;
        const reach = C.ARM_MAX - 0.02;
        if (d > reach) {
          const ex = Math.min(d - reach, C.SWING_MAX_EXCESS);
          excessSum += ex;
          ax += (ddx / d) * ex; ay += (ddy / d) * ex;
          nReach++;
          tx = sh.x + (ddx / d) * reach; ty = sh.y + (ddy / d) * reach;
        }
        arm.target = { x: tx, y: ty };
      }
      let sax = 0, say = 0;
      if (nReach && this.anyGrip()) {
        sax = (ax / nReach) * C.SWING_ACCEL;
        say = (ay / nReach) * C.SWING_ACCEL * (ay > 0 ? 0.3 : 0.55);
      } else if (nReach && this.lastSupported) {
        // Lying on a ledge: reaching past your arm drags you along it (a crawl).
        const cx = U.clamp(ax / nReach, -1, 1);
        body.translate(cx * C.CRAWL_SPEED * dt, 0);
      }

      // --- pull up / lower -------------------------------------------------
      const pull = (inp.wheel || 0) * C.WHEEL_STEP + (inp.pullKey || 0) * 1.2 * dt;
      for (let h = 0; h < 2; h++) {
        const hand = this.hands[h];
        if (hand.state !== 'grip') continue;
        if (pull) hand.lenTarget = U.clamp(hand.lenTarget - pull, C.ARM_MIN, C.ARM_MAX);
        const prevLen = hand.len;
        const maxD = C.PULL_SPEED * dt;
        hand.len += U.clamp(hand.lenTarget - hand.len, -maxD, maxD);
        body.arms[h].len = hand.len;
        if (hand.len < prevLen && hand.taut) {
          const cost = (prevLen - hand.len) * C.PULL_COST / Math.max(0.6, hand.hold ? hand.hold.grip : 1);
          hand.st -= cost;
          this.pullDist += prevLen - hand.len;
        }
      }

      // --- holds: shy, crumble, respawn --------------------------------------
      this._updateHolds(dt, cw);

      // --- physics ----------------------------------------------------------
      const gripping = this.anyGrip();
      const ledges = this.level.ledgesIn(chest.y - 4, chest.y + 3, true, this._ledgeBuf);
      body.step({ ax: sax, ay: say, damp: gripping ? C.DAMP_HANG : C.DAMP_AIR, ledges: ledges, core: gripping ? C.CORE : C.CORE * 0.15 });

      // --- after physics: tautness, support, stamina -------------------------
      const supIdx = body.supported();
      const cv = body.chestVel();
      const speed = U.len(cv.x, cv.y);
      const supported = supIdx >= 0;
      this.lastSupported = supported;
      if (supported && speed < 1.4) this.rest += dt; else this.rest = 0;
      const resting = this.rest > 0.25;
      const supLedge = supported ? ledges[supIdx] : null;

      let nTaut = 0;
      for (let h = 0; h < 2; h++) {
        const hand = this.hands[h];
        hand.taut = false;
        if (hand.state !== 'grip') continue;
        hand.gripT += dt;
        const sh = this.shoulderPos(h), hp = this.handPos(h);
        hand.taut = U.dist(sh.x, sh.y, hp.x, hp.y) > hand.len - 0.03;
        if (hand.taut) nTaut++;
      }
      for (let h = 0; h < 2; h++) {
        const hand = this.hands[h];
        if (resting) { hand.st += C.REST_REGEN * dt; }
        else if (hand.state === 'grip') {
          const g = hand.hold ? hand.hold.grip : 1;
          let drain = 0;
          if (hand.taut) drain = nTaut === 1 ? C.ONE_ARM_DRAIN : C.TWO_ARM_DRAIN;
          else drain = supported ? 0 : C.TWO_ARM_DRAIN * 0.5;
          drain /= g;
          drain += excessSum * C.DRAG_COST;
          hand.st -= drain * dt;
        } else {
          hand.st += C.FREE_REGEN * dt;
        }
        hand.st = U.clamp(hand.st, 0, 1);
        if (hand.state === 'grip' && hand.st <= 0) {
          this._release(h, false);
          this.emit('slip', { hand: h, reason: 'stamina' });
        }
        // The lying stamina bar shows full while the arm is actually tired.
        const shownTarget = this.flags.stamLie ? 1 : hand.st;
        hand.shown = U.damp(hand.shown, shownTarget, 10, dt);
      }

      // --- falling bookkeeping --------------------------------------------
      const g2 = this.anyGrip();
      if (!g2 && !supported) {
        this.airT += dt;
        if (!this.falling && this.airT > 0.12) { this.falling = true; this.fallPeak = H; }
        if (this.falling) this.fallPeak = Math.max(this.fallPeak, H);
      } else {
        if (this.falling) {
          const dist = this.fallPeak - H;
          if (dist > 1.6) {
            if (dist > 3) this.falls++;
            if (dist > 15) this.bigFalls++;
            this.emit('fell', { dist: dist, from: this.fallPeak, to: H, zone: LL.zoneAt(H).id, caught: g2 ? 'hand' : (supLedge ? supLedge.type : 'ledge') });
          }
        }
        this.falling = false;
        this.airT = 0;
      }
      if (supported) {
        for (const i of [P.pelvis, P.lFoot, P.rFoot, P.head]) {
          if (body.contact[i] >= 0 && body.vin[i] < -3.5) { this.emit('thud', { v: -body.vin[i], net: supLedge && supLedge.type === 'net' }); break; }
        }
      }

      if (resting && !this.memo.rested && H > 2) { this.memo.rested = true; this.emit('firstRest'); }

      // --- best height -----------------------------------------------------
      if (H > this.best) this.best = H;

      // --- fake falls (Zone 3+) -------------------------------------------
      this._fakeFalls(dt, H, resting);

      // --- summits ---------------------------------------------------------
      this._summits(dt, supLedge, resting);
    }

    /* ------------------------------------------------------------ */

    _grip(h, hold, silent) {
      const hand = this.hands[h];
      const body = this.body;
      const hp = this.handPos(h);
      // anchor: hand position pulled inside the hold
      let ax = hold.x, ay = hold.y;
      const d = U.dist(hold.x, hold.y, hp.x, hp.y);
      if (d > 0.001) { const k = Math.min(d, hold.r * 0.4) / d; ax = hold.x + (hp.x - hold.x) * k; ay = hold.y + (hp.y - hold.y) * k; }
      hand.state = 'grip';
      hand.hold = hold;
      hand.gripT = 0;
      body.pin(h, ax, ay);
      const sh = this.shoulderPos(h);
      hand.len = hand.lenTarget = U.clamp(U.dist(sh.x, sh.y, ax, ay), C.ARM_MIN, C.ARM_MAX);
      body.arms[h].len = hand.len;
      body.arms[h].target = null;
      hand.offX = ax - hold.x; hand.offY = ay - hold.y;
      if (!silent) this.emit('grip', { hand: h, hold: hold });
    }

    _release(h, voluntary) {
      const hand = this.hands[h];
      if (hand.state !== 'grip') return;
      this.body.unpin(h);
      hand.state = 'free';
      const hold = hand.hold;
      hand.hold = null;
      hand.lastLen = hand.len;
      hand.len = hand.lenTarget = C.ARM_MAX;
      this.body.arms[h].len = C.ARM_MAX;
      if (hold && hold.type === 'fake' && hold.crumbleT >= 0 && !hold.gone) hold.crumbleT = -1;
      if (voluntary) this.emit('release', { hand: h });
    }

    _tryGrip(h) {
      const hand = this.hands[h];
      const body = this.body;
      body.arms[h].target = null;
      hand.state = 'free';
      const hp = this.handPos(h);
      const hold = this.holdAt(hp.x, hp.y);

      if (!hold) {
        // A hand that passes through a painted backdrop tears it.
        const p = this.level.panelAt(hp.x, hp.y);
        if (p && (!this.level.isHidden({ y0: hp.y }, this.fs.done))) this._tear(p, hp.x, hp.y, h);
        else this.emit('miss', { hand: h });
        return;
      }
      if (hold.type === 'painted') { this._tear(this.level.panelAt(hold.x, hold.y), hold.x, hold.y, h, hold); return; }
      if (hold.type === 'shy' && !hold.tamed) {
        if (hold.fled > 0.35) { this.emit('miss', { hand: h }); return; }
        hold.tamed = true;
        this.emit('tame', { hold: hold });
      }

      // Catching yourself mid-fall costs stamina; too much and the hand rips off.
      const cv = body.chestVel();
      const sp = U.len(cv.x, cv.y);
      if (sp > C.CATCH_FREE_SPEED) {
        const cost = (sp - C.CATCH_FREE_SPEED) * C.CATCH_COST / hold.grip;
        if (cost > hand.st) {
          hand.st = 0;
          this.emit('slip', { hand: h, reason: 'catch', hold: hold });
          return;
        }
        hand.st -= cost;
        this.emit('catch', { hand: h, speed: sp });
      }

      this._grip(h, hold);
      if (hold.type === 'fake' && hold.crumbleT < 0) {
        hold.crumbleT = 0.5;
      }
      if (hold.tag === 'tellLie' && !this.memo.tellLie) { this.memo.tellLie = true; this.emit('tellLieHeld'); }
    }

    _tear(p, x, y, h, hold) {
      if (p) {
        p.tears.push({ x: x, y: y, r: 0.25 + Math.random() * 0.2, s: Math.random() });
        if (p.tears.length > 40) p.tears.shift();
      }
      if (hold) { hold.gone = true; hold.respawnT = 1e9; }
      this.emit('painted', { hand: h, x: x, y: y, first: !this.memo.painted });
      this.memo.painted = true;
    }

    _dyno() {
      const body = this.body;
      let pullFrac = 0, stAvg = 0, n = 0;
      for (let h = 0; h < 2; h++) {
        const hand = this.hands[h];
        stAvg += hand.st; n++;
        // How locked-off the arm was when it let go: a pulled-up body springs further.
        if (hand.lastLen != null) pullFrac = Math.max(pullFrac, (C.ARM_MAX - hand.lastLen) / (C.ARM_MAX - C.ARM_MIN));
      }
      stAvg /= n;
      const c = this.chest(), cw = this.cursorWorld();
      let dx = cw.x - c.x, dy = cw.y - c.y + 0.6;
      const d = U.len(dx, dy) || 1;
      dx /= d; dy /= d;
      const v = Math.min(C.DYNO_MAX, (C.DYNO_BASE + C.DYNO_PULL * U.clamp(pullFrac, 0, 1)) * U.clamp(0.35 + stAvg, 0.35, 1));
      body.kick(dx * v, dy * v);
      for (const hand of this.hands) hand.st = Math.max(0, hand.st - C.DYNO_COST);
      this.dynos++;
      this.emit('dyno', { v: v });
    }

    _updateHolds(dt, cw) {
      const c = this.chest();
      const hs = this.level.holdsIn(c.y - 6, c.y + 6, this._shyBuf);
      const reaching = this.hands[0].state === 'reach' || this.hands[1].state === 'reach';
      for (const h of hs) {
        if (h.gone) {
          h.respawnT -= dt;
          if (h.respawnT <= 0) { h.gone = false; h.crumbleT = -1; h.tamed = false; this.emit('respawn', { hold: h }); }
          continue;
        }
        if (h.type === 'fake' && h.crumbleT >= 0) {
          h.crumbleT -= dt;
          if (h.crumbleT <= 0) {
            h.gone = true; h.respawnT = 14; h.crumbleT = -1;
            for (let k = 0; k < 2; k++) {
              if (this.hands[k].hold === h) this._release(k, false);
            }
            this.emit('crumble', { hold: h, first: !this.memo.crumbled });
            this.memo.crumbled = true;
          }
        }
        if (h.type === 'shy' && !h.tamed) {
          const d = U.dist(h.x, h.y, cw.x, cw.y);
          // tell: a tiny wobble whenever the cursor passes nearby
          const wobTarget = d < 1.6 ? 1 - d / 1.6 : 0;
          h.wob = U.damp(h.wob, wobTarget, 6, dt);
          if (reaching && d < 0.55 && h.fleeT < 0 && h.fled < 0.05) {
            h.fleeT = 0.2;
            h.fleeDir = cw.x < h.x0 ? 1 : -1;
          }
          if (h.fleeT >= 0) {
            h.fleeT -= dt;
            if (h.fleeT < 0) { h.fleeT = -1; h.fled = 0.001; h.calmT = 3; this.emit('shyFlee', { hold: h, first: !this.memo.shy }); this.memo.shy = true; }
          }
          if (h.fled > 0) {
            h.calmT -= dt;
            const goal = h.calmT > 0 ? 1 : 0;
            h.fled = U.damp(h.fled, goal, goal ? 9 : 1.5, dt);
            if (goal === 0 && h.fled < 0.01) h.fled = 0;
          }
          h.x = h.x0 + h.fleeDir * 1.0 * h.fled;
          h.y = h.y0 + 0.25 * Math.sin(h.fled * Math.PI);
        }
      }
    }

    _fakeFalls(dt, H, resting) {
      if (this.fakeFall > 0) {
        this.fakeFall -= dt;
        if (this.fakeFall <= 0) this.emit('fakeFallEnd', { held: this.anyGrip() });
        return;
      }
      if (H < 200 || this.finished || this.fs.active) return;
      const holding = this.anyGrip() && !resting && (this.hands[0].gripT > 1.2 || this.hands[1].gripT > 1.2);
      if (!holding) return;
      // First one is shown early, just above a rest ledge.
      if (!this.memo.fakeFall && H > 212.3 && H < 226) return this._startFakeFall(true);
      if (!this.memo.fakeFall) return;
      this.fakeFallCD -= dt;
      if (this.fakeFallCD <= 0) this._startFakeFall(false);
    }

    _startFakeFall(first) {
      this.memo.fakeFall = true;
      this.fakeFall = 1.35;
      this.fakeFallCount++;
      this.fakeFallCD = 55 + Math.random() * 60;
      this.emit('fakeFall', { first: first });
    }

    _summits(dt, supLedge, resting) {
      const fs = this.fs;
      if (!fs.done && !fs.active && supLedge && supLedge.type === 'fakeSummit' && resting && this.rest > 0.8) {
        fs.active = true; fs.t = 0;
        this.emit('credits');
      }
      if (fs.active) {
        fs.t += dt;
        if (fs.t > 16 && !fs.done) {
          fs.done = true; fs.active = false; fs.collapseT = 0;
          for (const l of this.level.ledges) if (l.type === 'fakeSummit') l.broken = true;
          for (let h = 0; h < 2; h++) {
            const hold = this.hands[h].hold;
            if (hold && hold.tag === 'fsRail') this._release(h, false);
          }
          this.emit('collapse');
        }
      }
      if (fs.collapseT >= 0) fs.collapseT += dt;
      if (!this.finished && supLedge && supLedge.type === 'summit' && resting && this.rest > 0.6) {
        this.finished = true;
        this.finishT = this.time;
        this.emit('summit', { time: this.time, falls: this.falls });
      }
    }

    // Find a hold for the narrator's arrow.
    findHold(kind, maxDist) {
      const c = this.chest();
      const hs = this.level.holdsIn(c.y - 0.5, c.y + (maxDist || 3.5));
      let best = null, bd = 1e9;
      for (const h of hs) {
        if (!this.holdUsable(h) || h.y < c.y) continue;
        let ok;
        if (kind === 'route') ok = h.route && h.type === 'normal';
        else if (kind === 'real') ok = h.type === 'normal';
        else ok = h.type === kind || h.tag === kind;
        if (!ok) continue;
        const d = U.dist(h.x, h.y, c.x, c.y + 1.4);
        if (d < bd && d < (maxDist || 3.5)) { bd = d; best = h; }
      }
      return best;
    }

    /* ---- save / load ------------------------------------------------ */

    serialize() {
      return {
        v: 1,
        body: this.body.serialize(),
        hands: this.hands.map((h) => ({ state: h.state === 'reach' ? 'free' : h.state, hold: h.hold ? h.hold.id : -1, len: h.len, st: h.st })),
        time: this.time, best: this.best, falls: this.falls, bigFalls: this.bigFalls,
        bestZone: this.bestZone, fsDone: this.fs.done, finished: this.finished, finishT: this.finishT,
        memo: this.memo, fakeFallCount: this.fakeFallCount, dynos: this.dynos, cursor: this.cursor
      };
    }

    restore(s) {
      if (!s || s.v !== 1) return false;
      if (!this.body.restore(s.body)) return false;
      for (let h = 0; h < 2; h++) { this.body.unpin(h); this.hands[h].state = 'free'; this.hands[h].hold = null; }
      s.hands.forEach((sh, h) => {
        const hand = this.hands[h];
        hand.st = sh.st;
        if (sh.state === 'grip' && sh.hold >= 0 && this.level.holds[sh.hold]) {
          const hold = this.level.holds[sh.hold];
          const hp = this.handPos(h);
          if (U.dist(hp.x, hp.y, hold.x, hold.y) < hold.r + 0.3) {
            this._grip(h, hold, true);
            hand.len = hand.lenTarget = this.body.arms[h].len = U.clamp(sh.len, C.ARM_MIN, C.ARM_MAX);
          }
        }
      });
      this.time = s.time || 0; this.best = s.best || 0; this.falls = s.falls || 0; this.bigFalls = s.bigFalls || 0;
      this.bestZone = s.bestZone || 1; this.zone = LL.zoneAt(this.height()).id;
      this.memo = s.memo || {};
      this.fakeFallCount = s.fakeFallCount || 0; this.dynos = s.dynos || 0;
      if (s.cursor) this.cursor = s.cursor;
      this.finished = !!s.finished; this.finishT = s.finishT || 0;
      if (s.fsDone) {
        this.fs.done = true; this.fs.collapseT = 999;
        for (const l of this.level.ledges) if (l.type === 'fakeSummit') l.broken = true;
      }
      this.flags = this.level.bandsAt(this.height());
      return true;
    }

    // Debug / editor helper: put the climber at a height, hanging from the nearest holds.
    teleport(height, x) {
      const y = height + 0.97 + 1.3;
      if (y > this.level.veilY && !this.fs.done) {
        this.fs.done = true; this.fs.collapseT = 999;
        for (const l of this.level.ledges) if (l.type === 'fakeSummit') l.broken = true;
      }
      const hs = this.level.holdsIn(y - 1.5, y + 1.5).filter((h) => this.holdUsable(h) && h.type === 'normal');
      if (x == null) {
        const r = hs.filter((h) => h.route);
        x = r.length ? r[0].x0 : 0;
      }
      for (let h = 0; h < 2; h++) { this.body.unpin(h); this.hands[h].state = 'free'; this.hands[h].hold = null; }
      const nb = new LL.Ragdoll(x, y - 1.3);
      this.body.restore(nb.serialize());
      this.fallPeak = y; this.falling = false; this.airT = 0;
      const pick = (hx) => {
        let b = null, bd = 1e9;
        for (const h of hs) { const d = U.dist(h.x, h.y, hx, y); if (d < bd && d < 1.2) { bd = d; b = h; } }
        return b;
      };
      const a = pick(x - 0.35), b = pick(x + 0.35);
      if (a) { this.body.x[P.lHand] = a.x; this.body.y[P.lHand] = a.y; this._grip(0, a, true); }
      if (b && b !== a) { this.body.x[P.rHand] = b.x; this.body.y[P.rHand] = b.y; this._grip(1, b, true); }
      this.best = Math.max(this.best, this.height());
    }
  }

  LL.Sim = Sim;
})(globalThis.LL = globalThis.LL || {});
