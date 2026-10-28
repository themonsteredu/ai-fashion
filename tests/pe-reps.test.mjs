// 체육 동작 × 변형별 반복 세기 (SPEC §11.1 Layer 1 (a)–(h), 말 타기 함정, 다른 사람, 코치)
// 합성 아이(pe-synth.mjs) + 잡음 모델: 프레임마다 전체 크기 N(1, 0.06), 관절 떨림 σ 12 mm(손목·발목 20 mm, 얼굴 4 mm),
// 3 % 다리 관절 ×1.5, 2 % 좌표 전체 ×8, 같은 스냅샷 2–10틱 반복(틱 30/60/144 Hz, 인식 15/30 Hz), 끊김 300/600/1200 ms
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, cases, repScript, holdScript, lerpPose, pose, SP } from './pe-synth.mjs';
import { getMove, resolveVariant } from '../js/pe-moves.js';

const CASES = cases();
const mvOf = (c) => resolveVariant(getMove(c.id, { jumpMode: c.jumpMode }), c.variant);
const N = 4;
const want = (c) => (c.hold ? 3 * c.targets.length : N);
const scriptOf = (c, o = {}) => (c.hold ? holdScript(c.rest, c.targets, o) : repScript(c.rest, c.targets, N, c.period, o));
const run = (c, o) => { const r = simulate({ mv: mvOf(c), setup: c.ready, perSide: 3, ...o }); assert.equal(r.decreased, false, `${c.name}: count went down`); return r; };
// (c) 반만 한 동작: 잡음 + '아깝다' 너그러움(E→0.5)까지 넣으면 아래 동작은 50 %에서도 가끔 센다 → 더 작은 비율로 확인 (TUNE, 최종 보고 참고)
//  neck: 14°의 25 %(3.5°)부터 셈 — lo 4°가 가만히 있을 때 흔들림(p95 2.4°)+기준 오차 안쪽. squat 7 cm의 40 %, knee_up 40 %, arm_push·leg_side 55 %부터
const PART = { neck: 0.2, 'squat/full': 0.3, 'knee_up/side': 0.35, 'knee_up/forward': 0.4, arm_push: 0.45, leg_side: 0.45 };

for (const c of CASES) {
  test(`${c.name}: (a) exactly ${want(c)} at tick 30/60/144 Hz × detection 15/30 Hz; (f) never decreasing`, () => {
    for (const tickHz of [30, 60, 144]) for (const detHz of [15, 30]) for (const seed of [1, 2]) {
      const r = run(c, { script: scriptOf(c), tickHz, detHz, seed });
      assert.equal(r.count, want(c), `${c.name} ${tickHz}/${detHz} seed ${seed}: ${r.count} (setup ${Math.round(r.setupMs)} ms, forced ${r.Bm.forced})`);
      assert.equal(r.setupMs < 3000, true, `${c.name}: baseline from still ready frames`);
      if (mvOf(c).needLegs) assert.ok(r.legsFrac > 0.95, `${c.name}: legs visible`);
      else if (c.variant === 'upper') assert.equal(r.legsFrac, 0, `${c.name}: legs hidden`);
    }
  });

  test(`${c.name}: (b) still 3 s → 0; (c) partial amplitude → 0`, () => {
    for (const seed of [1, 2, 3]) {
      const still = run(c, { script: Object.assign([[0, c.ready]], { duration: 3000 }), seed });
      assert.equal(still.count, 0, `${c.name} still seed ${seed}`);
      const f = PART[c.name] ?? 0.5;
      const part = c.hold
        ? run(c, { script: holdScript(c.rest, [c.toe, c.toe]), seed })
        : run(c, { script: repScript(c.rest, c.targets.map((t) => lerpPose(c.rest, t, f)), 6, c.period), seed });
      assert.equal(part.count, 0, `${c.name} ${c.hold ? 'toe/half' : Math.round(f * 100) + '%'} seed ${seed}`);
    }
  });

  test(`${c.name}: (e) dropouts 300/600/1200 ms mid-target and mid-rest → no gain, no loss`, () => {
    for (const len of [300, 600, 1200]) for (const detHz of [15, 30]) {
      let sc, drops;
      if (c.hold) {
        sc = holdScript(c.rest, c.targets, { holdMs: 2600 + len + 600 });
        drops = [[800 + 1200, len]];
      } else {
        sc = [[0, c.rest]]; drops = []; let t = 800;
        for (let i = 0; i < N; i++) {
          const tg = c.targets[i % c.targets.length], hold = c.period / 2 + (i === 1 ? len + 600 : 0), rest = c.period / 2 + (i === 2 ? len + 600 : 0);
          sc.push([t, tg]); if (i === 1) drops.push([t + 600, len]);
          t += hold; sc.push([t, c.rest]); if (i === 2) drops.push([t + 600, len]);
          t += rest;
        }
        sc.duration = t + 1500;
      }
      const r = run(c, { script: sc, dropouts: drops, detHz, seed: 4 });
      assert.equal(r.count, want(c), `${c.name} dropout ${len} ms @${detHz}: ${r.count}`);
    }
  });

  if (c.hold) continue;
  const alt = getMove(c.id).kind === 'alt';
  if (alt) test(`${c.name}: (d) same side 3× → 2 counts + other_side; (h) A→B swings count`, () => {
    for (const seed of [1, 2]) {
      const same = run(c, { script: repScript(c.rest, [c.targets[0]], 3, c.period), seed });
      assert.equal(same.count, 2, `${c.name} same side`); assert.ok(same.hints.includes('other_side'));
      const sw = run(c, { script: repScript(c.rest, c.targets, 5, c.period, { direct: true }), seed });
      assert.equal(sw.count, 5, `${c.name} direct swings: ${sw.count}`);
    }
  });

  test(`${c.name}: (g) sensitivity k 0.8 ≥ 1 ≥ 1.15`, () => {
    let differs = false;
    for (const f of [0.55, 0.65, 0.75, 0.85]) {
      const sc = repScript(c.rest, c.targets.map((t) => lerpPose(c.rest, t, f)), N, c.period);
      const [a, b, d] = [0.8, 1, 1.15].map((k) => run(c, { script: sc, k, seed: 5 }).count);
      assert.ok(a >= b && b >= d, `${c.name} @${f}: ${a} ${b} ${d}`);
      if (a > d) differs = true;
    }
    if (!['arm_push', 'tree/upper'].includes(c.name)) assert.ok(differs, `${c.name}: k changes the threshold somewhere`);
  });
}

test('coach in the loop: never more than one target ahead, waits ≤ 2 s, child counts unchanged', () => {
  for (const c of CASES) {
    const r = run(c, { script: scriptOf(c), coach: true, seed: 6 });
    assert.equal(r.count, want(c), c.name);
    assert.ok(r.coachMaxLead <= 1, `${c.name} lead ${r.coachMaxLead}`); assert.ok(r.coachMaxWait <= 2000 + 17, `${c.name} wait ${r.coachMaxWait}`);
  }
});

const HIP_A = { eL: 50, fL: -100, eR: 50, fR: -100 };
test('squat traps: feet-together baseline then wide stance → 0; walking 25 % closer → 0', () => {
  const full = resolveVariant(getMove('squat'), 'full'), upper = resolveVariant(getMove('squat'), 'upper');
  const together = pose(HIP_A), wide = pose(HIP_A, { outL: 11, outR: 11 });
  for (const seed of [1, 2, 3]) {
    const sc = Object.assign([[0, together], [800, wide], [3000, together], [4500, wide], [6500, together]], { duration: 8000 });
    const r = simulate({ mv: full, setup: together, script: sc, seed });
    assert.equal(r.Bm.wide, false, 'baseline was taken feet together (forced)'); assert.equal(r.Bm.forced, true);
    assert.equal(r.count, 0, `widening the stance is not a squat (seed ${seed})`);
    for (const [mv, base] of [[full, wide], [upper, pose(wide, { camD: 1.4, camH: 1.25 })]]) for (const [walkMs, frac] of [[2000, 0.25], [1000, 0.25], [600, 0.14]]) {
      const w = [[0, base]], d0 = base.camD;
      for (let i = 1; i <= 10; i++) w.push([800 + (i * walkMs) / 10, pose(base, { camD: d0 * (1 - (frac * i) / 10) })]);
      w.push([800 + walkMs + 2500, pose(base, { camD: d0 })]); w.duration = 800 + walkMs + 6000;
      const rw = simulate({ mv, setup: base, script: w, seed, trans: walkMs / 10 });
      assert.equal(rw.count, 0, `${mv.variant}: walking ${frac * 100}% closer in ${walkMs} ms (seed ${seed})`);
      // 다가간 자리에서 진짜로 앉으면 센다 (기준이 따라옴)
      const near = pose(base, { camD: d0 * (1 - frac) }), sq = [...w.slice(0, 11), [800 + walkMs + 2500, near]];
      for (let i = 0; i < 3; i++) { sq.push([800 + walkMs + 2500 + i * 1800, pose(near, { squat: mv.variant === 'upper' ? 0.09 : 0.07 })]); sq.push([800 + walkMs + 3400 + i * 1800, near]); }
      sq.duration = 800 + walkMs + 2500 + 3 * 1800 + 1500;
      const rs = simulate({ mv, setup: base, script: sq, seed, trans: 200 });
      assert.equal(rs.count, 3, `${mv.variant}: squats after walking closer counted (seed ${seed}): ${rs.count}`);
    }
  }
});

test('a different child steps in mid-set: freeze + silent rebase, count kept, the new child is counted', () => {
  const c = CASES.find((x) => x.name === 'jumping_jack/full'), mv = mvOf(c);
  const big = (p) => pose(p, { size: 1.45, x: 0.1 });
  const sc = repScript(c.rest, c.targets, 2, c.period);
  const tail = sc.duration - 1500, sc2 = [...sc, [tail, big(c.rest), { instant: true }]];
  for (let i = 0; i < 3; i++) { sc2.push([tail + 1500 + i * c.period, big(c.targets[i % 2])]); sc2.push([tail + 1500 + i * c.period + c.period / 2, big(c.rest)]); }
  sc2.duration = tail + 1500 + 3 * c.period + 1500;
  for (const seed of [1, 2]) {
    const r = simulate({ mv, setup: c.ready, script: sc2, seed });
    assert.ok(r.jumps >= 1, 'identity jump seen'); assert.equal(r.decreased, false);
    assert.equal(r.count, 5, `2 + 3 (seed ${seed}): ${r.count}`); assert.ok(r.Bm.rebased >= 1, 'baseline re-taken silently');
  }
});

test('setup never gets stuck: no ready pose → forced at 3 s; nobody → defaults at 6 s', () => {
  const c = CASES.find((x) => x.name === 'neck'), mv = mvOf(c);
  const r = simulate({ mv, setup: SP.DOWN, script: Object.assign([[0, SP.DOWN]], { duration: 500 }), seed: 1 });
  assert.equal(r.Bm.forced, true); assert.ok(r.setupMs >= 3000 && r.setupMs < 3100);
  const r2 = simulate({ mv, setup: SP.HIP, script: Object.assign([[0, SP.HIP]], { duration: 500 }), seed: 1, nobodyInSetup: true });
  assert.equal(r2.Bm.defaults, true); assert.ok(r2.setupMs >= 6000 && r2.setupMs < 6100); assert.equal(r2.Bm.tilt, 0);
});
