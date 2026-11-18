export const MOVEMENT_GROUPS = [
  {
    title: '펴기와 접기',
    poses: [
      { id: 'stretch', title: '팔을 쭉 펴기', hint: '양팔을 어깨 높이에서 옆으로 쭉 펴요.', art: 'bend-and-stretch', crop: [575, 107, 357, 411] },
      { id: 'bend', title: '팔꿈치를 접기', hint: '팔꿈치를 어깨 높이에서 접고 두 손을 위로 향하게 해요.', art: 'bend-and-stretch', crop: [992, 107, 235, 411] },
    ],
  },
  {
    title: '높낮이 바꾸기',
    poses: [
      { id: 'waist', title: '손을 허리 높이에', hint: '두 손을 허리 높이에서 양옆으로 벌려요.', art: 'hand-height', crop: [652, 145, 249, 337] },
      { id: 'above-head', title: '손을 머리 위로', hint: '양손을 머리 위로 높이 뻗어요.', art: 'hand-height', crop: [1020, 110, 192, 372] },
      { id: 'stand', title: '몸을 펴고 서기', hint: '두 발을 바닥에 두고 허리와 무릎을 펴요.', art: 'stand-and-crouch', crop: [200, 12, 260, 515] },
      { id: 'crouch', title: '무릎을 굽혀 몸 낮추기', hint: '두 발을 바닥에 두고 무릎을 살짝 굽혀요.', art: 'stand-and-crouch', crop: [637, 79, 270, 448] },
    ],
  },
  {
    title: '신체 부위 바꾸기',
    poses: [
      { id: 'raise-arm', title: '팔 들기', hint: '한 팔만 대각선 위로 들고 다른 팔은 아래에 둬요.', art: 'body-parts', crop: [563, 12, 213, 418] },
      { id: 'raise-leg', title: '다리 들기', hint: '한 발로 서고 반대쪽 무릎을 들어요.', art: 'body-parts', crop: [870, 12, 145, 418] },
      { id: 'lean', title: '몸통 기울이기', hint: '두 발을 딛고 상체를 한쪽으로 천천히 기울여요.', art: 'body-parts', crop: [1084, 12, 210, 418] },
    ],
  },
];

export const MOVEMENTS = MOVEMENT_GROUPS.flatMap(({ poses }) => poses);

const shoulders = [11, 12], elbows = [13, 14], wrists = [15, 16];
const hips = [23, 24], knees = [25, 26], ankles = [27, 28];
const arms = [...elbows, ...wrists], legs = [...hips, ...knees, ...ankles];
const both = [0, 1];

function visible(point) {
  return point && (point.visibility ?? 1) >= .55
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function angle(a, joint, b) {
  const vector = p => [p.x - joint.x, p.y - joint.y, (p.z ?? 0) - (joint.z ?? 0)];
  const u = vector(a), v = vector(b);
  const scale = Math.hypot(...u) * Math.hypot(...v);
  if (!scale) return NaN;
  const cosine = u.reduce((sum, value, i) => sum + value * v[i], 0) / scale;
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;
}

const rules = {
  stretch: { need: arms, check: (f) => both.every(i => f.elbowAngle(i) >= 148
    && Math.abs(f.handHeight(i)) <= .36 && f.outward(wrists[i], i) >= .52) },
  bend: { need: arms, check: (f) => both.every(i => {
    const bend = f.elbowAngle(i);
    return bend >= 55 && bend <= 123 && f.outward(elbows[i], i) >= .33
      && Math.abs(f.dy(elbows[i], shoulders[i])) <= .43 && f.dy(elbows[i], wrists[i]) >= .28;
  }) },
  waist: { need: [...wrists, ...hips], check: (f) => both.every(i =>
    Math.abs(f.dy(wrists[i], hips[i])) <= .44 && f.outward(wrists[i], i) >= .12) },
  'above-head': { need: [0, ...arms], check: (f) => both.every(i =>
    f.dy(0, wrists[i]) >= .08 && f.dy(shoulders[i], elbows[i]) >= .12) },
  stand: { need: legs, check: (f) => both.every(i => f.kneeAngle(i) >= 155) && f.trunkTilt() < .20 },
  crouch: { need: legs, check: (f) => both.every(i => f.kneeAngle(i) < 150)
    && Math.abs(f.dy(ankles[0], ankles[1])) <= .5 },
  'raise-arm': { need: wrists, check: (f) => both.some(i => f.handHeight(i) >= .33 && f.handHeight(1 - i) <= -.40) },
  'raise-leg': { need: legs, check: (f) => both.some(i => f.dy(knees[1 - i], knees[i]) >= .38
    && f.dy(ankles[1 - i], ankles[i]) >= .36 && f.kneeAngle(1 - i) >= 139) },
  lean: { need: hips, check: (f) => f.trunkTilt() >= .23 },
};

// A null reading means a required joint is outside the frame or uncertain.
export function matchesMovement(id, image, world, aspect) {
  const rule = rules[id];
  if (!rule || !Number.isFinite(aspect) || aspect <= 0
      || ![...shoulders, ...rule.need].every(i => visible(image?.[i]))) return null;
  const p = index => ({ x: image[index].x * aspect, y: image[index].y });
  const span = Math.hypot(p(11).x - p(12).x, p(11).y - p(12).y);
  if (span < .035) return null;
  const dy = (a, b) => (p(a).y - p(b).y) / span;
  const outward = (index, side) => (p(index).x - p(shoulders[side]).x) / span * (side === 0 ? 1 : -1);
  const projectedAngle = (a, b, c) => angle(p(a), p(b), p(c));
  const kneeAngle = (i) => {
    const indices = [hips[i], knees[i], ankles[i]];
    const joints = indices.map(index => world?.[index]);
    if (joints.every(j => j && (j.visibility ?? 1) >= .55 && [j.x, j.y, j.z ?? 0].every(Number.isFinite))) {
      const measured = angle(...joints);
      if (Number.isFinite(measured)) return measured;
    }
    return projectedAngle(...indices);
  };
  const trunkTilt = () => {
    const mid = (pair, key) => (p(pair[0])[key] + p(pair[1])[key]) / 2;
    const rise = mid(hips, 'y') - mid(shoulders, 'y');
    return rise > .15 * span ? Math.abs(mid(shoulders, 'x') - mid(hips, 'x')) / rise : 0;
  };
  return rule.check({
    dy, outward, kneeAngle, trunkTilt,
    handHeight: i => dy(shoulders[i], wrists[i]),
    elbowAngle: i => projectedAngle(shoulders[i], elbows[i], wrists[i]),
  });
}

const HOLD_DURATION_MS = 2000;

export class MovementHold {
  constructor() { this.reset(); }

  reset() {
    this.since = null;
    this.previous = null;
    this.frames = 0;
  }

  get secondsLeft() {
    if (this.since === null) return null;
    return Math.max(0, Math.ceil((HOLD_DURATION_MS - (this.previous - this.since)) / 1000));
  }

  update(matched, now) {
    if (!matched) {
      this.reset();
      return false;
    }
    if (this.since === null || now - this.previous > 320) {
      this.since = now;
      this.frames = 0;
    }
    this.previous = now;
    this.frames++;
    return this.frames >= 3 && now - this.since >= HOLD_DURATION_MS;
  }
}
