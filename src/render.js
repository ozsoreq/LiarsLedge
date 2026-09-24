/* Liar's Ledge — renderer (Canvas 2D).
 * Flat, calm, premium-app look. World units are metres with y up; the camera
 * maps them to the screen. Tells live here: shadows, sharp edges, wobble,
 * parallax drift on painted rock, trembling hands, the tilted cursor trail. */
(function (LL) {
  'use strict';

  const U = LL.U, C = LL.C;
  const P = LL.Ragdoll.P;

  const HOLD_COL = { 1: '#bdb5a6', 2: '#ece6d8', 3: '#dca56c', 4: '#93e4d1', 5: '#f2d08e' };

  const CREDITS = [
    ['', 'LIAR\'S LEDGE'],
    ['', ''],
    ['Climbing Director', 'Holdsworth Grippington'],
    ['Rock Consultant', 'Petra Stonewall-Fairweather'],
    ['Gravity', 'Isaac Newtonne'],
    ['Lead Summit Engineer', 'Ima Realperson'],
    ['Ledge Inspector', 'Ledgar Allan Poe'],
    ['Narration', 'The Guide (who never lies)'],
    ['Hold Casting', 'Crimpy McCrimpface'],
    ['Catering', 'Nobody In Particular'],
    ['Special Thanks', 'The Summit, for being here'],
    ['', ''],
    ['', 'Thank you for playing.']
  ];

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 1.6, view: 10.5, shakeX: 0, shakeY: 0 };
      this.fx = [];
      this.t = 0;
      this.glint = 0;
      this.toast = null;
      this.glitch = 0;
      this.nextGlitch = 3;
      this.blur = 0;
      this.fakeFallT = 0;
      this.impact = 0;
      this.debug = false;
      this.labels = [];
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.W = this.cv.clientWidth || window.innerWidth;
      this.H = this.cv.clientHeight || window.innerHeight;
      this.cv.width = Math.round(this.W * dpr);
      this.cv.height = Math.round(this.H * dpr);
    }

    get scale() { return this.H / this.cam.view; }

    toScreen(x, y) {
      const s = this.scale, c = this.cam;
      return { x: this.W / 2 + (x - c.x - c.shakeX) * s, y: this.H / 2 - (y - c.y - c.shakeY) * s };
    }
    toWorld(sx, sy) {
      const s = this.scale, c = this.cam;
      return { x: (sx - this.W / 2) / s + c.x + c.shakeX, y: -(sy - this.H / 2) / s + c.y + c.shakeY };
    }

    worldT() {
      const s = this.scale * this.dpr, c = this.cam;
      this.ctx.setTransform(s, 0, 0, -s, this.dpr * this.W / 2 - (c.x + c.shakeX) * s, this.dpr * this.H / 2 + (c.y + c.shakeY) * s);
    }
    screenT() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

    /* ---- camera ------------------------------------------------------- */
    follow(sim, dt) {
      const c = sim.chest(), v = sim.body.chestVel();
      const tx = c.x + sim.cursor.x * 0.18, ty = c.y + 0.6 + sim.cursor.y * 0.15;
      const cam = this.cam;
      cam.x = U.damp(cam.x, U.clamp(tx, -5.5, 5.5), 4, dt);
      cam.y = U.damp(cam.y, ty, v.y < -8 ? 9 : 4.5, dt);
      const wantView = 10.5 + U.clamp((-v.y - 6) * 0.18, 0, 3.5);
      cam.view = U.damp(cam.view, wantView, 2, dt);
      // fake fall: the camera lies, the body doesn't
      cam.shakeX = 0; cam.shakeY = 0;
      if (this.fakeFallT > 0) {
        const k = this.fakeFallT / 1.35;
        cam.shakeX = (Math.random() - 0.5) * 0.25 * k;
        cam.shakeY = (Math.random() - 0.5) * 0.25 * k + (1 - k) * 0.9 * Math.sin(k * Math.PI);
      }
      if (this.impact > 0) {
        cam.shakeX += (Math.random() - 0.5) * 0.12 * this.impact;
        cam.shakeY += (Math.random() - 0.5) * 0.12 * this.impact;
      }
    }

    /* ---- events → visual fx ------------------------------------------- */
    onEvent(e, sim) {
      switch (e.type) {
        case 'crumble': this.burstChips(e.hold.x, e.hold.y, e.hold.r, 16, HOLD_COL[LL.zoneAt(e.hold.y).id]); break;
        case 'painted': this.burstPaper(e.x, e.y); break;
        case 'thud': this.impact = Math.min(1, e.v / 14); this.burstDust(sim.body.x[P.pelvis], sim.body.y[P.pelvis] - 0.1, e.v); break;
        case 'swap': this.glint = 1; this.glitch = Math.max(this.glitch, 0.25); break;
        case 'mirror': case 'stamLie': case 'altLie': if (sim.zone >= 4) this.glitch = Math.max(this.glitch, 0.2); break;
        case 'fakeFall': this.fakeFallT = 1.35; break;
        case 'zone': this.toast = { zone: LL.C.ZONES[e.zone - 1], t: 0 }; break;
        case 'collapse': {
          const ly = C.FAKE_SUMMIT;
          for (let x = -C.WALL_HALF; x < C.WALL_HALF; x += 0.35) this.burstChips(x, ly - 0.1, 0.2, 2, '#c9b08a');
          this.impact = 1;
          break;
        }
        case 'tame': this.sparkle(e.hold.x, e.hold.y); break;
        case 'respawn': this.sparkle(e.hold.x, e.hold.y, 0.4); break;
      }
    }

    burstChips(x, y, r, n, col) {
      for (let i = 0; i < n; i++) {
        this.fx.push({ k: 'chip', x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r,
          vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 2, life: 1.6, max: 1.6,
          s: 0.03 + Math.random() * 0.06, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, c: col });
      }
    }
    burstPaper(x, y) {
      for (let i = 0; i < 10; i++) {
        this.fx.push({ k: 'paper', x: x, y: y, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5,
          life: 2.2, max: 2.2, s: 0.05 + Math.random() * 0.06, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, c: '#d8cbb4' });
      }
    }
    burstDust(x, y, v) {
      const n = Math.min(14, Math.round(v));
      for (let i = 0; i < n; i++) {
        this.fx.push({ k: 'dust', x: x + (Math.random() - 0.5) * 0.5, y: y, vx: (Math.random() - 0.5) * 2.4, vy: Math.random() * 0.8,
          life: 0.9, max: 0.9, s: 0.08 + Math.random() * 0.1, c: '#d9d2c4' });
      }
    }
    sparkle(x, y, a) {
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        this.fx.push({ k: 'spark', x: x, y: y, vx: Math.cos(ang) * 1.2, vy: Math.sin(ang) * 1.2, life: 0.5, max: 0.5, s: 0.03, c: '#fff4c8', a: a || 1 });
      }
    }

    update(dt) {
      this.t += dt;
      this.glint = Math.max(0, this.glint - dt * 0.8);
      this.impact = Math.max(0, this.impact - dt * 3);
      this.fakeFallT = Math.max(0, this.fakeFallT - dt);
      this.glitch = Math.max(0, this.glitch - dt);
      if (this.toast) { this.toast.t += dt; if (this.toast.t > 5) this.toast = null; }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const p = this.fx[i];
        p.life -= dt;
        if (p.life <= 0) { this.fx.splice(i, 1); continue; }
        const g = p.k === 'paper' ? 2.2 : p.k === 'dust' ? -0.4 : p.k === 'spark' ? 0 : 9.8;
        p.vy -= g * dt;
        if (p.k === 'paper') { p.vx += Math.sin(this.t * 5 + i) * dt * 3; p.vx *= 0.98; p.vy *= 0.97; }
        if (p.k === 'dust') { p.vx *= 0.95; p.vy *= 0.95; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vr) p.rot += p.vr * dt;
      }
    }

    /* ---- colours ---------------------------------------------------- */
    zoneMix(y) {
      // returns [zoneA, zoneB, t] blending over the last 10 m of each zone
      const Z = C.ZONES;
      const z = LL.zoneAt(y);
      const i = z.id - 1;
      if (i < Z.length - 1 && y > z.y1 - 10) return [z, Z[i + 1], U.smooth((y - (z.y1 - 10)) / 10)];
      return [z, z, 0];
    }
    wallCol(y, shade) {
      const m = this.zoneMix(y);
      const a = U.mix(m[0].wall, m[0].wall2, shade);
      if (m[2] <= 0) return a;
      const b = U.mix(m[1].wall, m[1].wall2, shade);
      return mixRgb(a, b, m[2]);
    }
    holdCol(y) {
      const m = this.zoneMix(y);
      return m[2] > 0 ? U.mix(HOLD_COL[m[0].id], HOLD_COL[m[1].id], m[2]) : HOLD_COL[m[0].id];
    }
    skyCols(y) {
      const m = this.zoneMix(y);
      let top = m[0].sky[0], bot = m[0].sky[1];
      if (m[2] > 0) { top = U.mix(top, m[1].sky[0], m[2]); bot = U.mix(bot, m[1].sky[1], m[2]); }
      else { top = U.mix(top, top, 0); bot = U.mix(bot, bot, 0); }
      if (y > C.TOP - 60) {
        const k = U.smooth((y - (C.TOP - 60)) / 60);
        top = mixRgb(top, 'rgb(64,96,150)', k); bot = mixRgb(bot, 'rgb(240,196,128)', k);
      }
      return [top, bot];
    }

    /* ================================================================= */
    draw(sim, guide, opts) {
      opts = opts || {};
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cam = this.cam;
      const yTop = cam.y + cam.view / 2 + 1, yBot = cam.y - cam.view / 2 - 1;
      this.labels.length = 0;
      const level = sim.level;
      const fsDone = sim.fs.done;

      // --- sky ----
      this.screenT();
      const sky = this.skyCols(cam.y);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      this.drawBackdrop(cam);

      // --- wall ----
      this.worldT();
      this.drawWall(Math.max(yBot, -2), Math.min(yTop, C.TOP), 0, 0, null);
      // painted panels (drawn at a slightly different depth — the tell)
      for (const p of level.panels) {
        if (p.y2 < yBot || p.y1 > yTop) continue;
        if (!fsDone && p.y1 > level.veilY - 1.6) continue;
        this.drawPanel(p);
      }
      this.drawZoneDressing(yBot, yTop);
      this.drawWallShade(Math.max(yBot, -2), Math.min(yTop, C.TOP));
      this.drawMarkers(yBot, yTop, fsDone ? Infinity : level.veilY - 1.2);

      // ledges
      for (const l of level.ledges) {
        if (l.y < yBot - 0.5 || l.y > yTop + 0.5) continue;
        if (!fsDone && l.y > level.veilY - 1.2 && l.type !== 'fakeSummit') continue;
        this.drawLedge(l, sim);
      }

      // best height marker — on the wall, honest
      if (sim.best > 3 && sim.best < C.TOP) {
        const by = sim.best + 0.97;
        if (by > yBot && by < yTop) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = 0.02;
          ctx.setLineDash([0.18, 0.14]);
          ctx.beginPath(); ctx.moveTo(-C.WALL_HALF, by); ctx.lineTo(C.WALL_HALF, by); ctx.stroke();
          ctx.restore();
          this.label('best', -C.WALL_HALF + 0.35, by + 0.16, 'rgba(255,255,255,0.35)', 11, 'left');
        }
      }

      // holds
      const hs = level.holdsIn(yBot, yTop);
      const hover = this.hoverHolds(sim);
      for (const h of hs) {
        if (h.gone || level.isHidden(h, fsDone) || (h.tag === 'fsRail' && fsDone)) continue;
        this.drawHold(h, sim, hover.indexOf(h) >= 0);
      }

      // fake summit backdrop ("the sky") — until it falls away
      this.drawVeil(sim, yBot, yTop);
      for (const l of level.ledges) {
        if ((l.type === 'fakeSummit' && !l.broken) || l.type === 'summit') if (l.y > yBot - 3 && l.y < yTop) this.drawFlag(l);
      }

      // fx behind the climber
      this.drawFx();

      // climber
      this.drawClimber(sim);

      // narrator arrow
      const d = guide && guide.display();
      if (d && d.arrow) this.drawArrow(d.arrow, d.alpha);

      // cursor + trail
      if (!opts.hideCursor) this.drawCursor(sim);

      if (this.debug) this.drawDebug(sim, hs);

      // --- screen space ----
      this.screenT();
      this.flushLabels();
      this.drawVignette(sim);
      if (this.glitchActive(sim)) this.drawGlitch();
      this.drawHUD(sim);
      if (d) this.drawSubtitle(d);
      if (sim.fs.active) this.drawCredits(sim.fs.t);
      if (this.toast) this.drawToast();
      if (sim.finished) this.drawFinish(sim);
    }

    /* ---- background parallax ---------------------------------------- */
    drawBackdrop(cam) {
      const ctx = this.ctx, W = this.W, H = this.H, s = this.scale;
      const y = cam.y;
      // distant city at the foot of the wall
      if (y < 200) {
        const f = 0.1, k = 0.55;
        const baseY = H / 2 + (y * f + 2) * s * k;
        ctx.fillStyle = 'rgba(12,16,24,0.55)';
        for (let i = -30; i < 30; i++) {
          const bx = W / 2 + (i * 1.6 - cam.x * f) * s * k;
          if (bx < -80 || bx > W + 80) continue;
          const bh = (1.5 + U.hash2(i, 7) * 6) * s * k;
          const bw = (0.9 + U.hash2(i, 9) * 0.8) * s * k;
          ctx.fillRect(bx, baseY - bh, bw, bh + H);
          // a few lit windows
          if (U.hash2(i, 3) > 0.5) {
            ctx.fillStyle = 'rgba(255,214,150,0.18)';
            for (let w = 0; w < 5; w++) ctx.fillRect(bx + bw * 0.25, baseY - bh + (w + 1) * bh / 7, bw * 0.15, bh / 30);
            ctx.fillStyle = 'rgba(12,16,24,0.55)';
          }
        }
        // second, nearer row
        const f2 = 0.2, k2 = 0.8;
        const baseY2 = H / 2 + (y * f2 + 1.5) * s * k2;
        ctx.fillStyle = 'rgba(10,13,20,0.7)';
        for (let i = -25; i < 25; i++) {
          const bx = W / 2 + (i * 2.2 - cam.x * f2) * s * k2;
          if (bx < -120 || bx > W + 120) continue;
          const bh = (1 + U.hash2(i, 17) * 4) * s * k2;
          const bw = (1.2 + U.hash2(i, 19)) * s * k2;
          ctx.fillRect(bx, baseY2 - bh, bw, bh + H);
        }
      }
      // clouds
      if (y > 90) {
        const f = 0.3;
        for (let i = 0; i < 40; i++) {
          const cy = 30 + i * 14;           // layer-space height
          const sy = H / 2 - (cy - y * f) * s * 0.6;
          if (sy < -120 || sy > H + 120) continue;
          const cx = (U.hash2(i, 1) - 0.5) * 30;
          const sx = W / 2 + (cx - cam.x * f) * s * 0.6 + Math.sin(this.t * 0.02 + i) * 30;
          const w = (2 + U.hash2(i, 2) * 4) * s * 0.6;
          const a = 0.05 + 0.07 * U.clamp((y - 90) / 120, 0, 1);
          ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
          ctx.beginPath();
          ctx.ellipse(sx, sy, w, w * 0.22, 0, 0, Math.PI * 2);
          ctx.ellipse(sx + w * 0.4, sy - w * 0.08, w * 0.5, w * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // stars in the glitch night
      if (y > 300 && y < 520) {
        const a = U.clamp((y - 300) / 40, 0, 1) * U.clamp((520 - y) / 40, 0, 1);
        ctx.fillStyle = 'rgba(220,255,245,' + (0.5 * a) + ')';
        for (let i = 0; i < 90; i++) {
          const sx = U.hash2(i, 11) * W;
          const sy = ((U.hash2(i, 12) * H * 2 + y * 3) % (H * 1.2)) - H * 0.1;
          const tw = 0.6 + 0.4 * Math.sin(this.t * 2 + i);
          ctx.fillRect(sx, sy, 1.5 * tw, 1.5 * tw);
        }
      }
      this.drawSun(y);
    }

    drawSun(y) {
      const ctx = this.ctx, W = this.W, H = this.H;
      if (y > 470) {
        const a = U.clamp((y - 470) / 60, 0, 1);
        const sx = W * 0.78, sy = H * 0.2;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.35);
        g.addColorStop(0, 'rgba(255,236,190,' + 0.55 * a + ')');
        g.addColorStop(0.15, 'rgba(255,214,150,' + 0.25 * a + ')');
        g.addColorStop(1, 'rgba(255,200,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }

    /* ---- the wall ----------------------------------------------------- */
    drawWall(y0, y1, offX, offY, clip) {
      const ctx = this.ctx;
      const N = 10, cw = (C.WALL_HALF * 2) / N, ch = 1.25;
      const WH = C.WALL_HALF;
      const vx = (i, j) => (i <= 0 ? -WH : i >= N ? WH : -WH + i * cw + (U.hash2(i, j) - 0.5) * 0.7 * cw) + offX;
      const vy = (i, j) => j * ch + (U.hash2(i + 71, j) - 0.5) * 0.7 * ch + offY;
      const j0 = Math.floor(y0 / ch) - 1, j1 = Math.ceil(y1 / ch) + 1;
      ctx.save();
      if (clip) { ctx.beginPath(); ctx.rect(clip.x1, clip.y1, clip.x2 - clip.x1, clip.y2 - clip.y1); ctx.clip(); }
      else { ctx.beginPath(); ctx.rect(-WH, -3, WH * 2, C.TOP + 3); ctx.clip(); }
      for (let j = j0; j < j1; j++) {
        for (let i = 0; i < N; i++) {
          const ax = vx(i, j), ay = vy(i, j), bx = vx(i + 1, j), by = vy(i + 1, j);
          const cx = vx(i, j + 1), cy = vy(i, j + 1), dx = vx(i + 1, j + 1), dy = vy(i + 1, j + 1);
          const diag = U.hash2(i + 13, j + 7) < 0.5;
          const s1 = U.hash2(i * 3 + 1, j * 5 + 2), s2 = U.hash2(i * 7 + 3, j * 11 + 5);
          const yc = (ay + dy) / 2;
          ctx.fillStyle = this.wallCol(yc, s1);
          ctx.beginPath();
          if (diag) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(dx, dy); }
          else { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = this.wallCol(yc, s2 * 0.8 + 0.1);
          ctx.beginPath();
          if (diag) { ctx.moveTo(ax, ay); ctx.lineTo(dx, dy); ctx.lineTo(cx, cy); }
          else { ctx.moveTo(bx, by); ctx.lineTo(dx, dy); ctx.lineTo(cx, cy); }
          ctx.closePath(); ctx.fill();

          // Zone 4: flickering pixel blocks
          const z4 = this.zoneWeight(yc, 4);
          if (z4 > 0) {
            const q = Math.floor(this.t * 6);
            if (U.hash2(i * 31 + q, j * 17) < 0.07 * z4) {
              const px = (ax + dx) / 2, py = (ay + dy) / 2, b = 0.18;
              ctx.fillStyle = U.hash2(i, j + q) < 0.5 ? 'rgba(111,240,198,0.35)' : 'rgba(255,90,160,0.25)';
              for (let k = 0; k < 5; k++) ctx.fillRect(px + (U.hash2(k, i + q) - 0.5) * cw * 0.6, py + (U.hash2(j, k + q) - 0.5) * ch * 0.6, b, b);
            }
          }
        }
      }
      // Zone 2: sleek white panels set into the stone (second pass, on top of the facets)
      for (let j = j0; j < j1; j++) {
        for (let i = 0; i < N; i++) {
          const ax = vx(i, j), ay = vy(i, j), dx = vx(i + 1, j + 1), dy = vy(i + 1, j + 1);
          const yc = (ay + dy) / 2;
          const z2 = this.zoneWeight(yc, 2);
          if (z2 > 0 && U.hash2(i + 5, j + 3) < 0.075 * z2) {
            const px = (ax + dx) / 2, py = (ay + dy) / 2;
            const pw = cw * (0.35 + 0.3 * U.hash2(i, j + 9)), ph = ch * (0.5 + 0.35 * U.hash2(i + 2, j));
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            roundRect(ctx, px - pw / 2 + 0.04, py - ph / 2 - 0.05, pw, ph, 0.06);
            ctx.fill();
            const pg = ctx.createLinearGradient(px, py + ph / 2, px, py - ph / 2);
            pg.addColorStop(0, 'rgba(240,237,230,0.78)');
            pg.addColorStop(1, 'rgba(214,210,202,0.7)');
            ctx.fillStyle = pg;
            roundRect(ctx, px - pw / 2, py - ph / 2, pw, ph, 0.06);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    // Edge shading + ground: drawn after painted panels so they share it.
    drawWallShade(y0, y1) {
      const ctx = this.ctx, WH = C.WALL_HALF;
      const a = Math.max(y0, -3), h = Math.min(y1, C.TOP) - a;
      const g = ctx.createLinearGradient(-WH, 0, WH, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.08, 'rgba(0,0,0,0)');
      g.addColorStop(0.92, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(-WH, a, WH * 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-WH - 0.12, a, 0.12, h);
      ctx.fillRect(WH, a, 0.12, h);
      if (y0 < 0.5) {
        ctx.fillStyle = '#20252c';
        ctx.fillRect(-60, -6, 120, 6);
        ctx.fillStyle = '#2b313a';
        ctx.fillRect(-60, -0.08, 120, 0.08);
      }
    }

    zoneWeight(y, id) {
      const m = this.zoneMix(y);
      let w = 0;
      if (m[0].id === id) w += 1 - m[2];
      if (m[1].id === id && m[2] > 0) w += m[2];
      return w;
    }

    drawZoneDressing(y0, y1) {
      const ctx = this.ctx, WH = C.WALL_HALF;
      // Zone 3: it's a film set — scaffolding at the edges and stage lights
      const mid = (y0 + y1) / 2;
      const z3 = Math.max(this.zoneWeight(y0, 3), this.zoneWeight(y1, 3));
      if (z3 > 0) {
        ctx.save();
        ctx.globalAlpha = z3;
        ctx.strokeStyle = '#3a3440';
        ctx.lineWidth = 0.07;
        for (const sx of [-WH - 0.45, WH + 0.45]) {
          ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(sx + Math.sign(sx) * 0.6, y0); ctx.lineTo(sx + Math.sign(sx) * 0.6, y1); ctx.stroke();
          for (let y = Math.floor(y0 / 2) * 2; y < y1; y += 2) {
            ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + Math.sign(sx) * 0.6, y + 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + Math.sign(sx) * 0.6, y); ctx.stroke();
          }
        }
        // stage lights: warm pools on the rock
        ctx.globalCompositeOperation = 'lighter';
        for (let k = Math.floor(y0 / 12) - 1; k <= Math.ceil(y1 / 12); k++) {
          const ly = k * 12 + 4;
          if (this.zoneWeight(ly, 3) <= 0) continue;
          const lx = (k % 2 ? -1 : 1) * 3.5;
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 5);
          g.addColorStop(0, 'rgba(255,190,110,0.16)'); g.addColorStop(1, 'rgba(255,190,110,0)');
          ctx.fillStyle = g;
          ctx.fillRect(lx - 5, ly - 5, 10, 10);
          // the lamp itself, on the scaffold
          ctx.fillStyle = 'rgba(255,220,160,0.8)';
          ctx.beginPath(); ctx.arc(Math.sign(lx) * (WH + 0.75), ly + 3, 0.12, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      // Zone 5: warm light washing down from the summit
      const z5 = this.zoneWeight(mid, 5);
      if (z5 > 0) {
        const g = ctx.createLinearGradient(0, y1, 0, y0);
        g.addColorStop(0, 'rgba(255,210,140,' + 0.16 * z5 + ')');
        g.addColorStop(1, 'rgba(255,210,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-WH, y0, WH * 2, Math.min(y1, C.TOP) - y0);
      }
      // Zone 4: scanlines
      const z4 = this.zoneWeight(mid, 4);
      if (z4 > 0) {
        ctx.fillStyle = 'rgba(0,0,0,' + 0.12 * z4 + ')';
        for (let y = Math.floor(y0 * 5) / 5; y < y1; y += 0.2) ctx.fillRect(-WH, y, WH * 2, 0.05);
      }
    }

    drawMarkers(y0, y1, maxY) {
      const ctx = this.ctx, WH = C.WALL_HALF;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let m = Math.ceil(y0 / 10) * 10; m <= y1; m += 10) {
        if (m <= 0 || m > maxY) continue;
        const wy = m + 0.97;
        const big = m % 50 === 0;
        ctx.fillRect(-WH, wy - 0.015, big ? 0.9 : 0.4, 0.03);
        ctx.fillRect(WH - (big ? 0.9 : 0.4), wy - 0.015, big ? 0.9 : 0.4, 0.03);
        if (big) {
          this.label(m + ' m', -WH + 1.05, wy, 'rgba(255,255,255,0.32)', 12, 'left');
          this.label(m + ' m', WH - 1.05, wy, 'rgba(255,255,255,0.32)', 12, 'right');
        }
      }
    }

    panelOffset(p) {
      // The painted backdrop sits at a slightly different depth: it drifts against the rock.
      const cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2;
      return { x: (this.cam.x - cx) * 0.035, y: (this.cam.y - cy) * 0.02 };
    }

    drawPanel(p) {
      const ctx = this.ctx;
      const o = this.panelOffset(p);
      const r = { x1: p.x1 + o.x, y1: p.y1 + o.y, x2: p.x2 + o.x, y2: p.y2 + o.y };
      // behind the backdrop: scaffolding (only seen through tears)
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1); ctx.clip();
      this.drawWall(r.y1, r.y2, o.x, o.y, r);
      // tears
      for (const t of p.tears) {
        const tx = t.x + o.x, ty = t.y + o.y;
        ctx.save();
        ctx.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2, rr = t.r * (0.6 + 0.5 * U.hash2(k, Math.floor(t.s * 1000)));
          const px = tx + Math.cos(a) * rr, py = ty + Math.sin(a) * rr;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#15121a';
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = '#6c6272';
        ctx.lineWidth = 0.04;
        for (let sx = Math.floor(tx - 1); sx < tx + 1; sx += 0.35) { ctx.beginPath(); ctx.moveTo(sx, ty - 1); ctx.lineTo(sx + 0.5, ty + 1); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(tx - 1, ty); ctx.lineTo(tx + 1, ty); ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = 'rgba(230,215,190,0.8)';
        ctx.lineWidth = 0.02;
        ctx.stroke();
      }
      ctx.restore();
    }

    drawLedge(l, sim) {
      const ctx = this.ctx;
      let ox = 0, oy = 0;
      if (l.type === 'painted') {
        const p = sim.level.panelAt((l.x1 + l.x2) / 2, l.y);
        if (p) { const o = this.panelOffset(p); ox = o.x; oy = o.y; }
      }
      const x1 = l.x1 + ox, x2 = l.x2 + ox, y = l.y + oy;
      if (l.type === 'ground') return;
      if (l.type === 'net') {
        ctx.strokeStyle = 'rgba(230,220,200,0.55)';
        ctx.lineWidth = 0.025;
        const sag = 0.18;
        ctx.beginPath();
        for (let x = x1; x <= x2 + 0.01; x += 0.25) {
          const t = (x - x1) / (x2 - x1), yy = y - Math.sin(t * Math.PI) * sag;
          ctx.moveTo(x, yy); ctx.lineTo(x + 0.12, yy - 0.3);
          ctx.moveTo(x + 0.25, yy); ctx.lineTo(x + 0.12, yy - 0.3);
        }
        ctx.stroke();
        ctx.lineWidth = 0.05;
        ctx.strokeStyle = 'rgba(240,230,210,0.8)';
        ctx.beginPath();
        for (let x = x1; x <= x2 + 0.01; x += 0.1) { const t = (x - x1) / (x2 - x1); const yy = y - Math.sin(t * Math.PI) * sag; x === x1 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
        ctx.stroke();
        ctx.fillStyle = '#3a3440';
        ctx.fillRect(x1 - 0.06, y - 0.6, 0.08, 0.7); ctx.fillRect(x2 - 0.02, y - 0.6, 0.08, 0.7);
        return;
      }
      if (l.broken) {
        // stubs of the fake summit
        ctx.fillStyle = '#6f624f';
        ctx.fillRect(-C.WALL_HALF, y - 0.3, 0.5, 0.3);
        ctx.fillRect(C.WALL_HALF - 0.5, y - 0.3, 0.5, 0.3);
        return;
      }
      const th = l.type === 'summit' ? 0.6 : l.type === 'fakeSummit' ? 0.45 : 0.26;
      const col = l.type === 'summit' ? '#d8c29a' : l.type === 'fakeSummit' ? '#d4bd92' : this.wallCol(l.y, 0.9);
      // soft shadow under the slab
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(ctx, x1 + 0.05, y - th - 0.12, x2 - x1, th, 0.1); ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, x1, y - th, x2 - x1, th, 0.1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, x1, y - 0.06, x2 - x1, 0.06, 0.03); ctx.fill();
    }

    // A flag on each summit (drawn after the painted sky). The real one is quieter.
    drawFlag(l) {
      const ctx = this.ctx, y = l.y;
      const fx = l.type === 'summit' ? 2.2 : 1.2;
      ctx.fillStyle = '#3b3530';
      ctx.fillRect(fx, y, 0.06, 2.2);
      const wave = Math.sin(this.t * 3) * 0.06;
      ctx.fillStyle = l.type === 'summit' ? '#e9e4da' : '#f3c56b';
      ctx.beginPath(); ctx.moveTo(fx + 0.06, y + 2.2); ctx.lineTo(fx + 0.9, y + 1.95 + wave); ctx.lineTo(fx + 0.06, y + 1.7); ctx.fill();
    }

    /* ---- holds -------------------------------------------------------- */
    hoverHolds(sim) {
      const out = [];
      for (let h = 0; h < 2; h++) {
        if (sim.hands[h].state !== 'reach') continue;
        const p = sim.handPos(h);
        const hold = sim.holdAt(p.x, p.y);
        if (hold) out.push(hold);
      }
      return out;
    }

    drawHold(h, sim, hover) {
      const ctx = this.ctx;
      let x = h.x, y = h.y;
      if (h.type === 'painted') {
        const p = sim.level.panelAt(h.x0, h.y0);
        if (p) { const o = this.panelOffset(p); x += o.x; y += o.y; }
      }
      if (h.type === 'shy' && !h.tamed && h.wob > 0.01) {
        // the tell: a tiny nervous wobble
        x += Math.sin(this.t * 38 + h.seed * 10) * 0.018 * h.wob;
        y += Math.cos(this.t * 29 + h.seed * 7) * 0.01 * h.wob;
      }
      let crumble = 0;
      if (h.type === 'fake' && h.crumbleT >= 0) { crumble = 1 - h.crumbleT / 0.5; x += (Math.random() - 0.5) * 0.02 * crumble; }
      const sharp = h.type === 'fake' || h.type === 'tellLie';
      const r = h.r;
      const col = this.holdCol(h.y0);
      // ambient shadow — real holds (and painted ones) have it; the fakes don't
      if (!sharp) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(x + 0.03, y - 0.06, r * 1.18, r * 1.0, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.beginPath(); ctx.ellipse(x + 0.04, y - 0.09, r * 1.35, r * 1.1, 0, 0, Math.PI * 2); ctx.fill();
      }
      // body
      ctx.beginPath();
      const n = sharp ? 6 : 8;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + h.seed * 6;
        const rr = r * (0.86 + 0.28 * U.hash2(k, Math.floor(h.seed * 1e6)));
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85]);
      }
      if (sharp) {
        pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      } else {
        for (let k = 0; k < n; k++) {
          const p = pts[k], q = pts[(k + 1) % n];
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          if (k === 0) { const l = pts[n - 1]; ctx.moveTo((l[0] + p[0]) / 2, (l[1] + p[1]) / 2); }
          ctx.quadraticCurveTo(p[0], p[1], mx, my);
        }
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(x, y + r, x, y - r);
      g.addColorStop(0, lighten(col, 0.18));
      g.addColorStop(1, darken(col, 0.22));
      ctx.fillStyle = g;
      ctx.globalAlpha = 1 - crumble * 0.4;
      ctx.fill();
      ctx.globalAlpha = 1;
      // subtle glow rim
      ctx.strokeStyle = hover ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = hover ? 0.03 : 0.015;
      ctx.stroke();
      if (h.respawnT > 0 && h.respawnT < 0.6) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (h.respawnT / 0.6) + ')';
        ctx.stroke();
      }
    }

    /* ---- the fake summit's painted sky ---------------------------------- */
    drawVeil(sim, y0, y1) {
      const level = sim.level;
      if (level.veilY === Infinity) return;
      const fs = sim.fs;
      const base = level.veilY - 0.6;
      let drop = 0, alpha = 1, rot = 0;
      if (fs.done) {
        const t = fs.collapseT;
        if (t > 4) return;
        drop = 0.5 * 9.8 * t * t * 0.5;
        alpha = U.clamp(1 - t / 4, 0, 1);
        rot = t * 0.03;
      }
      if (base - drop > y1) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(0, -drop);
      ctx.rotate(rot);
      // Paint the "sky" with exactly what the real sky behind looks like right now,
      // so the wall seems to simply end here.
      ctx.beginPath();
      ctx.rect(-C.WALL_HALF - 0.15, base, C.WALL_HALF * 2 + 0.3, 60);
      ctx.clip();
      this.screenT();
      const sky = this.skyCols(this.cam.y);
      const g = ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
      this.drawSun(this.cam.y);
      ctx.restore();
    }

    /* ---- climber ------------------------------------------------------ */
    drawClimber(sim) {
      const ctx = this.ctx, b = sim.body;
      const X = b.x, Y = b.y;
      const body = C.BODY, shade = '#b9b3a8';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // legs (dead weight)
      ctx.strokeStyle = shade;
      ctx.lineWidth = 0.15;
      for (const [hp, kn, ft] of [[P.lHip, P.lKnee, P.lFoot], [P.rHip, P.rKnee, P.rFoot]]) {
        ctx.beginPath(); ctx.moveTo(X[hp], Y[hp]); ctx.lineTo(X[kn], Y[kn]); ctx.lineTo(X[ft], Y[ft]); ctx.stroke();
      }
      ctx.fillStyle = '#8d877d';
      for (const ft of [P.lFoot, P.rFoot]) { ctx.beginPath(); ctx.arc(X[ft], Y[ft], 0.075, 0, Math.PI * 2); ctx.fill(); }
      // arms behind torso: upper arm + forearm via IK
      const handDraw = [];
      for (let h = 0; h < 2; h++) {
        const arm = b.arms[h];
        let hx = X[arm.hand], hy = Y[arm.hand];
        // trembling: the honest tell of a tired arm
        const st = sim.hands[h].st;
        if (st < 0.3 && sim.hands[h].state === 'grip') {
          const k = (0.3 - st) / 0.3;
          hx += Math.sin(this.t * 55 + h * 3) * 0.018 * k;
          hy += Math.cos(this.t * 47 + h) * 0.014 * k;
        }
        const sx = X[arm.sh], sy = Y[arm.sh];
        const e = elbow(sx, sy, hx, hy, 0.56, h === 0 ? 1 : -1);
        ctx.strokeStyle = body;
        ctx.lineWidth = 0.12;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(e.x, e.y); ctx.lineTo(hx, hy); ctx.stroke();
        handDraw.push([hx, hy]);
      }
      // torso
      ctx.fillStyle = body;
      ctx.strokeStyle = body;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(X[P.lSh], Y[P.lSh]); ctx.lineTo(X[P.rSh], Y[P.rSh]);
      ctx.lineTo(X[P.rHip], Y[P.rHip]); ctx.lineTo(X[P.lHip], Y[P.lHip]); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // a faint spine line so the back reads
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.025;
      ctx.beginPath(); ctx.moveTo(X[P.neck], Y[P.neck]); ctx.lineTo(X[P.pelvis], Y[P.pelvis]); ctx.stroke();
      // head: faceless
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(X[P.head], Y[P.head], 0.14, 0, Math.PI * 2); ctx.fill();
      // gloves
      for (let h = 0; h < 2; h++) {
        const [hx, hy] = handDraw[h];
        const col = h === 0 ? C.GLOVE_L : C.GLOVE_R;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(hx, hy, 0.085, 0, Math.PI * 2); ctx.fill();
        if (sim.hands[h].state === 'grip') {
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.beginPath(); ctx.arc(hx - 0.02, hy + 0.025, 0.035, 0, Math.PI * 2); ctx.fill();
        }
        if (this.glint > 0) {
          // swapped hands tell: a glint running over each glove
          const gl = this.glint;
          ctx.strokeStyle = 'rgba(255,255,255,' + gl + ')';
          ctx.lineWidth = 0.02;
          ctx.beginPath(); ctx.arc(hx, hy, 0.09 + (1 - gl) * 0.25, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,' + gl * 0.9 + ')';
          const a = (1 - gl) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(hx + Math.cos(a) * 0.06, hy + Math.sin(a) * 0.06, 0.02, 0, Math.PI * 2); ctx.fill();
        }
      }
      // stamina lines at the shoulders (the bar can lie; the trembling can't)
      for (let h = 0; h < 2; h++) {
        const arm = b.arms[h];
        const sx = X[arm.sh], sy = Y[arm.sh] + 0.17;
        const sh = sim.hands[h].shown;
        const w = 0.34, dir = h === 0 ? -1 : 1;
        const x0 = sx - (dir < 0 ? w * 0.75 : w * 0.25);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x0, sy, w, 0.03);
        ctx.fillStyle = sh < 0.25 ? '#ff6b6b' : (h === 0 ? C.GLOVE_L : C.GLOVE_R);
        if (dir < 0) ctx.fillRect(x0 + w * (1 - sh), sy, w * sh, 0.03);
        else ctx.fillRect(x0, sy, w * sh, 0.03);
      }
    }

    drawCursor(sim) {
      const ctx = this.ctx;
      const cw = sim.cursorWorld();
      // trail rebuilt from raw mouse motion: under a mirrored cursor it tilts the wrong way
      const hist = sim.rawHist;
      let px = cw.x, py = cw.y;
      ctx.lineCap = 'round';
      const steps = hist.length / 2;
      for (let k = steps - 1, n = 0; k >= 0 && n < 18; k--, n++) {
        const nx = px - hist[k * 2] * 1.6, ny = py - hist[k * 2 + 1] * 1.6;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 * (1 - n / 18)) + ')';
        ctx.lineWidth = 0.035 * (1 - n / 18);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        px = nx; py = ny;
      }
      const reach = [sim.hands[0].state === 'reach', sim.hands[1].state === 'reach'];
      // reach circle
      for (let h = 0; h < 2; h++) {
        if (!reach[h]) continue;
        const s = sim.shoulderPos(h);
        ctx.strokeStyle = U.rgba(h === 0 ? C.GLOVE_L : C.GLOVE_R, 0.12);
        ctx.lineWidth = 0.02;
        ctx.beginPath(); ctx.arc(s.x, s.y, C.ARM_MAX, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.lineWidth = 0.03;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(cw.x, cw.y, 0.09, 0, Math.PI * 2); ctx.stroke();
      if (reach[0] || reach[1]) {
        ctx.fillStyle = reach[0] && reach[1] ? '#ffffff' : reach[0] ? C.GLOVE_L : C.GLOVE_R;
        ctx.beginPath(); ctx.arc(cw.x, cw.y, 0.05, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawArrow(h, alpha) {
      const ctx = this.ctx;
      const bob = Math.sin(this.t * 4) * 0.08;
      const x = h.x, y = h.y + h.r + 0.35 + bob;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = 'rgba(255,240,180,0.9)';
      ctx.shadowBlur = 12 * this.dpr;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.moveTo(x, y - 0.14);
      ctx.lineTo(x - 0.16, y + 0.06); ctx.lineTo(x - 0.06, y + 0.06);
      ctx.lineTo(x - 0.06, y + 0.3); ctx.lineTo(x + 0.06, y + 0.3);
      ctx.lineTo(x + 0.06, y + 0.06); ctx.lineTo(x + 0.16, y + 0.06);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    drawFx() {
      const ctx = this.ctx;
      for (const p of this.fx) {
        const a = U.clamp(p.life / p.max, 0, 1) * (p.a || 1);
        if (p.k === 'dust') {
          ctx.fillStyle = U.rgba('#d9d2c4', 0.25 * a);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1.8 - a), 0, Math.PI * 2); ctx.fill();
        } else if (p.k === 'spark') {
          ctx.fillStyle = 'rgba(255,244,200,' + a + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalAlpha = a;
          ctx.fillStyle = p.c;
          if (p.k === 'paper') ctx.fillRect(-p.s, -p.s * 0.6, p.s * 2, p.s * 1.2);
          else { ctx.beginPath(); ctx.moveTo(-p.s, -p.s); ctx.lineTo(p.s, -p.s * 0.4); ctx.lineTo(0, p.s); ctx.closePath(); ctx.fill(); }
          ctx.restore();
        }
      }
    }

    drawDebug(sim, hs) {
      const ctx = this.ctx;
      const col = { fake: '#ff4d4d', shy: '#ffd84d', painted: '#c77dff', tellLie: '#4dff88' };
      ctx.lineWidth = 0.03;
      for (const h of hs) {
        if (h.type === 'normal') continue;
        ctx.strokeStyle = col[h.type] || '#fff';
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 0.07, 0, Math.PI * 2); ctx.stroke();
      }
      for (const p of sim.level.panels) {
        ctx.strokeStyle = '#c77dff';
        ctx.strokeRect(p.x1, p.y1, p.x2 - p.x1, p.y2 - p.y1);
      }
    }

    /* ---- screen space --------------------------------------------------- */
    label(text, x, y, col, size, align) {
      this.labels.push({ text, x, y, col, size, align });
    }
    flushLabels() {
      const ctx = this.ctx;
      for (const l of this.labels) {
        const p = this.toScreen(l.x, l.y);
        ctx.font = '500 ' + l.size + 'px Inter, ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = l.align || 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = l.col;
        ctx.fillText(l.text, p.x, p.y);
      }
    }

    drawVignette(sim) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // speed lines while falling (real or fake)
      const v = sim.body.chestVel();
      const fall = Math.max(U.clamp((-v.y - 8) / 12, 0, 1), this.fakeFallT > 0 ? this.fakeFallT / 1.35 : 0);
      if (fall > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,' + 0.12 * fall + ')';
        ctx.lineWidth = 1;
        for (let i = 0; i < 24; i++) {
          const x = U.hash2(i, Math.floor(this.t * 20)) * W;
          const y = U.hash2(i + 9, Math.floor(this.t * 20)) * H;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 40 - 80 * fall); ctx.stroke();
        }
      }
      if (sim.fs.active) {
        ctx.fillStyle = 'rgba(20,14,8,' + U.clamp(sim.fs.t / 3, 0, 0.55) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }

    glitchActive(sim) {
      if (sim.zone !== 4) return this.glitch > 0;
      if (this.t > this.nextGlitch) { this.glitch = 0.12 + Math.random() * 0.12; this.nextGlitch = this.t + 2 + Math.random() * 5; }
      return this.glitch > 0;
    }

    drawGlitch() {
      const ctx = this.ctx, cv = this.cv;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let i = 0; i < 6; i++) {
        const h = Math.floor(8 + Math.random() * 40) * this.dpr;
        const y = Math.floor(Math.random() * (cv.height - h));
        const dx = Math.floor((Math.random() - 0.5) * 50 * this.dpr);
        ctx.drawImage(cv, 0, y, cv.width, h, dx, y, cv.width, h);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(111,240,198,0.05)';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.globalCompositeOperation = 'source-over';
      this.screenT();
    }

    drawHUD(sim) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const x = W - 34, top = H * 0.14, bot = H * 0.86;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      // zone ticks
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (const z of C.ZONES) { const y = U.lerp(bot, top, z.y0 / C.TOP); ctx.fillRect(x - 4, y, 8, 1); }
      ctx.fillRect(x - 6, top, 12, 1);
      const shown = sim.shownHeight();
      const my = U.lerp(bot, top, U.clamp(shown / C.TOP, 0, 1));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, my, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(Math.floor(shown) + ' m', x - 10, my);
      ctx.font = '500 10px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(LL.zoneAt(sim.height()).name.toUpperCase(), x - 10, my + 14);
    }

    drawSubtitle(d) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const maxW = Math.min(620, W - 80);
      ctx.save();
      ctx.globalAlpha = d.alpha;
      ctx.font = '400 18px Inter, ui-sans-serif, system-ui, sans-serif';
      const lines = wrap(ctx, d.full, maxW);
      // type the visible part into the wrapped layout
      let remaining = d.text.length;
      const lh = 26;
      const y0 = H - 60 - (lines.length - 1) * lh;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 10px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(243,197,107,0.75)';
      ctx.fillText('T H E   G U I D E', W / 2, y0 - 26);
      ctx.font = '400 18px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(245,242,235,0.95)';
      lines.forEach((ln, i) => {
        const vis = ln.slice(0, Math.max(0, remaining));
        remaining -= ln.length + 1;
        if (!vis) return;
        const full = ctx.measureText(ln).width;
        ctx.textAlign = 'left';
        ctx.fillText(vis, W / 2 - full / 2, y0 + i * lh);
      });
      ctx.restore();
    }

    drawCredits(t) {
      const ctx = this.ctx, W = this.W, H = this.H;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const speed = 60;
      let y = H + 40 - t * speed;
      for (const [role, name] of CREDITS) {
        if (role) {
          ctx.font = '500 11px Inter, ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(243,197,107,0.8)';
          ctx.fillText(role.toUpperCase(), W / 2, y);
          ctx.font = '400 20px Inter, ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255,250,240,0.95)';
          ctx.fillText(name, W / 2, y + 24);
          y += 72;
        } else {
          ctx.font = name === 'LIAR\'S LEDGE' ? '300 44px Inter, ui-sans-serif, system-ui, sans-serif' : '400 18px Inter, ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255,250,240,0.95)';
          if (name) ctx.fillText(name, W / 2, y);
          y += 56;
        }
      }
      ctx.restore();
    }

    drawToast() {
      const ctx = this.ctx, W = this.W;
      const t = this.toast.t, z = this.toast.zone;
      const a = t < 0.8 ? t / 0.8 : t > 4 ? 1 - (t - 4) : 1;
      ctx.save();
      ctx.globalAlpha = U.clamp(a, 0, 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '500 11px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = z.accent;
      ctx.fillText('ZONE ' + z.id + '  ·  ' + z.y0 + ' M', W / 2, 70);
      ctx.font = '300 34px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(z.name, W / 2, 104);
      ctx.restore();
    }

    drawFinish(sim) {
      const t = sim.time - sim.finishT;
      if (t < 6) return;
      const ctx = this.ctx, W = this.W, H = this.H;
      const a = U.clamp((t - 6) / 4, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '300 40px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText('600 m', W / 2, H * 0.3);
      ctx.font = '400 14px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(U.fmtTime(sim.finishT) + '   ·   ' + sim.falls + ' falls   ·   ' + sim.dynos + ' dynos', W / 2, H * 0.3 + 40);
      ctx.restore();
    }
  }

  /* ---- helpers ---------------------------------------------------------- */
  function elbow(sx, sy, hx, hy, seg, side) {
    const dx = hx - sx, dy = hy - sy, d = Math.hypot(dx, dy) || 1e-6;
    const mx = (sx + hx) / 2, my = (sy + hy) / 2;
    if (d >= seg * 2) return { x: mx, y: my };
    const h = Math.sqrt(seg * seg - (d / 2) * (d / 2));
    // elbows point outward and slightly down
    let nx = -dy / d, ny = dx / d;
    if (nx * -side < 0) { nx = -nx; ny = -ny; }
    return { x: mx + nx * h, y: my + ny * h - h * 0.15 };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function parseRgb(c) {
    if (c[0] === '#') return U.hex(c);
    const m = c.match(/\d+(\.\d+)?/g);
    return [+m[0], +m[1], +m[2]];
  }
  function mixRgb(a, b, t) {
    const x = parseRgb(a), y = parseRgb(b);
    return 'rgb(' + Math.round(U.lerp(x[0], y[0], t)) + ',' + Math.round(U.lerp(x[1], y[1], t)) + ',' + Math.round(U.lerp(x[2], y[2], t)) + ')';
  }
  function lighten(c, k) { const x = parseRgb(c); return 'rgb(' + x.map((v) => Math.round(v + (255 - v) * k)).join(',') + ')'; }
  function darken(c, k) { const x = parseRgb(c); return 'rgb(' + x.map((v) => Math.round(v * (1 - k))).join(',') + ')'; }

  function wrap(ctx, text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  Renderer.roundRect = roundRect;
  LL.Renderer = Renderer;
})(globalThis.LL = globalThis.LL || {});
