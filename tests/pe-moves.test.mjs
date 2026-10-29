// 체육 동작 데이터 점검 (SPEC §3.7 data lint, §11.1-7 측정값 대조) + 설정·통계 저장
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, CATALOG_ORDER, COURSE_DEFAULT, KP, IDLE_LOOP, getMove, countWord, mirror, HINTS, hintText, resolveVariant, parseFallback, legsDecision,
  PE_DEFAULTS, normalizePESettings, loadPESettings, savePESettings, resetPESettings, courseMoves, enabledMoves, repsFor, targetFor, SENS_K,
  loadPEStats, recordPEStart, recordPEResult, recordPESession, resetPEStats, summarizePEStats, isPEDebug, LS_PE_SETTINGS, IDLE_MOVE } from '../js/pe-moves.js';
import { scoreAll, EMPTY_R, RepCounter } from '../js/pe-engine.js';

const ALL = [...CATALOG_ORDER.map((id) => [id, getMove(id, { jumpMode: 'step' })]), ['jumping_jack:jump', getMove('jumping_jack', { jumpMode: 'jump' })]];
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('catalog: order, course, ids and copy', () => {
  assert.deepEqual(Object.keys(MOVES).sort(), [...CATALOG_ORDER].sort());
  assert.deepEqual(COURSE_DEFAULT, ['neck', 'arm_push', 'side_bend', 'squat', 'jumping_jack', 'breathe']);
  for (const [id, m] of ALL) {
    assert.equal(m.id, id.split(':')[0]);
    for (const f of ['name', 'short', 'emoji', 'theme', 'badge', 'praise', 'safety', 'readyLabel']) assert.ok(typeof m[f] === 'string' && m[f], `${id}.${f}`);
    assert.ok(m.text.main && m.text.sub && m.text.why, `${id} text`);
    assert.ok(['none', 'prefer', 'need'].includes(m.legs)); assert.ok(['alt', 'cycle', 'hold'].includes(m.kind));
    assert.ok(m.reps.single >= 1 && m.reps.course >= 1 && m.unitMs > 0 && m.minGapMs >= 0);
    assert.equal(typeof m.readyScore, 'function'); assert.ok(m.keys[m.ready], `${id} ready key`);
  }
  assert.equal(getMove('jumping_jack').name, '팔 벌려 콩콩', 'step is the default'); assert.equal(getMove('jumping_jack', { jumpMode: 'jump' }).name, '팔 벌려 뛰기');
});

test('data lint: keys exist, rep scores exist in every variant, Z-only, angle limits, fallbacks resolve', () => {
  const specs = [];
  for (const [id, m] of ALL) {
    for (const vn of Object.keys(m.variants)) {
      const v = resolveVariant(m, vn);
      for (const [k, u] of v.cycle) { assert.ok(v.keys[k], `${id}/${vn} cycle key ${k}`); assert.ok(u > 0); }
      for (const k of v.targetKeys) { assert.ok(v.keys[k], `${id}/${vn} target ${k}`); assert.ok(v.cycle.some(([c]) => c === k), `${id}/${vn} target ${k} in cycle`); }
      for (const st of v.steps) { assert.ok(v.keys[st.key], `${id}/${vn} step key ${st.key}`); assert.ok(v.score[st.score], `${id}/${vn} step score ${st.score}`); }
      const rep = v.rep, names = [rep.rest, ...(rep.peak ? [rep.peak] : rep.sides)];
      for (const n of names) assert.equal(typeof v.score[n], 'function', `${id}/${vn} rep score ${n}`);
      if (rep.kind === 'alt' || rep.kind === 'hold') for (const sd of rep.sides) assert.ok(v.keys[sd], `${id}/${vn} side ${sd} is also a key`);
      assert.ok(v.keys[rep.rest] || rep.kind === 'cycle', `${id}/${vn} rest`);
      for (const k of Object.values(v.keys)) specs.push([id, k.spec]);
    }
    const fb = parseFallback(m);
    if (m.fallback) {
      assert.ok(fb, `${id} fallback ${m.fallback} resolves`);
      if (fb.type === 'move') assert.equal(getMove(fb.id).legs, 'none', 'substitute needs no legs');
    }
    if (m.legs !== 'none') assert.ok(m.fallback, `${id} with legs has a fallback`);
  }
  for (const s of Object.values(KP)) specs.push(['KP', s]);
  for (const [id, spec] of specs) for (const [b, ax, a] of spec) {
    assert.deepEqual(ax, [0, 0, 1], `${id} ${b} Z-only`);
    if (b === 'leftUpperArm') assert.ok(a >= -1.2 && a <= 1.8, `${id} ${b} ${a}`);
    if (b === 'rightUpperArm') assert.ok(a >= -1.8 && a <= 1.2, `${id} ${b} ${a}`);
    if (/UpperLeg$/.test(b)) assert.ok(Math.abs(a) <= 1.4, `${id} ${b} ${a}`);
    if (/Lower(Arm|Leg)$/.test(b)) assert.ok(Math.abs(a) <= 3.0, `${id} ${b} ${a}`);
  }
  for (const [k] of IDLE_LOOP) assert.ok(KP[k]); assert.ok(IDLE_MOVE.keys.DOWN.spec === KP.DOWN);
  assert.deepEqual(mirror(KP.HIP), [['rightUpperArm', [0, 0, 1], 0.7], ['rightLowerArm', [0, 0, 1], 1.6], ['leftUpperArm', [0, 0, 1], -0.7], ['leftLowerArm', [0, 0, 1], -1.6]]);
  for (const [id, m] of ALL) if (m.kind === 'alt') {           // 왼쪽/오른쪽 키는 서로 거울
    const [a, b] = m.rep.sides, norm = (s) => JSON.stringify([...s].sort((x, y) => x[0].localeCompare(y[0])));
    assert.equal(norm(mirror(m.keys[a].spec)), norm(m.keys[b].spec), `${id} sides mirror`);
  }
});

test('spot checks against the measured matrix (SPEC §11.1-7)', () => {
  const sc = (id, n, F, k = 1, mode) => getMove(id, { jumpMode: mode }).variants.full.score[n](F, k).s;
  assert.equal(sc('side_bend', 'right', { lean: 17.7, elevL: 108 }).toFixed(2), '0.86');
  assert.equal(sc('side_bend', 'center', { lean: 0 }), 1);
  assert.equal(sc('jumping_jack', 'open', { minElev: 171, legOutL: 24, legOutR: 0 }), 1);
  assert.equal(sc('jumping_jack', 'closed', { maxElev: 24, legOutL: 0.5, legOutR: 0 }), 1);
  assert.equal(sc('knee_up', 'left', { kneeUpL: 0.42, kneeUpR: 0, footUpL: 0.39 }), 1);
  assert.equal(sc('knee_up', 'left', { kneeUpL: 0.23, kneeUpR: 0.23, footUpL: 0 }), 0, 'both knees in a sumo squat');
  assert.equal(sc('squat', 'down', { ovOK: true, drop: 0.27, depth: null }), 1);
  assert.equal(sc('squat', 'up', { ovOK: true, drop: 0.01, depth: null }), 1);
  assert.equal(sc('squat', 'up', { ovOK: false, depth: null }), 0, 'no signal → not standing');
  assert.equal(sc('tree', 'right', { footUpR: 1.04 }), 1); assert.equal(sc('tree', 'right', { footUpR: 0.07 }), 0, 'toe down not counted');
  assert.equal(sc('tree', 'right', { footUpR: 0.07 }, 0.8), 0); assert.ok(sc('tree', 'right', { footUpR: 0.2 }, 0.8) >= 0.7, '너그럽게 0.08→0.24');
  assert.equal(sc('neck', 'right', { tilt: 22.8 }), 1); assert.equal(sc('neck', 'right', { tilt: 8 }).toFixed(2), '0.57');
  assert.deepEqual(getMove('neck').variants.full.score.right({ tilt: null }, 1), { s: 0, why: 'face_front' });
  assert.equal(sc('sky_punch', 'left', { elevL: 165, elevR: 20 }), 1); assert.equal(sc('sky_punch', 'left', { elevL: 165, elevR: 120 }), 0, 'other arm must stay down');
  assert.equal(sc('breathe', 'up', { minElev: 172 }), 1);
  assert.equal(sc('leg_side', 'left', { legOutL: 24, footUpL: 0.15, legOutR: 1 }), 1);
  assert.equal(sc('leg_side', 'left', { legOutL: 10, footUpL: 0.15, legOutR: 10 }), 0.25, 'wide stance is not a leg raise');
  // 민감도 k는 목표 점수를 올바른 방향으로 움직인다 (0.8 ≥ 1 ≥ 1.15)
  const F = { tilt: 8, elevL: 130, elevR: 20, minElev: 130, lean: 8, drop: 0.13, ovOK: true, depth: 0.06, legOutL: 9, legOutR: 9, kneeUpL: 0.22, footUpL: 0.18, footUpR: 0.18, ovScale: 1 };
  for (const [id, m] of ALL) for (const v of Object.values(m.variants)) for (const n of Object.keys(v.score)) {
    const a = v.score[n](F, 0.8).s, b = v.score[n](F, 1).s, c = v.score[n](F, 1.15).s;
    assert.ok(a >= b - 1e-9 && b >= c - 1e-9, `${id}.${n}: ${a} ${b} ${c}`);
  }
  assert.equal(SENS_K.easy, 0.8); assert.equal(SENS_K.normal, 1); assert.equal(SENS_K.strict, 1.15);
});

test('hints: every why a score or counter can produce has Korean text', () => {
  const whys = new Set(['other_side', 'too_fast', 'face_front']);
  const probes = [{}, EMPTY_R, { tilt: 30 }, { tilt: -30 }, { lean: 30, elevL: 60, elevR: 60 }, { lean: -30 }, { maxElev: 170, minElev: 20, elevL: 20, elevR: 170 },
    { reachRelL: 1, reachRelR: 1, wrElL: -1, wrElR: -1, elevL: 10, elevR: 10, maxElev: 10 }, { ovOK: true, drop: 0.5, ovScale: 1.3, depth: 0.2 },
    { legOutL: 20, legOutR: 20, footUpL: 0, footUpR: 0, kneeUpL: 0.5, kneeUpR: 0.5, minElev: 10, maxElev: 10 }, { upL: -1, upR: -1, gap: 2 }];
  for (const [, m] of ALL) for (const v of Object.values(m.variants)) for (const F of probes) for (const r of Object.values(scoreAll(v.score, F, 1))) if (r.why) whys.add(r.why);
  for (const w of whys) assert.ok(HINTS[w] && hintText(w), `hint for ${w}`);
  assert.equal(hintText('too_fast', getMove('breathe')), '천천히~ 숨을 크게 🌬️'); assert.notEqual(hintText('too_fast', getMove('neck')), HINTS.too_fast);
  assert.equal(hintText(null), ''); assert.equal(hintText('other_side'), '이번엔 반대쪽! 👉');
});

test('countWord: 구령 하나 둘 셋 넷 / 둘 둘 셋 넷', () => {
  assert.equal(Array.from({ length: 8 }, (_, i) => countWord(i)).join(' '), '하나 둘 셋 넷 둘 둘 셋 넷');
  assert.equal(countWord(8), '셋'); assert.equal(countWord(12), '넷');
});

test('variants and fallbacks: tree upper, substitutes, legs decision', () => {
  const tu = resolveVariant(getMove('tree'), 'upper');
  assert.equal(tu.variant, 'upper'); assert.equal(tu.variantLabel, '기지개 버티기'); assert.deepEqual(tu.targetKeys, ['up']); assert.ok(tu.keys.up && tu.keys.stand);
  assert.deepEqual(tu.steps, [{ key: 'up', score: 'up' }], 'steps fall back to the variant target'); assert.equal(targetFor(tu, 3), 3); assert.equal(targetFor(resolveVariant(getMove('tree')), 3), 6);
  assert.equal(resolveVariant(getMove('squat'), 'nope').variant, 'full');
  assert.deepEqual(resolveVariant(getMove('breathe')).steps, []);
  assert.deepEqual(parseFallback(getMove('knee_up')), { type: 'move', id: 'sky_punch' });
  assert.deepEqual(parseFallback(getMove('leg_side')), { type: 'skip' }); assert.equal(parseFallback(getMove('neck')), null);
  assert.deepEqual(legsDecision(getMove('neck'), false), { type: 'variant', name: 'full' });
  assert.deepEqual(legsDecision(getMove('squat'), true), { type: 'variant', name: 'full' });
  assert.deepEqual(legsDecision(getMove('squat'), false), { type: 'variant', name: 'upper' });
  assert.deepEqual(legsDecision(getMove('squat'), true, 'upper'), { type: 'variant', name: 'upper' }, '항상 상체 버전');
  assert.deepEqual(legsDecision(getMove('knee_up'), false), { type: 'move', id: 'sky_punch' });
  // 각 변형의 rep으로 카운터를 만들 수 있다
  for (const [id, m] of ALL) for (const vn of Object.keys(m.variants)) { const v = resolveVariant(m, vn); if (v.rep.kind !== 'hold') assert.ok(new RepCounter(v.rep).expected(), `${id}/${vn}`); }
});

test('settings: defaults, clamping, per-move reps rule, round trip, broken storage', () => {
  const st = memStore();
  const d = loadPESettings(st);
  assert.equal(d.sensitivity, 'normal'); assert.equal(d.tempo, 1); assert.equal(d.holdMs, 400); assert.equal(d.slipMs, 400); assert.equal(d.jumpMode, 'step');
  assert.equal(d.legsMode, 'auto'); assert.equal(d.autoStartSec, 20); assert.equal(d.resultTimeoutSec, 40); assert.equal(d.moveTimeLimitSec, 40); assert.equal(d.noProgressSec, 12);
  assert.equal(d.volume, 70); assert.equal(d.practice, true); assert.equal(d.practiceInCourse, false); assert.equal(d.devFast, false);
  assert.ok(CATALOG_ORDER.every((id) => d.enabled[id] === true)); assert.deepEqual(courseMoves(d), COURSE_DEFAULT);
  const s = savePESettings({ ...d, sensitivity: 'easy', tempo: '1.3', holdMs: 5000, slipMs: -3, volume: '55', autoStartSec: 99, noProgressSec: 1, jumpMode: 'jump', legsMode: 'upper',
    enabled: { ...d.enabled, neck: false }, course: { ...d.course, breathe: true, sky_punch: true, side_bend: false }, reps: { arm_push: 8, neck: 6, tree: 9, squat: 1, knee_up: '' } }, st);
  assert.equal(s.sensitivity, 'easy'); assert.equal(s.tempo, 1.25); assert.equal(s.holdMs, 1000); assert.equal(s.slipMs, 0); assert.equal(s.volume, 55);
  assert.equal(s.autoStartSec, 60); assert.equal(s.noProgressSec, 6); assert.equal(s.jumpMode, 'jump'); assert.equal(s.legsMode, 'upper');
  assert.deepEqual(s.reps, { neck: 6, squat: 2, tree: 5 }, 'clamped; equal-to-default dropped');
  assert.deepEqual(courseMoves(s), ['arm_push', 'sky_punch', 'squat', 'jumping_jack', 'breathe'], 'catalog order, disabled removed, breathe last');
  assert.deepEqual(loadPESettings(st), s, 'round trip');
  assert.equal(repsFor(getMove('arm_push'), s, true), 4, 'course keeps the short count'); assert.equal(repsFor(getMove('neck'), s, true), 6);
  assert.equal(repsFor(getMove('tree'), s, false), 5);
  const qa = normalizePESettings({ reps: 3, devFast: true, autoStartSec: 0, resultTimeoutSec: 0, voice: false, sfx: false, practice: false });
  assert.equal(qa.reps, 3); assert.equal(repsFor(getMove('squat'), qa, false), 3); assert.equal(qa.devFast, true); assert.equal(qa.autoStartSec, 0); assert.equal(qa.voice, false);
  assert.ok(!enabledMoves(s).includes('neck'));
  const r = resetPESettings(st); assert.equal(st.m.has(LS_PE_SETTINGS), false); assert.deepEqual(r, normalizePESettings({}));
  st.setItem(LS_PE_SETTINGS, '{broken'); assert.deepEqual(loadPESettings(st), normalizePESettings({}));
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.deepEqual(loadPESettings(bad), normalizePESettings({})); assert.doesNotThrow(() => savePESettings(d, bad)); assert.doesNotThrow(() => resetPESettings(bad));
  assert.equal(isPEDebug(bad), false); const dbg = memStore(); dbg.setItem('fas_pe_debug', '1'); assert.equal(isPEDebug(dbg), true);
  assert.ok(Object.isFrozen(PE_DEFAULTS));
});

test('stats: per move counters, sessions, summary, reset', () => {
  const st = memStore();
  recordPEStart('squat', st); recordPEResult('squat', { outcome: 'completed', stars: 3, reps: 8, ms: 20000 }, st);
  recordPEStart('squat', st); recordPEResult('squat', { outcome: 'partial', variant: 'upper', stars: 1, reps: 3, ms: 40000, manual: 1 }, st);
  recordPEStart('knee_up', st); recordPEResult('knee_up', { outcome: 'completed', variant: 'sub:sky_punch', stars: 2, reps: 8, ms: 15000 }, st);
  recordPEStart('neck', st); recordPEResult('neck', { outcome: 'assist', variant: 'assist', reps: 4, ms: 9000 }, st);
  recordPESession({ course: true }, st); recordPESession({}, st);
  const s = loadPEStats(st);
  assert.equal(s.sessions, 2); assert.equal(s.courses, 1);
  assert.deepEqual({ ...s.squat }, { started: 2, completed: 1, partial: 1, skipped: 0, assist: 0, manual: 1, upper: 1, sub: 0, stars: 4, rated: 2, totalReps: 11, totalMs: 60000 });
  assert.deepEqual(summarizePEStats(s.squat), { started: 2, completed: 1, avgStars: 2, altPct: 50, avgSec: 30 });
  assert.equal(s.knee_up.sub, 1); assert.equal(s.neck.assist, 1); assert.equal(s.neck.rated, 0, 'assist has no stars');
  assert.deepEqual(summarizePEStats(undefined), { started: 0, completed: 0, avgStars: null, altPct: null, avgSec: null });
  resetPEStats(st); assert.deepEqual(loadPEStats(st), {});
});
