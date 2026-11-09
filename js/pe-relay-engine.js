import { KP, MOVES, Z } from './pe-moves.js';

export const RELAY_HOLD_MS = 1000;
const MAX_FRAME_GAP_MS = 250;
const MIN_VISIBILITY = 0.5;
const SHOULDERS = ['L_SH', 'R_SH'];
const HIPS = ['L_HIP', 'R_HIP'];
const LEGS = ['L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK'];
const IMAGE_JOINTS = {
  NOSE: 0, L_EYE: 2, R_EYE: 5,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28,
};

const sideName = (side) => side === 'L' ? '왼' : '오른';
const outward = (side) => side === 'L' ? -1 : 1;
const between = (value, min, max) => value >= min && value <= max;
const degrees = (radians) => radians * 180 / Math.PI;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const onSide = (spec, side) => spec.filter(([bone]) => bone.startsWith(side === 'L' ? 'left' : 'right'));
const z = (bone, angle) => [bone, Z, angle];

function arm(side, elevation, bend = 0) {
  const name = side === 'L' ? 'left' : 'right';
  const liftSign = -outward(side);
  return [z(name + 'UpperArm', elevation * liftSign), z(name + 'LowerArm', bend * liftSign)];
}

function condition(joints, hint, check) {
  return { joints, hint, check };
}

function wristAtWaist(side) {
  return condition([side + '_WR', side + '_HIP'], `${sideName(side)}손을 허리 옆으로 가져와요.`, (p, unit) => {
    const wrist = p[side + '_WR'], hip = p[side + '_HIP'];
    return between((wrist.y - hip.y) / unit, 0.12, 0.78) && Math.abs(wrist.x - hip.x) <= 0.6 * unit;
  });
}

function wristAtChest(side) {
  return condition([side + '_WR'], `${sideName(side)}손을 가슴 앞으로 가져와요.`, (p, unit) => {
    const wrist = p[side + '_WR'], center = mid(p.L_SH, p.R_SH);
    return between((center.y - wrist.y) / unit, 0.15, 0.75) && Math.abs(wrist.x - center.x) <= 0.55 * unit;
  });
}

function shoulderHeight(side, joint) {
  const name = joint === 'WR' ? '손을' : '쪽 팔꿈치를';
  return condition([side + '_' + joint], `${sideName(side)}${name} 어깨와 같은 높이에 맞춰요.`, (p, unit) =>
    Math.abs(p[side + '_' + joint].y - p[side + '_SH'].y) <= 0.22 * unit);
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

const headLeft = condition(['L_EYE', 'R_EYE'], '고개를 왼쪽 어깨 쪽으로 살짝 기울여요.', (p) => {
  const eyes = Math.atan2(p.R_EYE.y - p.L_EYE.y, p.R_EYE.x - p.L_EYE.x);
  const shoulders = Math.atan2(p.R_SH.y - p.L_SH.y, p.R_SH.x - p.L_SH.x);
  return degrees(eyes - shoulders) >= 8;
});

function torsoLean(side) {
  return condition(HIPS, `몸통을 ${sideName(side)}쪽으로 살짝 기울여요.`, (p) => {
    const shoulders = mid(p.L_SH, p.R_SH), hips = mid(p.L_HIP, p.R_HIP);
    return outward(side) * degrees(Math.atan2(shoulders.x - hips.x, shoulders.y - hips.y)) >= 8;
  });
}

function footOut(side) {
  return condition([...HIPS, ...LEGS], `${sideName(side)}발을 몸 옆 바닥에 한 걸음 옮겨요.`, (p, unit) => {
    const other = side === 'L' ? 'R' : 'L';
    const ankle = p[side + '_ANK'], otherAnkle = p[other + '_ANK'];
    const sideOffset = outward(side) * (ankle.x - p[side + '_HIP'].x);
    const otherOffset = Math.abs(otherAnkle.x - p[other + '_HIP'].x);
    return sideOffset >= 0.25 * unit && sideOffset - otherOffset >= 0.2 * unit
      && otherOffset <= 0.43 * unit
      && Math.abs(ankle.y - otherAnkle.y) <= 0.28 * unit;
  });
}

const rightKneeUp = condition(LEGS, '오른쪽 무릎과 발을 함께 살짝 들어요.', (p, unit) =>
  p.R_KNEE.y - p.L_KNEE.y >= 0.18 * unit && p.R_ANK.y - p.L_ANK.y >= 0.2 * unit);

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

function step(instruction, demo, ...conditions) {
  const requiredLandmarks = [...new Set([...SHOULDERS, ...conditions.flatMap((c) => c.joints)])];
  return { instruction, demo, conditions, requiredLandmarks };
}

function mission(id, focus, title, steps) {
  return { id, focus, title, steps, requiresFullBody: steps.some((s) => s.requiredLandmarks.some((k) => LEGS.includes(k))) };
}

const vArms = [...arm('L', 0.88), ...arm('R', 0.88)];
const chestArm = (side) => arm(side, -1.35, -2.5);
const shoulderHands = step('두 손을 어깨 높이로 올려요.', KP.SHOULDER, shoulderHeight('L', 'WR'), shoulderHeight('R', 'WR'));
const waistHands = step('두 손을 허리 높이로 가져와요.', KP.HIP, wristAtWaist('L'), wristAtWaist('R'));
const tArms = step('두 팔을 어깨 높이로 옆에 뻗어요.', KP.T, armDirection('L', 'level'), armDirection('R', 'level'));
const vArmsStep = step('두 팔을 위 대각선으로 뻗어 V를 만들어요.', vArms, armDirection('L', 'up'), armDirection('R', 'up'));
const HEIGHT = '높이';
const DIRECTION = '방향';
const BODY = '몸통과 다리';
const COMBINATION = '높이와 방향';
const SEQUENCE = '순서';

export const RELAY_MISSIONS = [
  mission(1, HEIGHT, '오른손을 허리 높이로', [step('오른손을 허리 옆으로 가져와요.', onSide(KP.HIP, 'R'), wristAtWaist('R'))]),
  mission(2, HEIGHT, '왼손을 가슴 높이로', [step('왼손을 가슴 앞으로 가져와요.', chestArm('L'), wristAtChest('L'))]),
  mission(3, HEIGHT, '두 손을 어깨 높이로', [shoulderHands]),
  mission(4, HEIGHT, '오른손을 머리 위로', [step('오른손을 머리 위로 올려요.', onSide(KP.UP, 'R'), wristAboveHead('R'))]),
  mission(5, HEIGHT, '왼쪽 팔꿈치를 어깨 높이로', [step('왼쪽 팔꿈치를 어깨 높이로 올려요.', arm('L', 0, -0.8), shoulderHeight('L', 'EL'))]),
  mission(6, DIRECTION, '오른팔을 오른쪽으로', [step('오른팔을 어깨 높이로 오른쪽에 뻗어요.', onSide(KP.T, 'R'), armDirection('R', 'level'))]),
  mission(7, DIRECTION, '왼팔을 왼쪽으로', [step('왼팔을 어깨 높이로 왼쪽에 뻗어요.', onSide(KP.T, 'L'), armDirection('L', 'level'))]),
  mission(8, DIRECTION, '오른팔을 위 대각선으로', [step('오른팔을 오른쪽 위 대각선으로 뻗어요.', arm('R', 0.88), armDirection('R', 'up'))]),
  mission(9, DIRECTION, '왼팔을 아래 대각선으로', [step('왼팔을 왼쪽 아래 대각선으로 뻗어요.', arm('L', -0.73), armDirection('L', 'down'))]),
  mission(10, DIRECTION, '두 팔로 V 만들기', [vArmsStep]),
  mission(11, BODY, '고개를 왼쪽 어깨 쪽으로', [step('고개를 왼쪽 어깨 쪽으로 살짝 기울여요.', [z('neck', -0.2), z('head', -0.16)], headLeft)]),
  mission(12, BODY, '몸통을 오른쪽으로', [step('몸통을 오른쪽으로 살짝 기울여요.', [z('spine', 0.22), z('chest', 0.13)], torsoLean('R'))]),
  mission(13, BODY, '왼발을 왼쪽으로', [step('왼발을 왼쪽으로 한 걸음 옮겨요.', [z('leftUpperLeg', 0.3)], footOut('L'))]),
  mission(14, BODY, '오른쪽 무릎을 위로', [step('오른쪽 무릎을 살짝 올려요.', MOVES.knee_up.keys.right.spec.filter(([bone]) => bone.endsWith('Leg')), rightKneeUp)]),
  mission(15, BODY, '양 무릎을 살짝 굽히기', [step('두 발은 바닥에 두고 무릎을 살짝 굽혀요.', MOVES.squat.keys.down.spec.filter(([bone]) => bone.endsWith('Leg')), kneesBent)]),
  mission(16, COMBINATION, '오른손은 머리 위, 왼손은 허리', [step('오른손은 머리 위에, 왼손은 허리 옆에 둬요.', [...onSide(KP.UP, 'R'), ...onSide(KP.HIP, 'L')], wristAboveHead('R'), wristAtWaist('L'))]),
  mission(17, COMBINATION, '왼팔은 위, 오른팔은 아래', [step('왼팔은 위 대각선, 오른팔은 아래 대각선으로 뻗어요.', [...arm('L', 0.88), ...arm('R', -0.73)], armDirection('L', 'up'), armDirection('R', 'down'))]),
  mission(18, COMBINATION, '왼팔은 왼쪽, 오른발은 오른쪽', [step('왼팔은 왼쪽으로 뻗고 오른발은 오른쪽으로 옮겨요.', [...onSide(KP.T, 'L'), z('rightUpperLeg', -0.3)], armDirection('L', 'level'), footOut('R'))]),
  mission(19, SEQUENCE, '두 손을 허리에서 어깨로', [waistHands, shoulderHands]),
  mission(20, SEQUENCE, '두 팔을 수평에서 V로', [tArms, vArmsStep]),
];

const UPPER_BODY = new Map([
  [13, mission(13, '몸통과 팔', '몸통을 왼쪽으로', [step('몸통을 왼쪽으로 살짝 기울여요.', [z('spine', -0.22), z('chest', -0.13)], torsoLean('L'))])],
  [14, mission(14, '몸통과 팔', '오른쪽 팔꿈치를 어깨 높이로', [step('오른쪽 팔꿈치를 어깨 높이로 올려요.', arm('R', 0, -0.8), shoulderHeight('R', 'EL'))])],
  [15, mission(15, '몸통과 팔', '두 손을 가슴 높이로', [step('두 손을 가슴 앞으로 모아요.', [...chestArm('L'), ...chestArm('R')], wristAtChest('L'), wristAtChest('R'))])],
  [18, mission(18, COMBINATION, '왼팔은 왼쪽, 오른손은 허리', [step('왼팔은 왼쪽으로 뻗고 오른손은 허리 옆에 둬요.', [...onSide(KP.T, 'L'), ...onSide(KP.HIP, 'R')], armDirection('L', 'level'), wristAtWaist('R'))])],
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
    const dt = this.lastSampleAt == null ? 0 : nowMs - this.lastSampleAt;
    if (!fresh) {
      if (this.lastSampleAt == null) this.lastSampleAt = nowMs;
      if (dt > MAX_FRAME_GAP_MS) this.clearHold(framing('카메라 영상이 다시 들어오면 이어서 해요.'));
      return this.getState();
    }

    this.lastSampleAt = nowMs;
    const target = this.missions[this.turn - 1].steps[this.step];
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
        if (this.step === this.missions[this.turn - 1].steps.length - 1) this.finishTurn('camera');
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
