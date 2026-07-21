// 랜덤 포즈 미션 — 포즈 정의 (데이터 기반) + 가중 점수 판정
//
// 좌표계: getPoseSnapshot().pts 는 {키: {x,y,z}}. 골반 중심 원점, 어깨너비로 정규화,
// 거울 반전(사람 기준 좌우는 관절 키로 고정: L_/R_ 는 사람의 해부학적 좌우).
// y는 위가 +. 판정은 어깨너비(sw)로 다시 정규화해 아동 키·거리 차이를 흡수한다.
//
// 성공률 우선 원칙:
//  - 정확한 각도 하나가 아니라 "조건별 가중 점수" 합산 (AND 방식 금지)
//  - 각 조건은 부드러운 램프(soft)로 0~만점 사이 부분점수를 준다
//  - 낮은 신뢰도 관절은 판정에서 제외하거나 가중치 축소

// ── 점수 헬퍼 ──
// 값 v가 [lo,hi] 안이면 만점, 밖으로 나갈수록 margin 폭만큼 선형 감소
function band(v, lo, hi, margin) {
  if (v >= lo && v <= hi) return 1;
  if (v < lo) return Math.max(0, 1 - (lo - v) / margin);
  return Math.max(0, 1 - (v - hi) / margin);
}
// v가 thr 이상이면 만점, 아래로 margin 만큼 부분점수
function atLeast(v, thr, margin) {
  if (v >= thr) return 1;
  return Math.max(0, 1 - (thr - v) / margin);
}
function atMost(v, thr, margin) {
  if (v <= thr) return 1;
  return Math.max(0, 1 - (v - thr) / margin);
}

// 스냅샷 접근 헬퍼 (어깨너비로 정규화된 상대 좌표)
function make(s) {
  const sw = s.shoulderW || 0.3;
  const P = s.pts, V = s.vis;
  const get = (k) => P[k];
  const has = (k, minVis = 0.4) => P[k] && (V[k] || 0) >= minVis;
  // 두 관절의 정규화된 y차이(위로 +), x차이(사람 좌우), 거리
  const dy = (a, b) => (P[a] && P[b]) ? (P[a].y - P[b].y) / sw : 0;
  const dx = (a, b) => (P[a] && P[b]) ? (P[a].x - P[b].x) / sw : 0;
  const dist = (a, b) => (P[a] && P[b]) ? Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y) / sw : 0;
  // 팔(어깨→손목) 방향 단위벡터: y 위 +, x 사람의 몸 바깥쪽 +
  const armDir = (side) => {
    const sh = P[side + '_SH'], wr = P[side + '_WR'];
    if (!sh || !wr) return null;
    let x = (wr.x - sh.x) / sw, y = (wr.y - sh.y) / sw;
    // 몸 바깥쪽을 +x로: 오른손(R)은 화면에서 -x쪽이므로 부호 통일
    if (side === 'R') x = -x;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len, len };
  };
  return { sw, P, V, get, has, dy, dx, dist, armDir,
    wristAboveHead: (side) => has(side + '_WR') && has('NOSE') && dy(side + '_WR', 'NOSE') > 0.2,
  };
}

// 조건 배열을 점수화 → { matched, confidence(0~1), progress, failedConditions }
// conds: [{ name, weight, score(m) → 0~1, vis?: [키...] }]
function judge(s, conds, passScore = 0.68) {
  const m = make(s);
  let total = 0, got = 0;
  const failed = [];
  for (const c of conds) {
    // 필요한 관절 신뢰도 확인 — 안 보이면 그 조건 가중치를 줄여 관대하게
    let w = c.weight;
    if (c.vis) {
      const visMin = Math.min(...c.vis.map((k) => (m.V[k] || 0)));
      if (visMin < 0.3) w *= 0.35;
    }
    total += w;
    let sc = 0;
    try { sc = Math.max(0, Math.min(1, c.score(m))); } catch (e) { sc = 0; }
    got += w * sc;
    if (sc < 0.5) failed.push(c.name);
  }
  const confidence = total > 0 ? got / total : 0;
  return {
    matched: confidence >= passScore,
    confidence,
    progress: Math.min(1, confidence / passScore),
    failedConditions: failed,
  };
}

// ── 포즈 정의 목록 ──
// reliability: STABLE(기본) | EXPERIMENTAL(테스트 후) | DISABLED
// category: ARMS | DIRECTION | CUTE | FULL_BODY | MOTION
// detect(snapshot) → PoseDetectionResult
export const POSE_DEFS = [
  // ───────── 매우 쉬운 팔 포즈 (STABLE) ─────────
  {
    id: 'both_up', name: '양팔 만세', shortInstruction: '양손을 번쩍 위로!',
    category: 'ARMS', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'both_arms', hintText: '두 팔을 머리 위로 쭉 뻗어요',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 위', weight: 40, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.25, 0.4) },
      { name: '오른손 위', weight: 40, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.25, 0.4) },
      { name: '양손 벌림', weight: 20, score: (m) => atLeast(m.dist('L_WR', 'R_WR'), 0.6, 0.6) },
    ]),
  },
  {
    id: 'left_up', name: '왼손 들기', shortInstruction: '왼손을 번쩍!',
    category: 'ARMS', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'single_up', hintText: '왼손만 머리 위로',
    requiredLandmarks: ['L_WR', 'L_SH', 'R_WR'],
    detect: (s) => judge(s, [
      { name: '왼손 위', weight: 55, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.25, 0.4) },
      { name: '오른손 아래', weight: 30, vis: ['R_WR'], score: (m) => atMost(m.dy('R_WR', 'R_SH'), 0.0, 0.4) },
      { name: '왼팔 폄', weight: 15, score: (m) => { const d = m.armDir('L'); return d ? atLeast(d.len, 0.9, 0.5) : 0; } },
    ]),
  },
  {
    id: 'right_up', name: '오른손 들기', shortInstruction: '오른손을 번쩍!',
    category: 'ARMS', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'single_up', hintText: '오른손만 머리 위로',
    requiredLandmarks: ['R_WR', 'R_SH', 'L_WR'],
    detect: (s) => judge(s, [
      { name: '오른손 위', weight: 55, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.25, 0.4) },
      { name: '왼손 아래', weight: 30, vis: ['L_WR'], score: (m) => atMost(m.dy('L_WR', 'L_SH'), 0.0, 0.4) },
      { name: '오른팔 폄', weight: 15, score: (m) => { const d = m.armDir('R'); return d ? atLeast(d.len, 0.9, 0.5) : 0; } },
    ]),
  },
  {
    id: 'both_side', name: '양팔 옆으로', shortInstruction: '양팔을 옆으로 쫙!',
    category: 'ARMS', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'both_arms', hintText: '두 팔을 어깨 높이로 옆으로',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼팔 수평', weight: 35, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.25, 0.25, 0.35) },
      { name: '오른팔 수평', weight: 35, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.25, 0.25, 0.35) },
      { name: '양팔 벌림', weight: 30, score: (m) => atLeast(m.dist('L_WR', 'R_WR'), 1.4, 0.8) },
    ]),
  },
  {
    id: 'left_side', name: '왼팔 옆으로', shortInstruction: '왼팔만 옆으로!',
    category: 'ARMS', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'single_side', hintText: '왼팔을 어깨 높이로 옆으로',
    requiredLandmarks: ['L_WR', 'L_SH'],
    detect: (s) => judge(s, [
      { name: '왼팔 수평', weight: 45, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.25, 0.25, 0.35) },
      { name: '왼팔 뻗음', weight: 35, score: (m) => atLeast(Math.abs(m.dx('L_WR', 'L_SH')), 0.7, 0.5) },
      { name: '오른팔 내림', weight: 20, vis: ['R_WR'], score: (m) => atMost(m.dy('R_WR', 'R_SH'), -0.1, 0.4) },
    ]),
  },
  {
    id: 'right_side', name: '오른팔 옆으로', shortInstruction: '오른팔만 옆으로!',
    category: 'ARMS', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'single_side', hintText: '오른팔을 어깨 높이로 옆으로',
    requiredLandmarks: ['R_WR', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '오른팔 수평', weight: 45, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.25, 0.25, 0.35) },
      { name: '오른팔 뻗음', weight: 35, score: (m) => atLeast(Math.abs(m.dx('R_WR', 'R_SH')), 0.7, 0.5) },
      { name: '왼팔 내림', weight: 20, vis: ['L_WR'], score: (m) => atMost(m.dy('L_WR', 'L_SH'), -0.1, 0.4) },
    ]),
  },
  {
    id: 'attention', name: '차렷', shortInstruction: '두 팔을 아래로 차렷!',
    category: 'ARMS', difficulty: 'EASY', reliability: 'STABLE',
    weight: 0.3, // 기본 서있는 자세라 노력 없이 통과 → 드물게만 출제
    cooldownGroup: 'rest', hintText: '팔을 몸 옆에 붙여요',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_HIP', 'R_HIP'],
    detect: (s) => judge(s, [
      { name: '왼손 아래', weight: 35, vis: ['L_WR'], score: (m) => atMost(m.dy('L_WR', 'L_SH'), -0.5, 0.4) },
      { name: '오른손 아래', weight: 35, vis: ['R_WR'], score: (m) => atMost(m.dy('R_WR', 'R_SH'), -0.5, 0.4) },
      { name: '팔 붙임', weight: 30, score: (m) => atMost(m.dist('L_WR', 'R_WR'), 0.9, 0.6) },
    ]),
  },
  {
    id: 'hands_hip', name: '양손 허리', shortInstruction: '양손을 허리에!',
    category: 'ARMS', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'rest', hintText: '두 손을 허리에 콕',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_HIP', 'R_HIP', 'L_EL', 'R_EL'],
    detect: (s) => judge(s, [
      { name: '왼손 허리높이', weight: 30, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_HIP'), -0.2, 0.35, 0.35) },
      { name: '오른손 허리높이', weight: 30, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_HIP'), -0.2, 0.35, 0.35) },
      { name: '왼손 몸 가까이', weight: 20, vis: ['L_WR'], score: (m) => atMost(Math.abs(m.dx('L_WR', 'L_HIP')), 0.5, 0.4) },
      { name: '오른손 몸 가까이', weight: 20, vis: ['R_WR'], score: (m) => atMost(Math.abs(m.dx('R_WR', 'R_HIP')), 0.5, 0.4) },
    ]),
  },

  // ───────── 방향 조합 포즈 ─────────
  {
    id: 'lup_rside', name: '왼팔 위 + 오른팔 옆', shortInstruction: '왼손 위로, 오른팔 옆으로!',
    category: 'DIRECTION', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'combo', hintText: '왼손은 하늘, 오른팔은 옆으로',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 위', weight: 40, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.25, 0.4) },
      { name: '오른팔 수평', weight: 40, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.25, 0.25, 0.35) },
      { name: '오른팔 뻗음', weight: 20, score: (m) => atLeast(Math.abs(m.dx('R_WR', 'R_SH')), 0.6, 0.5) },
    ]),
  },
  {
    id: 'rup_lside', name: '오른팔 위 + 왼팔 옆', shortInstruction: '오른손 위로, 왼팔 옆으로!',
    category: 'DIRECTION', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'combo', hintText: '오른손은 하늘, 왼팔은 옆으로',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '오른손 위', weight: 40, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.25, 0.4) },
      { name: '왼팔 수평', weight: 40, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.25, 0.25, 0.35) },
      { name: '왼팔 뻗음', weight: 20, score: (m) => atLeast(Math.abs(m.dx('L_WR', 'L_SH')), 0.6, 0.5) },
    ]),
  },
  {
    id: 'both_diag_up', name: '양팔 대각선 위', shortInstruction: '두 팔을 브이(V)로 위로!',
    category: 'DIRECTION', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'both_arms', hintText: '두 팔을 위로 벌려 V자',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼팔 대각위', weight: 35, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), 0.1, 0.6, 0.35) },
      { name: '오른팔 대각위', weight: 35, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), 0.1, 0.6, 0.35) },
      { name: '양손 벌림', weight: 30, score: (m) => atLeast(m.dist('L_WR', 'R_WR'), 1.2, 0.7) },
    ]),
  },
  {
    id: 'both_diag_down', name: '양팔 대각선 아래', shortInstruction: '두 팔을 아래로 벌려요!',
    category: 'DIRECTION', difficulty: 'NORMAL', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'both_arms', hintText: '두 팔을 아래로 벌려 Y자 거꾸로',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼팔 대각아래', weight: 35, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.7, -0.2, 0.35) },
      { name: '오른팔 대각아래', weight: 35, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.7, -0.2, 0.35) },
      { name: '양손 벌림', weight: 30, score: (m) => atLeast(m.dist('L_WR', 'R_WR'), 1.0, 0.6) },
    ]),
  },
  {
    id: 'point_left', name: '왼쪽 가리키기', shortInstruction: '왼쪽을 가리켜요!',
    category: 'DIRECTION', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'point', hintText: '한 팔을 왼쪽으로 쭉',
    requiredLandmarks: ['L_WR', 'L_SH'],
    detect: (s) => judge(s, [
      // 사람의 왼쪽(화면 오른쪽) 방향으로 팔을 뻗음: 왼손목이 왼어깨보다 바깥쪽
      { name: '왼팔 옆 뻗음', weight: 55, vis: ['L_WR'], score: (m) => atLeast(m.dx('L_WR', 'L_SH'), 0.7, 0.5) },
      { name: '수평 높이', weight: 30, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.35, 0.35, 0.4) },
      { name: '오른팔 내림', weight: 15, vis: ['R_WR'], score: (m) => atMost(m.dy('R_WR', 'R_SH'), 0.0, 0.4) },
    ]),
  },
  {
    id: 'point_right', name: '오른쪽 가리키기', shortInstruction: '오른쪽을 가리켜요!',
    category: 'DIRECTION', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'point', hintText: '한 팔을 오른쪽으로 쭉',
    requiredLandmarks: ['R_WR', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '오른팔 옆 뻗음', weight: 55, vis: ['R_WR'], score: (m) => atLeast(-m.dx('R_WR', 'R_SH'), 0.7, 0.5) },
      { name: '수평 높이', weight: 30, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.35, 0.35, 0.4) },
      { name: '왼팔 내림', weight: 15, vis: ['L_WR'], score: (m) => atMost(m.dy('L_WR', 'L_SH'), 0.0, 0.4) },
    ]),
  },
  {
    id: 'point_up', name: '위쪽 가리키기', shortInstruction: '하늘을 가리켜요!',
    category: 'DIRECTION', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'single_up', hintText: '한 손 검지로 하늘 콕',
    requiredLandmarks: ['L_WR', 'R_WR'],
    detect: (s) => judge(s, [
      // 한 손이라도 머리 위로
      { name: '한 손 위로', weight: 70, vis: ['L_WR', 'R_WR'], score: (m) => Math.max(atLeast(m.dy('L_WR', 'NOSE'), 0.1, 0.4), atLeast(m.dy('R_WR', 'NOSE'), 0.1, 0.4)) },
      { name: '팔 폄', weight: 30, score: (m) => { const l = m.armDir('L'), r = m.armDir('R'); return Math.max(l ? atLeast(l.len, 0.85, 0.5) : 0, r ? atLeast(r.len, 0.85, 0.5) : 0); } },
    ]),
  },

  // ───────── 전신 재미 포즈 (STABLE 위주 — 큰 관절) ─────────
  {
    id: 'airplane', name: '비행기', shortInstruction: '양팔 벌려 비행기!',
    category: 'FULL_BODY', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'both_arms', hintText: '두 팔을 옆으로 쫙, 비행기처럼',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼팔 수평', weight: 35, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.3, 0.3, 0.4) },
      { name: '오른팔 수평', weight: 35, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.3, 0.3, 0.4) },
      { name: '크게 벌림', weight: 30, score: (m) => atLeast(m.dist('L_WR', 'R_WR'), 1.5, 0.8) },
    ]),
  },
  {
    id: 'superhero', name: '슈퍼히어로', shortInstruction: '한 손 위, 한 손 허리! 슈퍼맨!',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'combo', hintText: '한 손은 하늘로, 한 손은 허리에',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH', 'L_HIP', 'R_HIP'],
    detect: (s) => judge(s, [
      // 좌우 어느 쪽이든 (한 손 위 + 반대 손 허리)
      { name: '한 손 위', weight: 45, vis: ['L_WR', 'R_WR'], score: (m) => Math.max(atLeast(m.dy('L_WR', 'L_SH'), 0.25, 0.4), atLeast(m.dy('R_WR', 'R_SH'), 0.25, 0.4)) },
      { name: '반대 손 허리', weight: 35, vis: ['L_WR', 'R_WR'], score: (m) => {
        const lUp = m.dy('L_WR', 'L_SH') > 0.2;
        const other = lUp ? 'R' : 'L';
        return band(m.dy(other + '_WR', other + '_HIP'), -0.25, 0.4, 0.4);
      } },
      { name: '자세 안정', weight: 20, score: () => 1 },
    ]),
  },
  {
    id: 'cheer', name: '응원 자세', shortInstruction: '양손 위로 흔들 준비! 응원!',
    category: 'FULL_BODY', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'both_arms', hintText: '두 손을 머리 위로 살짝 벌려요',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 위', weight: 40, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.2, 0.4) },
      { name: '오른손 위', weight: 40, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.2, 0.4) },
      { name: '어깨보다 넓게', weight: 20, score: (m) => atLeast(m.dist('L_WR', 'R_WR'), 0.9, 0.6) },
    ]),
  },
  {
    id: 'lean_left', name: '몸 왼쪽 기울이기', shortInstruction: '몸을 왼쪽으로 기울여요!',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'lean', hintText: '상체를 왼쪽으로 살짝',
    requiredLandmarks: ['L_SH', 'R_SH', 'L_HIP', 'R_HIP'],
    detect: (s) => judge(s, [
      // 어깨선이 사람의 왼쪽으로 내려감 (왼어깨가 오른어깨보다 낮음)
      { name: '어깨 기울기', weight: 70, vis: ['L_SH', 'R_SH'], score: (m) => atLeast(m.dy('R_SH', 'L_SH'), 0.15, 0.25) },
      { name: '유지', weight: 30, score: () => 1 },
    ]),
  },
  {
    id: 'lean_right', name: '몸 오른쪽 기울이기', shortInstruction: '몸을 오른쪽으로 기울여요!',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'lean', hintText: '상체를 오른쪽으로 살짝',
    requiredLandmarks: ['L_SH', 'R_SH', 'L_HIP', 'R_HIP'],
    detect: (s) => judge(s, [
      { name: '어깨 기울기', weight: 70, vis: ['L_SH', 'R_SH'], score: (m) => atLeast(m.dy('L_SH', 'R_SH'), 0.15, 0.25) },
      { name: '유지', weight: 30, score: () => 1 },
    ]),
  },
  {
    id: 'robot', name: '로봇 자세', shortInstruction: '두 팔을 앞으로 접어 로봇!',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'combo', hintText: '팔꿈치를 90도로 앞으로',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_EL', 'R_EL', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 가슴높이', weight: 30, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.4, 0.1, 0.35) },
      { name: '오른손 가슴높이', weight: 30, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.4, 0.1, 0.35) },
      { name: '팔 앞으로 모음', weight: 40, score: (m) => atMost(m.dist('L_WR', 'R_WR'), 1.0, 0.6) },
    ]),
  },

  // ───────── 웃음 포인트 포즈 (STABLE — 큰 관절만 사용) ─────────
  {
    id: 'muscle', name: '알통 뽐내기', shortInstruction: '두 팔 접어 알통 뽐내기! 💪',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'flex', hintText: '두 주먹을 머리 옆으로 올려 힘 꽉! 💪',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH', 'L_EL', 'R_EL'],
    detect: (s) => judge(s, [
      { name: '왼주먹 위', weight: 28, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), 0.1, 0.9, 0.4) },
      { name: '오른주먹 위', weight: 28, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), 0.1, 0.9, 0.4) },
      { name: '팔꿈치 벌림', weight: 24, vis: ['L_EL', 'R_EL'], score: (m) => (atLeast(Math.abs(m.dx('L_EL', 'L_SH')), 0.2, 0.4) + atLeast(Math.abs(m.dx('R_EL', 'R_SH')), 0.2, 0.4)) / 2 },
      { name: '주먹 머리 근처', weight: 20, score: (m) => (atMost(Math.abs(m.dx('L_WR', 'L_SH')), 0.75, 0.5) + atMost(Math.abs(m.dx('R_WR', 'R_SH')), 0.75, 0.5)) / 2 },
    ]),
  },
  {
    id: 'disco', name: '토요일밤 디스코', shortInstruction: '한 손은 하늘! 한 손은 아래! 🕺',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'dance', hintText: '한 손가락으로 하늘 콕! 반대 손은 아래로 🕺',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '한 손 하늘 대각', weight: 45, vis: ['L_WR', 'R_WR'], score: (m) => {
        const up = (side) => Math.min(atLeast(m.dy(side + '_WR', side + '_SH'), 0.4, 0.4), atLeast(Math.abs(m.dx(side + '_WR', side + '_SH')), 0.25, 0.4));
        return Math.max(up('L'), up('R'));
      } },
      { name: '반대 손 아래로', weight: 40, vis: ['L_WR', 'R_WR'], score: (m) => {
        const other = m.dy('L_WR', 'L_SH') > m.dy('R_WR', 'R_SH') ? 'R' : 'L';
        return atMost(m.dy(other + '_WR', other + '_SH'), -0.1, 0.5);
      } },
      { name: '신나게', weight: 15, score: () => 1 },
    ]),
  },
  {
    id: 'trex', name: '티라노 공룡', shortInstruction: '팔을 작게 오므려 공룡! 🦖',
    category: 'FULL_BODY', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'dino', hintText: '팔꿈치는 옆구리에 붙이고 손은 앞으로 오므려요 🦖',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 가슴앞', weight: 25, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'L_SH'), -0.6, 0.05, 0.35) },
      { name: '오른손 가슴앞', weight: 25, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'R_SH'), -0.6, 0.05, 0.35) },
      { name: '팔 몸에 붙임', weight: 30, vis: ['L_WR', 'R_WR'], score: (m) => (atMost(Math.abs(m.dx('L_WR', 'L_SH')), 0.45, 0.4) + atMost(Math.abs(m.dx('R_WR', 'R_SH')), 0.45, 0.4)) / 2 },
      { name: '손 앞으로 오므림', weight: 20, score: (m) => atMost(m.dist('L_WR', 'R_WR'), 0.85, 0.5) },
    ]),
  },
  {
    id: 'selfhug', name: '셀프 허그', shortInstruction: '두 팔로 나를 꼬옥 안아요! 🤗',
    category: 'CUTE', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'hug', hintText: '두 손을 반대쪽 어깨에 올려 꼬옥 🤗',
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 오른어깨', weight: 40, vis: ['L_WR', 'R_SH'], score: (m) => atMost(m.dist('L_WR', 'R_SH'), 0.8, 0.6) },
      { name: '오른손 왼어깨', weight: 40, vis: ['R_WR', 'L_SH'], score: (m) => atMost(m.dist('R_WR', 'L_SH'), 0.8, 0.6) },
      { name: '가슴 높이', weight: 20, vis: ['L_WR', 'R_WR'], score: (m) => (band(m.dy('L_WR', 'L_SH'), -0.5, 0.3, 0.4) + band(m.dy('R_WR', 'R_SH'), -0.5, 0.3, 0.4)) / 2 },
    ]),
  },
  {
    id: 'dab', name: '댑 댄스', shortInstruction: '한쪽으로 두 팔 쭉! 얼굴은 팔에 쏙! 🙆',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'dab', hintText: '두 팔을 같은 쪽 위로 뻗고 고개를 팔에 파묻어요 🙆',
    requiredLandmarks: ['L_WR', 'R_WR', 'NOSE', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '두 팔 한쪽으로', weight: 45, vis: ['L_WR', 'R_WR', 'NOSE'], score: (m) => {
        const lp = m.P.L_WR, rp = m.P.R_WR, np = m.P.NOSE, sw = m.sw;
        if (!lp || !rp || !np) return 0;
        const dl = (lp.x - np.x) / sw, dr = (rp.x - np.x) / sw;
        if (dl * dr <= 0) return 0; // 두 손이 서로 반대편이면 실패
        return Math.min(atLeast(Math.abs(dl), 0.3, 0.4), atLeast(Math.abs(dr), 0.3, 0.4));
      } },
      { name: '한 손 머리 위', weight: 35, vis: ['L_WR', 'R_WR'], score: (m) => Math.max(atLeast(m.dy('L_WR', 'NOSE'), -0.1, 0.4), atLeast(m.dy('R_WR', 'NOSE'), -0.1, 0.4)) },
      { name: '팔 쭉', weight: 20, score: () => 1 },
    ]),
  },

  // ───────── 다리 쓰는 포즈 (STABLE — 전신 인식 필요) ─────────
  {
    id: 'wide_stand', name: '다리 벌려 서기', shortInstruction: '두 발을 넓게 벌려요!',
    category: 'FULL_BODY', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'legs', hintText: '두 발을 어깨보다 넓게 쫙 벌려요', needsFullBody: true,
    requiredLandmarks: ['L_ANK', 'R_ANK', 'L_HIP', 'R_HIP'],
    detect: (s) => judge(s, [
      { name: '두 발 넓게', weight: 65, vis: ['L_ANK', 'R_ANK'], score: (m) => atLeast(Math.abs(m.dx('L_ANK', 'R_ANK')), 1.2, 0.7) },
      { name: '바르게 서기', weight: 35, vis: ['L_ANK', 'R_ANK'], score: (m) => atMost(Math.abs(m.dy('L_ANK', 'R_ANK')), 0.4, 0.4) },
    ], 0.6),
  },
  {
    id: 'one_leg', name: '한 발 들기', shortInstruction: '한 발을 들어 홍학처럼! 🦩',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'legs', hintText: '한 발을 옆으로 살짝 들어 균형! 🦩', needsFullBody: true,
    requiredLandmarks: ['L_ANK', 'R_ANK', 'L_KNEE', 'R_KNEE'],
    detect: (s) => judge(s, [
      { name: '한 발 들기', weight: 70, vis: ['L_ANK', 'R_ANK'], score: (m) => atLeast(Math.abs(m.dy('L_ANK', 'R_ANK')), 0.45, 0.4) },
      { name: '균형 잡기', weight: 30, score: () => 1 },
    ], 0.6),
  },
  {
    id: 'squat', name: '앉았다 스쿼트', shortInstruction: '무릎 굽혀 살짝 앉아요!',
    category: 'FULL_BODY', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'legs2', hintText: '무릎을 굽혀 엉덩이를 살짝 내려 앉아요', needsFullBody: true,
    requiredLandmarks: ['L_HIP', 'R_HIP', 'L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK'],
    detect: (s) => judge(s, [
      { name: '무릎 굽혀 앉기', weight: 70, vis: ['L_KNEE', 'R_KNEE', 'L_HIP', 'R_HIP'], score: (m) => (atMost(m.dy('L_HIP', 'L_KNEE'), 0.85, 0.5) + atMost(m.dy('R_HIP', 'R_KNEE'), 0.85, 0.5)) / 2 },
      { name: '두 발 지지', weight: 30, vis: ['L_ANK', 'R_ANK'], score: (m) => atLeast(Math.abs(m.dx('L_ANK', 'R_ANK')), 0.5, 0.5) },
    ], 0.58),
  },

  // ───────── 다리 포함 (EXPERIMENTAL) ─────────
  {
    id: 'knee_left', name: '왼쪽 무릎 굽히기', shortInstruction: '왼쪽 무릎을 살짝 굽혀요!',
    category: 'FULL_BODY', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'knee', hintText: '왼발을 살짝 들어 무릎 굽히기', needsFullBody: true,
    requiredLandmarks: ['L_HIP', 'L_KNEE', 'L_ANK'],
    detect: (s) => judge(s, [
      { name: '왼무릎 굽힘', weight: 70, vis: ['L_KNEE', 'L_ANK'], score: (m) => atLeast(m.dy('L_KNEE', 'L_ANK'), 0.35, 0.4) },
      { name: '서있음', weight: 30, score: () => 1 },
    ], 0.6),
  },
  {
    id: 'knee_right', name: '오른쪽 무릎 굽히기', shortInstruction: '오른쪽 무릎을 살짝 굽혀요!',
    category: 'FULL_BODY', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'knee', hintText: '오른발을 살짝 들어 무릎 굽히기', needsFullBody: true,
    requiredLandmarks: ['R_HIP', 'R_KNEE', 'R_ANK'],
    detect: (s) => judge(s, [
      { name: '오른무릎 굽힘', weight: 70, vis: ['R_KNEE', 'R_ANK'], score: (m) => atLeast(m.dy('R_KNEE', 'R_ANK'), 0.35, 0.4) },
      { name: '서있음', weight: 30, score: () => 1 },
    ], 0.6),
  },

  // ───────── 귀여운 촬영 포즈 (손/얼굴 근처 — EXPERIMENTAL) ─────────
  {
    id: 'overhead_heart', name: '머리 위 하트', shortInstruction: '머리 위로 하트 그리기!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'heart', hintText: '두 팔을 머리 위로 동그랗게',
    requiredLandmarks: ['L_WR', 'R_WR', 'NOSE'],
    detect: (s) => judge(s, [
      { name: '양손 머리 위', weight: 50, vis: ['L_WR', 'R_WR'], score: (m) => Math.min(atLeast(m.dy('L_WR', 'NOSE'), 0.05, 0.3), atLeast(m.dy('R_WR', 'NOSE'), 0.05, 0.3)) },
      { name: '양손 모음', weight: 30, score: (m) => atMost(m.dist('L_WR', 'R_WR'), 1.1, 0.6) },
      { name: '하트 감지', weight: 20, score: (m) => m.P && s.heart ? Math.max(s.heart.blend, 0.3) : 0.3 },
    ], 0.62),
  },
  {
    id: 'v_left', name: '왼손 브이', shortInstruction: '왼손으로 브이(V)!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'v', hintText: '왼손을 얼굴 옆에 브이',
    requiredLandmarks: ['L_WR'],
    detect: (s) => {
      const g = s.hands && s.hands.left;
      const gestureOk = g && g.gesture === 'victory' ? g.gBlend : 0;
      return judge(s, [
        { name: '왼손 얼굴 근처', weight: 40, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'NOSE'), -0.6, 0.5, 0.5) },
        { name: '브이 손모양', weight: 60, score: () => gestureOk },
      ], 0.6);
    },
  },
  {
    id: 'v_right', name: '오른손 브이', shortInstruction: '오른손으로 브이(V)!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'v', hintText: '오른손을 얼굴 옆에 브이',
    requiredLandmarks: ['R_WR'],
    detect: (s) => {
      const g = s.hands && s.hands.right;
      const gestureOk = g && g.gesture === 'victory' ? g.gBlend : 0;
      return judge(s, [
        { name: '오른손 얼굴 근처', weight: 40, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'NOSE'), -0.6, 0.5, 0.5) },
        { name: '브이 손모양', weight: 60, score: () => gestureOk },
      ], 0.6);
    },
  },
  {
    id: 'v_both', name: '양손 브이', shortInstruction: '양손으로 브이(V)!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'v', hintText: '두 손 모두 브이',
    requiredLandmarks: ['L_WR', 'R_WR'],
    detect: (s) => {
      const gl = s.hands && s.hands.left && s.hands.left.gesture === 'victory' ? s.hands.left.gBlend : 0;
      const gr = s.hands && s.hands.right && s.hands.right.gesture === 'victory' ? s.hands.right.gBlend : 0;
      return judge(s, [
        { name: '왼손 브이', weight: 50, score: () => gl },
        { name: '오른손 브이', weight: 50, score: () => gr },
      ], 0.55);
    },
  },
  {
    id: 'hands_face', name: '양손 얼굴 옆', shortInstruction: '양손을 얼굴 옆에!',
    category: 'CUTE', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'face', hintText: '두 손을 볼 옆에 살짝',
    requiredLandmarks: ['L_WR', 'R_WR', 'NOSE'],
    detect: (s) => judge(s, [
      { name: '왼손 얼굴높이', weight: 40, vis: ['L_WR'], score: (m) => band(m.dy('L_WR', 'NOSE'), -0.4, 0.3, 0.4) },
      { name: '오른손 얼굴높이', weight: 40, vis: ['R_WR'], score: (m) => band(m.dy('R_WR', 'NOSE'), -0.4, 0.3, 0.4) },
      { name: '얼굴 옆', weight: 20, score: (m) => band(m.dist('L_WR', 'R_WR'), 0.4, 1.3, 0.5) },
    ]),
  },
  {
    id: 'chin_rest', name: '한 손 턱받침', shortInstruction: '한 손으로 턱을 괴어요!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'STABLE',
    cooldownGroup: 'face', hintText: '한 손을 턱 아래에 살짝',
    requiredLandmarks: ['L_WR', 'R_WR', 'NOSE'],
    detect: (s) => judge(s, [
      { name: '한 손 얼굴 근처', weight: 70, vis: ['L_WR', 'R_WR'], score: (m) => Math.max(band(m.dy('L_WR', 'NOSE'), -0.6, 0.0, 0.4), band(m.dy('R_WR', 'NOSE'), -0.6, 0.0, 0.4)) },
      { name: '유지', weight: 30, score: () => 1 },
    ], 0.6),
  },
  {
    id: 'thumbsup_left', name: '왼손 엄지척', shortInstruction: '왼손 엄지척 👍!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'thumbs', hintText: '왼손 엄지를 위로',
    requiredLandmarks: ['L_WR'],
    detect: (s) => {
      const g = s.hands && s.hands.left && s.hands.left.gesture === 'thumbsUp' ? s.hands.left.gBlend : 0;
      return judge(s, [{ name: '왼손 엄지척', weight: 100, score: () => g }], 0.55);
    },
  },
  {
    id: 'thumbsup_right', name: '오른손 엄지척', shortInstruction: '오른손 엄지척 👍!',
    category: 'CUTE', difficulty: 'CHALLENGE', reliability: 'EXPERIMENTAL',
    cooldownGroup: 'thumbs', hintText: '오른손 엄지를 위로',
    requiredLandmarks: ['R_WR'],
    detect: (s) => {
      const g = s.hands && s.hands.right && s.hands.right.gesture === 'thumbsUp' ? s.hands.right.gBlend : 0;
      return judge(s, [{ name: '오른손 엄지척', weight: 100, score: () => g }], 0.55);
    },
  },
  {
    id: 'surprise', name: '깜짝 놀란 자세', shortInstruction: '양손을 볼에! 깜짝!',
    category: 'CUTE', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'face', hintText: '두 손을 볼 옆에 대고 놀란 표정',
    requiredLandmarks: ['L_WR', 'R_WR', 'NOSE'],
    detect: (s) => judge(s, [
      { name: '양손 얼굴 옆', weight: 60, vis: ['L_WR', 'R_WR'], score: (m) => Math.min(band(m.dy('L_WR', 'NOSE'), -0.5, 0.2, 0.4), band(m.dy('R_WR', 'NOSE'), -0.5, 0.2, 0.4)) },
      { name: '입 벌림', weight: 40, score: () => 0.6 },
    ], 0.6),
  },

  // ───────── 동작형 미션 (MOTION) ─────────
  {
    id: 'wave_left', name: '왼손 흔들기', shortInstruction: '왼손을 흔들어요! 👋',
    category: 'MOTION', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'wave', hintText: '왼손을 들고 좌우로 흔들흔들', motion: true,
    requiredLandmarks: ['L_WR', 'L_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 들기', weight: 100, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.0, 0.4) },
    ], 0.6),
  },
  {
    id: 'wave_right', name: '오른손 흔들기', shortInstruction: '오른손을 흔들어요! 👋',
    category: 'MOTION', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'wave', hintText: '오른손을 들고 좌우로 흔들흔들', motion: true,
    requiredLandmarks: ['R_WR', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '오른손 들기', weight: 100, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.0, 0.4) },
    ], 0.6),
  },
  {
    id: 'wave_both', name: '양손 흔들기', shortInstruction: '양손을 흔들어요! 🙌',
    category: 'MOTION', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'wave', hintText: '두 손을 들고 흔들흔들', motion: true,
    requiredLandmarks: ['L_WR', 'R_WR'],
    detect: (s) => judge(s, [
      { name: '왼손 들기', weight: 50, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.0, 0.4) },
      { name: '오른손 들기', weight: 50, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.0, 0.4) },
    ], 0.6),
  },
  {
    id: 'sway', name: '몸 좌우로 흔들기', shortInstruction: '몸을 좌우로 흔들어요!',
    category: 'MOTION', difficulty: 'NORMAL', reliability: 'STABLE',
    cooldownGroup: 'lean', hintText: '상체를 좌우로 왔다갔다', motion: true,
    requiredLandmarks: ['L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '몸 기울임', weight: 100, vis: ['L_SH', 'R_SH'], score: (m) => atLeast(Math.abs(m.dy('L_SH', 'R_SH')), 0.1, 0.2) },
    ], 0.5),
  },
  {
    id: 'raise_both', name: '양팔 올리기', shortInstruction: '양팔을 아래에서 위로 올려요!',
    category: 'MOTION', difficulty: 'EASY', reliability: 'STABLE',
    cooldownGroup: 'both_arms', hintText: '두 팔을 위로 쭉 올리기', motion: true,
    requiredLandmarks: ['L_WR', 'R_WR', 'L_SH', 'R_SH'],
    detect: (s) => judge(s, [
      { name: '왼손 위', weight: 50, vis: ['L_WR'], score: (m) => atLeast(m.dy('L_WR', 'L_SH'), 0.2, 0.4) },
      { name: '오른손 위', weight: 50, vis: ['R_WR'], score: (m) => atLeast(m.dy('R_WR', 'R_SH'), 0.2, 0.4) },
    ]),
  },
];

// 편의: id로 조회
export const POSE_BY_ID = Object.fromEntries(POSE_DEFS.map((p) => [p.id, p]));

// 난이도/카테고리 상수
export const DIFFICULTIES = ['EASY', 'NORMAL', 'CHALLENGE'];
export const CATEGORIES = ['ARMS', 'DIRECTION', 'CUTE', 'FULL_BODY', 'MOTION'];
export const CATEGORY_LABELS = { ARMS: '팔', DIRECTION: '방향', CUTE: '귀여운', FULL_BODY: '전신', MOTION: '동작' };
export const DIFFICULTY_LABELS = { EASY: '쉬움', NORMAL: '보통', CHALLENGE: '도전' };
