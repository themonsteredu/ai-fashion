// One Euro Filter — 속도에 따라 컷오프를 조절하는 저지연 스무딩 필터
// 느린 움직임 = 강하게 스무딩(떨림 제거), 빠른 움직임 = 약하게 스무딩(지연 최소화)
import * as THREE from 'three';

function smoothingFactor(dt, cutoff) {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}

export class OneEuro1D {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = null;
    this.dx = 0;
  }
  filter(v, dt) {
    if (!Number.isFinite(v) || dt <= 0) return this.x != null ? this.x : 0;
    if (this.x == null) { this.x = v; this.dx = 0; return v; }
    const rawDx = (v - this.x) / dt;
    const aD = smoothingFactor(dt, this.dCutoff);
    this.dx = this.dx + aD * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = smoothingFactor(dt, cutoff);
    this.x = this.x + a * (v - this.x);
    return this.x;
  }
}

export class OneEuroVec3 {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.fx = new OneEuro1D(minCutoff, beta, dCutoff);
    this.fy = new OneEuro1D(minCutoff, beta, dCutoff);
    this.fz = new OneEuro1D(minCutoff, beta, dCutoff);
  }
  setParams(minCutoff, beta) {
    for (const f of [this.fx, this.fy, this.fz]) {
      f.minCutoff = minCutoff;
      f.beta = beta;
    }
  }
  reset() { this.fx.reset(); this.fy.reset(); this.fz.reset(); }
  filter(v, dt, out) {
    out = out || new THREE.Vector3();
    out.set(this.fx.filter(v.x, dt), this.fy.filter(v.y, dt), this.fz.filter(v.z, dt));
    return out;
  }
}

// 안전한 정규화: 길이가 0이거나 NaN이면 fallback 방향 반환
export function safeNormalize(v, fallback) {
  const len = v.length();
  if (!Number.isFinite(len) || len < 1e-6) return v.copy(fallback);
  return v.divideScalar(len);
}

export function isFiniteVec(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
