// 체육 동작 배우기 엔진 — 순수 계산만 (DOM·three.js 없음, Node에서 그대로 테스트)
// 좌우는 항상 '학생 자신의' 왼쪽/오른쪽. 스냅샷 pts는 엉덩이 중심 m, y 위, 학생 왼쪽(L_*)이 −x.
// 길이 특징은 모두 몸통 길이 T(어깨 중점↔엉덩이 중점, 2D)로 나눈 값. 어깨너비는 팔 자세에 따라 변해서 자로 쓰지 않는다.
// 시간은 전부 ms(틱 시간). setTimeout 없음 — 호출하는 쪽이 dt/tMs를 넘긴다.
//
// 명세(SPEC §4.1)와 다른 점 / 추가된 것 (UI 쪽에서 알아야 할 것):
//  - Tracker.update(...)는 { isNew, R, raw, stable, present, motion, still, refLost }를 돌려준다.
//    R은 항상 객체(데이터가 없으면 모든 값이 null인 EMPTY_R) — 점수 함수에 그대로 넘겨도 안전.
//    tracker.setRef(T): 기준 몸통 길이(Bm.T). 기준과 계속(1.5 s) 다른 사람이 서 있으면 기준을 풀고 refLost=true(→ markRebase).
//    stillness(motion)는 스무딩된 손목·발목 위치로 잰다(낱 프레임 떨림 σ 2 cm가 기준 0.08 T를 넘기 때문).
//    몸통 길이가 직전의 2.5배 넘게/0.4배 밑으로 튄 프레임은 버린다(최대 3개 연속; 좌표 전체 ×8 같은 글리치가 3번 이어지면
//    중앙값도 넘어가서 '다른 사람'으로 오인·800 ms 멈춤이 났다 — 테스트로 확인).
//  - Baseline.offer(R, tMs, still, legsOK=true): 다리 값은 legsOK 프레임에서만. get(curR): 빠진 화면(overlay) 값은 현재 프레임에서.
//    get()은 한 번 계산한 Bm 객체를 그대로 돌려주고, refresh/재기준이 그 객체를 고친다(game.Bm 참조 유지). size() 추가.
//    refresh(R, tMs, legsOK=true): 쉬는 자세 400 ms 이상일 때 새 프레임마다 호출.
//  - relFeatures: 엉덩이가 보일 때 drop = (엉덩이 y − 0.5)/화면 몸통 길이의 기준 대비 차 (원근 보정: 카메라 쪽으로 걸어오면 화면이
//    중심 기준으로 커질 뿐이라 0). 명세 식 (y − y0)/몸통0 그대로면 ±15 % 크기 안에서 걸어오기만 해도 '앉기'로 세었다(테스트로 확인).
//    크기가 같으면 명세 식과 같다. 엉덩이가 화면 밖(어깨 사용)이면 명세 식 그대로(어깨너비는 팔 자세로 변해서 보정에 못 씀).
//    Bm에 hipOff 추가. Baseline.track(R, tMs): 따라 하기 중 새 프레임마다 호출 — 걸어와서 크기가 계속 달라졌으면 화면 기준만 다시 잡음.
//  - IdentityGuard.update → { frozen, jumped, crowd } (crowd = '한 명씩 해요' 배너 3초).
//  - StepJudge.update(s, dt, ok=true).
//  - RepCounter: restMs 공개 = 쉬는 상태이면서 쉬는 자세 점수 ≥ 0.7이 이어진 시간. Baseline.refresh는 restMs ≥ 400일 때만
//    (점수만 보고 '쉬는 상태'로 남아 있는 동안 refresh하면, 천천히 들어 올리는 동작까지 기준이 따라가서 영영 못 센다 — 테스트로 확인).
//  - HoldCounter: count 이벤트 { type:'count', n(이쪽 개수), side, total }, 'start' | 'pause' | 'switch' | 'done' 이벤트,
//    expected(), count(누적), done, counts{side:n}. opts.perSide로 쪽당 횟수 바꿈.
//  - Coach(move, unitMs, mode, opts): opts는 cycleOverride 배열 또는 { cycle, targetKeys, ready, watchCycles, watchSlow(1.25), maxWaitMs(2000) }.
//    unitMs는 이미 tempo를 곱한 값. step(dt, kidCount, expectedSide)는 이벤트 배열({type:'enter', key, next, target})을 돌려준다.
//    rep.kind==='hold'이고 mode==='reps'면 '버티기' 코치(expectedSide 필요, 쪽 바뀔 때 onSwitch()).
//    spec()은 끊김 없는 현재 시범 스펙(따라가기 점프 중에도 부드럽게). frame()은 { a, b, u, key }.
//  - 추가 export: Sensor(Tracker+LegsGate+IdentityGuard 묶음), scoreAll, starsFor, NEUTRAL, EMPTY_R, median.
//
// pe-ui tick에서 쓰는 순서 (SPEC §8.3; tests/pe-synth.mjs simulate()가 그대로 흉내 내며 검증):
//   mv = resolveVariant(getMove(id, settings), 'full' | 'upper')          // pe-moves.js
//   s = sensor.update(snap, ov, aspect, game.t)  → { isNew, R, present, stable, still, legsOK, frozen, jumped, crowd, refLost, ok }
//   if (s.jumped || s.refLost) baseline.markRebase()
//   setup: rs = mv.readyScore(s.R, s.legsOK); if (s.isNew) baseline.offer(s.R, t, s.still && rs >= 0.7, s.legsOK)
//          readyJudge.update(rs, dt, s.ok) … 끝나면 Bm = baseline.get(s.R); sensor.tracker.setRef(Bm.T)
//   step:  stepJudge.update(scoreAll(mv.score, relFeatures(s.R, Bm, s.legsOK), k)[step.score].s, dt, s.ok)
//   reps:  sc = scoreAll(mv.score, relFeatures(s.R, Bm, s.legsOK), k); ev = counter.update(sc, dt, s.ok)
//          if (s.isNew) { if (counter.restMs >= 400) baseline.refresh(s.R, t, s.legsOK); baseline.track(s.R, t); }   (버티기는 track만)
//          coach.step(dt, counter.count, hold ? counter.expected() : undefined); count → coach.onKidCount(e.key, counter.count); switch → coach.onSwitch()
//          힌트 = sc[counter.expected()].why (버티기: sc[expected].why), counter.sinceProgress ≥ 4000일 때

// ── 점수 도우미 (SPEC §3.6) ──
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const ramp = (v, lo, hi) => (v == null || Number.isNaN(v) ? 0 : clamp01((v - lo) / (hi - lo)));   // lo > hi = 내려가는 경사
export const band = (v, lo, hi, m) => (v == null || Number.isNaN(v) ? 0 : v < lo ? clamp01(1 - (lo - v) / m) : v > hi ? clamp01(1 - (v - hi) / m) : 1);
export const mx = (...xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? Math.max(...v) : null; };
export const mn = (...xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? Math.min(...v) : null; };
export const neg = (v) => (v == null ? null : -v);
export function all(...terms) { let s = 1, why = null; for (const [w, t] of terms) if (t < s) { s = t; why = w; } return { s, why }; }
// 민감도 k (너그럽게 0.8 · 보통 1 · 엄격하게 1.15)는 '얼마나 움직여야 하나'만 바꾼다. cap은 도달 가능한 한계
export const A = (k, lo, hi, cap = Infinity) => [lo * k, Math.min(hi * k, cap)];
export const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export function median(arr) {
  const v = arr.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const sub = (a, b) => (a == null || b == null ? null : a - b);
const div = (a, b) => (a == null || b == null || !b ? null : a / b);

// ── 원시 특징 (SPEC §3.5), 새 인식 프레임마다 ──
const deg = (r) => r * 180 / Math.PI;
const vok = (V, k, t) => (V[k] || 0) >= t;
export function rawFeatures(snap, ov, aspect) {
  if (!snap || !snap.present || !snap.pts) return null;
  const P = snap.pts, V = snap.vis || {};
  if (!P.L_SH || !P.R_SH || !P.L_HIP || !P.R_HIP) return null;
  const shM = { x: (P.L_SH.x + P.R_SH.x) / 2, y: (P.L_SH.y + P.R_SH.y) / 2 };
  const hM = { x: (P.L_HIP.x + P.R_HIP.x) / 2, y: (P.L_HIP.y + P.R_HIP.y) / 2 };
  const T = Math.hypot(shM.x - hM.x, shM.y - hM.y);
  if (!(T > 1e-3)) return null;
  const R = { key: `${P.L_SH.x},${P.L_SH.y},${P.R_SH.y}`, T };
  for (const s of ['L', 'R']) {                                   // ── 팔
    const sh = P[s + '_SH'], wr = P[s + '_WR'], el = P[s + '_EL'];
    const wrOK = !!wr && vok(V, s + '_WR', 0.35), elOK = !!el && vok(V, s + '_EL', 0.4);
    const end = wrOK ? wr : elOK ? el : null;
    const len = end ? Math.hypot(end.x - sh.x, end.y - sh.y) : 0;
    R['elev' + s] = end && len / T >= (wrOK ? 0.35 : 0.2) ? deg(Math.acos(Math.max(-1, Math.min(1, -(end.y - sh.y) / len)))) : null; // 0 아래 · 90 옆 · 180 위
    R['up' + s] = wrOK ? (wr.y - sh.y) / T : elOK ? (el.y - sh.y) / T + 0.25 : null;   // + = 손목이 어깨보다 위
    R['reach' + s] = wrOK ? Math.hypot(wr.x - sh.x, wr.y - sh.y) / T : null;
    R['wrEl' + s] = wrOK && elOK ? (wr.y - el.y) / T : null;                         // + = 손목이 팔꿈치보다 위
    R['wr' + s] = wrOK ? { x: wr.x / T, y: wr.y / T } : null;                        // 멈춤 판정·손 간격용
  }
  R.minElev = mn(R.elevL, R.elevR); R.maxElev = mx(R.elevL, R.elevR);
  const shAng = deg(Math.atan2(P.R_SH.y - P.L_SH.y, P.R_SH.x - P.L_SH.x));         // 수평이면 ≈0
  const hipsOK = vok(V, 'L_HIP', 0.5) && vok(V, 'R_HIP', 0.5);
  R.lean = hipsOK ? deg(Math.atan2(shM.x - hM.x, shM.y - hM.y)) : -0.7 * shAng;    // + = 학생 오른쪽으로
  const line = (a, b) => (P[a] && P[b] && vok(V, a, 0.5) && vok(V, b, 0.5) ? deg(Math.atan2(P[b].y - P[a].y, P[b].x - P[a].x)) : null);
  const eye = line('L_EYE', 'R_EYE'), ear = line('L_EAR', 'R_EAR');
  const head = eye == null ? null : ear == null ? eye : (eye + ear) / 2;
  R.tilt = head == null ? null : -(head - shAng);                                    // + = 머리가 오른쪽 어깨로
  for (const s of ['L', 'R']) {                                                      // ── 다리 (LegsGate가 켜졌을 때만 믿음)
    const hip = P[s + '_HIP'], kn = P[s + '_KNEE'], an = P[s + '_ANK'];
    if (!kn || !an) { R['legAng' + s] = R['hipAnk' + s] = R['kneeY' + s] = R['ankY' + s] = R['an' + s] = null; continue; }
    const out = s === 'L' ? hip.x - an.x : an.x - hip.x;                            // + = 발이 바깥으로
    R['legAng' + s] = deg(Math.atan2(out, Math.max(hip.y - an.y, 1e-3)));
    R['hipAnk' + s] = (hip.y - an.y) / T;
    R['kneeY' + s] = kn.y / T;                                                       // 엉덩이 중심이라 곧 엉덩이 기준 높이
    R['ankY' + s] = an.y / T;
    R['an' + s] = { x: an.x / T, y: an.y / T };
  }
  R.hipAnk = mx(R.hipAnkL, R.hipAnkR);                                               // 더 곧은 다리
  if (ov && ov[11] && ov[12] && ov[23] && ov[24]) {                                  // ── 화면(원본 영상) 좌표
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const s = mid(ov[11], ov[12]), h = mid(ov[23], ov[24]);
    R.ovShY = s.y; R.ovHipY = h.y; R.ovHipX = h.x;
    R.ovTorso = Math.hypot((s.x - h.x) * aspect, s.y - h.y);
    R.swImg = Math.hypot((ov[11].x - ov[12].x) * aspect, ov[11].y - ov[12].y);
    R.ovHipOK = Math.min(ov[23].visibility ?? 1, ov[24].visibility ?? 1) >= 0.5 && h.y <= 0.95;
    R.ovAnkIn = !!(ov[27] && ov[28]) && ov[27].y <= 0.97 && ov[28].y <= 0.97;
  }
  return R;
}

// 스무딩 대상 필드
const NUM_FIELDS = ['T', 'elevL', 'elevR', 'upL', 'upR', 'reachL', 'reachR', 'wrElL', 'wrElR', 'lean', 'tilt',
  'legAngL', 'legAngR', 'hipAnkL', 'hipAnkR', 'kneeYL', 'kneeYR', 'ankYL', 'ankYR',
  'ovShY', 'ovHipY', 'ovHipX', 'ovTorso', 'swImg'];
const PT_FIELDS = ['wrL', 'wrR', 'anL', 'anR'];
const BOOL_FIELDS = ['ovHipOK', 'ovAnkIn'];
export const EMPTY_R = Object.freeze(Object.fromEntries([['key', null], ...[...NUM_FIELDS, 'minElev', 'maxElev', 'hipAnk', ...PT_FIELDS, ...BOOL_FIELDS].map((f) => [f, null])]));

// ── 스무딩: 최근 서로 다른 프레임 5개(각 500 ms 이내)의 중앙값. 값이 3개 미만이면 null ──
export class Smoother {
  constructor(n = 5, maxAgeMs = 500) { this.n = n; this.maxAgeMs = maxAgeMs; this.buf = []; }
  reset() { this.buf = []; }
  push(R, tMs) { if (!R) return; this.buf.push({ R, t: tMs }); while (this.buf.length > this.n) this.buf.shift(); this.prune(tMs); }
  prune(tMs) { if (tMs == null) return; while (this.buf.length && tMs - this.buf[0].t > this.maxAgeMs) this.buf.shift(); }
  get(tMs) {
    this.prune(tMs);
    const B = this.buf; if (!B.length) return null;
    const last = B[B.length - 1].R, out = { key: last.key };
    for (const f of NUM_FIELDS) {
      const v = []; for (const e of B) { const x = e.R[f]; if (x != null && !Number.isNaN(x)) v.push(x); }
      out[f] = v.length >= 3 ? median(v) : null;
    }
    for (const f of PT_FIELDS) {
      const xs = [], ys = []; for (const e of B) { const p = e.R[f]; if (p) { xs.push(p.x); ys.push(p.y); } }
      out[f] = xs.length >= 3 ? { x: median(xs), y: median(ys) } : null;
    }
    for (const f of BOOL_FIELDS) out[f] = last[f] ?? null;
    out.minElev = mn(out.elevL, out.elevR); out.maxElev = mx(out.elevL, out.elevR);
    out.hipAnk = mx(out.hipAnkL, out.hipAnkR);
    return out;
  }
}

// ── Tracker: 사람 있음(디바운스), 새 프레임, 안정, 멈춤 (SPEC §4.2) ──
export class Tracker {
  constructor() { this.smoother = new Smoother(); this.reset(); }
  reset() {
    this.smoother.reset(); this.lastKey = null; this.present = false; this.lastSeen = -1e12;
    this.Th = []; this.motions = []; this.prevS = null; this.motion = null; this.R = EMPTY_R; this.raw = null;
    this.Tref = null; this.offRefMs = 0; this.glitches = 0; this.lastT = null;
  }
  setRef(T) { this.Tref = T > 0 ? T : null; this.offRefMs = 0; }
  update(snap, ov, aspect, tMs) {
    const dtMs = this.lastT != null ? Math.max(0, Math.min(100, tMs - this.lastT)) : 16; this.lastT = tMs;
    const raw = rawFeatures(snap, ov, aspect || 4 / 3);
    if (raw) this.lastSeen = tMs;
    this.present = raw ? true : this.present && tMs - this.lastSeen < 400;     // 켜짐은 즉시, 꺼짐은 400 ms 뒤
    let isNew = !!raw && raw.key !== this.lastKey;
    if (isNew) {
      this.lastKey = raw.key;
      const pT = this.R && this.R.T;                                                  // 좌표 전체가 한꺼번에 튀는 프레임(×8 등)은 버림
      const odd = !!pT && (raw.T / pT > 2.5 || raw.T / pT < 0.4);
      if (odd && this.glitches < 3) { this.glitches++; isNew = false; }
      else { if (odd) this.smoother.reset(); this.glitches = 0; this.raw = raw; this.smoother.push(raw, tMs); }   // 4번째부터는 진짜로 받아들임
    }
    const R = this.smoother.get(tMs) || EMPTY_R;
    if (isNew && R !== EMPTY_R) {
      const p = this.prevS;
      if (p) {
        const d = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);       // 없는 관절은 0
        this.motion = Math.max(d(R.wrL, p.wrL), d(R.wrR, p.wrR), d(R.anL, p.anL), d(R.anR, p.anR));
        this.motions.push(this.motion); if (this.motions.length > 6) this.motions.shift();
      }
      this.prevS = { wrL: R.wrL, wrR: R.wrR, anL: R.anL, anR: R.anR };
      if (R.T != null) this.Th.push({ t: tMs, T: R.T });
    }
    while (this.Th.length && tMs - this.Th[0].t > 1000) this.Th.shift();
    if (R === EMPTY_R) { this.prevS = null; this.motions = []; }
    const still = this.motions.length >= 3 && median(this.motions) < 0.08;
    const Tmed = median(this.Th.map((e) => e.T));
    const inside = (T, ref) => !ref || (T >= 0.65 * ref && T <= 1.5 * ref);
    let stable = R.T != null && inside(R.T, this.Tref || Tmed);
    let refLost = false;
    // 기준 몸통과 계속 다른데 최근 1초끼리는 일정함 = 다른 사람(크기)이 섰다 → 기준을 풀고 재기준 요청
    if (this.Tref && R.T != null && !stable && inside(R.T, Tmed)) {
      this.offRefMs += dtMs;
      if (this.offRefMs >= 1500) { this.Tref = null; this.offRefMs = 0; refLost = true; stable = true; }
    } else this.offRefMs = 0;
    this.R = R;
    return { isNew, R, raw: isNew ? raw : null, stable, present: this.present, motion: this.motion, still, refLost };
  }
}

// ── 다리 보임 게이트 (SPEC §4.4) — snap.fullBody는 쓰지 않음(발목이 화면 밖이어도 true였음) ──
export class LegsGate {
  constructor({ vis = 0.6, onFrac = 0.7, offFrac = 0.4, winMs = 1000, offMs = 1000, minFrames = 5, tTol = 0.3 } = {}) {
    Object.assign(this, { vis, onFrac, offFrac, winMs, offMs, minFrames, tTol }); this.reset();
  }
  reset() { this.on = false; this.buf = []; this.Th = []; this.lowSince = null; }
  update(snap, ov, R, isNew, tMs) {
    if (!isNew) return this.on;
    const V = (snap && snap.vis) || {};
    let good = ['L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK'].every((k) => (V[k] || 0) >= this.vis) && !!(R && R.ovAnkIn);
    const T = R ? R.T : null;
    if (T != null) this.Th.push({ t: tMs, T });
    while (this.Th.length && tMs - this.Th[0].t > this.winMs) this.Th.shift();
    const Tm = median(this.Th.map((e) => e.T));
    good = good && T != null && Tm != null && Math.abs(T / Tm - 1) <= this.tTol;
    this.buf.push({ t: tMs, good });
    while (this.buf.length && tMs - this.buf[0].t > this.winMs) this.buf.shift();
    const n = this.buf.length, frac = n ? this.buf.filter((e) => e.good).length / n : 0;
    this.frac = frac;
    if (!this.on) { if (n >= this.minFrames && frac >= this.onFrac) { this.on = true; this.lowSince = null; } }
    else if (frac < this.offFrac) {
      if (this.lowSince == null) this.lowSince = tMs;
      else if (tMs - this.lowSince >= this.offMs) { this.on = false; this.lowSince = null; }
    } else this.lowSince = null;                                                     // 50 % 깜빡임은 현재 상태 유지
    return this.on;
  }
}

// ── 다른 사람/지나가는 사람 (SPEC §4.5). 개수는 절대 줄지 않는다 ──
export class IdentityGuard {
  constructor({ tJump = 0.35, xJump = 0.25, freezeMs = 800, crowdN = 3, crowdWinMs = 10000, crowdMs = 3000 } = {}) {
    Object.assign(this, { tJump, xJump, freezeMs, crowdN, crowdWinMs, crowdMs }); this.reset();
  }
  reset() { this.prev = null; this.frozenUntil = -1e12; this.jumps = []; this.crowdUntil = -1e12; }
  update(R, isNew, tMs) {
    let jumped = false;
    if (isNew && R && R.T != null) {
      const p = this.prev;
      if (p && (Math.abs(R.T / p.T - 1) > this.tJump || (R.ovHipX != null && p.ovHipX != null && Math.abs(R.ovHipX - p.ovHipX) > this.xJump))) jumped = true;
      this.prev = { T: R.T, ovHipX: R.ovHipX };
      if (jumped) {
        this.frozenUntil = tMs + this.freezeMs;
        this.jumps.push(tMs); this.jumps = this.jumps.filter((t) => tMs - t <= this.crowdWinMs);
        if (this.jumps.length >= this.crowdN) { this.crowdUntil = tMs + this.crowdMs; this.jumps = []; }
      }
    }
    return { frozen: tMs < this.frozenUntil, jumped, crowd: tMs < this.crowdUntil };
  }
}

// ── 묶음: pe-ui tick이 하는 앞부분 그대로 (SPEC §8.3) ──
export class Sensor {
  constructor() { this.tracker = new Tracker(); this.legs = new LegsGate(); this.identity = new IdentityGuard(); }
  reset() { this.tracker.reset(); this.legs.reset(); this.identity.reset(); }
  update(snap, ov, aspect, tMs) {
    const tr = this.tracker.update(snap, ov, aspect, tMs);
    const legsOK = this.legs.update(snap, ov, tr.R, tr.isNew, tMs);
    const idg = this.identity.update(tr.R, tr.isNew, tMs);
    return { ...tr, legsOK, frozen: idg.frozen, jumped: idg.jumped, crowd: idg.crowd, ok: tr.present && tr.stable && !idg.frozen };
  }
}

// ── 동작별 기준 자세 Bm (SPEC §4.3) ──
const BM_DEFAULTS = { lean: 0, tilt: 0, legAngL: 1, legAngR: 1, kneeYL: -0.8, kneeYR: -0.8, ankYL: -1.6, ankYR: -1.6, hipAnk: 1.6, reach: 1.0 };
const OV_FIELDS = ['ovHipY', 'ovShY', 'ovTorso', 'swImg'];
const LEG_FIELDS = ['legAngL', 'legAngR', 'kneeYL', 'kneeYR', 'ankYL', 'ankYR', 'hipAnk'];
const unitOvOf = (B) => (B.ovHipOK ? B.ovTorso : B.swImg != null ? 1.5 * B.swImg : null);
// 엉덩이의 화면 중심 기준 높이 ÷ 그 프레임의 화면 몸통 길이: 카메라 쪽으로 걸어와도(화면 중심 기준 확대) 변하지 않고, 앉으면 늘어난다
const hipOffOf = (R) => (R && R.ovHipY != null && R.ovTorso ? (R.ovHipY - 0.5) / R.ovTorso : null);
function computeBm(frames, curR) {
  const med = (f, src = frames) => median(src.map((e) => e.R[f]));
  const legs = frames.filter((e) => e.legs);
  const B = { T: med('T'), lean: med('lean'), tilt: med('tilt') };
  const rf = frames.filter((e) => e.R.maxElev != null && e.R.maxElev <= 40).map((e) => mx(e.R.reachL, e.R.reachR) == null ? null
    : ((e.R.reachL ?? e.R.reachR) + (e.R.reachR ?? e.R.reachL)) / 2);
  B.reach = median(rf);
  for (const f of LEG_FIELDS) B[f] = legs.length ? med(f, legs) : null;
  for (const f of OV_FIELDS) B[f] = med(f);
  B.hipOff = median(frames.map((e) => hipOffOf(e.R)));
  const oks = frames.map((e) => e.R.ovHipOK).filter((v) => v != null);
  B.ovHipOK = oks.length ? oks.filter(Boolean).length * 2 >= oks.length : null;
  for (const [f, v] of Object.entries(BM_DEFAULTS)) if (B[f] == null) B[f] = v;
  if (curR) {                                                                        // 화면 값이 없으면 현재 프레임에서
    for (const f of OV_FIELDS) if (B[f] == null && curR[f] != null) B[f] = curR[f];
    if (B.ovHipOK == null && curR.ovHipOK != null) B.ovHipOK = curR.ovHipOK;
    if (B.T == null && curR.T != null) B.T = curR.T;
    if (B.hipOff == null) B.hipOff = hipOffOf(curR);
  }
  if (B.ovHipOK == null) B.ovHipOK = false;
  B.wide = B.legAngL >= 5 && B.legAngR >= 5;
  B.n = frames.length;
  return B;
}
export class Baseline {
  constructor() { this.reset(); }
  reset() { this.frames = []; this.forced = false; this.Bm = null; this.rebase = false; this.mini = []; this.lastKey = null; this.trk = []; this.trkKey = null; }
  offer(R, tMs, still, legsOK = true) {
    if (!R || R.T == null) return;
    this.frames.push({ R, t: tMs, still: !!still, legs: !!legsOK });
    while (this.frames.length && tMs - this.frames[0].t > 2000) this.frames.shift();
  }
  size() { return this.frames.length; }
  stillFrames() { return this.frames.filter((e) => e.still); }
  ready() { const s = this.stillFrames(); return s.length >= 6 && s[s.length - 1].t - s[0].t >= 500; }
  force() { this.forced = true; }
  get(curR) {
    if (this.Bm) return this.Bm;
    const last = this.frames.length ? this.frames[this.frames.length - 1].t : 0;
    const recent = this.frames.filter((e) => last - e.t <= 1000);
    const st = this.stillFrames();
    const src = this.forced ? recent : st.length ? st : recent;
    this.Bm = computeBm(src, curR);
    this.Bm.forced = this.forced; this.Bm.defaults = !src.length;
    return this.Bm;
  }
  markRebase() { this.rebase = true; this.mini = []; }
  // 쉬는 자세가 400 ms 넘게 이어질 때 새 프레임마다: 허용 범위 안의 값만 EMA(0.2)로 따라감, 재기준 요청이 있으면 600 ms 조용히 다시 잼
  refresh(R, tMs, legsOK = true) {
    const B = this.Bm;
    if (!B || !R || R.key == null || R.key === this.lastKey) return;
    this.lastKey = R.key;
    if (this.rebase) {
      if (this.mini.length && tMs != null && tMs - this.mini[this.mini.length - 1].t > 300) this.mini = [];   // 쉬는 자세가 끊기면 다시
      if (R.T != null) this.mini.push({ R, t: tMs ?? 0, still: true, legs: !!legsOK });
      if (this.mini.length >= 3 && this.mini[this.mini.length - 1].t - this.mini[0].t >= 600) {
        const nb = computeBm(this.mini, R); delete nb.wide;                          // 다리 넓이 판단은 처음 기준 그대로
        if (!this.mini.some((e) => e.legs)) for (const f of LEG_FIELDS) delete nb[f];
        Object.assign(B, nb); this.rebase = false; this.mini = []; B.rebased = (B.rebased || 0) + 1;
      }
      return;
    }
    const a = 0.2;
    const ema = (f, tol, rel) => {
      const v = R[f], b = B[f]; if (v == null || b == null) return;
      const d = rel ? Math.abs(v / b - 1) : Math.abs(v - b);
      if (d <= tol) B[f] = b + a * (v - b);
    };
    ema('lean', 3); ema('tilt', 3);
    if (legsOK) { ema('legAngL', 3); ema('legAngR', 3); for (const f of ['kneeYL', 'kneeYR', 'ankYL', 'ankYR']) ema(f, 0.08); ema('hipAnk', 0.08, true); }
    const u = unitOvOf(B);
    if (u) { ema('ovHipY', 0.04 * u); ema('ovShY', 0.04 * u); }
    const ho = hipOffOf(R); if (ho != null && B.hipOff != null && Math.abs(ho - B.hipOff) <= 0.04) B.hipOff += a * (ho - B.hipOff);
    ema('ovTorso', 0.1, true); ema('swImg', 0.1, true);
  }
  // 따라 하기 중 새 프레임마다: 화면 크기(ovScale)가 1.5 s 동안 ±10 % 넘게 다르면서 일정하면(앞으로 걸어와 섰다)
  // 화면 기준값만 다시 잡는다. 안 그러면 ±15 % 가드에 막혀 그 세트는 끝까지 못 센다. 앉기는 크기를 바꾸지 않아서 흡수되지 않음
  track(R, tMs) {
    const B = this.Bm;
    if (!B || !R || R.key == null || R.key === this.trkKey) return false;
    this.trkKey = R.key;
    const s = B.ovHipOK ? div(R.ovTorso, B.ovTorso) : div(R.swImg, B.swImg);
    if (s == null) { this.trk = []; return false; }
    this.trk.push({ t: tMs, s, R });
    while (this.trk.length && tMs - this.trk[0].t > 1500) this.trk.shift();
    if (this.trk.length < 6 || tMs - this.trk[0].t < 1400) return false;
    const ms = median(this.trk.map((e) => e.s));
    if (Math.abs(ms - 1) <= 0.1 || !this.trk.every((e) => Math.abs(e.s / ms - 1) <= 0.05)) return false;
    const m = (f) => median(this.trk.map((e) => e.R[f]));
    for (const f of OV_FIELDS) { const v = m(f); if (v != null) B[f] = v; }
    const ho = median(this.trk.map((e) => hipOffOf(e.R))); if (ho != null) B.hipOff = ho;
    this.trk = []; B.rescaled = (B.rescaled || 0) + 1;
    return true;
  }
}

// ── 상대 특징 F (SPEC §3.5). 다리 값은 legsOK일 때만 ──
export function relFeatures(R, Bm, legsOK) {
  R = R || EMPTY_R; const B = Bm || {};
  const F = {
    elevL: R.elevL ?? null, elevR: R.elevR ?? null, minElev: R.minElev ?? null, maxElev: R.maxElev ?? null,
    upL: R.upL ?? null, upR: R.upR ?? null, wrElL: R.wrElL ?? null, wrElR: R.wrElR ?? null,
    reachRelL: div(R.reachL, B.reach), reachRelR: div(R.reachR, B.reach),
    lean: sub(R.lean, B.lean ?? 0), tilt: sub(R.tilt, B.tilt ?? 0),
    gap: R.wrL && R.wrR ? Math.abs(R.wrL.x - R.wrR.x) : null,
    legOutL: null, legOutR: null, kneeUpL: null, kneeUpR: null, footUpL: null, footUpR: null, depth: null,
    drop: null, ovScale: null, ovOK: false,
  };
  if (legsOK) {
    F.legOutL = sub(R.legAngL, B.legAngL); F.legOutR = sub(R.legAngR, B.legAngR);
    F.kneeUpL = sub(R.kneeYL, B.kneeYL); F.kneeUpR = sub(R.kneeYR, B.kneeYR);
    const fu = sub(sub(R.ankYL, R.ankYR), sub(B.ankYL, B.ankYR));
    F.footUpL = fu; F.footUpR = neg(fu);
    F.depth = B.wide ? (R.hipAnk != null && B.hipAnk ? 1 - R.hipAnk / B.hipAnk : null) : null;
  }
  const unit = unitOvOf(B);
  F.ovScale = B.ovHipOK ? div(R.ovTorso, B.ovTorso) : div(R.swImg, B.swImg);
  const useHip = !!(R.ovHipOK && B.ovHipOK), ho = hipOffOf(R);                       // + = 화면에서 더 아래
  if (useHip && ho != null && B.hipOff != null) F.drop = ho - B.hipOff;              // 엉덩이: 원근 보정(걸어와도 0)
  else if (R.ovShY != null && B.ovShY != null && unit) F.drop = (R.ovShY - B.ovShY) / unit;   // 어깨(엉덩이가 화면 밖): 명세 식 그대로
  F.ovOK = F.drop != null && F.ovScale != null && Math.abs(F.ovScale - 1) <= 0.15;
  return F;
}

// 변형(variant)의 모든 점수: { name: {s, why} }. 점수 함수가 던져도 0으로
export function scoreAll(score, F, k = 1) {
  const out = {};
  for (const [name, fn] of Object.entries(score || {})) {
    let r; try { r = fn(F || {}, k); } catch (e) { r = null; }
    out[name] = r && typeof r.s === 'number' && !Number.isNaN(r.s) ? r : { s: 0, why: r ? r.why ?? null : null };
  }
  return out;
}

// ── 연습·준비 자세 유지 판정 (SPEC §4.8, 미션 MissionJudge와 같은 1× 감소) ──
export class StepJudge {
  constructor({ holdMs = 400, slipMs = 400, enter = 0.7 } = {}) { Object.assign(this, { holdMs, slipMs, enter }); this.reset(); }
  reset() { this.hold = 0; this.slip = 0; }
  update(s, dt, ok = true) {
    if (ok) {
      if (s >= this.enter) { this.hold += dt; this.slip = 0; }
      else if (this.hold > 0) { this.slip += dt; if (this.slip > this.slipMs) this.hold = Math.max(0, this.hold - dt); }
    }
    return { progress: Math.min(1, this.hold / this.holdMs), done: this.hold >= this.holdMs };
  }
}

// ── 반복 세기: cycle(쉼↔목표) / alt(좌우 번갈아) (SPEC §4.6) — 목표에 닿는 순간 센다 ──
export class RepCounter {
  constructor(rep, { minGapMs = 400, enter = 0.7, exit = 0.3, dwellMs = 120, restDwellMs = 100 } = {}) {
    Object.assign(this, { rep, minGapMs, E0: enter, X: exit, dwellMs, restDwellMs }); this.reset();
  }
  reset() {
    this.state = null; this.cand = null; this.candMs = 0; this.count = 0; this.E = this.E0; this.sinceCount = 1e9;
    this.lastSide = null; this.warned = false; this.peakMax = 0; this.nearMiss = 0; this.dropMs = 0; this.sinceProgress = 0; this.restMs = 0;
  }
  targets() { return this.rep.kind === 'cycle' ? [this.rep.peak] : this.rep.sides; }
  update(scores, dt, ok = true) {
    const ev = [], r = this.rep; this.sinceCount += dt; this.sinceProgress += dt;
    const sc = (p) => (scores && scores[p] ? scores[p].s : 0);
    if (!ok) { this.dropMs += dt; if (this.dropMs > 600) { this.cand = null; this.candMs = 0; } return ev; }   // 멈춤. 오래 끊기면 머문 시간만 초기화
    this.dropMs = 0;
    if (this.state === r.rest && sc(r.rest) >= this.E0) this.restMs += dt; else this.restMs = 0;   // '정말' 쉬는 자세일 때만 (기준 따라가기용)
    const T = this.targets();
    let want;
    if (this.state === null) want = [r.rest];                                         // 처음엔 쉬는 자세부터
    else if (this.state === r.rest) want = T;
    else want = r.kind === 'alt' ? [r.rest, ...T.filter((t) => t !== this.state)] : [r.rest]; // alt: A→B 바로 가도 됨
    let best = null;
    for (const p of want) { const th = p === r.rest ? this.E0 : this.E; if (sc(p) >= th && (!best || sc(p) > sc(best))) best = p; }
    if (this.state === r.rest) {                                                     // 아깝게 못 미친 동작 2번 → 기준을 조금 낮춤
      const top = Math.max(...T.map((t) => sc(t)));
      this.peakMax = Math.max(this.peakMax, top);
      if (top < this.X && this.peakMax >= this.E - 0.25 && this.peakMax < this.E) {
        this.peakMax = 0; if (++this.nearMiss >= 2) { this.nearMiss = 0; if (this.E > 0.5) { this.E = Math.max(0.5, this.E - 0.1); ev.push({ type: 'lenient' }); } }
      } else if (top < this.X) this.peakMax = 0;
    }
    if (best && best === this.cand) this.candMs += dt; else { this.cand = best; this.candMs = best ? dt : 0; }
    if (this.cand && this.candMs >= (this.cand === r.rest ? this.restDwellMs : this.dwellMs)) {
      const from = this.state, to = this.cand; this.state = to; this.cand = null; this.candMs = 0; this.sinceProgress = 0;
      if (to !== r.rest) this.restMs = 0;
      ev.push({ type: 'phase', phase: to });
      if (to !== r.rest && from !== null) {
        const side = r.kind === 'alt' ? to : null;
        if (this.sinceCount < this.minGapMs) ev.push({ type: 'hint', key: 'too_fast' });
        else if (side && side === this.lastSide && !this.warned) { this.warned = true; ev.push({ type: 'hint', key: 'other_side' }); }
        else {
          this.count++; this.lastSide = side; this.warned = false; this.sinceCount = 0; this.nearMiss = 0; this.peakMax = 0;
          ev.push({ type: 'count', n: this.count, side, key: to });
        }
      }
    }
    return ev;
  }
  expected() {
    return this.state === this.rep.rest || this.state === null
      ? (this.rep.kind === 'alt' && this.lastSide ? this.rep.sides.find((s) => s !== this.lastSide) : this.targets()[0])
      : this.rep.rest;
  }
}

// ── 버티기 세기 (나무 자세, SPEC §4.7) ──
export class HoldCounter {
  constructor(rep, { countMs = 700, enter = 0.7, exit = 0.3, startMs = 200, dropMs = 500, perSide } = {}) {
    Object.assign(this, { rep, countMs, E: enter, X: exit, startMs, dropLimitMs: dropMs, perSide: perSide ?? rep.perSide ?? 3 }); this.reset();
  }
  reset() {
    this.counts = Object.fromEntries(this.rep.sides.map((s) => [s, 0]));
    this.side = null; this.req = null; this.holdMs = 0; this.belowMs = 0; this.cand = null; this.candMs = 0;
    this.count = 0; this.done = false; this.sinceProgress = 0;
  }
  left() { return this.rep.sides.filter((s) => this.counts[s] < this.perSide); }
  expected() { return this.done ? null : this.side || this.req || this.left()[0] || null; }
  update(scores, dt, ok = true) {
    const ev = []; this.sinceProgress += dt;
    if (this.done || !ok) return ev;                                                 // 끊기면 시간 멈춤
    const sc = (p) => (scores && scores[p] ? scores[p].s : 0);
    if (!this.side) {                                                                // 시작: 어느 쪽이든 E 이상 200 ms
      const allowed = this.req ? [this.req] : this.left();
      let best = null; for (const p of allowed) if (sc(p) >= this.E && (!best || sc(p) > sc(best))) best = p;
      if (best && best === this.cand) this.candMs += dt; else { this.cand = best; this.candMs = best ? dt : 0; }
      if (this.cand && this.candMs >= this.startMs) {
        this.side = this.cand; this.req = this.cand; this.cand = null; this.candMs = 0; this.holdMs = 0; this.belowMs = 0;
        ev.push({ type: 'start', side: this.side });
      }
      return ev;
    }
    const s = this.side;
    if (sc(s) >= this.X) {
      this.belowMs = 0; this.holdMs += dt;
      while (this.holdMs >= this.countMs && this.counts[s] < this.perSide) {
        this.holdMs -= this.countMs; this.counts[s]++; this.count++; this.sinceProgress = 0;
        ev.push({ type: 'count', n: this.counts[s], side: s, total: this.count });
      }
      if (this.counts[s] >= this.perSide) {
        this.side = null; this.holdMs = 0;
        const rest = this.left();
        if (!rest.length) { this.done = true; this.req = null; ev.push({ type: 'done' }); }
        else { this.req = rest[0]; ev.push({ type: 'switch', side: this.req }); }
      }
    } else {
      this.belowMs += dt;                                                            // 500 ms 안쪽 이탈은 무시(시간만 멈춤)
      if (this.belowMs >= this.dropLimitMs) {
        ev.push({ type: 'pause', side: s });
        this.req = this.counts[s] > 0 ? s : null;                                    // 아직 0개면 어느 쪽이든 다시 시작 가능
        this.side = null; this.holdMs = 0; this.belowMs = 0;
      }
    }
    return ev;
  }
}

// ── 시범 스펙 보간 (Z축만). 빠진 뼈 = 중립(위팔 ∓1.187 rad, 나머지 0) ──
export const NEUTRAL = Object.freeze({ leftUpperArm: -1.187, rightUpperArm: 1.187 });
const ZAX = [0, 0, 1];
export function blendSpec(a, b, u) {
  const A0 = new Map(), B0 = new Map(), names = [];
  for (const [n, , v] of a || []) { if (!A0.has(n) && !B0.has(n)) names.push(n); A0.set(n, v); }
  for (const [n, , v] of b || []) { if (!A0.has(n) && !B0.has(n)) names.push(n); B0.set(n, v); }
  const t = Math.max(0, Math.min(1, u ?? 0));
  return names.map((n) => {
    const va = A0.has(n) ? A0.get(n) : NEUTRAL[n] || 0, vb = B0.has(n) ? B0.get(n) : NEUTRAL[n] || 0;
    return [n, ZAX.slice(), va + (vb - va) * t];
  });
}

// ── 코치 = 그림 선생님이 보여 줄 것 (SPEC §4.9) ──
// watch: 준비 600 ms → 사이클 × watchCycles → 준비 400 ms → done. loop: 무한 반복.
// reps: '앞서되 기다리기' — 학생보다 목표 1개 넘게 앞서지 않고, 최대 2 s 기다린 뒤 다시 보여 줌. 학생이 빠르면 따라감.
// hold(reps + rep.kind 'hold'): 준비 동작(arms) → 기대하는 쪽을 계속 보여 줌, 쪽이 바뀌면 stand 600 ms 후 반대쪽.
export class Coach {
  constructor(move, unitMs, mode = 'watch', opts) {
    const o = Array.isArray(opts) ? { cycle: opts } : opts || {};
    this.move = move; this.keys = o.keys || move.keys; this.unitMs = unitMs > 0 ? unitMs : move.unitMs || 1000; this.mode = mode;
    this.cycle = o.cycle || move.cycle;
    this.targets = new Set(o.targetKeys || move.targetKeys || []);
    this.readyKey = o.ready ?? move.ready ?? this.cycle[0][0];
    this.slow = mode === 'watch' ? o.watchSlow ?? 1.25 : 1;
    this.maxWaitMs = o.maxWaitMs ?? 2000;
    this.rest = (move.rep && move.rep.rest && this.keys[move.rep.rest] ? move.rep.rest : null) || this.readyKey;
    this.holdMode = mode === 'reps' && !!(o.hold ?? (move.rep && move.rep.kind === 'hold'));
    this.done = false; this.started = 0; this.kidCount = 0; this.waitMs = 0; this.waiting = false;
    const ent = (k, units) => { const d = units * this.unitMs * this.slow; return [k, d, d]; };
    if (mode === 'watch') {
      const n = Math.max(1, Math.round(o.watchCycles ?? (move.watchCycles && move.watchCycles.single) ?? 1));
      this.tl = [[this.readyKey, 600, 600]];
      for (let c = 0; c < n; c++) for (const [k, u] of this.cycle) this.tl.push(ent(k, u));
      this.tl.push([this.readyKey, 400, 400]);
    } else if (this.holdMode) {
      this.tl = [[this.readyKey, Infinity, 600]]; this.holdSide = undefined; this.pendingRest = false;
    } else this.tl = this.cycle.map(([k, u]) => ent(k, u));
    this.i = 0; this.t = 0; this.prevKey = this.readyKey; this.fromSpec = this.specOf(this.readyKey); this.pending = [];
    if (mode !== 'watch' && !this.holdMode) this.enter(0, this.specOf(this.readyKey), this.pending, this.readyKey);
  }
  specOf(k) { const e = this.keys[k]; return e ? e.spec : []; }
  get key() { return this.tl[this.i][0]; }
  frame() {
    const [k, , ease] = this.tl[this.i];
    const prev = this.prevKey ?? this.readyKey;
    return { a: prev, b: k, u: easeInOut(Math.min(1, this.t / Math.max(1, 0.45 * ease))), key: k };
  }
  spec() { const f = this.frame(); return blendSpec(this.fromSpec, this.specOf(f.b), f.u); }
  enter(i, fromSpec, ev, prevKey) {
    this.prevKey = prevKey ?? this.tl[this.i][0];
    this.i = i; this.t = 0; this.fromSpec = fromSpec; this.waitMs = 0; this.waiting = false;
    const k = this.tl[i][0], isT = this.targets.has(k);
    if (this.mode === 'reps' && isT && !this.holdMode) this.started++;
    if (ev) ev.push({ type: 'enter', key: k, next: this.tl[(i + 1) % this.tl.length][0], target: isT });
  }
  onKidCount(key, n) {
    const kc = n != null ? n : this.kidCount + 1;
    this.kidCount = Math.max(this.kidCount, kc);
    if (this.mode !== 'reps' || this.holdMode || this.kidCount <= this.started) return;
    // 학생이 더 빠름 → 다음 목표 칸(alt면 센 쪽)으로 바로 넘어감
    const L = this.tl.length;
    for (let d = 1; d <= L; d++) {
      const j = (this.i + d) % L, k = this.tl[j][0];
      if (this.targets.has(k) && (key == null || !this.keys[key] || !this.targets.has(key) || k === key)) {
        const from = this.spec(); this.enter(j, from, null); this.started = this.kidCount; return;
      }
    }
  }
  onSwitch() { this.pendingRest = true; }
  step(dt, kidCount, expectedSide) {
    const ev = this.pending.length ? this.pending.splice(0) : [];
    if (kidCount != null && kidCount > this.kidCount) this.kidCount = kidCount;
    if (this.done) return ev;
    if (this.holdMode) return this.stepHold(dt, expectedSide, ev);
    this.t += dt;
    for (let guard = 0; guard < 64; guard++) {
      const [, dur] = this.tl[this.i];
      if (this.t < dur) break;
      let ni = this.i + 1;
      if (ni >= this.tl.length) { if (this.mode === 'watch') { this.done = true; this.t = dur; break; } ni = 0; }
      const nk = this.tl[ni][0];
      if (this.mode === 'reps' && this.targets.has(nk) && this.started - this.kidCount >= 1) {
        this.waiting = true; this.waitMs = this.t - dur;                              // 지금 자세로 기다림
        if (this.waitMs < this.maxWaitMs) break;
        const carry = this.waitMs - this.maxWaitMs; this.started = this.kidCount;    // 2 s 기다려도 안 오면 다시 보여 줌
        this.enter(ni, this.specOf(this.tl[this.i][0]), ev); this.t = carry; continue;
      }
      const carry = this.waiting ? 0 : this.t - dur;                                // 기다렸다 들어가면 처음부터
      this.enter(ni, this.specOf(this.tl[this.i][0]), ev); this.t = carry;
    }
    return ev;
  }
  stepHold(dt, side, ev) {
    const want = side === undefined ? this.holdSide : side;
    if (want !== this.holdSide) {
      const cur = this.spec(), plan = [];
      if (this.pendingRest && this.keys[this.rest]) plan.push([this.rest, 600, 600]);
      if (want && this.keys[want]) {
        const ci = this.cycle.findIndex(([k]) => k === want);
        const pre = ci >= 0 ? this.cycle[(ci - 1 + this.cycle.length) % this.cycle.length] : null;
        if (pre && pre[0] !== want) { const d = pre[1] * this.unitMs; plan.push([pre[0], d, d]); }
        const units = ci >= 0 ? this.cycle[ci][1] : 1;
        plan.push([want, Infinity, units * this.unitMs]);
      } else plan.push([this.rest, Infinity, 600]);
      this.prevKey = this.key; this.tl = plan; this.i = 0; this.t = 0; this.fromSpec = cur;
      this.holdSide = want; this.pendingRest = false;
      ev.push({ type: 'enter', key: plan[0][0], next: plan[1] ? plan[1][0] : plan[0][0], target: this.targets.has(plan[0][0]) });
    }
    this.t += dt;
    while (this.t >= this.tl[this.i][1] && this.i < this.tl.length - 1) {
      const carry = this.t - this.tl[this.i][1], from = this.specOf(this.tl[this.i][0]);
      this.prevKey = this.tl[this.i][0]; this.i++; this.t = carry; this.fromSpec = from;
      const k = this.tl[this.i][0];
      ev.push({ type: 'enter', key: k, next: this.tl[Math.min(this.i + 1, this.tl.length - 1)][0], target: this.targets.has(k) });
    }
    return ev;
  }
}

// 별 (SPEC §5.6): 학생이 센 개수(운영자 Space 포함, 코치 대신 센 것 제외) 기준
export function starsFor(childCount, target) {
  if (!(target > 0)) return 1;
  const r = childCount / target;
  return r >= 0.9 ? 3 : r >= 0.5 ? 2 : 1;
}
