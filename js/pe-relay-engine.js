import { KP, MOVES, Z } from './pe-moves.js';

export const RELAY_HOLD_MS = 1000;
const MAX_FRAME_GAP_MS = 250;
const MIN_VISIBILITY = 0.5;
const SHOULDERS = ['L_SH', 'R_SH'];
const HIPS = ['L_HIP', 'R_HIP'];
const LEGS = ['L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK'];
const IMAGE_JOINTS = {
  NOSE: 0,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28,
};

const sideName = (side) => side === 'L' ? '왼' : '오른';
const outward = (side) => side === 'L' ? -1 : 1;
const between = (value, min, max) => value >= min && value <= max;
const degrees = (radians) => radians * 180 / Math.PI;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const z = (bone, angle) => [bone, Z, angle];

function arm(side, elevation, bend = 0) {
  const name = side === 'L' ? 'left' : 'right';
  const liftSign = -outward(side);
  return [z(name + 'UpperArm', elevation * liftSign), z(name + 'LowerArm', bend * liftSign)];
}

function condition(joints, hint, check) {
  return { joints, hint, check };
}

function wristAboveHead(side) {
  return condition([side + '_WR', 'NOSE'], `${sideName(side)}손을 머리 위까지 올려요.`, (p, unit) =>
    p[side + '_WR'].y - p.NOSE.y >= 0.3 * unit);
}

// PoseSnapshot is mirrored. Student L/R joint names stay anatomical, with the student's right toward +x.
function armDirection(side, direction) {
  const [min, max, word] = {
    level: [-19, 19, '어깨 높이에서 옆으로'], up: [25, 72, '위 대각선으로'], down: [-72, -25, '아래 대각선으로'],
  }[direction];
  return condition([side + '_EL', side + '_WR'], `${sideName(side)}팔을 ${word} 뻗어요.`, (p, unit) => {
    const shoulder = p[side + '_SH'], elbow = p[side + '_EL'], wrist = p[side + '_WR'];
    const x = outward(side) * (wrist.x - shoulder.x);
    const elevation = degrees(Math.atan2(wrist.y - shoulder.y, x));
    const reach = distance(shoulder, wrist);
    return x >= 0.4 * unit && between(elevation, min, max)
      && reach >= 0.76 * (distance(shoulder, elbow) + distance(elbow, wrist));
  });
}

function kneeAngle(hip, knee, ankle) {
  const a = [hip.x - knee.x, hip.y - knee.y, (hip.z ?? 0) - (knee.z ?? 0)];
  const b = [ankle.x - knee.x, ankle.y - knee.y, (ankle.z ?? 0) - (knee.z ?? 0)];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cos = dot / (Math.hypot(...a) * Math.hypot(...b));
  return degrees(Math.acos(Math.max(-1, Math.min(1, cos))));
}

const kneesBent = condition([...HIPS, ...LEGS], '두 발은 바닥에 두고 양 무릎을 살짝 굽혀요.', (p, unit) =>
  Math.abs(p.L_ANK.y - p.R_ANK.y) <= 0.25 * unit
  && kneeAngle(p.L_HIP, p.L_KNEE, p.L_ANK) <= 164
  && kneeAngle(p.R_HIP, p.R_KNEE, p.R_ANK) <= 164);

function armFolded(side) {
  return condition([side + '_EL', side + '_WR'], `${sideName(side)}쪽 팔꿈치를 접어 손을 어깨 가까이 가져와요.`, (p, unit) => {
    const shoulder = p[side + '_SH'], elbow = p[side + '_EL'], wrist = p[side + '_WR'];
    return distance(shoulder, wrist) <= 0.78 * (distance(shoulder, elbow) + distance(elbow, wrist))
      && Math.abs(shoulder.y - wrist.y) <= 0.6 * unit;
  });
}

const kneesStraight = condition([...HIPS, ...LEGS], '무릎을 펴고 일어서요.', (p) =>
  kneeAngle(p.L_HIP, p.L_KNEE, p.L_ANK) >= 169 && kneeAngle(p.R_HIP, p.R_KNEE, p.R_ANK) >= 169);

function step(instruction, demo, ...conditions) {
  const requiredLandmarks = [...new Set([...SHOULDERS, ...conditions.flatMap((c) => c.joints)])];
  return { instruction, demo, conditions, requiredLandmarks };
}

function mission(id, focus, title, steps) {
  const requiresFullBody = steps.some((s) => s.requiredLandmarks.some((key) => LEGS.includes(key)));
  return { id, focus, title, steps, requiresFullBody, assessment: 'camera' };
}

// 연속 동작과 이동 경로는 교사가 관찰하고 완료를 누른다.
function movement(id, focus, title, instruction, demoFrames, requiresFullBody = false) {
  return { id, focus, title, steps: [step(instruction, demoFrames[0])], requiresFullBody, assessment: 'teacher', demoFrames };
}

const openArms = step('두 팔을 어깨 높이로 옆에 쭉 펴요.', KP.T, armDirection('L', 'level'), armDirection('R', 'level'));
const foldArms = step('팔꿈치를 접고 두 손을 어깨 가까이 가져와요.', KP.SHOULDER, armFolded('L'), armFolded('R'));
const vArms = [...arm('L', 0.88), ...arm('R', 0.88)];
const upArms = step('두 손을 머리 위로 높이 뻗어요.', KP.UP, wristAboveHead('L'), wristAboveHead('R'));
const downArms = step('두 팔을 아래쪽 대각선으로 뻗어요.', [...arm('L', -0.73), ...arm('R', -0.73)], armDirection('L', 'down'), armDirection('R', 'down'));
const squat = MOVES.squat.keys.down.spec.filter(([bone]) => bone.endsWith('Leg'));
const low = step('두 발을 바닥에 두고 무릎을 살짝 굽혀 몸을 낮춰요.', squat, kneesBent);
const high = step('일어서서 두 손을 머리 위로 뻗어요.', KP.UP, kneesStraight, wristAboveHead('L'), wristAboveHead('R'));

const X = [1, 0, 0], Y = [0, 1, 0];
const turn = (angle) => [['spine', Y, angle], ['chest', Y, angle * 0.7], ['head', Y, angle * 0.55], ...KP.T];
const reach = (side) => [...arm(side, 0.88), ...arm(side === 'L' ? 'R' : 'L', -0.73)];
const swing = (side) => [...arm(side, -0.93, 1.3), ...arm(side === 'L' ? 'R' : 'L', -1.4)];
const walkLeft = [...swing('R'), ['leftUpperLeg', X, -0.45], ['leftLowerLeg', X, 0.35], ['rightUpperLeg', X, 0.3]];
const walkRight = [...swing('L'), ['rightUpperLeg', X, -0.45], ['rightLowerLeg', X, 0.35], ['leftUpperLeg', X, 0.3]];
const leftKnee = MOVES.knee_up.keys.left.spec.filter(([bone]) => bone.endsWith('Leg'));
const rightKnee = MOVES.knee_up.keys.right.spec.filter(([bone]) => bone.endsWith('Leg'));
const stepLeft = [...KP.T, z('leftUpperLeg', 0.36)];
const stepRight = [...KP.T, z('rightUpperLeg', -0.36)];
const leanLeft = MOVES.side_bend.keys.left.spec;
const leanRight = MOVES.side_bend.keys.right.spec;

export const RELAY_MISSIONS = [
  mission(1, '펴기 · 106~107쪽', '두 팔을 펴서 표지판 만들기', [openArms]),
  mission(2, '접기 · 106~107쪽', '작은 소라처럼 팔 접기', [foldArms]),
  movement(3, '비틀기 · 106~107쪽', '파도처럼 몸통 비틀기',
    '발은 제자리에 두고 몸통을 왼쪽과 오른쪽으로 번갈아 비틀어요.', [turn(-0.5), KP.T, turn(0.5)]),
  movement(4, '제자리 돌기 · 108~109쪽', '세탁기처럼 제자리 돌기',
    '제자리에서 몸 전체를 한쪽으로 천천히 돌렸다가 정면으로 돌아와요.', [KP.T, turn(-0.95), KP.T], true),
  movement(5, '털기 · 108~109쪽', '젖은 빨래처럼 손 털기',
    '두 손을 내밀고 젖은 옷의 물기를 털듯 손목을 가볍게 털어요.',
    [[...arm('L', -0.65, 1.0), ...arm('R', -0.65, 1.0)], [...arm('L', -0.65, 0.68), ...arm('R', -0.65, 0.68)]]),
  movement(6, '흔들기 · 108~109쪽', '바람에 흔들리는 꽃',
    '제자리에서 꽃이 바람에 흔들리듯 몸통을 양옆으로 움직여요.', [leanLeft, KP.HIP, leanRight, KP.HIP]),
  movement(7, '워킹 · 102~103쪽', '숲길을 걷는 워킹',
    '숲길을 걷듯 양발을 번갈아 짧게 내디뎌요.', [walkLeft, KP.DOWN, walkRight, KP.DOWN], true),
  movement(8, '점핑 · 102~103쪽', '작은 통나무를 넘는 점핑',
    '통나무를 넘는 흉내를 내요. 두 발로 살짝 뛰어 두 발로 내려와요.', [[...KP.DOWN, ...squat], KP.UP, [...KP.T, ...squat]], true),
  movement(9, '호핑 · 102~103쪽', '한 발로 콩콩 호핑',
    '한쪽 발을 들고, 바닥에 딛고 있는 발로 작게 뛰었다가 같은 발로 내려와요.',
    [[...KP.T, ...leftKnee], [...KP.T, ...leftKnee, ['rightLowerLeg', X, 0.38]]], true),
  movement(10, '스키핑 · 102~103쪽', '걸음과 뜀을 잇는 스키핑',
    '한 발을 내디딘 뒤 그 발로 가볍게 뛰어요. 반대 발로 바꾸어 이어 가요.',
    [walkLeft, [...swing('L'), ...rightKnee], walkRight, [...swing('R'), ...leftKnee]], true),
  movement(11, '갤러핑 · 104~105쪽', '달리는 말처럼 갤러핑',
    '한 발을 내디디며 가볍게 뛰고, 뒤 발을 재빨리 따라 붙여요. 같은 발이 앞에 와요.', [walkLeft, KP.DOWN, walkLeft], true),
  movement(12, '리핑 · 104~105쪽', '무지개를 건너는 리핑',
    '한 발로 바닥을 밀고 떠올라 반대 발로 내려와요. 짧게 건너요.',
    [walkLeft, [...KP.T, ['leftUpperLeg', X, -0.7], ['rightUpperLeg', X, 0.58]], walkRight], true),
  movement(13, '슬라이딩 · 104~105쪽', '오리처럼 옆으로 슬라이딩',
    '한 발을 옆으로 내디딘 뒤 다른 발을 가까이 따라 붙여요.', [stepRight, KP.T, stepRight], true),
  mission(14, '크기 · 116쪽', '작은 풍선이 커져요', [
    foldArms,
    step('커지는 풍선처럼 두 팔을 위 대각선으로 크게 펴요.', vArms, armDirection('L', 'up'), armDirection('R', 'up')),
  ]),
  mission(15, '높낮이 · 116쪽', '바닥에 내려앉는 풍선', [low]),
  mission(16, '높낮이 · 116쪽', '하늘로 떠오르는 풍선', [upArms]),
  movement(17, '경로 · 117쪽', '둥근 길 따라 움직이기',
    '바닥에 반원을 그린다고 생각하며 짧은 걸음으로 둥글게 돌아가요.', [walkLeft, turn(-0.5), walkRight], true),
  movement(18, '경로 · 117쪽', '지그재그 길 따라 움직이기',
    '왼쪽 대각선, 오른쪽 대각선으로 방향을 바꾸며 짧게 걸어요.', [stepLeft, KP.DOWN, stepRight, KP.DOWN], true),
  movement(19, '방향 · 117쪽', '앞으로, 뒤로, 옆으로',
    '앞으로 한 걸음, 뒤로 한 걸음, 옆으로 한 걸음 움직여요.', [walkLeft, walkRight, stepRight], true),
  mission(20, '높낮이 · 117쪽', '피아노 건반처럼 낮게, 높게', [low, high]),
];

const UPPER_BODY = new Map([
  [4, movement(4, '돌기 · 상체 표현', '세탁기처럼 어깨 돌리기',
    '두 어깨를 한쪽으로 돌렸다가 정면으로 돌아와요.', [KP.T, turn(-0.65), KP.T])],
  [7, movement(7, '워킹 · 상체 표현', '숲길을 걷는 팔', '걷는 사람처럼 두 팔을 번갈아 움직여요.', [swing('L'), swing('R')])],
  [8, mission(8, '점핑 · 상체 표현', '두 팔로 통나무 넘기', [downArms, upArms])],
  [9, movement(9, '호핑 · 상체 표현', '한 팔로 콩콩', '같은 팔을 위로 두 번 가볍게 들어요.', [KP.DOWN, reach('R'), KP.DOWN, reach('R')])],
  [10, movement(10, '스키핑 · 상체 표현', '왼팔과 오른팔로 박자 잇기', '왼팔과 오른팔을 차례로 접었다 펴요.', [swing('L'), reach('L'), swing('R'), reach('R')])],
  [11, movement(11, '갤러핑 · 상체 표현', '먼저 가는 손, 따라오는 손', '한 손을 먼저 뻗고 다른 손을 그쪽으로 따라 보내요.', [reach('R'), leanRight, KP.DOWN])],
  [12, movement(12, '리핑 · 상체 표현', '팔로 무지개 건너기', '한 팔을 위로 들어 올리고, 반대 팔로 무지개 끝을 이어요.', [reach('L'), KP.HANDS_UP, reach('R')])],
  [13, movement(13, '슬라이딩 · 상체 표현', '두 손을 옆으로 미끄러뜨리기', '두 손을 가까이 모아 한쪽 옆으로 움직여요.', [KP.SHOULDER, leanRight, KP.SHOULDER])],
  [15, mission(15, '높낮이 · 상체 표현', '풍선이 손 아래로 내려와요', [downArms])],
  [17, movement(17, '경로 · 상체 표현', '손으로 둥근 길 그리기', '손으로 앞에 큰 반원을 그려요.', [reach('L'), KP.HANDS_UP, reach('R')])],
  [18, movement(18, '경로 · 상체 표현', '손으로 지그재그 그리기', '손을 왼쪽 위, 오른쪽 아래로 번갈아 움직여요.', [reach('L'), reach('R'), reach('L')])],
  [19, movement(19, '방향 · 상체 표현', '손을 앞으로, 안쪽으로, 옆으로', '손을 앞으로 뻗었다 가슴으로 가져온 뒤 양옆으로 펴요.', [KP.SHOULDER, KP.T])],
  [20, mission(20, '높낮이 · 상체 표현', '손으로 낮고 높은 건반 누르기', [downArms, upArms])],
]);

export function getRelayMissions({ upperBodyOnly = false } = {}) {
  return upperBodyOnly ? RELAY_MISSIONS.map((m) => UPPER_BODY.get(m.id) ?? m) : RELAY_MISSIONS;
}

function inFrame(p) {
  return p && between(p.x, 0.01, 0.99) && between(p.y, 0.01, 0.99) && (p.visibility ?? 1) >= MIN_VISIBILITY;
}

function isVisible(snapshot, overlay, key) {
  const point = snapshot.pts?.[key];
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && snapshot.vis?.[key] >= MIN_VISIBILITY
    && (!overlay || inFrame(overlay[IMAGE_JOINTS[key]]));
}

function framing(hint) {
  return { matched: false, hint, hintType: 'framing' };
}

export function evaluateRelayStep(snapshot, target, overlay = null) {
  if (!snapshot?.present || SHOULDERS.some((key) => !isVisible(snapshot, overlay, key))) {
    return framing('카메라 가운데에 한 명만 서서 정면을 봐요.');
  }
  if (overlay && !between((overlay[11].x + overlay[12].x) / 2, 0.25, 0.75)) {
    return framing('화면 가운데로 와요.');
  }
  const missing = target.requiredLandmarks.filter((key) => !isVisible(snapshot, overlay, key));
  if (missing.some((key) => LEGS.includes(key))) return framing('무릎과 두 발이 화면에 들어오게 서요.');
  if (missing.some((key) => key.endsWith('_WR') || key.endsWith('_EL'))) return framing('손과 팔꿈치가 화면에 보이게 서요.');
  if (missing.some((key) => HIPS.includes(key))) return framing('허리까지 화면에 들어오게 서요.');
  if (missing.length) return framing('얼굴이 보이게 카메라 정면을 봐요.');
  const p = snapshot.pts;
  const unit = distance(p.L_SH, p.R_SH);
  if (!(unit > 0)) return framing('두 어깨가 보이게 카메라 정면을 봐요.');
  const failed = target.conditions.find((c) => !c.check(p, unit));
  return failed ? { matched: false, hint: failed.hint, hintType: 'posture' } : { matched: true, hint: null, hintType: null };
}

export class RelaySession {
  constructor({ upperBodyOnly = false } = {}) {
    this.missions = getRelayMissions({ upperBodyOnly });
    this.start();
  }

  start() {
    this.phase = 'ready';
    this.turn = 1;
    this.completed = 0;
    this.result = null;
    this.lastFrameId = null;
    this.resetAttempt();
    return this.getState();
  }

  startTurn() {
    if (this.phase === 'ready' || this.phase === 'handoff') {
      this.turn = this.completed + 1;
      this.phase = 'active';
      this.result = null;
      this.resetAttempt();
    }
    return this.getState();
  }

  retryTurn() {
    if (this.phase === 'active') this.resetAttempt();
    return this.getState();
  }

  completeTurn() {
    if (this.phase === 'active') this.finishTurn('teacher');
    return this.getState();
  }

  setPaused(paused) {
    if (this.phase === 'active' && this.paused !== paused) {
      this.paused = paused;
      this.lastSampleAt = null;
      this.wasMatching = false;
    }
    return this.getState();
  }

  update(snapshot, nowMs, overlay = null) {
    const frameId = snapshot?.frameId;
    const fresh = frameId == null || frameId !== this.lastFrameId;
    this.lastFrameId = frameId;
    if (this.phase !== 'active' || this.paused) return this.getState();
    const mission = this.missions[this.turn - 1];
    if (mission.assessment === 'teacher') return this.getState();
    const dt = this.lastSampleAt == null ? 0 : nowMs - this.lastSampleAt;
    if (!fresh) {
      if (this.lastSampleAt == null) this.lastSampleAt = nowMs;
      if (dt > MAX_FRAME_GAP_MS) this.clearHold(framing('카메라 영상이 다시 들어오면 이어서 해요.'));
      return this.getState();
    }

    this.lastSampleAt = nowMs;
    const target = mission.steps[this.step];
    const check = evaluateRelayStep(snapshot, target, overlay);
    this.hint = check.hint;
    this.hintType = check.hintType;
    if (!check.matched) {
      this.clearHold(check);
    } else {
      if (dt > MAX_FRAME_GAP_MS || dt < 0) this.holdMs = 0;
      else if (this.wasMatching) this.holdMs += dt;
      this.wasMatching = true;
      if (this.holdMs >= RELAY_HOLD_MS) {
        if (this.step === mission.steps.length - 1) this.finishTurn('camera');
        else { this.step += 1; this.clearHold(); }
      }
    }
    return this.getState();
  }

  getState() {
    return {
      phase: this.phase, turn: this.turn, total: this.missions.length, completed: this.completed,
      mission: this.missions[this.turn - 1], step: this.step, progress: this.holdMs / RELAY_HOLD_MS,
      hint: this.hint, hintType: this.hintType, paused: this.paused, result: this.result,
    };
  }

  resetAttempt() {
    this.step = 0;
    this.paused = false;
    this.lastSampleAt = null;
    this.clearHold();
  }

  clearHold(check = {}) {
    this.holdMs = 0;
    this.wasMatching = false;
    this.hint = check.hint ?? null;
    this.hintType = check.hintType ?? null;
  }

  finishTurn(method) {
    this.completed += 1;
    this.phase = this.completed === this.missions.length ? 'done' : 'handoff';
    this.step = this.missions[this.turn - 1].steps.length - 1;
    this.paused = false;
    this.holdMs = RELAY_HOLD_MS;
    this.hint = null;
    this.hintType = null;
    this.result = { method, turn: this.turn };
  }
}
