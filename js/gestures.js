// 손동작 프리셋 + 제스처 감지 (V 포즈, 머리 위 하트)
// 프리셋은 손가락별 굽힘값(0=펴짐, 1=주먹)으로 정의하고,
// 실시간 추적값과 blendHandPose로 혼합한다.
import * as THREE from 'three';

export const HAND_PRESETS = {
  relaxed:       { Thumb: 0.15, Index: 0.15, Middle: 0.15, Ring: 0.15, Little: 0.15 },
  openPalm:      { Thumb: 0.0,  Index: 0.0,  Middle: 0.0,  Ring: 0.0,  Little: 0.0 },
  fist:          { Thumb: 0.8,  Index: 1.0,  Middle: 1.0,  Ring: 1.0,  Little: 1.0 },
  victory:       { Thumb: 0.65, Index: 0.02, Middle: 0.02, Ring: 0.95, Little: 0.95 },
  overheadHeart: { Thumb: 0.35, Index: 0.4,  Middle: 0.48, Ring: 0.55, Little: 0.6 },
  fingerHeart:   { Thumb: 0.55, Index: 0.75, Middle: 1.0,  Ring: 1.0,  Little: 1.0 },
  thumbsUp:      { Thumb: 0.0,  Index: 1.0,  Middle: 1.0,  Ring: 1.0,  Little: 1.0 },
};

// 추적된 손가락 굽힘값과 프리셋을 혼합
export function blendHandPose(trackedCurls, presetCurls, blendWeight) {
  const out = {};
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const t = trackedCurls[f] != null ? trackedCurls[f] : 0.15;
    const p = presetCurls[f] != null ? presetCurls[f] : t;
    out[f] = t + (p - t) * blendWeight;
  }
  return out;
}

// ── 범용 제스처 감지기: 조건 함수 + 프레임 유지(디바운스) + 부드러운 blend ──
export class GestureDetector {
  constructor(condition, onFrames = 4, offFrames = 5, rampSec = 0.22) {
    this.condition = condition;
    this.onFrames = onFrames;
    this.offFrames = offFrames;
    this.rampSec = rampSec;
    this.reset();
  }
  reset() { this.onCount = 0; this.offCount = 0; this.active = false; this.blend = 0; }

  // ctx: {curls, world}  curls: 손가락 굽힘값(0~1), world: 손 21점 랜드마크
  update(ctx, dt) {
    let cond = false;
    try { cond = !!(ctx.curls && ctx.world && this.condition(ctx)); } catch (e) {}
    if (cond) { this.onCount++; this.offCount = 0; }
    else { this.offCount++; if (this.offCount > this.offFrames) { this.onCount = 0; this.active = false; } }
    if (this.onCount >= this.onFrames) this.active = true;

    const k = Math.min(1, dt / this.rampSec);
    this.blend += ((this.active ? 1 : 0) - this.blend) * k;
    if (this.blend < 0.005) this.blend = 0;
    return this.blend;
  }
}

function dir(w, a, b) {
  return new THREE.Vector3(w[b].x - w[a].x, w[b].y - w[a].y, w[b].z - w[a].z).normalize();
}
function tipDist(w, a, b) {
  return Math.hypot(w[a].x - w[b].x, w[a].y - w[b].y, w[a].z - w[b].z);
}

// ── 손 제스처 정의 (위가 우선순위 높음) ──
// weight: 감지 시 프리셋 반영 비율 (실시간 추적과 혼합)
export const HAND_GESTURE_DEFS = [
  {
    name: 'fingerHeart', preset: 'fingerHeart', weight: 0.9,
    condition: ({ curls, world }) =>
      curls.Index > 0.25 && curls.Index < 0.85 &&
      curls.Middle > 0.55 && curls.Ring > 0.55 && curls.Little > 0.55 &&
      curls.Thumb > 0.2 &&
      tipDist(world, 4, 8) < 0.05, // 엄지 끝-검지 끝이 맞닿음
  },
  {
    name: 'victory', preset: 'victory', weight: 0.9,
    condition: ({ curls, world }) => {
      if (!(curls.Index < 0.3 && curls.Middle < 0.3 && curls.Ring > 0.5 && curls.Little > 0.5)) return false;
      const iDir = dir(world, 5, 8), mDir = dir(world, 9, 12);
      const angle = Math.acos(THREE.MathUtils.clamp(iDir.dot(mDir), -1, 1));
      return angle > 0.12 && angle < 1.1;
    },
  },
  {
    name: 'thumbsUp', preset: 'thumbsUp', weight: 0.9,
    condition: ({ curls }) =>
      curls.Index > 0.6 && curls.Middle > 0.6 && curls.Ring > 0.55 && curls.Little > 0.55 &&
      curls.Thumb < 0.22,
  },
  {
    name: 'fist', preset: 'fist', weight: 0.85,
    condition: ({ curls }) =>
      curls.Index > 0.65 && curls.Middle > 0.65 && curls.Ring > 0.6 && curls.Little > 0.6 &&
      curls.Thumb > 0.35,
  },
];

// ── 머리 위 하트 감지 (디바운스 + 히스테리시스 + 상태머신) ──
// 상태: NONE → HEART_ENTERING → HEART_ACTIVE → HEART_EXITING → NONE
export class HeartDetector {
  constructor() {
    this.state = 'NONE';
    this.holdTime = 0;
    this.exitTime = 0;
    this.blend = 0;
  }
  reset() { this.state = 'NONE'; this.holdTime = 0; this.exitTime = 0; this.blend = 0; }

  // p(i): 포즈 랜드마크(아바타 좌표), LM: 인덱스 표
  update(p, LM, dt) {
    const lw = p(LM.L_WR), rw = p(LM.R_WR);
    const nose = p(LM.NOSE);
    const ls = p(LM.L_SH), rs = p(LM.R_SH);
    const le = p(LM.L_EL), re = p(LM.R_EL);
    const shoulderW = (ls && rs ? ls.distanceTo(rs) : 0.3) || 0.3;

    let cond = false;
    if (lw && rw && nose && ls && rs && le && re) {
      const bothAbove = lw.y > nose.y + 0.04 && rw.y > nose.y + 0.04;      // 손목이 얼굴보다 위
      const close = lw.distanceTo(rw) < shoulderW * 1.15;                   // 양손이 가까움
      const centered = Math.abs((lw.x + rw.x) / 2 - nose.x) < shoulderW;    // 머리 중심 근처
      const lBend = bendOf(p, LM.L_SH, LM.L_EL, LM.L_WR);
      const rBend = bendOf(p, LM.R_SH, LM.R_EL, LM.R_WR);
      const elbowsBent = lBend > 0.5 && rBend > 0.5;                        // 팔꿈치 굽힘
      cond = bothAbove && close && centered && elbowsBent;
    }

    // 상태 전이 (0.18초 유지해야 진입, 0.25초 벗어나야 해제)
    switch (this.state) {
      case 'NONE':
        if (cond) { this.state = 'HEART_ENTERING'; this.holdTime = 0; }
        break;
      case 'HEART_ENTERING':
        if (!cond) { this.state = 'NONE'; }
        else { this.holdTime += dt; if (this.holdTime > 0.18) this.state = 'HEART_ACTIVE'; }
        break;
      case 'HEART_ACTIVE':
        if (!cond) { this.state = 'HEART_EXITING'; this.exitTime = 0; }
        break;
      case 'HEART_EXITING':
        if (cond) { this.state = 'HEART_ACTIVE'; }
        else { this.exitTime += dt; if (this.exitTime > 0.25) this.state = 'NONE'; }
        break;
    }

    const target = (this.state === 'HEART_ACTIVE' || this.state === 'HEART_EXITING') ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, dt / 0.3);
    if (this.blend < 0.005) this.blend = 0;
    return this.blend;
  }
}

function bendOf(p, iSh, iEl, iWr) {
  const a = p(iEl).clone().sub(p(iSh)).normalize();
  const b = p(iWr).clone().sub(p(iEl)).normalize();
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)); // 0=쭉 폄
}

// 하트 보정 포즈: 팔이 정수리 위에서 하트 모양을 그리도록 하는 목표 방향
// (사용자 추적 70% + 이 프리셋 30%를 혼합해 모양을 다듬는다)
export const HEART_ARM_PRESET = {
  right: { // 아바타 오른팔 (rest 방향 -X)
    upperDir: new THREE.Vector3(-0.62, 0.74, 0.1).normalize(),
    lowerDir: new THREE.Vector3(0.72, 0.66, 0.12).normalize(),
  },
  left: {
    upperDir: new THREE.Vector3(0.62, 0.74, 0.1).normalize(),
    lowerDir: new THREE.Vector3(-0.72, 0.66, 0.12).normalize(),
  },
};
export const HEART_ARM_MIX = 0.35; // 하트 중 프리셋 반영 비율
