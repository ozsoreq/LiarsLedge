/* Liar's Ledge — The Guide.
 * A calm, meditation-app voice. True in the Quarry; from the Gallery on,
 * about one tip in three is false. Never wrong about physics, only the wall.
 * At the real summit he goes silent for the first time: that is the reward. */
(function (LL) {
  'use strict';

  const U = LL.U;

  // Height-triggered lines (by best height). `tip` points an arrow at a hold;
  // `lie` is bookkeeping for designers (and the curious).
  const SCRIPT = [
    { id: 'z1a', h: 3, text: 'Good. One hand holds while the other reaches. That\'s all climbing is.' },
    { id: 'z1b', h: 8, text: 'When your arms burn, find a ledge. Rest there and they\'ll recover.' },
    { id: 'z1c', h: 16, text: 'Big round holds are generous. The small ones tire you faster.' },
    { id: 'z1d', h: 26, text: 'Momentum carries. Reach past your arm while you hang and your body swings with it.' },
    { id: 'z1e', h: 40.5, text: 'See that gap above the ledge? Pull up, then hold both buttons. Let go of everything, fly, and catch.', tip: 'dyno1' },
    { id: 'z1f', h: 60, text: 'You\'re doing wonderfully. This wall has never lied to anyone.' },
    { id: 'z1g', h: 76, text: 'Up ahead is the Gallery. Every hold there is a work of art.' },

    { id: 'z2a', h: 81.6, text: 'See the big one right above the ledge? Perfect. Grab it.', tip: 'firstFake', lie: true },
    { id: 'z2b', h: 93.4, text: 'This next one is shy. Don\'t linger near it.', tip: 'firstShy' },
    { id: 'z2c', h: 108, text: 'Stay with the round holds on the path. They\'ve never let anyone down.', tip: 'route' },
    { id: 'z2d', h: 128, text: 'Here\'s a shortcut. That one\'s solid, I checked.', tip: 'fake', lie: true },
    { id: 'z2e', h: 150, text: 'Real holds cast a soft shadow on the rock. Just an observation.' },
    { id: 'z2f', h: 168, text: 'Nearly through. That one, right there. Nice and steady.', tip: 'route' },
    { id: 'z2g', h: 185, text: 'Sharp edges mean a sharper grip. It\'s science.', lie: true },

    { id: 'z3a', h: 204.8, text: 'The rock off to the side looks easy. Go on, it\'s practically a staircase.', tip: 'firstPainted', lie: true },
    { id: 'z3b', h: 226, text: 'When you swing, painted rock drifts a little against the real stuff. Watch the edges.' },
    { id: 'z3c', h: 245, text: 'There. Good holds, big and friendly.', tip: 'painted', lie: true },
    { id: 'z3d', h: 262, text: 'The nets are real. Stunt crews leave them lying around.' },
    { id: 'z3e', h: 290, text: 'You\'re past halfway. Honestly.' },
    { id: 'z3f', h: 318, text: 'The next part is purely cosmetic. Nothing up there changes how you play.', lie: true },

    { id: 'z4a', h: 347.5, text: 'Listen for the chime. It means something changed. Or I\'m humming.' },
    { id: 'z4b', h: 420, text: 'The markers painted on the wall are older than me. They don\'t lie.' },
    { id: 'z4c', h: 445, text: 'Straight up. That one. Trust me.', tip: 'fake', lie: true },
    { id: 'z4d', h: 470, text: 'Almost out. The sky up there is real. Mostly.' },

    { id: 'z5a', h: 500, text: 'I should confess something. Not everything I\'ve told you was true.' },
    { id: 'z5b', h: 507, text: 'The shadows? A lie. No, wait. That one was true. The shortcut in the Gallery, that was a lie. Probably.' },
    { id: 'z5c', h: 523, text: 'The ledges never lied. The nets never lied. The rest of it, well. Most of it.', lie: true },
    { id: 'z5d', h: 540, text: 'The top is right there. Can you feel it?' },
    { id: 'z5e', h: 581.2, text: 'Oh, I\'ve been waiting for this one. Look at it. Sharp edge. No shadow. You know exactly what that means.', tip: 'tellLie', lie: true },
    { id: 'z5f', h: 596, text: 'Almost...' }
  ];

  const ZONE_LINES = {
    2: { text: 'The Gallery. Every hold here was carved by hand, and every hold is exactly what it looks like.', lie: true },
    3: { text: 'The Stage. Isn\'t it beautiful? Real stone, all the way up.', lie: true },
    4: { text: 'The Glitch. Don\'t worry. Your eyes are the only thing that still works properly up here.', lie: true },
    5: { text: 'The Summit. Clear skies. Nothing left to hide.', lie: true }
  };

  const FALL = {
    small: ['Easy. Falling is part of climbing.', 'Shake it out. Go again.', 'That\'s fine. Your hands know the way now.'],
    mid: ['A few meters. You\'ll have them back in no time.', 'The wall will still be there.', 'Breathe. Hands first, then the rest of you.'],
    midLie: ['Barely a scratch.', 'That hardly counts as a fall.', 'Honestly, that section was overrated.'],
    big: ['You were barely a few meters up anyway.', 'That was, what, {s} meters? Nothing.', 'Good news: you get to see that bit again.', 'Think of it as a second look at the view.'],
    huge: ['A scenic descent. Maybe {s} meters.', 'You were barely a few meters up anyway.', 'Gravity is just the wall hugging you.']
  };

  const IDLE = [
    'Take your time. Rest is progress too.',
    'Breathe in. Hold. Breathe out. Don\'t let go.',
    'The wall isn\'t going anywhere.',
    'Notice your hands. Notice the rock. Notice which one is lying.'
  ];

  class Guide {
    constructor(sim) {
      this.sim = sim;
      this.queue = [];
      this.cur = null;
      this.gap = 0;
      this.said = {};
      this.silent = false;
      this.lastFall = -99;
      this.lastIdle = 0;
      this.rng = U.rng(Date.now() & 0xffff);
      this.introDone = false;
    }

    serialize() { return { said: Object.keys(this.said), silent: this.silent }; }
    restore(s) {
      if (!s) return;
      (s.said || []).forEach((k) => (this.said[k] = 1));
      this.silent = !!s.silent;
      this.introDone = true;
    }

    say(text, o) {
      if (this.silent) return;
      o = o || {};
      if (o.id) { if (this.said[o.id]) return; this.said[o.id] = 1; }
      const line = { text: text, tip: o.tip || null, lie: !!o.lie, pri: o.pri || 0, t: 0, born: this.sim.time, arrow: null };
      if (o.now) {
        // urgent lines cut in
        if (this.cur && this.cur.pri < line.pri) this.cur = null;
        this.queue.unshift(line);
      } else this.queue.push(line);
    }

    pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

    start(isNew) {
      if (!isNew) {
        this.say(this.pick(['Welcome back. The wall remembers you.', 'Ah, you\'re back. Right where you left yourself.', 'Welcome back. Breathe in. Let\'s continue.']), {});
        return;
      }
      this.say('Welcome. I\'m your Guide. Let\'s begin with a breath.', { id: 'intro1' });
      this.say('Hold the left mouse button and move to reach with your left hand. Let go to grip.', { id: 'intro2' });
      this.say('The right button does the same for your right hand. One always holds.', { id: 'intro3' });
    }

    onEvent(e) {
      const s = this.sim;
      if (this.silent) return;
      const z = s.zone;
      switch (e.type) {
        case 'zone':
          if (ZONE_LINES[e.zone]) this.say(ZONE_LINES[e.zone].text, { id: 'zone' + e.zone, lie: ZONE_LINES[e.zone].lie, pri: 1 });
          break;
        case 'firstRest':
          this.say('Rest here. Your arms recover when your body is supported.', { id: 'rest' });
          break;
        case 'crumble':
          if (e.first) {
            this.say('Oh! That happens.', { id: 'crumble1', pri: 2, now: true });
            this.say('Look closer next time. Some holds have a sharper edge, and no shadow underneath.', { id: 'crumble2' });
          } else if (this.rng() < 0.3) this.say(this.pick(['That one was fine. You squeezed too hard.', 'Hm. It must have been tired.', 'Nobody saw that.']), { lie: true });
          break;
        case 'shyFlee':
          if (e.first) this.say('Shy holds get nervous if you hesitate. Be quick and it\'s yours.', { id: 'shy1', pri: 1, now: true });
          break;
        case 'tame':
          this.say('See? It just needed a firm hand.', { id: 'tame1' });
          break;
        case 'painted':
          if (e.first) {
            this.say('Scaffolding? Must be maintenance. Pay it no mind.', { id: 'paint1', pri: 2, now: true, lie: true });
          }
          break;
        case 'fakeFall':
          if (e.first) this.say('No! You\'re falling!', { id: 'ff1', pri: 3, now: true, lie: true });
          else if (this.rng() < 0.5) this.say(this.pick(['Careful!', 'Whoa, whoa!', 'Hold on!']), { pri: 3, now: true, lie: true });
          break;
        case 'fakeFallEnd':
          if (e.held && !this.said.ff2) this.say('...Or not. Did you hear that? Your grip never went quiet.', { id: 'ff2', pri: 2, now: true });
          break;
        case 'swap':
          if (e.on) this.say('Did you hear a chime? No? Good. Nothing changed.', { id: 'swap1', lie: true, pri: 1 });
          break;
        case 'mirror':
          if (e.on) this.say('Your mouse is fine. It\'s you.', { id: 'mirror1', lie: true, pri: 1 });
          break;
        case 'stamLie':
          if (e.on) this.say('Your arms look great. Full strength, see?', { id: 'stam1', lie: true, pri: 1 });
          break;
        case 'altLie':
          if (e.offset > 0) this.say('Five hundred meters! Look at that. You\'re nearly there.', { id: 'alt1', lie: true, pri: 1 });
          else if (e.offset < 0) this.say('Still a long way to go. Pace yourself.', { id: 'alt2', lie: true, pri: 1 });
          break;
        case 'credits':
          this.queue.length = 0; this.cur = null;
          this.say('You did it. You actually did it.', { id: 'fs1', pri: 3 });
          this.say('Thank you for climbing with me. Really.', { id: 'fs2', pri: 3 });
          break;
        case 'collapse':
          this.queue.length = 0; this.cur = null;
          this.say('Ah.', { id: 'fs3', pri: 4, now: true });
          this.memoCollapse = true;
          break;
        case 'tellLieHeld':
          this.say('...Huh. It held. Nobody tells me anything.', { id: 'tl2', pri: 2, now: true });
          break;
        case 'fell':
          this.onFall(e, z);
          break;
        case 'summit':
          // The reward is silence.
          this.queue.length = 0;
          this.cur = null;
          this.silent = true;
          break;
      }
    }

    onFall(e, z) {
      const s = this.sim;
      if (this.memoCollapse && e.dist > 15) {
        this.memoCollapse = false;
        this.say('Did I say summit? I meant a summit.', { id: 'fs4', pri: 3, now: true });
        this.say('Thirty meters. You were barely up there anyway.', { id: 'fs5', pri: 3, lie: true });
        return;
      }
      if (s.time - this.lastFall < 7) return;
      this.lastFall = s.time;
      const small = Math.max(2, Math.round(e.dist / 8));
      const fill = (t) => t.replace('{s}', small);
      let line, lie = false;
      if (e.dist < 4) { if (this.rng() < 0.5) return; line = this.pick(FALL.small); }
      else if (e.dist < 15) {
        if (z >= 2 && this.rng() < 0.45) { line = this.pick(FALL.midLie); lie = true; }
        else line = this.pick(FALL.mid);
      } else if (e.dist < 60) {
        if (z === 1) line = 'That one hurt. It\'s alright. The route is the same as before.';
        else { line = fill(this.pick(FALL.big)); lie = true; }
      } else { line = fill(this.pick(FALL.huge)); lie = true; }
      this.say(line, { pri: 2, now: true, lie: lie });
    }

    update(dt) {
      const s = this.sim;
      if (this.silent) { this.cur = null; return; }
      // height-scripted lines
      for (const L of SCRIPT) {
        if (this.said[L.id] || s.best < L.h) continue;
        if (s.best - L.h > 25) { this.said[L.id] = 1; continue; } // loaded far above: skip
        this.say(L.text, { id: L.id, tip: L.tip, lie: L.lie, pri: 1 });
      }
      // gentle tutorial nudges
      if (!this.said.pull && s.time > 16 && s.best < 2.2 && s.pullDist < 0.3) this.say('Roll the mouse wheel forward to pull yourself up. W and S work too.', { id: 'pull' });
      if (!this.said.btn && s.time > 9 && s.best < 0.6) this.say('Hold a button, move the mouse, let go on a hold. Slowly is fine.', { id: 'btn' });
      // idle
      if (s.idle > 32 && s.anyGrip() && s.time - this.lastIdle > 60) {
        this.lastIdle = s.time;
        this.say(this.pick(IDLE));
      }

      if (this.cur) {
        this.cur.t += dt;
        if (this.cur.t > this.cur.dur) { this.cur = null; this.gap = 0.7; }
      } else {
        this.gap -= dt;
        // stale queued lines go unsaid
        while (this.queue.length && s.time - this.queue[0].born > 25 && this.queue[0].pri < 2) this.queue.shift();
        if (this.gap <= 0 && this.queue.length) {
          const l = this.queue.shift();
          l.dur = 2.4 + l.text.length * 0.055;
          l.t = 0;
          if (l.tip) l.arrow = s.findHold(l.tip, /^(first|dyno|tell)/.test(l.tip) ? 6 : 3.5);
          this.cur = l;
        }
      }
    }

    // What the subtitle shows right now.
    display() {
      if (!this.cur) return null;
      const c = this.cur;
      const chars = Math.min(c.text.length, Math.floor(c.t * 42));
      const fade = c.t > c.dur - 0.5 ? U.clamp((c.dur - c.t) / 0.5, 0, 1) : 1;
      return { text: c.text.slice(0, chars), full: c.text, alpha: fade, arrow: c.arrow && !c.arrow.gone ? c.arrow : null };
    }

    speaking() { return !!this.cur; }
  }

  Guide.SCRIPT = SCRIPT;
  LL.Guide = Guide;
})(globalThis.LL = globalThis.LL || {});
