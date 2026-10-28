// 체육 엔진 단위 테스트 (SPEC §11.1 Layer 1): 특징·스무딩·게이트·판정·세기·코치
import test from 'node:test';
import assert from 'node:assert/strict';
import { ramp, band, all, A, mx, mn, rawFeatures, Smoother, Tracker, LegsGate, IdentityGuard, Baseline, relFeatures, scoreAll,
  StepJudge, RepCounter, HoldCounter, Coach, blendSpec, easeInOut, NEUTRAL, EMPTY_R, starsFor } from '../js/pe-engine.js';
import { getMove, resolveVariant, KP, CATALOG_ORDER, IDLE_MOVE, PRAISE_MOVE } from '../js/pe-moves.js';
import { synthFrame, rng, pose, SP, ASPECT } from './pe-synth.mjs';

const near = (a, b, tol, msg) => assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} ±${tol}`);
const clean = (P) => synthFrame(P, rng(1), { noise: false });
const isZ = (spec) => Array.isArray(spec) && spec.every(([b, ax, v]) => typeof b === 'string' && ax[0] === 0 && ax[1] === 0 && ax[2] === 1 && Number.isFinite(v));

test('score helpers: ramp/band/all/A/mx/mn', () => {
  assert.equal(ramp(5, 0, 10), 0.5); assert.equal(ramp(15, 0, 10), 1); assert.equal(ramp(null, 0, 1), 0); assert.equal(ramp(NaN, 0, 1), 0);
  assert.equal(ramp(2, 10, 0), 0.8, 'lo > hi = falling');
  assert.equal(band(5, 0, 10, 2), 1); assert.equal(band(-1, 0, 10, 2), 0.5); assert.equal(band(NaN, 0, 10, 2), 0); assert.equal(band(null, 0, 1, 1), 0);
  assert.deepEqual(all(['a', 0.9], ['b', 0.4], ['c', 0.6]), { s: 0.4, why: 'b' });
  assert.deepEqual(all(['a', 1]), { s: 1, why: null });
  assert.deepEqual(A(0.8, 10, 20), [8, 16]); assert.deepEqual(A(1.15, 115, 145, 165), [115 * 1.15, 165]);
  assert.equal(mx(null, 3, 1), 3); assert.equal(mn(null, null), null); assert.equal(mn(2, null, -1), -1);
  assert.equal(easeInOut(0), 0); assert.equal(easeInOut(1), 1); near(easeInOut(0.5), 0.5, 1e-9, 'ease mid');
  assert.equal(starsFor(8, 8), 3); assert.equal(starsFor(4, 8), 2); assert.equal(starsFor(3, 8), 1); assert.equal(starsFor(0, 0), 1);
});

test('rawFeatures: sides, angles and ruler follow the conventions', () => {
  assert.equal(rawFeatures({ present: false }), null);
  assert.equal(rawFeatures(null), null);
  const d = rawFeatures(clean(SP.DOWN).snap, clean(SP.DOWN).ov, ASPECT);
  near(d.T, 0.38, 0.002, 'T = torso'); near(d.elevL, 15, 1, 'elev down'); near(d.upL, -0.966, 0.01, 'up down'); near(d.lean, 0, 0.5, 'lean'); near(d.tilt, 0, 0.5, 'tilt');
  near(d.hipAnk, 1.553, 0.01, 'hipAnk standing'); near(d.legAngL, 0, 0.5, 'legAng'); assert.equal(d.ovHipOK, true); assert.equal(d.ovAnkIn, true);
  const t = rawFeatures(clean(SP.T).snap, null, ASPECT);
  near(t.elevL, 90, 1, 'T elev'); near(t.upR, 0, 0.02, 'T up'); near(t.reachL, 1, 0.01, 'reach'); assert.equal(t.ovShY, undefined, 'no overlay → no ov fields');
  const sky = clean(pose({ eL: 165 }));
  assert.ok(sky.snap.pts.L_WR.x < 0, 'child left joints sit at −x');
  assert.ok(sky.ov[11].x > sky.ov[12].x, 'raw image is not mirrored');
  const sr = rawFeatures(sky.snap, sky.ov, ASPECT);
  near(sr.elevL, 165, 1.5, 'left arm up'); near(sr.elevR, 15, 1, 'right arm down'); near(sr.maxElev, 165, 1.5, 'maxElev'); near(sr.minElev, 15, 1, 'minElev');
  near(rawFeatures(clean(pose({ lean: 16 })).snap, null, 1).lean, 16, 0.5, 'lean + = child right');
  near(rawFeatures(clean(pose({ tilt: -14 })).snap, null, 1).tilt, -14, 0.5, 'tilt − = child left');
  const leg = rawFeatures(clean(pose({ outL: 24 })).snap, null, 1);
  near(leg.legAngL, 24, 0.5, 'left leg out'); near(leg.legAngR, 0, 0.5, 'right leg still');
  const hip = rawFeatures(clean(SP.HIP).snap, null, 1);
  assert.ok(hip.upL > -0.7 && hip.upL < -0.15, `hands on hips up ${hip.upL}`);
  // 관절이 안 보이면 팔꿈치로, 그것도 없으면 null
  const f = clean(SP.UP); f.snap.vis.L_WR = 0.1;
  const fe = rawFeatures(f.snap, null, 1); assert.equal(fe.reachL, null); assert.ok(fe.elevL > 150, 'elbow fallback'); assert.ok(fe.upL > 0);
  f.snap.vis.L_EL = 0.1; assert.equal(rawFeatures(f.snap, null, 1).elevL, null);
  // 비율 특징은 좌표 전체 ×8에도 같다
  const big = clean(SP.T); for (const p of Object.values(big.snap.pts)) { p.x *= 8; p.y *= 8; }
  const bf = rawFeatures(big.snap, null, 1); near(bf.elevL, t.elevL, 1e-6, 'scale-free elev'); near(bf.reachL, t.reachL, 1e-6, 'scale-free reach');
});

test('Smoother: median of the last 5 fresh frames, null below 3 samples or when stale', () => {
  const s = new Smoother();
  const R = (v, key) => ({ key, T: v, elevL: v, wrL: { x: v, y: -v }, ovHipOK: v > 2 });
  s.push(R(1, 'a'), 0); s.push(R(2, 'b'), 30);
  assert.equal(s.get(30).T, null, 'fewer than 3');
  s.push(R(100, 'c'), 60); s.push(R(3, 'd'), 90); s.push(R(4, 'e'), 120);
  const g = s.get(120);
  assert.equal(g.T, 3, 'median absorbs one spike'); assert.deepEqual(g.wrL, { x: 3, y: -3 }); assert.equal(g.ovHipOK, true, 'booleans = latest'); assert.equal(g.key, 'e');
  assert.equal(g.minElev, 3); assert.equal(s.get(900), null, 'all older than 500 ms');
});

test('Tracker: debounced presence, fresh-frame gate, stability vs reference', () => {
  const tr = new Tracker(), R = rng(3);
  let f = synthFrame(SP.DOWN, R), o;
  for (let t = 0; t < 300; t += 16) { if (t % 32 === 0) f = synthFrame(SP.DOWN, R); o = tr.update(f.snap, f.ov, ASPECT, t); }
  assert.equal(o.present, true); assert.ok(o.R.T > 0.3); assert.equal(o.stable, true);
  const dup = tr.update(f.snap, f.ov, ASPECT, 310); assert.equal(dup.isNew, false, 'same snapshot is not a new frame');
  let t = 320;
  for (; t < 900; t += 16) { o = tr.update({ present: false }, null, ASPECT, t); if (t - 320 < 380) assert.equal(o.present, true, 'debounced 400 ms'); if (t - 320 > 420) assert.equal(o.present, false); }
  assert.equal(o.stable, false, 'no fresh data for 500 ms → not stable'); assert.equal(o.R.T, null);
  o = tr.update(synthFrame(SP.DOWN, R).snap, null, ASPECT, t); assert.equal(o.present, true, 'present again at once');
  // 기준 T보다 한참 크면 불안정
  const tr2 = new Tracker(); tr2.setRef(0.2);
  for (let i = 0; i < 10; i++) o = tr2.update(synthFrame(SP.DOWN, R).snap, null, ASPECT, i * 33);
  assert.equal(o.stable, false, 'T 0.38 vs ref 0.2');
  // 계속 같은 크기면 1.5 s 뒤 기준을 놓고 다시 맞춤 요청
  let lost = false; for (let i = 10; i < 80; i++) { o = tr2.update(synthFrame(SP.DOWN, R).snap, null, ASPECT, i * 33); lost ||= o.refLost; }
  assert.ok(lost, 'reference released'); assert.equal(o.stable, true);
});

test('Tracker: a burst of whole-frame scale glitches (×8) is dropped, not taken for a new person', () => {
  const tr = new Tracker(), ig = new IdentityGuard(), R = rng(13); let o, jumped = false, t = 0;
  const step = (f) => { o = tr.update(f.snap, f.ov, ASPECT, t); jumped ||= ig.update(o.R, o.isNew, t).jumped; t += 33; return o; };
  for (let i = 0; i < 20; i++) step(synthFrame(SP.DOWN, R));
  const T0 = o.R.T;
  for (let i = 0; i < 3; i++) { const f = synthFrame(SP.DOWN, R); for (const p of Object.values(f.snap.pts)) { p.x *= 8; p.y *= 8; } assert.equal(step(f).isNew, false); }
  for (let i = 0; i < 5; i++) step(synthFrame(SP.DOWN, R));
  near(o.R.T, T0, 0.03, 'T unchanged'); assert.equal(jumped, false);
  for (let i = 0; i < 6; i++) { const f = synthFrame(SP.DOWN, R); for (const p of Object.values(f.snap.pts)) { p.x *= 8; p.y *= 8; } step(f); }
  assert.ok(o.R.T > 1, 'a lasting change is accepted after 3 frames');
});

test('Tracker stillness: still while standing, not while waving', () => {
  const tr = new Tracker(), R = rng(5); let o, stills = 0;
  for (let i = 0; i < 60; i++) { o = tr.update(synthFrame(SP.DOWN, R).snap, null, ASPECT, i * 33); if (i > 10 && o.still) stills++; }
  assert.ok(stills >= 45, `still frames ${stills}`);
  let moving = 0;
  for (let i = 60; i < 120; i++) { const e = 15 + 150 * Math.abs(Math.sin(i / 3)); o = tr.update(synthFrame(pose({ eL: e, eR: e }), R).snap, null, ASPECT, i * 33); if (!o.still) moving++; }
  assert.ok(moving >= 50, `moving frames ${moving}`);
});

test('LegsGate: on within ~1 s, off after ≥1 s cut, 50 % flicker keeps state', () => {
  const R = rng(9), g = new LegsGate(), tr = new Tracker();
  const run = (P, from, to, alt) => { let on, firstOn = null, lastOn = null;
    for (let t = from; t < to; t += 33) { const Q = alt ? (Math.round(t / 33) % 2 ? P : alt) : P; const f = synthFrame(Q, R);
      const s = tr.update(f.snap, f.ov, ASPECT, t); on = g.update(f.snap, f.ov, s.R, s.isNew, t);
      if (on && firstOn == null) firstOn = t; if (on) lastOn = t; }
    return { on, firstOn, lastOn }; };
  const a = run(SP.DOWN, 0, 1500);
  assert.equal(a.on, true); assert.ok(a.firstOn <= 1000, `on at ${a.firstOn}`);
  const cut = pose({ camD: 1.5 });
  const b = run(cut, 1500, 4000);
  assert.equal(b.on, false); assert.ok(b.lastOn >= 1500 + 1000 && b.lastOn <= 1500 + 2200, `off after ${b.lastOn - 1500} ms`);
  const c = run(SP.DOWN, 4000, 6000); assert.equal(c.on, true);
  const d = run(SP.DOWN, 6000, 9000, cut); assert.equal(d.on, true, 'flicker from on stays on'); assert.equal(d.lastOn > 8900, true);
  const g2 = new LegsGate(), tr2 = new Tracker(); let on2 = false;
  for (let t = 0; t < 3000; t += 33) { const f = synthFrame(Math.round(t / 33) % 2 ? SP.DOWN : cut, R); const s = tr2.update(f.snap, f.ov, ASPECT, t); on2 = g2.update(f.snap, f.ov, s.R, s.isNew, t) || on2; }
  assert.equal(on2, false, 'flicker from off stays off');
  // fullBody만 true(발목이 화면 밖)여도 켜지지 않는다
  const g3 = new LegsGate(), tr3 = new Tracker(); let on3 = false;
  for (let t = 0; t < 2000; t += 33) { const f = synthFrame(cut, R); f.snap.fullBody = true; for (const k of ['L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK']) f.snap.vis[k] = 0.9;
    const s = tr3.update(f.snap, f.ov, ASPECT, t); on3 = g3.update(f.snap, f.ov, s.R, s.isNew, t) || on3; }
  assert.equal(on3, false, 'ankles outside the image keep it off');
});

test('IdentityGuard: a different person freezes 800 ms; 3 jumps in 10 s → crowd banner', () => {
  const R = rng(11), tr = new Tracker(), ig = new IdentityGuard();
  let t = 0, jumps = 0, frozenMs = 0, crowd = false;
  const run = (P, ms) => { for (const end = t + ms; t < end; t += 33) { const f = synthFrame(P, R); const s = tr.update(f.snap, f.ov, ASPECT, t);
    const o = ig.update(s.R, s.isNew, t); if (o.jumped) jumps++; if (o.frozen) frozenMs += 33; crowd ||= o.crowd; } };
  run(SP.DOWN, 1500); assert.equal(jumps, 0, 'no false jumps from noise'); assert.equal(frozenMs, 0);
  run(pose({ size: 1.5 }), 1500); assert.equal(jumps, 1, 'bigger person'); assert.ok(frozenMs >= 760 && frozenMs <= 840, `frozen ${frozenMs}`);
  run(pose({ x: 1.0 }), 1500); assert.equal(jumps, 2, 'person somewhere else in the image');
  assert.equal(crowd, false);
  run(SP.DOWN, 1500); assert.equal(jumps, 3); assert.equal(crowd, true, '3 jumps within 10 s');
});

test('StepJudge: 400 ms hold, 400 ms slip forgiven, then 1× drain (mission semantics)', () => {
  const j = new StepJudge({ holdMs: 400, slipMs: 400 }); let r;
  for (let i = 0; i < 15; i++) r = j.update(0.9, 20); assert.equal(r.done, false); near(r.progress, 0.75, 1e-9, 'progress');
  for (let i = 0; i < 20; i++) r = j.update(0.2, 20); near(j.hold, 300, 1e-9, 'slip ≤ 400 ms keeps hold');
  for (let i = 0; i < 5; i++) r = j.update(0.2, 20); near(j.hold, 200, 1e-9, '1× drain after slip');
  for (let i = 0; i < 50; i++) j.update(0.9, 20, false); near(j.hold, 200, 1e-9, 'ok=false freezes');
  for (let i = 0; i < 9; i++) r = j.update(0.9, 20); assert.equal(r.done, false); r = j.update(0.9, 20); assert.equal(r.done, true);
  j.reset(); assert.equal(j.update(0.9, 20).progress, 0.05);
});

const S = (o) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, { s, why: s < 0.7 ? 'x' : null }]));
const feed = (c, scores, ms, dt = 16, ok = true) => { const ev = []; for (let t = 0; t < ms; t += dt) ev.push(...c.update(S(scores), dt, ok)); return ev; };

test('RepCounter cycle: arms on rest, counts on reaching the peak, min gap', () => {
  const c = new RepCounter({ kind: 'cycle', rest: 'down', peak: 'up' }, { minGapMs: 500 });
  assert.equal(feed(c, { down: 0, up: 1 }, 500).filter((e) => e.type === 'count').length, 0, 'must see rest first');
  feed(c, { down: 1, up: 0 }, 300);
  const ev = feed(c, { down: 0, up: 1 }, 200);
  assert.equal(c.count, 1); assert.ok(ev.find((e) => e.type === 'count').n === 1);
  const at = []; let t = 0; const c2 = new RepCounter({ kind: 'cycle', rest: 'down', peak: 'up' });
  for (; t < 300; t += 16) c2.update(S({ down: 1, up: 0 }), 16, true);
  for (; t < 800; t += 16) if (c2.update(S({ down: 0, up: 1 }), 16, true).some((e) => e.type === 'count')) at.push(t);
  assert.ok(at[0] - 300 <= 150, `fires ~dwell after reaching: ${at[0] - 300} ms`);
  feed(c, { down: 1, up: 0 }, 150); const ev2 = feed(c, { down: 0, up: 1 }, 150);
  assert.equal(c.count, 1, 'too fast'); assert.ok(ev2.some((e) => e.type === 'hint' && e.key === 'too_fast'));
  assert.equal(c.expected(), 'down');
});

test('RepCounter alt: other side hint once, A→B direct counts, expected side', () => {
  const r = { kind: 'alt', rest: 'center', sides: ['left', 'right'] };
  const c = new RepCounter(r, { minGapMs: 300 }); const hints = [];
  const step = (sc, ms) => { for (const e of feed(c, sc, ms)) if (e.type === 'hint') hints.push(e.key); };
  const L = { center: 0, left: 1, right: 0 }, Rr = { center: 0, left: 0, right: 1 }, C = { center: 1, left: 0, right: 0 };
  step(C, 300); step(L, 400); assert.equal(c.count, 1); step(C, 400); assert.equal(c.expected(), 'right');
  step(L, 400); assert.equal(c.count, 1, 'same side again: not counted'); assert.deepEqual(hints, ['other_side']);
  step(C, 400); step(L, 400); assert.equal(c.count, 2, 'next repeat counts (no child gets stuck)');
  step(Rr, 400); assert.equal(c.count, 3, 'A→B without rest counts B');
  step(L, 400); assert.equal(c.count, 4);
});

test('RepCounter: near-miss leniency lowers E to 0.5 at most; dropouts freeze', () => {
  const c = new RepCounter({ kind: 'cycle', rest: 'r', peak: 'p' }, { minGapMs: 0 }); let len = 0;
  const near1 = () => { for (const e of [...feed(c, { r: 1, p: 0 }, 300), ...feed(c, { r: 0.5, p: 0.55 }, 300)]) if (e.type === 'lenient') len++; };
  for (let i = 0; i < 4; i++) near1();
  len += feed(c, { r: 1, p: 0 }, 300).filter((e) => e.type === 'lenient').length;
  assert.equal(len, 2); near(c.E, 0.5, 1e-9, 'E floor'); assert.equal(c.count, 0, '0.55 < 0.6 earlier');
  feed(c, { r: 0, p: 0.55 }, 300); assert.equal(c.count, 1, 'now 0.55 ≥ 0.5 counts');
  const d = new RepCounter({ kind: 'cycle', rest: 'r', peak: 'p' });
  feed(d, { r: 1, p: 0 }, 300); feed(d, { r: 0, p: 1 }, 80); feed(d, { r: 0, p: 1 }, 1000, 16, false);
  assert.equal(d.count, 0, 'frozen while not ok'); assert.equal(d.candMs, 0, 'long dropout resets dwell only');
  feed(d, { r: 0, p: 1 }, 200); assert.equal(d.count, 1);
  feed(d, { r: 0, p: 1 }, 2000, 16, false); assert.equal(d.count, 1, 'never decreases');
});

test('HoldCounter: either side starts, 700 ms counts, blips ignored, pause keeps counts, switch, done', () => {
  const rep = { kind: 'hold', rest: 'stand', sides: ['right', 'left'], perSide: 3 };
  const h = new HoldCounter(rep, { countMs: 700 }); const ev = [];
  const run = (sc, ms) => { for (let t = 0; t < ms; t += 20) ev.push(...h.update(S(sc), 20, true)); };
  const Rt = { stand: 0, right: 1, left: 0 }, Lt = { stand: 0, right: 0, left: 1 }, St = { stand: 1, right: 0, left: 0 };
  run(Lt, 200 + 700 + 20); assert.deepEqual(h.counts, { right: 0, left: 1 }, 'left may go first');
  run(St, 300); run(Lt, 700); assert.equal(h.counts.left, 2, '300 ms blip only pauses time');
  run(St, 600); assert.ok(ev.some((e) => e.type === 'pause')); assert.equal(h.counts.left, 2, 'counts kept'); assert.equal(h.expected(), 'left');
  run(Rt, 1000); assert.equal(h.counts.right, 0, 'locked to the side that has counts');
  run(Lt, 200 + 700); assert.equal(h.counts.left, 3); assert.ok(ev.some((e) => e.type === 'switch' && e.side === 'right'));
  assert.equal(h.expected(), 'right');
  run(Rt, 200 + 3 * 700 + 40); assert.equal(h.count, 6); assert.equal(h.done, true); assert.ok(ev.some((e) => e.type === 'done'));
  const words = ev.filter((e) => e.type === 'count').map((e) => e.n); assert.deepEqual(words, [1, 2, 3, 1, 2, 3]);
  const h2 = new HoldCounter(rep);
  for (let t = 0; t < 400; t += 20) h2.update(S(Rt), 20, true); for (let t = 0; t < 600; t += 20) h2.update(S(St), 20, true);
  assert.equal(h2.req, null, 'no counts yet → unlocked');
  const h3 = new HoldCounter(rep, { perSide: 1 }); for (let t = 0; t < 2000; t += 20) h3.update(S(Rt), 20, true); assert.equal(h3.count, 1);
});

test('Baseline: still frames, force, defaults, refresh tolerance, silent rebase', () => {
  const b = new Baseline();
  const R = (i, o = {}) => ({ key: 'k' + i, T: 0.38, lean: 1, tilt: -2, reachL: 1.0, reachR: 1.02, maxElev: 20, legAngL: 6, legAngR: 7, kneeYL: -0.79, kneeYR: -0.8,
    ankYL: -1.55, ankYR: -1.56, hipAnk: 1.55, ovHipY: 0.68, ovShY: 0.51, ovTorso: 0.16, swImg: 0.12, ovHipOK: true, ...o });
  for (let i = 0; i < 5; i++) b.offer(R(i), i * 100, true);
  assert.equal(b.ready(), false, '5 frames');
  b.offer(R(5), 450, true); assert.equal(b.ready(), false, 'span < 500 ms'); b.offer(R(6), 520, true); assert.equal(b.ready(), true);
  const Bm = b.get(); near(Bm.reach, 1.01, 1e-9, 'reach mean'); assert.equal(Bm.wide, true); assert.equal(Bm.ovHipOK, true); assert.equal(b.get(), Bm, 'cached object');
  b.refresh(R(10, { lean: 2.5, tilt: 10 }), 600);
  near(Bm.lean, 1.3, 1e-9, 'EMA within ±3°'); near(Bm.tilt, -2, 1e-9, 'outside tolerance ignored');
  b.refresh(R(10, { lean: 2.5 }), 610); near(Bm.lean, 1.3, 1e-9, 'same frame key ignored');
  b.refresh(R(11, { ovHipY: 0.68 + 0.03 * 0.16 }), 620); assert.ok(Bm.ovHipY > 0.68, 'ov within 0.04 torso');
  const y = Bm.ovHipY; b.refresh(R(12, { ovHipY: 0.68 + 0.08 * 0.16 }), 640); assert.equal(Bm.ovHipY, y, 'a squat start is never absorbed');
  b.markRebase(); let t = 1000;
  for (let i = 20; i < 45; i++, t += 33) b.refresh(R(i, { T: 0.5, lean: -4 }), t);
  near(Bm.T, 0.5, 1e-9, 'rebased in place'); near(Bm.lean, -4, 1e-9); assert.equal(Bm.wide, true, 'stance decision kept'); assert.equal(b.rebase, false);
  const b2 = new Baseline(); for (let i = 0; i < 8; i++) b2.offer(R(i, { maxElev: 120, legAngL: 1, legAngR: 1 }), i * 300, false);
  assert.equal(b2.ready(), false); b2.force(); const B2 = b2.get(); assert.equal(B2.forced, true); assert.ok(B2.n <= 4, 'last 1 s only');
  assert.equal(B2.reach, 1.0, 'no arms-down frames → default reach'); assert.equal(B2.wide, false);
  const B3 = new Baseline().get({ ...EMPTY_R, T: 0.4, ovHipY: 0.6, ovShY: 0.4, ovTorso: 0.2, swImg: 0.15, ovHipOK: true });
  assert.equal(B3.defaults, true); assert.equal(B3.legAngL, 1); assert.equal(B3.kneeYL, -0.8); assert.equal(B3.ankYL, -1.6); assert.equal(B3.hipAnk, 1.6);
  assert.equal(B3.ovHipY, 0.6, 'overlay from the current frame'); assert.equal(B3.T, 0.4);
  const b4 = new Baseline(); for (let i = 0; i < 10; i++) b4.offer(R(i, { legAngL: 30 }), i * 60, true, false);
  assert.equal(b4.get().legAngL, 1, 'leg fields only from frames with legs visible');
});

test('Baseline overlay: hip offset follows slow drift only, track() re-anchors after walking closer', () => {
  const b = new Baseline();
  const R = (i, o = {}) => ({ ...EMPTY_R, key: 'k' + i, T: 0.38, maxElev: 20, ovHipY: 0.68, ovShY: 0.51, ovTorso: 0.16, swImg: 0.12, ovHipOK: true, ...o });
  for (let i = 0; i < 8; i++) b.offer(R(i), i * 100, true);
  const Bm = b.get(); near(Bm.hipOff, 0.18 / 0.16, 1e-9, 'hipOff');
  const h0 = Bm.hipOff; b.refresh(R(20, { ovHipY: 0.68 + 0.02 * 0.16 }), 900); assert.ok(Bm.hipOff > h0 && Bm.hipOff < h0 + 0.02, 'small drift followed');
  const h1 = Bm.hipOff; b.refresh(R(21, { ovHipY: 0.68 + 0.1 * 0.16 }), 930); assert.equal(Bm.hipOff, h1, 'squat-sized change ignored');
  let t = 1000, i = 30; const s = 1.25, near1 = (o = {}) => R(i++, { ovHipY: 0.5 + 0.18 * s, ovShY: 0.5 + 0.01 * s, ovTorso: 0.16 * s, swImg: 0.12 * s, ...o });
  for (; t < 2200; t += 33) assert.equal(b.track(near1(), t), false, 'not before 1.4 s');
  let done = false; for (; t < 2600; t += 33) done ||= b.track(near1(), t);
  assert.equal(done, true); near(Bm.ovTorso, 0.2, 1e-9, 're-anchored scale'); near(relFeatures(near1(), Bm, true).ovScale, 1, 1e-9);
  near(relFeatures(near1(), Bm, true).drop, 0, 0.03, 'still no drop'); assert.ok(relFeatures(near1({ ovHipY: 0.5 + 0.18 * s + 0.05 }), Bm, true).drop > 0.2, 'a squat there counts');
  const b2 = new Baseline(); for (let k = 0; k < 8; k++) b2.offer(R(k), k * 100, true); b2.get(); let any = false;
  for (let k = 0; k < 80; k++) any ||= b2.track(R(100 + k, { ovTorso: 0.16 * (k % 2 ? 1.25 : 1.0) }), 1000 + k * 33);
  assert.equal(any, false, 'an unsteady scale does not re-anchor');
});

test('relFeatures: torso units, legs only with legsOK, perspective-corrected drop, null never NaN', () => {
  const Bm = { T: 0.38, lean: 1, tilt: -2, reach: 1, legAngL: 1, legAngR: 1, kneeYL: -0.8, kneeYR: -0.8, ankYL: -1.55, ankYR: -1.55, hipAnk: 1.55,
    ovHipY: 0.68, ovShY: 0.51, ovTorso: 0.16, swImg: 0.12, ovHipOK: true, wide: true, hipOff: 0.18 / 0.16 };
  const R = { ...EMPTY_R, T: 0.38, lean: 5, tilt: 10, reachL: 0.5, legAngL: 21, legAngR: 1, kneeYL: -0.5, kneeYR: -0.8, ankYL: -1.3, ankYR: -1.55, hipAnk: 1.4,
    ovHipY: 0.68 + 0.04, ovShY: 0.55, ovTorso: 0.16, swImg: 0.12, ovHipOK: true, wrL: { x: -0.2, y: 1 }, wrR: { x: 0.3, y: 1 } };
  const F = relFeatures(R, Bm, true);
  assert.equal(F.lean, 4); assert.equal(F.tilt, 12); assert.equal(F.reachRelL, 0.5); assert.equal(F.reachRelR, null); assert.equal(F.legOutL, 20);
  near(F.kneeUpL, 0.3, 1e-9, 'kneeUp'); near(F.footUpL, 0.25, 1e-9, 'footUp'); near(F.footUpR, -0.25, 1e-9, 'mirrored');
  near(F.depth, 1 - 1.4 / 1.55, 1e-9, 'depth only with wide baseline'); near(F.drop, 0.25, 1e-9, 'drop in torso units'); assert.equal(F.ovOK, true); near(F.gap, 0.5, 1e-9, 'gap');
  const F2 = relFeatures(R, { ...Bm, wide: false }, false);
  assert.equal(F2.legOutL, null); assert.equal(F2.footUpL, null); assert.equal(F2.depth, null); assert.ok(F2.drop != null, 'drop does not need the legs');
  const F3 = relFeatures({ ...R, ovTorso: 0.16 * 1.2 }, Bm, true); assert.equal(F3.ovOK, false, 'more than ±15 % scale');
  const F4 = relFeatures({ ...R, ovHipOK: false }, { ...Bm, ovHipOK: false }, true); near(F4.drop, 0.04 / 0.18, 1e-9, 'shoulders / 1.5 sw when hips are cut');
  const F5 = relFeatures({ ...R, ovHipOK: false }, Bm, true); near(F5.drop, 0.04 / 0.16, 1e-9, 'hips lost now → shoulders / baseline torso');
  // 걸어서 다가오면(화면 중심 기준 확대) drop은 0
  const s = 1.12, Fw = relFeatures({ ...R, ovHipY: 0.5 + (0.68 - 0.5) * s, ovTorso: 0.16 * s }, Bm, true); near(Fw.drop, 0, 1e-9, 'walking closer is not a squat');
  const E = relFeatures(EMPTY_R, Bm, true);
  for (const [k, v] of Object.entries(E)) assert.ok(v === null || v === false, `${k} empty → null`);
  for (const id of CATALOG_ORDER) for (const vn of Object.keys(getMove(id).variants)) {
    const mv = resolveVariant(getMove(id), vn);
    for (const [n, r] of Object.entries(scoreAll(mv.score, E, 1))) assert.ok(r.s === 0 || (n === mv.rep.rest && r.s >= 0), `${id}/${vn}/${n} on empty F = ${r.s}`);
    for (const r of Object.values(scoreAll(mv.score, E, 1))) assert.ok(Number.isFinite(r.s));
  }
});

test('blendSpec: endpoints, neutral for missing bones, fresh Z-only arrays', () => {
  const a = KP.HIP, b = getMove('tree').keys.right.spec;
  const at = (spec, n) => { const e = spec.find(([x]) => x === n); return e ? e[2] : NEUTRAL[n] || 0; };
  for (const [u, src] of [[0, a], [1, b]]) { const s = blendSpec(a, b, u); assert.ok(isZ(s)); for (const [n, , v] of s) near(v, at(src, n), 1e-12, `u=${u} ${n}`); }
  const m = blendSpec([], KP.UP, 0); near(m.find(([n]) => n === 'leftUpperArm')[2], -1.187, 1e-12, 'missing upper arm = 차렷 drop');
  near(blendSpec(KP.DOWN, KP.UP, 0.5).find(([n]) => n === 'rightUpperArm')[2], 0.5 * (1.15 - 1.45), 1e-12, 'midpoint');
  const s1 = blendSpec(a, a, 1), s2 = blendSpec(a, a, 1); assert.notEqual(s1, s2); assert.notEqual(s1, a); assert.notEqual(s1[0][1], a[0][1], 'new axis arrays too');
});

test('Coach watch: ready 600 → cycle × watchCycles at ×1.25 → ready 400 → done', () => {
  for (const id of CATALOG_ORDER) {
    const mv = getMove(id), cyc = mv.watchCycles.single, unit = mv.unitMs;
    const c = new Coach(mv, unit, 'watch', { watchCycles: cyc });
    const total = 600 + 400 + cyc * mv.cycle.reduce((s, [, u]) => s + u * unit * 1.25, 0);
    assert.equal(c.key, mv.ready); assert.ok(isZ(c.spec()));
    let t = 0, entered = [];
    while (!c.done && t < 60000) { for (const e of c.step(10)) entered.push(e.key); t += 10; assert.ok(isZ(c.spec()), `${id} Z-only`); }
    assert.ok(Math.abs(t - total) <= 20, `${id} watch ${t} vs ${total}`);
    assert.deepEqual(entered.slice(0, mv.cycle.length), mv.cycle.map(([k]) => k), `${id} order`);
  }
  const fast = new Coach(getMove('neck'), 900, 'watch', { watchCycles: 1, watchSlow: 1 }); let t = 0; while (!fast.done) { fast.step(10); t += 10; }
  assert.ok(Math.abs(t - (1000 + 3.4 * 900)) <= 20, 'devFast watch ×1');
});

test('Coach reps: leads by at most one target, waits ≤ 2 s, keeps demonstrating, follows a fast child', () => {
  for (const id of CATALOG_ORDER.filter((x) => getMove(x).kind !== 'hold')) {
    const mv = getMove(id), c = new Coach(mv, mv.unitMs, 'reps'); let maxLead = 0, maxWait = 0, targets = 0;
    for (let t = 0; t < 30000; t += 16) { for (const e of c.step(16, 0)) if (e.target) targets++; maxLead = Math.max(maxLead, c.started - c.kidCount); if (c.waiting) maxWait = Math.max(maxWait, c.waitMs); assert.ok(isZ(c.spec())); }
    assert.ok(maxLead <= 1, `${id} lead ${maxLead}`); assert.ok(maxWait <= 2000 + 16, `${id} wait ${maxWait}`); assert.ok(targets >= 4, `${id} keeps showing (${targets})`);
  }
  const mv = getMove('sky_punch'), c = new Coach(mv, mv.unitMs, 'reps');
  assert.equal(c.key, 'left', 'first target shown at once'); c.step(100, 0);
  c.onKidCount('left', 1); assert.equal(c.key, 'left', 'in sync: no jump');
  c.onKidCount('right', 2); assert.equal(c.key, 'right', 'child faster → jump to the counted side'); assert.equal(c.started, 2);
  c.onKidCount('left', 3); assert.equal(c.key, 'left'); assert.ok(isZ(c.spec()));
  const sq = new Coach(getMove('squat'), 900, 'reps'); sq.step(50, 0); sq.onKidCount('down', 1); sq.onKidCount('down', 2); assert.equal(sq.key, 'down');
  // 기다리다가 학생이 세면 바로 다음 목표로
  const w = new Coach(getMove('neck'), 900, 'reps'); let t = 0;
  while (!w.waiting && t < 5000) { w.step(16, 0); t += 16; }
  assert.equal(w.key, 'center'); w.step(16, 1); assert.equal(w.key, 'left', 'child counted → coach goes on');
});

test('Coach hold (tree) and loops (idle, praise)', () => {
  const tree = getMove('tree'), c = new Coach(tree, 1000, 'reps'); const seen = [];
  const run = (ms, exp) => { for (let t = 0; t < ms; t += 20) { for (const e of c.step(20, 0, exp)) seen.push(e.key); assert.ok(isZ(c.spec())); } };
  run(2000, 'right'); assert.deepEqual(seen, ['arms', 'right']); assert.equal(c.key, 'right');
  run(5000, 'right'); assert.equal(c.key, 'right', 'holds while the child holds');
  c.onSwitch(); run(700, 'left'); assert.deepEqual(seen.slice(2, 4), ['stand', 'arms']);
  run(2000, 'left'); assert.equal(c.key, 'left'); run(100, null); assert.equal(c.key, 'stand', 'done → stand');
  const up = resolveVariant(tree, 'upper'), cu = new Coach(up, 1000, 'reps');
  for (let t = 0; t < 3000; t += 20) cu.step(20, 0, 'up'); assert.equal(cu.key, 'up');
  for (const M of [IDLE_MOVE, PRAISE_MOVE]) {
    const l = new Coach(M, 1, 'loop'); const keys = new Set(); const total = M.cycle.reduce((s, [, ms]) => s + ms, 0);
    for (let t = 0; t < total * 2; t += 16) { for (const e of l.step(16)) keys.add(e.key); assert.ok(isZ(l.spec())); }
    assert.equal(l.done, false); assert.deepEqual([...keys].sort(), [...new Set(M.cycle.map(([k]) => k))].sort());
  }
  const assist = new Coach(getMove('arm_push'), 700, 'loop'); let n = 0;
  for (let t = 0; t < 7000; t += 16) for (const e of assist.step(16)) if (e.target) n++;
  assert.ok(n >= 4 && n <= 6, `assist: one target entry per cycle (${n})`);
});
