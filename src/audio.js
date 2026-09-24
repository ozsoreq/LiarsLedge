/* Liar's Ledge — sound. Everything is synthesised with WebAudio: no assets.
 * Each trick has a signature sound so players can learn them by ear, and the
 * grip hum is honest: it plays while a hand really holds, whatever the screen says. */
(function (LL) {
  'use strict';

  const U = LL.U;
  // D major-ish lo-fi progression (MIDI note numbers).
  const CHORDS = [
    [50, 57, 61, 64, 69], // Dmaj9-ish
    [47, 54, 57, 62, 66], // Bm7
    [43, 50, 54, 59, 64], // Gmaj7
    [45, 52, 57, 61, 64]  // A6
  ];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.volume = 0.8;
      this.chord = 0;
      this.nextChord = 0;
      this.nextPluck = 0;
      this.musicLevel = 1;
      this.silenced = false;
      this.credits = false;
      this.height = 0;
      this.zone = 1;
    }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
      this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
      this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 1400;
      this.musicFilter.connect(this.music);

      // noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      // wind / fall whoosh
      this.wind = this._loopNoise();
      this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.7;
      this.windG = ctx.createGain(); this.windG.gain.value = 0;
      this.wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.sfx);

      // grip hum: a soft two-tone drone plus a creak of filtered noise
      this.humG = ctx.createGain(); this.humG.gain.value = 0;
      this.humF = ctx.createBiquadFilter(); this.humF.type = 'highpass'; this.humF.frequency.value = 60;
      this.humF.connect(this.humG); this.humG.connect(this.sfx);
      for (const f of [98, 147.5]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0.5;
        o.connect(g); g.connect(this.humF); o.start();
      }
      const cr = this._loopNoise();
      const crF = ctx.createBiquadFilter(); crF.type = 'bandpass'; crF.frequency.value = 520; crF.Q.value = 6;
      const crG = ctx.createGain(); crG.gain.value = 0.35;
      cr.connect(crF); crF.connect(crG); crG.connect(this.humF);
      this.humCreak = crF;

      // vinyl hiss for the lo-fi bed
      const hs = this._loopNoise();
      const hsF = ctx.createBiquadFilter(); hsF.type = 'highpass'; hsF.frequency.value = 5000;
      this.hissG = ctx.createGain(); this.hissG.gain.value = 0.012;
      hs.connect(hsF); hsF.connect(this.hissG); this.hissG.connect(this.music);

      this.nextChord = ctx.currentTime + 0.2;
      this.nextPluck = ctx.currentTime + 1.5;
    }

    _loopNoise() {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise; s.loop = true;
      s.start(0, Math.random() * 1.5);
      return s;
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }

    /* ---- primitives ---- */
    _env(g, t, a, peak, dec) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    }
    tone(freq, dur, o) {
      if (!this.ctx) return;
      o = o || {};
      const ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      const g = ctx.createGain();
      this._env(g, t, o.a || 0.004, o.vol || 0.2, dur);
      osc.connect(g); g.connect(o.bus || this.sfx);
      osc.start(t); osc.stop(t + dur + 0.1);
    }
    burst(dur, o) {
      if (!this.ctx) return;
      o = o || {};
      const ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = o.ftype || 'bandpass';
      f.frequency.setValueAtTime(o.f || 1500, t);
      if (o.fto) f.frequency.exponentialRampToValueAtTime(o.fto, t + dur);
      f.Q.value = o.q || 1;
      const g = ctx.createGain();
      this._env(g, t, o.a || 0.002, o.vol || 0.2, dur);
      s.connect(f); f.connect(g); g.connect(o.bus || this.sfx);
      s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1);
    }

    /* ---- game sounds ---- */
    grip(hold) {
      const r = hold ? hold.r : 0.15;
      this.burst(0.03, { f: 3200, q: 2, vol: 0.28 });
      this.tone(900 - r * 1600, 0.06, { vol: 0.16, type: 'triangle' });
      this.tone(220, 0.08, { vol: 0.08 });
    }
    release() { this.burst(0.025, { f: 1800, q: 1.5, vol: 0.08 }); }
    miss() { this.tone(260, 0.05, { vol: 0.05, type: 'triangle' }); }
    slip() { this.tone(520, 0.22, { to: 160, vol: 0.14, type: 'triangle' }); this.burst(0.15, { f: 900, vol: 0.08 }); }
    catch_() { this.burst(0.06, { f: 1400, vol: 0.2 }); this.tone(160, 0.12, { vol: 0.14 }); }
    crumble() {
      for (let i = 0; i < 7; i++) this.burst(0.05 + Math.random() * 0.06, { f: 900 + Math.random() * 2600, q: 3, vol: 0.18, delay: i * 0.05 });
      this.burst(0.5, { f: 180, ftype: 'lowpass', vol: 0.25 });
    }
    shyFlee() { this.tone(700, 0.16, { to: 1500, vol: 0.07, type: 'sine' }); this.tone(1400, 0.1, { to: 900, vol: 0.04, delay: 0.14 }); }
    tame() { this.tone(660, 0.12, { vol: 0.08 }); this.tone(990, 0.2, { vol: 0.06, delay: 0.06 }); }
    tear() {
      for (let i = 0; i < 5; i++) this.burst(0.04 + Math.random() * 0.05, { f: 3500 + Math.random() * 2500, ftype: 'highpass', vol: 0.16, delay: i * 0.035 });
    }
    thud(v, net) {
      const k = U.clamp(v / 14, 0.15, 1);
      if (net) { this.tone(140, 0.35, { to: 240, vol: 0.18 * k }); return; }
      this.tone(90, 0.3, { to: 38, vol: 0.45 * k });
      this.burst(0.18, { f: 260, ftype: 'lowpass', vol: 0.3 * k });
    }
    chime() {
      this.tone(1318.5, 1.8, { vol: 0.08, a: 0.01 });
      this.tone(1975.5, 1.4, { vol: 0.05, a: 0.01, delay: 0.05 });
    }
    glitch() {
      for (let i = 0; i < 4; i++) this.tone(200 + Math.random() * 1600, 0.03, { vol: 0.035, type: 'square', delay: i * 0.04 });
    }
    dyno() { this.burst(0.35, { f: 500, fto: 1600, vol: 0.12 }); }
    fakeWhoosh() { this.burst(1.2, { f: 300, fto: 1800, vol: 0.35, a: 0.08, q: 0.7 }); this.tone(300, 0.6, { to: 120, vol: 0.08, delay: 0.05 }); }
    rumble() {
      this.burst(2.2, { f: 90, ftype: 'lowpass', vol: 0.5, a: 0.3 });
      for (let i = 0; i < 6; i++) this.burst(0.08, { f: 700 + Math.random() * 900, q: 2, vol: 0.2, delay: 0.3 + i * 0.22 });
    }
    swell() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [50, 57, 62, 66, 69, 74].forEach((m, i) => {
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.06, t + 3 + i * 0.2);
        g.gain.linearRampToValueAtTime(0.05, t + 13);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 16);
        o.connect(g); g.connect(this.musicFilter); o.start(t); o.stop(t + 16.2);
      });
      this.musicFilter.frequency.setTargetAtTime(3200, t, 2);
    }
    cutMusic() {
      if (!this.ctx) return;
      this.musicFilter.frequency.setTargetAtTime(500, this.ctx.currentTime, 0.1);
      this.music.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.15);
      setTimeout(() => { if (!this.silenced) this.music.gain.setTargetAtTime(0.32, this.ctx.currentTime, 3); }, 2500);
    }

    /* ---- continuous layers, called every frame ---- */
    update(dt, st) {
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      this.height = st.height;
      this.zone = st.zone;

      // wind rises with fall speed (fake falls inject their own whoosh)
      const fall = Math.max(0, -st.vy - 3.5);
      const w = U.clamp(fall / 18, 0, 1) * 0.5 + (st.height > 450 ? 0.02 : 0);
      this.windG.gain.setTargetAtTime(w, now, 0.08);
      this.windF.frequency.setTargetAtTime(300 + fall * 70, now, 0.1);

      // honest grip hum; thinner when the arm is really tired
      const hum = st.grips * 0.022 * (0.5 + 0.5 * st.stamina);
      this.humG.gain.setTargetAtTime(hum, now, 0.06);
      this.humF.frequency.setTargetAtTime(60 + (1 - st.stamina) * 900, now, 0.2);
      this.humCreak.frequency.setTargetAtTime(520 + (1 - st.stamina) * 1400, now, 0.2);

      if (st.silent && !this.silenced) {
        this.silenced = true;
        this.music.gain.setTargetAtTime(0.0001, now, 1.5);
        this.windG.gain.setTargetAtTime(0.01, now, 2);
      }
      if (this.silenced) return;

      // the lo-fi bed thins out with height
      const thin = U.clamp(st.height / LL.C.TOP, 0, 1);
      if (!this.credits) this.musicFilter.frequency.setTargetAtTime(1500 - thin * 800 + (st.zone === 4 ? 400 : 0), now, 1);
      if (this.nextChord < now - 0.5) this.nextChord = now + 0.1;   // tab was hidden
      if (this.nextPluck < now - 0.5) this.nextPluck = now + 0.1;
      if (now > this.nextChord - 0.05) {
        const chord = CHORDS[this.chord % CHORDS.length];
        this.chord++;
        const voices = Math.max(2, Math.round(5 - thin * 3));
        for (let i = 0; i < voices; i++) this._pad(mtof(chord[i]), this.nextChord, 7.5, 0.05);
        this.nextChord += 6;
      }
      if (now > this.nextPluck - 0.05) {
        const pluckP = 0.55 * (1 - thin);
        if (Math.random() < pluckP) {
          const chord = CHORDS[(this.chord + 3) % CHORDS.length];
          const m = chord[1 + Math.floor(Math.random() * 4)] + 12;
          this._pluck(mtof(m), this.nextPluck);
        }
        if (st.zone === 4 && Math.random() < 0.08) this.glitch();
        this.nextPluck += 0.5;
      }
    }

    _pad(f, t, dur, vol) {
      const ctx = this.ctx;
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 1.8);
        g.gain.setValueAtTime(vol, t + dur - 2);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.musicFilter);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
    _pluck(f, t) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g); g.connect(this.musicFilter);
      o.start(t); o.stop(t + 1.3);
    }
  }

  LL.Sound = Sound;
})(globalThis.LL = globalThis.LL || {});
