// 체육 엔진 테스트 도우미: 합성 아이(getPoseSnapshot/getPoseOverlay 모양의 가짜 프레임) + pe-ui tick과 같은 파이프라인 시뮬레이터
// (테스트 파일이 아니라서 *.test.mjs가 아님)
// 좌표: pts = 엉덩이 중심 m, y 위, 학생 오른쪽 +x (L_*는 −x). 화면(overlay) = 원본 영상 0..1, y 아래, 좌우 반전 없음.
import { Sensor, Baseline, relFeatures, scoreAll, StepJudge, RepCounter, HoldCounter, Coach } from '../js/pe-engine.js';

export const BODY = { sh: 0.14, ua: 0.20, fa: 0.18, torso: 0.38, hip: 0.08, th: 0.30, sn: 0.29, ank: 0.05 };  // 아이 비율 (m)
const LEG = BODY.th + BODY.sn;
const F_CAM = 1.207;                     // 세로 화각 약 45°
export const ASPECT = 4 / 3;
const d2r = Math.PI / 180;

// 자세 변수 (모두 숫자라 보간 가능). 팔: e = 들어 올린 각(0 아래·90 옆·180 위, 180 넘으면 머리 위로 반대쪽), f = 팔꿈치 접힘(같은 방향으로 더 돎)
// 다리: out = 곧은 다리 벌림(°), side = 무릎 옆으로 들기(0..1), fwd = 무릎 앞으로(0..1), tree = 나무 자세 발(0..1), squat = 엉덩이 내려감(m)
// cam: 카메라 거리·높이·좌우, x = 아이의 좌우 위치, size = 몸 크기 배율
export const P0 = Object.freeze({ eL: 15, fL: 0, eR: 15, fR: 0, lean: 0, tilt: 0, outL: 0, outR: 0, sideL: 0, sideR: 0, fwdL: 0, fwdR: 0,
  treeL: 0, treeR: 0, squat: 0, camD: 2.8, camH: 1.05, camX: 0, x: 0, size: 1 });
export const pose = (...o) => Object.assign({}, P0, ...o);
export const lerpPose = (a, b, u) => { const o = {}; for (const k of Object.keys(P0)) o[k] = a[k] + (b[k] - a[k]) * u; return o; };

export function joints(P) {
  const z = P.size || 1, J = {};
  const add = (p, v, L) => [p[0] + v[0] * L * z, p[1] + v[1] * L * z];
  const lam = P.lean * d2r, up = [Math.sin(lam), Math.cos(lam)], pp = [Math.cos(lam), -Math.sin(lam)];
  const S = add([0, 0], up, BODY.torso);
  J.L_SH = add(S, pp, -BODY.sh); J.R_SH = add(S, pp, BODY.sh);
  for (const [s, sg] of [['L', -1], ['R', 1]]) {
    const e = P['e' + s] * d2r, f = (P['e' + s] + P['f' + s]) * d2r;
    J[s + '_EL'] = add(J[s + '_SH'], [sg * Math.sin(e), -Math.cos(e)], BODY.ua);
    J[s + '_WR'] = add(J[s + '_EL'], [sg * Math.sin(f), -Math.cos(f)], BODY.fa);
  }
  const hd = (P.lean + P.tilt) * d2r, hu = [Math.sin(hd), Math.cos(hd)], hp = [Math.cos(hd), -Math.sin(hd)];
  const hc = add(S, hu, 0.17);
  J.NOSE = add(hc, hu, -0.01);
  J.L_EYE = add(add(hc, hu, 0.015), hp, -0.03); J.R_EYE = add(add(hc, hu, 0.015), hp, 0.03);
  J.L_EAR = add(hc, hp, -0.065); J.R_EAR = add(hc, hp, 0.065);
  J.L_HIP = [-BODY.hip * z, 0]; J.R_HIP = [BODY.hip * z, 0];
  for (const [s, sg] of [['L', -1], ['R', 1]]) {
    const hip = J[s + '_HIP'], out = P['out' + s];
    if (P.squat > 1e-4) {                                                // 발은 바닥에 그대로, 무릎은 바깥·앞으로 (2관절 IK)
      const o = out * d2r, A0 = add(hip, [sg * Math.sin(o), -Math.cos(o)], LEG), An = [A0[0], A0[1] + P.squat];
      const L1 = BODY.th * z, L2 = BODY.sn * z, dx = An[0] - hip[0], dy = An[1] - hip[1], D = Math.hypot(dx, dy);
      const u = [dx / D, dy / D], n = [sg * -u[1], sg * u[0]];
      if (D >= L1 + L2) J[s + '_KNEE'] = [hip[0] + u[0] * L1, hip[1] + u[1] * L1];
      else { const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
        J[s + '_KNEE'] = [hip[0] + u[0] * a + n[0] * 0.6 * h, hip[1] + u[1] * a + n[1] * 0.6 * h]; }
      J[s + '_ANK'] = An;
    } else {                                                             // 모양 섞기: 곧게 / 옆 무릎 / 앞 무릎 / 나무
      const side = P['side' + s], fwd = P['fwd' + s], tree = P['tree' + s], wb = Math.max(0, 1 - side - tree);
      const th = wb * out + side * 70 + tree * 50, Lt = wb * BODY.th * Math.cos(80 * fwd * d2r) + side * BODY.th + tree * 0.26;  // 앞으로 들면 허벅지가 짧아 보임
      const sn = wb * out - 25 * side - 54.5 * tree, Ls = (wb + side) * BODY.sn + tree * 0.28;
      J[s + '_KNEE'] = add(hip, [sg * Math.sin(th * d2r), -Math.cos(th * d2r)], Lt);
      J[s + '_ANK'] = add(J[s + '_KNEE'], [sg * Math.sin(sn * d2r), -Math.cos(sn * d2r)], Ls);
    }
  }
  return J;
}

const OV_IDX = { NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28 };
const EXTREM = new Set(['L_WR', 'R_WR', 'L_ANK', 'R_ANK']);
const FACE = new Set(['NOSE', 'L_EYE', 'R_EYE', 'L_EAR', 'R_EAR']);   // 얼굴 점은 몸 관절보다 훨씬 정확 (σ 4 mm)
const LEGJ = ['L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK'];

export function rng(seed = 1) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = () => { let x = 0; for (let i = 0; i < 6; i++) x += u(); return (x - 3) / Math.SQRT2; };   // 대략 N(0,1)
  return { u, g };
}

// 한 인식 프레임: { snap, ov }. noise=false면 깨끗한 값(그래도 키가 매번 달라지게 아주 작은 떨림)
export function synthFrame(P, R, { noise = true, spikes = true } = {}) {
  const J = joints(P);
  const hipW = (LEG + BODY.ank) * (P.size || 1) - P.squat;
  const s = noise ? Math.max(0.8, Math.min(1.2, 1 + 0.06 * R.g())) : 1;
  const big = noise && spikes && R.u() < 0.02 ? 8 : 1;                                 // 2 %: 좌표 전체 ×8 (비율은 그대로여야)
  const legSpike = noise && spikes && R.u() < 0.03 ? LEGJ[Math.floor(R.u() * 4)] : null; // 3 %: 다리 관절 하나 ×1.5
  const pts = {}, vis = {}, ov = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  for (const [k, [x, y]] of Object.entries(J)) {
    const sg = noise ? (EXTREM.has(k) ? 0.02 : FACE.has(k) ? 0.004 : 0.012) : 1e-5;
    let px = x + sg * R.g(), py = y + sg * R.g();
    if (k === legSpike) { px *= 1.5; py *= 1.5; }
    pts[k] = { x: px * s * big, y: py * s * big, z: 0 };
    const X = P.x + x + (noise ? sg * R.g() : 0), Y = hipW + y + (noise ? sg * R.g() : 0);
    const u = 0.5 - (F_CAM * (X - P.camX)) / (P.camD * ASPECT), v = 0.5 - (F_CAM * (Y - P.camH)) / P.camD;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    vis[k] = inside ? 0.92 + (noise ? 0.04 * (R.u() - 0.5) : 0) : 0.15;
    ov[OV_IDX[k]] = { x: u, y: v, visibility: vis[k] };
  }
  const snap = { present: true, calibrated: true, shoulderW: Math.hypot(pts.L_SH.x - pts.R_SH.x, pts.L_SH.y - pts.R_SH.y), pts, vis,
    fullBody: vis.L_ANK > 0.5 && vis.R_ANK > 0.5 };
  return { snap, ov };
}

// 대본: [[tMs, pose], …] — tMs에 그 자세로 trans ms 동안 옮겨 가서 다음 칸까지 유지
export function poseAt(script, t, trans = 200) {
  let i = 0; while (i + 1 < script.length && script[i + 1][0] <= t) i++;
  const [t0, p, opt] = script[i]; if (i === 0 || t < t0) return script[0][1];
  if (opt && opt.instant) return p;                                              // 다른 사람으로 바뀜 등
  return lerpPose(script[i - 1][1], p, Math.min(1, (t - t0) / trans));
}
// 반복 대본: 처음 lead ms는 rest, 그 뒤 period마다 목표(targets 순환)를 period/2 유지 → rest
export function repScript(rest, targets, n, period, { lead = 800, direct = false, tail = 1500 } = {}) {
  const sc = [[0, rest]];
  for (let i = 0; i < n; i++) {
    const t0 = lead + i * period;
    sc.push([t0, targets[i % targets.length]]);
    if (!direct) sc.push([t0 + period / 2, rest]);
  }
  if (direct) sc.push([lead + n * period, rest]);
  sc.duration = lead + n * period + tail;
  return sc;
}

// pe-ui tick의 setup → reps를 그대로 흉내: Sensor → (setup: readyScore·Baseline) → (reps: relFeatures → 점수 → 카운터, 쉴 때 refresh)
export function simulate(o) {
  const { mv, k = 1, tickHz = 60, detHz = 30, seed = 1, noise = true, spikes = true, setup, script, dropouts = [],
    hold = mv.rep.kind === 'hold', perSide, minGapMs = mv.minGapMs, rel = relFeatures, coach: withCoach = false, trans = 200 } = o;
  const R = rng(seed), sensor = new Sensor(), base = new Baseline(), judge = new StepJudge({ holdMs: 400 });
  const setupScript = Array.isArray(setup) ? setup : [[0, setup || script[0][1]]];
  const repsMs = o.repsMs ?? script.duration ?? (script[script.length - 1][0] + 1500);
  const dt = 1000 / tickHz, detDt = 1000 / detHz;
  const out = { count: 0, events: [], hints: [], decreased: false, Bm: null, setupMs: 0, legsOn: [], okMs: 0, coachMaxLead: 0, coachMaxWait: 0, jumps: 0 };
  let phase = 'setup', t = 0, tPhase = 0, repsStart = 0, nextDet = 0, frame = { snap: { present: false }, ov: null }, counter = null, coach = null, Bm = null;
  const childAt = (tp) => (phase === 'setup' ? poseAt(setupScript, tp, trans) : poseAt(script, tp - repsStart, trans));
  const inDrop = (tp) => (phase === 'setup' ? !!o.nobodyInSetup : dropouts.some(([a, len]) => tp - repsStart >= a && tp - repsStart < a + len));
  for (let guard = 0; guard < 1e6; guard++) {
    while (t >= nextDet) { const tp = nextDet; nextDet += detDt * (noise ? 0.9 + 0.2 * R.u() : 1);
      frame = inDrop(tp) ? { snap: { present: false, calibrated: true }, ov: null } : synthFrame(childAt(tp), R, { noise, spikes }); }
    const s = sensor.update(frame.snap, frame.ov, ASPECT, t);
    if (phase === 'setup') {
      const rs = mv.readyScore(s.R, s.legsOK);
      if (s.isNew) base.offer(s.R, t, s.still && rs >= 0.7, s.legsOK);
      const j = judge.update(rs, dt, s.ok); tPhase += dt;
      let go = j.done && base.ready();
      if (!go && tPhase >= 3000 && base.size() >= 6) { base.force(); go = true; }
      if (go || tPhase >= 6000) {
        Bm = out.Bm = base.get(s.R); sensor.tracker.setRef(Bm.T); out.setupMs = tPhase; out.legsAtSetup = s.legsOK;
        phase = 'reps'; repsStart = t; tPhase = 0;
        counter = hold ? new HoldCounter(mv.rep, { countMs: mv.countMs || 700, perSide }) : new RepCounter(mv.rep, { minGapMs });
        if (withCoach) coach = new Coach(mv, mv.unitMs, 'reps');
      }
    } else {
      const F = rel(s.R, Bm, s.legsOK), sc = scoreAll(mv.score, F, k);
      if (s.jumped || s.refLost) { base.markRebase(); out.jumps++; }
      const ev = counter.update(sc, dt, s.ok);
      if (o.onTick) o.onTick(t - repsStart, s, F, sc, counter, sensor);
      if (s.ok) out.okMs += dt;
      if (!hold && s.isNew && counter.restMs >= 400) base.refresh(s.R, t, s.legsOK);
      if (s.isNew && base.track(s.R, t)) out.rescaled = (out.rescaled || 0) + 1;
      for (const e of ev) {
        out.events.push({ t: t - repsStart, ...e });
        if (e.type === 'hint') out.hints.push(e.key);
        if (e.type === 'count' && coach) coach.onKidCount(e.key, counter.count);
        if (e.type === 'switch' && coach) coach.onSwitch();
      }
      if (counter.count < out.count) out.decreased = true;
      out.count = counter.count;
      if (coach) {
        coach.step(dt, counter.count, hold ? counter.expected() : undefined);
        out.coachMaxLead = Math.max(out.coachMaxLead, coach.started - coach.kidCount);
        out.coachMaxWait = Math.max(out.coachMaxWait, coach.waiting ? coach.waitMs : 0);
      }
      out.legsOn.push(s.legsOK);
      tPhase += dt; if (tPhase >= repsMs) break;
    }
    t += dt;
  }
  out.counter = counter; out.lenient = out.events.filter((e) => e.type === 'lenient').length;
  out.legsFrac = out.legsOn.length ? out.legsOn.filter(Boolean).length / out.legsOn.length : 0;
  return out;
}

// ── 동작별 합성 자세 (학생 자신의 좌우) ──
const HIP_A = { eL: 50, fL: -100, eR: 50, fR: -100 };
export const SP = {
  DOWN: pose(),
  HIP: pose(HIP_A),
  T: pose({ eL: 90, eR: 90 }),
  UP: pose({ eL: 175, eR: 175 }),
  SHOULDER: pose({ eL: 15, fL: 165, eR: 15, fR: 165 }),
  HANDS_UP: pose({ eL: 160, fL: 70, eR: 160, fR: 70 }),
};
const WIDE = { outL: 11, outR: 11 };
const CUT_LEGS = { camD: 1.5 };                       // 가까이 서서 무릎·발이 화면 밖
const CUT_HIPS = { camD: 1.4, camH: 1.25 };           // 더 가깝고 높게: 엉덩이까지 화면 밖
// 각 경우: ready(준비 자세), rest(쉬는 자세), targets(목표 순서대로 돌아감), period(ms), half(반만 한 목표), cam(카메라)
// 크기는 '확실히 세는 아이 동작이면서 반만 하면 0.45 미만'으로 골랐다 (SPEC §11.1 (c)). 측정값보다 작은 것도 있음:
//  neck ±14° (측정 ±18–22°의 절반은 일부러 너그럽게 셈), squat 7 cm(깊이 경로는 약 5 cm부터 셈), squat 상체 9 cm
export function cases() {
  const H = SP.HIP, D = SP.DOWN;
  const neckR = pose(HIP_A, { tilt: 14 }), neckL = pose(HIP_A, { tilt: -14 });
  const skyL = pose({ eL: 165 }), skyR = pose({ eR: 165 });
  const sbR = pose({ lean: 16, eL: 125, eR: 50, fR: -100 }), sbL = pose({ lean: -16, eR: 125, eL: 50, fL: -100 });
  const sqUp = pose(HIP_A, WIDE), sqDown = pose(HIP_A, WIDE, { squat: 0.07 });
  const sqUpC = pose(HIP_A, WIDE, CUT_HIPS), sqDownC = pose(HIP_A, WIDE, CUT_HIPS, { squat: 0.09 });
  const jjL = pose({ eL: 165, eR: 165, outL: 22 }), jjR = pose({ eL: 165, eR: 165, outR: 22 });
  const kuL = pose(HIP_A, { sideL: 1 }), kuR = pose(HIP_A, { sideR: 1 });
  const kfL = pose(HIP_A, { fwdL: 1 }), kfR = pose(HIP_A, { fwdR: 1 });
  const lsL = pose({ eL: 90, eR: 90, outL: 24 }), lsR = pose({ eL: 90, eR: 90, outR: 24 });
  const trR = pose({ eL: 160, fL: 70, eR: 160, fR: 70, treeR: 1 }), trL = pose({ eL: 160, fL: 70, eR: 160, fR: 70, treeL: 1 });
  const C = (o) => o;
  return [
    C({ name: 'neck', id: 'neck', variant: 'full', ready: H, rest: H, targets: [neckR, neckL], keys: ['right', 'left'], period: 2000 }),
    C({ name: 'arm_push', id: 'arm_push', variant: 'full', ready: D, rest: SP.SHOULDER, targets: [SP.T], keys: ['out'], period: 1400 }),
    C({ name: 'sky_punch', id: 'sky_punch', variant: 'full', ready: D, rest: D, targets: [skyL, skyR], keys: ['left', 'right'], period: 1200 }),
    C({ name: 'breathe', id: 'breathe', variant: 'full', ready: D, rest: D, targets: [SP.UP], keys: ['up'], period: 3200 }),
    C({ name: 'side_bend', id: 'side_bend', variant: 'full', ready: H, rest: H, targets: [sbR, sbL], keys: ['right', 'left'], period: 2000 }),
    C({ name: 'squat/full', id: 'squat', variant: 'full', ready: sqUp, rest: sqUp, targets: [sqDown], keys: ['down'], period: 1800 }),
    C({ name: 'squat/upper', id: 'squat', variant: 'upper', ready: sqUpC, rest: sqUpC, targets: [sqDownC], keys: ['down'], period: 1800 }),
    C({ name: 'jumping_jack/full', id: 'jumping_jack', variant: 'full', ready: D, rest: D, targets: [jjL, jjR], keys: ['open'], period: 1600 }),
    C({ name: 'jumping_jack/upper', id: 'jumping_jack', variant: 'upper', ready: pose(CUT_LEGS), rest: pose(CUT_LEGS),
      targets: [pose(jjL, CUT_LEGS), pose(jjR, CUT_LEGS)], keys: ['open'], period: 1600 }),
    C({ name: 'jumping_jack/jump', id: 'jumping_jack', jumpMode: 'jump', variant: 'full', ready: D, rest: D,
      targets: [pose({ eL: 165, eR: 165, outL: 15, outR: 15 })], keys: ['open'], period: 1600 }),
    C({ name: 'knee_up/side', id: 'knee_up', variant: 'full', ready: H, rest: H, targets: [kuL, kuR], keys: ['left', 'right'], period: 1400 }),
    C({ name: 'knee_up/forward', id: 'knee_up', variant: 'full', ready: H, rest: H, targets: [kfL, kfR], keys: ['left', 'right'], period: 1400 }),
    C({ name: 'leg_side', id: 'leg_side', variant: 'full', ready: SP.T, rest: SP.T, targets: [lsL, lsR], keys: ['left', 'right'], period: 1800 }),
    C({ name: 'tree/full', id: 'tree', variant: 'full', hold: true, ready: D, rest: D, targets: [trR, trL], keys: ['right', 'left'],
      toe: pose({ eL: 160, fL: 70, eR: 160, fR: 70, treeR: 0.1 }) }),
    C({ name: 'tree/upper', id: 'tree', variant: 'upper', hold: true, ready: pose(CUT_LEGS), rest: pose(CUT_LEGS),
      targets: [pose(SP.HANDS_UP, CUT_LEGS)], keys: ['up'], toe: pose({ eL: 95, eR: 95 }, CUT_LEGS) }),
  ];
}
// 버티기 대본: 목표마다 holdMs 유지 → rest gapMs
export function holdScript(rest, targets, { lead = 800, holdMs = 2600, gapMs = 800, blip = null } = {}) {
  const sc = [[0, rest]]; let t = lead;
  for (const tg of targets) {
    sc.push([t, tg]);
    if (blip) { sc.push([t + blip.at, rest]); sc.push([t + blip.at + blip.len, tg]); }
    t += holdMs; sc.push([t, rest]); t += gapMs;
  }
  sc.duration = t + 1000;
  return sc;
}
