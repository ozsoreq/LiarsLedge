/* Liar's Ledge — headless tests: level invariants, physics sanity, and a
 * scripted climber that has to get up real sections of the wall.
 * Run: node tools/test.js            (fast)
 *      node tools/test.js --long     (also climbs every zone section) */
'use strict';
const { LL, Bot } = require('./harness');
const C = LL.C;
const LONG = process.argv.includes('--long');

let failed = 0, passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); passed++; console.log('  ok   ' + name + '  (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

const level = () => LL.Level.generate(C.SEED);

console.log('Level');

test('generation is deterministic', () => {
  const a = JSON.stringify(level().toJSON()), b = JSON.stringify(level().toJSON());
  assert(a === b, 'two generations differ');
});

test('route: every step is reachable from the locked-off shoulder (except dyno gaps)', () => {
  const L = level();
  const route = L.holds.filter((h) => h.route);
  let worst = 0, at = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    if (b.tag && /^dyno/.test(b.tag)) continue;
    // either hand may take it: best of the two shoulders
    const d = Math.min(
      Math.hypot(b.x0 - (a.x0 + 0.4), b.y0 - (a.y0 - C.ARM_MIN)),
      Math.hypot(b.x0 - (a.x0 - 0.4), b.y0 - (a.y0 - C.ARM_MIN)));
    if (d > worst) { worst = d; at = b.y0; }
  }
  assert(worst < C.ARM_MAX - 0.05, 'worst reach ' + worst.toFixed(2) + ' m at ' + at.toFixed(1) + ' m');
});

test('route reaches the summit', () => {
  const L = level();
  const route = L.holds.filter((h) => h.route);
  assert(route[route.length - 1].y0 > C.TOP - 0.8, 'route ends at ' + route[route.length - 1].y0);
  assert(L.holds.some((h) => h.tag === 'summitRail'), 'no top-out holds');
});

test('zones: each lie appears where the design says', () => {
  const L = level();
  const firstY = (type) => Math.min(...L.holds.filter((h) => h.type === type).map((h) => h.y0));
  assert(L.holds.filter((h) => h.y0 < 80).every((h) => h.type === 'normal'), 'Zone 1 must not lie');
  assert(firstY('fake') > 80 && firstY('fake') < 90, 'first fake hold at ' + firstY('fake'));
  assert(firstY('shy') > 80 && firstY('shy') < 100, 'first shy hold at ' + firstY('shy'));
  assert(firstY('painted') > 200 && firstY('painted') < 210, 'first painted hold at ' + firstY('painted'));
  assert(Math.min(...L.bands.map((b) => b.y1)) >= 330, 'UI lies start in Zone 4');
  assert(L.bands.some((b) => b.type === 'altLie' && b.offset === 100 && b.y1 <= 400 && b.y2 >= 400), 'altimeter says 500 at 400');
  assert(L.holds.filter((h) => h.type === 'tellLie').length === 1, 'the tell lies exactly once');
});

test('the first crumbling hold sits ~1 m above a safe ledge', () => {
  const L = level();
  const f = L.holds.find((h) => h.tag === 'firstFake');
  const below = L.ledges.filter((l) => l.type === 'ledge' && f.x0 >= l.x1 && f.x0 <= l.x2 && l.y < f.y0 && f.y0 - l.y < 1.3);
  assert(below.length, 'no ledge under the first fake hold');
});

test('fake summit: full-width ledge at 560, catch ledge ~30 m below, nothing in between', () => {
  const L = level();
  const fs = L.ledges.find((l) => l.type === 'fakeSummit');
  assert(fs && Math.abs(fs.y - C.FAKE_SUMMIT) < 0.01, 'fake summit ledge');
  const catchL = L.ledges.find((l) => Math.abs(l.y - C.CATCH_LEDGE) < 0.01);
  assert(catchL && catchL.x1 <= -C.WALL_HALF && catchL.x2 >= C.WALL_HALF, 'full-width catch ledge');
  const between = L.ledges.filter((l) => l.y > catchL.y + 0.1 && l.y < fs.y - 0.1 && l.type !== 'painted');
  assert(between.length === 0, 'ledges between catch and fake summit: ' + between.map((l) => l.y.toFixed(1)));
  assert(L.veilY > fs.y && L.veilY < fs.y + 2, 'veil above fake summit');
});

test('painted panels never contain real route holds', () => {
  const L = level();
  for (const h of L.holds) {
    if (!h.route) continue;
    for (const p of L.panels) assert(!(h.x0 > p.x1 && h.x0 < p.x2 && h.y0 > p.y1 && h.y0 < p.y2), 'route hold ' + h.id + ' inside a panel');
  }
});

test('JSON round trip', () => {
  const L = level();
  const j = L.toJSON();
  const L2 = LL.Level.fromJSON(JSON.parse(JSON.stringify(j)));
  assert(L2.holds.length === L.holds.length && L2.ledges.length === L.ledges.length && L2.panels.length === L.panels.length, 'counts differ');
  assert(L2.veilY === L.veilY, 'veil lost');
});

console.log('Physics & climbing');

const steps = (s, sec, inp) => { for (let i = 0; i < sec / C.DT; i++) s.step(Object.assign({ btn: [false, false] }, inp || {})); };

test('starts hanging from two holds with feet on the ground and stays stable', () => {
  const s = new LL.Sim(level());
  steps(s, 5);
  assert(s.hands.every((h) => h.state === 'grip'), 'let go on its own');
  assert(Math.abs(s.height()) < 0.3, 'height ' + s.height());
  assert(Array.from(s.body.x).every(Number.isFinite), 'NaN in body');
});

test('one-arm hanging drains stamina until the hand opens', () => {
  const L = level();
  let s;
  for (const h of [25, 27, 29, 31, 33]) {   // somewhere with no ledge underfoot
    s = new LL.Sim(L);
    s.teleport(h);
    steps(s, 0.5, { btn: [true, false] });   // left reaches, right holds alone
    if (s.body.supported() < 0 && s.hands[1].state === 'grip') break;
  }
  const st0 = s.hands[1].st;
  steps(s, 3, { btn: [true, false] });
  assert(s.hands[1].st < st0 - 0.1, 'no drain: ' + st0 + ' -> ' + s.hands[1].st);
  steps(s, 30, { btn: [true, false] });
  assert(s.hands[1].state !== 'grip', 'hand never opened');
});

test('pulling up raises the body; letting go of both drops it', () => {
  const s = new LL.Sim(level());
  s.teleport(30);
  steps(s, 1);
  const h0 = s.height();
  steps(s, 1.2, { pullKey: 1 });
  assert(s.height() > h0 + 0.35, 'pull-up only gained ' + (s.height() - h0).toFixed(2));
  steps(s, 0.05, { btn: [true, true] });
  steps(s, 0.8, { btn: [true, true] });
  assert(s.height() < h0 - 0.5 || s.falling, 'did not fall');
});

test('fake hold crumbles 0.5 s after the grab', () => {
  const L = level();
  const s = new LL.Sim(L);
  const f = L.holds.find((h) => h.tag === 'firstFake');
  s.teleport(f.y0 - 2.27 - 0.5, f.x0);
  const hand = f.x0 < s.chest().x ? 0 : 1;
  const b = [hand === 0, hand === 1];
  for (let i = 0; i < 240; i++) {
    const p = s.handPos(hand);
    if (Math.hypot(p.x - f.x, p.y - f.y) < f.r * 0.5) break;
    s.step({ btn: b, abs: { x: f.x, y: f.y }, pullKey: 1 });
  }
  s.step({ btn: [false, false], abs: { x: f.x, y: f.y } });
  assert(s.hands[hand].hold === f, 'could not grab the fake hold');
  steps(s, 0.4);
  assert(!f.gone, 'crumbled too early');
  steps(s, 0.2);
  assert(f.gone && s.hands[hand].state !== 'grip', 'did not crumble');
  assert(s.events.some((e) => e.type === 'crumble'), 'no crumble event');
});

test('fake fall never moves the body', () => {
  const s = new LL.Sim(level());
  s.teleport(215);
  steps(s, 3);
  assert(s.events.some((e) => e.type === 'fakeFall'), 'no scripted fake fall at 212-226 m');
  assert(s.anyGrip(), 'fake fall made the climber let go');
});

test('save / restore round trip', () => {
  const L = level();
  const s = new LL.Sim(L);
  s.teleport(123);
  steps(s, 1);
  const data = JSON.parse(JSON.stringify(s.serialize()));
  const s2 = new LL.Sim(L);
  assert(s2.restore(data), 'restore failed');
  assert(Math.abs(s2.height() - s.height()) < 1e-6, 'height differs');
  assert(s2.hands.filter((h) => h.state === 'grip').length === s.hands.filter((h) => h.state === 'grip').length, 'grips differ');
});

test('the Guide goes silent at the summit', () => {
  const s = new LL.Sim(level());
  const g = new LL.Guide(s);
  g.start(true);
  g.update(0.1);
  assert(g.speaking(), 'no intro');
  g.onEvent({ type: 'summit' });
  g.say('anything');
  g.update(0.1);
  assert(!g.speaking() && g.silent, 'still talking');
});

test('fake summit: credits roll, the floor gives way, the catch ledge ~30 m below holds you', () => {
  const L = level();
  const s = new LL.Sim(L);
  const fsL = L.ledges.find((l) => l.type === 'fakeSummit');
  // drop the climber onto the fake summit ledge
  const nb = new LL.Ragdoll(0, fsL.y + 1.2);
  s.hands.forEach((h, i) => { s.body.unpin(i); h.state = 'free'; h.hold = null; });
  s.body.restore(nb.serialize());
  steps(s, 3);
  assert(s.events.some((e) => e.type === 'credits'), 'no credits (height ' + s.height().toFixed(1) + ')');
  assert(L.holds.filter((h) => h.y0 > L.veilY).every((h) => !s.holdUsable(h)), 'holds above the painted sky are usable');
  steps(s, 17);
  assert(s.events.some((e) => e.type === 'collapse') && fsL.broken, 'no collapse');
  steps(s, 6);
  const fell = s.events.find((e) => e.type === 'fell');
  assert(fell && fell.dist > 25 && fell.dist < 35, 'fell ' + (fell && fell.dist.toFixed(1)));
  assert(Math.abs(s.height() + 0.97 - C.CATCH_LEDGE) < 1.2, 'landed at ' + s.height().toFixed(1));
  assert(L.holds.filter((h) => h.route && h.y0 > L.veilY).every((h) => s.holdUsable(h)), 'route above still hidden after collapse');
});

test('real summit: resting on the plateau finishes the climb', () => {
  const L = level();
  const s = new LL.Sim(L);
  s.fs.done = true;
  const nb = new LL.Ragdoll(0, C.TOP + 1.2);
  s.hands.forEach((h, i) => { s.body.unpin(i); h.state = 'free'; h.hold = null; });
  s.body.restore(nb.serialize());
  steps(s, 3);
  assert(s.finished && s.events.some((e) => e.type === 'summit'), 'not finished');
});

function climb(from, to, budget) {
  const s = new LL.Sim(level());
  if (from > 0) s.teleport(from);
  const bot = new Bot(s);
  while (s.best < to && s.time < budget) {
    const t0 = s.time;
    if (!s.anyGrip()) bot.recover(); else bot.move();
    if (s.time === t0) steps(s, 0.5);
    s.events.length = 0;
  }
  return s;
}

test('scripted climber: ground to the Gallery (0 → 80 m)', () => {
  const s = climb(0, 80, 600);
  assert(s.best >= 80, 'reached ' + s.best.toFixed(1) + ' m in ' + s.time.toFixed(0) + ' s');
});

if (LONG) {
  for (const [a, b] of [[80, 200], [200, 330], [330, 480], [480, 520]]) {
    test('scripted climber: ' + a + ' → ' + b + ' m', () => {
      const s = climb(a, b, 1500);
      assert(s.best >= b, 'reached ' + s.best.toFixed(1) + ' m in ' + s.time.toFixed(0) + ' s');
    });
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
