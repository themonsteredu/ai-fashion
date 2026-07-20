// 모션 인식 파이프라인: MediaPipe(포즈+손+표정) → VRM 본 매핑 (거울 모드)
//
// 처리 순서 (매 프레임):
//  1. MediaPipe 결과 수신 (detect)
//  2. visibility 신뢰도 게이팅
//  3. One Euro Filter 랜드마크 스무딩
//  4. 캘리브레이션 / 체형 스케일 변환
//  5. 목표 Quaternion 계산 (setFromUnitVectors, 부모-자식 체인)
//  6. 관절 제한 (무릎 역접힘 방지, 회전 한계, hemisphere flip 방지)
//  7. 발 잠금(Foot Lock) + two-bone 다리 IK
//  8. normalized VRM bone 적용 (dt 기반 slerp 감쇠)
//  9. vrm.update(dt)  ← main.js에서 호출
// 10. render          ← main.js에서 호출
import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker, FaceLandmarker, HandLandmarker } from '../lib/mediapipe/vision_bundle.mjs';
import { OneEuroVec3, safeNormalize, isFiniteVec } from './filters.js';

// ── 필터 파라미터 (부위별 One Euro) ──
export const FILTER_PARAMS = {
  torso:     { minCutoff: 1.0, beta: 0.5 },   // 어깨·골반·머리: 안정 우선
  limb:      { minCutoff: 1.6, beta: 0.9 },   // 팔꿈치·무릎
  extremity: { minCutoff: 2.2, beta: 1.4 },   // 손목·발목: 반응 우선
};

// ── 조정 가능한 상수 ──
const SMOOTH_BONE = 14;        // 본 회전 감쇠 속도 (dt 기반)
const SMOOTH_LEG = 9;
const SMOOTH_FACE = 0.5;
const HEAD_PITCH_GAIN = 1.1;
const HEAD_LIMIT = 0.55;
const TORSO_AMOUNT = 0.7;
const HIPS_AMOUNT = 0.5;
const HAND_ORIENT = 0.85;
const CROUCH_DEPTH = 0.42;
const SIDE_STEP_RANGE = 1.0;

// 신뢰도 게이팅 (E)
const VIS_FULL = 0.75;         // 이상: 정상 적용
const VIS_SOFT = 0.5;          // 0.5~0.75: 강한 스무딩 / 미만: 마지막 값 유지
const HOLD_TIMEOUT_MS = 1500;  // 이 시간 이상 미검출 → 기본 자세로 서서히 복귀
const SOFT_BLEND = 0.45;

// 캘리브레이션 (B)
const CALIB_DURATION_MS = 1500;

// Foot Lock (G)
const FOOT_CONTACT_H = 0.075;  // 바닥에서 이 높이 이내면 접촉 후보 (m)
const FOOT_CONTACT_VY = 0.55;  // 수직 속도가 이보다 느려야 접촉 (m/s)
const FOOT_RELEASE_H = 0.13;   // 이 높이 이상 올라가면 잠금 해제
const FOOT_RELEASE_DIST = 0.26;// 잠금 위치에서 이만큼 벗어나면 해제

const LM = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28,
};
const LM_GROUP = {};
for (const i of [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR, LM.L_SH, LM.R_SH, LM.L_HIP, LM.R_HIP]) LM_GROUP[i] = 'torso';
for (const i of [LM.L_EL, LM.R_EL, LM.L_KNEE, LM.R_KNEE]) LM_GROUP[i] = 'limb';
for (const i of [LM.L_WR, LM.R_WR, LM.L_ANK, LM.R_ANK]) LM_GROUP[i] = 'extremity';

let poseLandmarker = null, faceLandmarker = null, handLandmarker = null;
let video = null, stream = null;
let lastVideoTime = -1, lastTs = 0, frameCount = 0;

let rawPose = null;      // 필터 전 좌표 (디버그용)
let latestPose = null;   // 필터 후 좌표 (아바타 좌표계, 사람 체형 스케일)
let latestVis = null;
let poseImg = null;
let latestHands = { left: null, right: null };
let faceValues = { aa: 0, blinkL: 0, blinkR: 0, smile: 0 };
let tracked = false;
let inferMs = 0;
let detectFps = 0, fpsAccum = 0, fpsCount = 0, fpsLast = 0;

const lmFilters = new Map();   // idx → OneEuroVec3
const smoothedCurls = { left: {}, right: {} };

// 캘리브레이션 상태
let calib = null;              // {scale, floorY, user:{...}, avatar:{...}}
let calibStartMs = 0;
let calibAccum = null;
let skeleton = null;           // 아바타 골격 치수 (setAvatar에서 계산)
let vrmVersion = '?';

// 발 잠금 상태
const feet = {
  left:  { locked: false, lockPos: new THREE.Vector3(), prevY: null, vy: 0 },
  right: { locked: false, lockPos: new THREE.Vector3(), prevY: null, vy: 0 },
};

export function isTracking() { return tracked; }

// 상태: 'idle' | 'noperson' | 'calibrating' | 'ok'
export function getStatus() {
  if (!stream) return 'idle';
  if (!tracked) return 'noperson';
  if (!calib) return 'calibrating';
  return 'ok';
}
export function getCalibProgress() {
  if (calib) return 1;
  if (!calibStartMs) return 0;
  return Math.min(1, (performance.now() - calibStartMs) / CALIB_DURATION_MS);
}

export function getHeadHint() {
  if (!tracked || !poseImg || !video) return null;
  const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
  const dx = (poseImg[LM.L_EYE].x - poseImg[LM.R_EYE].x) * aspect;
  const dy = poseImg[LM.L_EYE].y - poseImg[LM.R_EYE].y;
  const eyeFrac = Math.hypot(dx, dy);
  if (eyeFrac < 0.008) return null;
  const eyeY = (poseImg[LM.L_EYE].y + poseImg[LM.R_EYE].y) / 2;
  return { eyeFrac, eyeY };
}

// 새 아바타 등록: 골격 치수 측정 + 상태 초기화
export function setAvatar(vrm, measures) {
  skeleton = measures || null;
  vrmVersion = (vrm && vrm.meta && (vrm.meta.metaVersion || vrm.meta.specVersion)) || '?';
  hipsRest = null;
  resetTracking();
}
export function resetForNewAvatar() { // 하위 호환
  hipsRest = null;
  resetTracking();
}

function resetTracking() {
  calib = null;
  calibStartMs = 0;
  calibAccum = null;
  for (const f of lmFilters.values()) f.reset();
  hipsOffset.set(0, 0, 0);
  hipsOffsetTarget.set(0, 0, 0);
  feet.left.locked = feet.right.locked = false;
  feet.left.prevY = feet.right.prevY = null;
  for (const c of Object.values(chains)) c.lastFull = 0;
}

export async function initTrackers(onStatus) {
  onStatus && onStatus('모션 인식 준비 중…');
  const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');

  async function make(delegate) {
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.6,
    });
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      outputFaceBlendshapes: true,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    const hand = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return { pose, face, hand };
  }

  try {
    ({ pose: poseLandmarker, face: faceLandmarker, hand: handLandmarker } = await make('GPU'));
  } catch (e) {
    console.warn('GPU 모드 실패 → CPU 모드로 전환', e);
    ({ pose: poseLandmarker, face: faceLandmarker, hand: handLandmarker } = await make('CPU'));
  }
}

export async function startCamera(videoEl) {
  video = videoEl;
  // 고해상도 요청: 웹캠에 따라 더 넓은 화각으로 잡혀 몸이 더 많이 나옴
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  resetTracking();
}

export function stopCamera() {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  if (video) video.srcObject = null;
  tracked = false;
  latestPose = null;
  latestHands.left = latestHands.right = null;
  resetTracking();
}

function conv(lm) { return new THREE.Vector3(-lm.x, -lm.y, -lm.z); } // 거울 반전

let lastDetectMs = 0;

// ── 1~4단계: 수신 → 게이팅 → 필터 → 스케일 ──
export function detect(now) {
  if (!video || !poseLandmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  frameCount++;

  // timestamp는 항상 증가하도록 보장
  let ts = Math.round(now);
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;

  const dtDetect = lastDetectMs ? Math.min((now - lastDetectMs) / 1000, 0.1) : 1 / 30;
  lastDetectMs = now;
  fpsAccum += dtDetect; fpsCount++;
  if (fpsAccum > 0.5) { detectFps = fpsCount / fpsAccum; fpsAccum = 0; fpsCount = 0; }

  const t0 = performance.now();
  const poseResult = poseLandmarker.detectForVideo(video, ts);
  const world = poseResult.worldLandmarks && poseResult.worldLandmarks[0];
  poseImg = (poseResult.landmarks && poseResult.landmarks[0]) || null;

  if (world && poseImg && shoulderVisible(world)) {
    tracked = true;
    ingestPose(world, dtDetect, now);
  } else {
    tracked = false;
    calibStartMs = 0;
    calibAccum = null;
  }

  // 손: 매 프레임
  if (handLandmarker && tracked) {
    const handResult = handLandmarker.detectForVideo(video, ts);
    assignHands(handResult);
  } else {
    latestHands.left = latestHands.right = null;
  }

  // 표정: 3프레임에 1번
  if (faceLandmarker && frameCount % 3 === 0) {
    const faceResult = faceLandmarker.detectForVideo(video, ts + 1);
    ingestFace(faceResult);
  }
  inferMs = performance.now() - t0;
}

function ingestPose(world, dt, now) {
  // 좌표 혼합: x·y는 화면 좌표(정확), z는 3D 추정값
  const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
  const shDx = (poseImg[LM.L_SH].x - poseImg[LM.R_SH].x) * aspect;
  const shDy = poseImg[LM.L_SH].y - poseImg[LM.R_SH].y;
  const shImgDist = Math.hypot(shDx, shDy);
  const shWorldDist = Math.hypot(
    world[LM.L_SH].x - world[LM.R_SH].x,
    world[LM.L_SH].y - world[LM.R_SH].y,
    world[LM.L_SH].z - world[LM.R_SH].z
  );
  const scale = shImgDist > 0.01 ? shWorldDist / shImgDist : 1;
  const originX = ((poseImg[LM.L_HIP].x + poseImg[LM.R_HIP].x) / 2) * aspect;
  const originY = (poseImg[LM.L_HIP].y + poseImg[LM.R_HIP].y) / 2;

  const raw = new Map();
  const pts = new Map();
  const vis = new Map();
  for (const idx of Object.values(LM)) {
    const hybrid = {
      x: (poseImg[idx].x * aspect - originX) * scale,
      y: (poseImg[idx].y - originY) * scale,
      z: world[idx].z,
    };
    const p = conv(hybrid);
    if (!isFiniteVec(p)) continue;
    raw.set(idx, p.clone());

    let f = lmFilters.get(idx);
    if (!f) {
      const g = FILTER_PARAMS[LM_GROUP[idx] || 'limb'];
      f = new OneEuroVec3(g.minCutoff, g.beta);
      lmFilters.set(idx, f);
    }
    const v = world[idx].visibility != null ? world[idx].visibility : 1;
    // 신뢰도가 애매하면(0.5~0.75) 필터를 더 무겁게: dt를 줄여 컷오프 효과 강화
    const fdt = v >= VIS_FULL ? dt : dt * 0.45;
    const sp = f.filter(p, fdt);
    pts.set(idx, sp.clone());
    vis.set(idx, v);
  }
  rawPose = raw;
  latestPose = pts;
  latestVis = vis;

  updateCalibration(now);
}

// ── B. 캘리브레이션: 1.5초간 편하게 선 자세 측정 ──
function updateCalibration(now) {
  if (calib || !latestPose) return;
  if (!calibStartMs) {
    calibStartMs = now;
    calibAccum = { n: 0, shoulderW: 0, hipW: 0, torso: 0, arm: 0, leg: 0, legN: 0, ankleY: 0, ankleN: 0 };
  }
  const p = (i) => latestPose.get(i);
  const vis = (i) => latestVis.get(i) || 0;
  const a = calibAccum;
  a.n++;
  a.shoulderW += p(LM.L_SH).distanceTo(p(LM.R_SH));
  a.hipW += p(LM.L_HIP).distanceTo(p(LM.R_HIP));
  const shMid = p(LM.L_SH).clone().add(p(LM.R_SH)).multiplyScalar(0.5);
  const hipMid = p(LM.L_HIP).clone().add(p(LM.R_HIP)).multiplyScalar(0.5);
  a.torso += shMid.distanceTo(hipMid);
  a.arm += (p(LM.L_SH).distanceTo(p(LM.L_EL)) + p(LM.L_EL).distanceTo(p(LM.L_WR))
          + p(LM.R_SH).distanceTo(p(LM.R_EL)) + p(LM.R_EL).distanceTo(p(LM.R_WR))) / 2;
  if (Math.min(vis(LM.L_KNEE), vis(LM.L_ANK)) > 0.6) {
    a.leg += p(LM.L_HIP).distanceTo(p(LM.L_KNEE)) + p(LM.L_KNEE).distanceTo(p(LM.L_ANK));
    a.legN++;
    a.ankleY += p(LM.L_ANK).y; a.ankleN++;
  }
  if (Math.min(vis(LM.R_KNEE), vis(LM.R_ANK)) > 0.6) {
    a.ankleY += p(LM.R_ANK).y; a.ankleN++;
  }

  if (now - calibStartMs >= CALIB_DURATION_MS && a.n > 10) {
    const user = {
      shoulderW: a.shoulderW / a.n,
      hipW: a.hipW / a.n,
      torso: a.torso / a.n,
      arm: a.arm / a.n,
      leg: a.legN > 3 ? a.leg / a.legN : null,
    };
    // 아바타 골격과 비교해 체형 스케일 계산
    let scale = 1;
    if (skeleton) {
      scale = user.leg && skeleton.legLen > 0.1
        ? skeleton.legLen / user.leg
        : (skeleton.torsoLen > 0.1 && user.torso > 0.1 ? skeleton.torsoLen / user.torso : 1);
      scale = THREE.MathUtils.clamp(scale, 0.4, 3.0);
    }
    const hipsY = skeleton ? skeleton.hipsY : 0.8;
    // 바닥 높이: 서 있을 때 발목의 아바타 공간 y
    const floorY = a.ankleN > 3 ? hipsY + (a.ankleY / a.ankleN) * scale : 0.05;
    calib = { scale, floorY, user };
    console.log('캘리브레이션 완료', JSON.stringify({ scale: scale.toFixed(2), floorY: floorY.toFixed(2) }));
  }
}

function assignHands(handResult) {
  latestHands.left = latestHands.right = null;
  const hands = handResult.landmarks || [];
  if (!hands.length || !poseImg) return;
  if (hands.length >= 2) {
    const d = (i, wr) => dist2(hands[i][0], poseImg[wr]);
    const costA = d(0, LM.L_WR) + d(1, LM.R_WR);
    const costB = d(0, LM.R_WR) + d(1, LM.L_WR);
    if (costA <= costB) {
      latestHands.right = handResult.worldLandmarks[0];
      latestHands.left = handResult.worldLandmarks[1];
    } else {
      latestHands.right = handResult.worldLandmarks[1];
      latestHands.left = handResult.worldLandmarks[0];
    }
  } else {
    const wristImg = hands[0][0];
    const dL = dist2(wristImg, poseImg[LM.L_WR]);
    const dR = dist2(wristImg, poseImg[LM.R_WR]);
    latestHands[dL < dR ? 'right' : 'left'] = handResult.worldLandmarks[0];
  }
}

function ingestFace(faceResult) {
  const shapes = faceResult.faceBlendshapes && faceResult.faceBlendshapes[0];
  if (!shapes) return;
  let jaw = 0, bl = 0, br = 0, smL = 0, smR = 0;
  for (const c of shapes.categories) {
    if (c.categoryName === 'jawOpen') jaw = c.score;
    else if (c.categoryName === 'eyeBlinkLeft') bl = c.score;
    else if (c.categoryName === 'eyeBlinkRight') br = c.score;
    else if (c.categoryName === 'mouthSmileLeft') smL = c.score;
    else if (c.categoryName === 'mouthSmileRight') smR = c.score;
  }
  faceValues.aa += (clamp01(jaw * 1.6) - faceValues.aa) * SMOOTH_FACE;
  faceValues.blinkR += (blinkCurve(bl) - faceValues.blinkR) * SMOOTH_FACE;
  faceValues.blinkL += (blinkCurve(br) - faceValues.blinkL) * SMOOTH_FACE;
  const smile = clamp01(((smL + smR) / 2 - 0.3) / 0.45) * 0.75;
  faceValues.smile += (smile - faceValues.smile) * SMOOTH_FACE * 0.7;
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function shoulderVisible(world) {
  const l = world[LM.L_SH], r = world[LM.R_SH];
  return (l.visibility ?? 1) > 0.5 && (r.visibility ?? 1) > 0.5;
}
function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function blinkCurve(v) { return clamp01((v - 0.3) / 0.35); }

// ── 본 목표값 ──
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_DOWN = new THREE.Vector3(0, -1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const REST_L_ARM = new THREE.Vector3(1, 0, 0);
const REST_R_ARM = new THREE.Vector3(-1, 0, 0);
const IDENTITY = new THREE.Quaternion();

const NEUTRAL = {};
{
  const drop = THREE.MathUtils.degToRad(68);
  NEUTRAL.leftUpperArm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -drop);
  NEUTRAL.rightUpperArm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), drop);
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const FINGER_JOINTS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] };

const targets = {
  hips: new THREE.Quaternion(),
  spine: new THREE.Quaternion(),
  chest: new THREE.Quaternion(),
  neck: new THREE.Quaternion(),
  head: new THREE.Quaternion(),
  leftShoulder: new THREE.Quaternion(),
  rightShoulder: new THREE.Quaternion(),
  leftUpperArm: NEUTRAL.leftUpperArm.clone(),
  leftLowerArm: new THREE.Quaternion(),
  leftHand: new THREE.Quaternion(),
  rightUpperArm: NEUTRAL.rightUpperArm.clone(),
  rightLowerArm: new THREE.Quaternion(),
  rightHand: new THREE.Quaternion(),
  leftUpperLeg: new THREE.Quaternion(),
  leftLowerLeg: new THREE.Quaternion(),
  leftFoot: new THREE.Quaternion(),
  rightUpperLeg: new THREE.Quaternion(),
  rightLowerLeg: new THREE.Quaternion(),
  rightFoot: new THREE.Quaternion(),
};
for (const side of ['left', 'right']) {
  for (const f of FINGERS) {
    const joints = f === 'Thumb' ? FINGER_JOINTS.Thumb : FINGER_JOINTS.other;
    for (const j of joints) targets[side + f + j] = new THREE.Quaternion();
  }
}
// hemisphere flip 방지용 직전 프레임 값
const prevTargets = {};
for (const k of Object.keys(targets)) prevTargets[k] = targets[k].clone();

const LEG_BONES = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

// 체인별 신뢰도 게이팅 상태
const chains = {
  armLeft: { lastFull: 0 }, armRight: { lastFull: 0 },
  legLeft: { lastFull: 0 }, legRight: { lastFull: 0 },
  head: { lastFull: 0 },
};

let hipsRest = null;
const hipsOffset = new THREE.Vector3();
const hipsOffsetTarget = new THREE.Vector3();

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();

// ── 5~8단계: 목표 계산 → 제한 → Foot IK → 본 적용 ──
export function applyToVRM(vrm, dt) {
  if (!vrm) return;
  const now = performance.now();

  if (tracked && latestPose && calib) {
    computeTargets(vrm, now, dt);
  } else {
    // 미검출/캘리브레이션 중: 기본 자세로 서서히 복귀
    for (const name of Object.keys(targets)) setTargetSafe(name, IDENTITY);
    setTargetSafe('leftUpperArm', NEUTRAL.leftUpperArm);
    setTargetSafe('rightUpperArm', NEUTRAL.rightUpperArm);
    hipsOffsetTarget.set(0, 0, 0);
    feet.left.locked = feet.right.locked = false;
  }

  const k = 1 - Math.exp(-dt * SMOOTH_BONE);
  const kLeg = 1 - Math.exp(-dt * SMOOTH_LEG);
  for (const name of Object.keys(targets)) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) bone.quaternion.slerp(targets[name], LEG_BONES.includes(name) ? kLeg : k);
  }

  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  if (hipsNode) {
    if (!hipsRest) hipsRest = hipsNode.position.clone();
    hipsOffset.lerp(hipsOffsetTarget, kLeg);
    hipsNode.position.set(hipsRest.x + hipsOffset.x, hipsRest.y + hipsOffset.y, hipsRest.z);
  }

  const em = vrm.expressionManager;
  if (em) {
    const value = tracked && calib ? faceValues : { aa: 0, blinkL: 0, blinkR: 0, smile: 0 };
    safeSet(em, 'aa', value.aa);
    safeSet(em, 'happy', value.smile);
    if (em.expressionMap && em.expressionMap['blinkLeft']) {
      safeSet(em, 'blinkLeft', value.blinkL);
      safeSet(em, 'blinkRight', value.blinkR);
    } else {
      safeSet(em, 'blink', Math.max(value.blinkL, value.blinkR));
    }
  }
}

function safeSet(em, name, v) { try { em.setValue(name, v); } catch (e) {} }

// 목표값 저장: NaN 방어 + hemisphere flip 방지
function setTargetSafe(name, q) {
  if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)) return;
  const t = targets[name];
  t.copy(q);
  if (t.dot(prevTargets[name]) < 0) t.set(-t.x, -t.y, -t.z, -t.w);
  prevTargets[name].copy(t);
}

// 회전 한계: 최대 각도를 넘으면 그만큼 깎기 (F)
function clampRotation(q, maxRad) {
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(q.w), 0, 1));
  if (angle > maxRad && angle > 1e-4) q.slerp(IDENTITY, 1 - maxRad / angle);
  return q;
}

// 체인 게이팅: 'full' | 'soft' | 'hold' (E)
function chainGate(chain, minVis, now) {
  if (minVis >= VIS_FULL) { chain.lastFull = now; return 'full'; }
  if (minVis >= VIS_SOFT) { chain.lastFull = now; return 'soft'; }
  return now - chain.lastFull > HOLD_TIMEOUT_MS ? 'timeout' : 'hold';
}

// 게이트에 따라 목표값 반영
function applyGated(name, computed, gate) {
  if (gate === 'full') { setTargetSafe(name, computed); return; }
  if (gate === 'soft') {
    _q3.copy(targets[name]).slerp(computed, SOFT_BLEND);
    setTargetSafe(name, _q3);
    return;
  }
  if (gate === 'timeout') {
    const neutral = NEUTRAL[name] || IDENTITY;
    _q3.copy(targets[name]).slerp(neutral, 0.03);
    setTargetSafe(name, _q3);
  }
  // 'hold': 마지막 정상값 유지 (아무것도 안 함)
}

function computeTargets(vrm, now, dt) {
  const p = (i) => latestPose.get(i);
  const vis = (i) => latestVis.get(i) || 0;

  // ── 골반 ──
  const hipAcross = safeNormalize(_v1.copy(p(LM.R_HIP)).sub(p(LM.L_HIP)), X_AXIS);
  _q1.setFromUnitVectors(X_AXIS, hipAcross);
  const qHipsWorld = new THREE.Quaternion().copy(IDENTITY).slerp(_q1, HIPS_AMOUNT);
  clampRotation(qHipsWorld, 0.6);
  setTargetSafe('hips', qHipsWorld);

  // ── 몸통 ──
  const across = safeNormalize(_v1.copy(p(LM.R_SH)).sub(p(LM.L_SH)), X_AXIS);
  _q1.setFromUnitVectors(X_AXIS, across);
  const qChestWorld = new THREE.Quaternion().copy(IDENTITY).slerp(_q1, TORSO_AMOUNT);
  clampRotation(qChestWorld, 0.8);
  const relTorso = _q2.copy(qHipsWorld).invert().multiply(qChestWorld);
  const spineQ = new THREE.Quaternion().copy(IDENTITY).slerp(relTorso, 0.5);
  setTargetSafe('spine', spineQ);
  setTargetSafe('chest', _q3.copy(spineQ).invert().multiply(relTorso));

  // ── 팔 (관람객 왼팔 → 아바타 오른팔) ──
  const armR = computeArm('right', LM.L_SH, LM.L_EL, LM.L_WR, REST_R_ARM, NEUTRAL.rightUpperArm, qChestWorld, chains.armRight, now);
  const armL = computeArm('left', LM.R_SH, LM.R_EL, LM.R_WR, REST_L_ARM, NEUTRAL.leftUpperArm, qChestWorld, chains.armLeft, now);
  solveHand('right', armR);
  solveHand('left', armL);

  // ── 다리 + Foot Lock/IK ──
  solveLegs(vrm, qHipsWorld, now, dt);

  // ── 앉기/좌우 이동 ──
  let crouch = 0;
  crouch = Math.max(crouch, kneeBend(LM.L_HIP, LM.L_KNEE, LM.L_ANK));
  crouch = Math.max(crouch, kneeBend(LM.R_HIP, LM.R_KNEE, LM.R_ANK));
  const hipsH = hipsRest ? hipsRest.y : 0.8;
  hipsOffsetTarget.y = -crouch * CROUCH_DEPTH * hipsH;
  if (poseImg) {
    const hipMidX = (poseImg[LM.L_HIP].x + poseImg[LM.R_HIP].x) / 2;
    let targetX = THREE.MathUtils.clamp((0.5 - hipMidX) * SIDE_STEP_RANGE, -0.45, 0.45);
    // 양발이 잠긴 상태에서는 root가 미끄러지듯 움직이지 않도록 제한 (G)
    if (feet.left.locked && feet.right.locked) {
      const maxStep = 0.06 * dt / 0.016;
      targetX = THREE.MathUtils.clamp(targetX, hipsOffsetTarget.x - maxStep, hipsOffsetTarget.x + maxStep);
    }
    hipsOffsetTarget.x = targetX;
  }

  // ── 고개 ──
  const headVis = Math.min(vis(LM.L_EAR), vis(LM.R_EAR), vis(LM.L_EYE), vis(LM.R_EYE));
  const headGate = chainGate(chains.head, headVis, now);
  if (headGate === 'full' || headGate === 'soft') {
    const earMid = _v1.copy(p(LM.L_EAR)).add(p(LM.R_EAR)).multiplyScalar(0.5);
    const eyeMid = _v2.copy(p(LM.L_EYE)).add(p(LM.R_EYE)).multiplyScalar(0.5);
    const fwd = eyeMid.sub(earMid);
    const flen = fwd.length() || 1;
    const yaw = clampAbs(Math.atan2(fwd.x, Math.max(0.02, fwd.z)), HEAD_LIMIT);
    const pitch = clampAbs(Math.asin(clampAbs(-fwd.y / flen, 1)) * HEAD_PITCH_GAIN, HEAD_LIMIT * 0.8);
    const earLine = _v2.copy(p(LM.R_EAR)).sub(p(LM.L_EAR));
    const roll = clampAbs(Math.atan2(earLine.y, Math.abs(earLine.x) || 0.01), HEAD_LIMIT * 0.8);
    const headWorld = _q1.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    clampRotation(headWorld, 0.9);
    const rel = _q2.copy(qChestWorld).invert().multiply(headWorld);
    const neckQ = new THREE.Quaternion().copy(IDENTITY).slerp(rel, 0.4);
    applyGated('neck', neckQ, headGate);
    applyGated('head', _q3.copy(neckQ).invert().multiply(rel), headGate);
  } else {
    applyGated('neck', IDENTITY, headGate);
    applyGated('head', IDENTITY, headGate);
  }

  function computeArm(side, iSh, iEl, iWr, rest, neutral, parentWorld, chain, now2) {
    const ua = side + 'UpperArm', la = side + 'LowerArm', sh = side + 'Shoulder';
    const gate = chainGate(chain, Math.min(vis(iSh), vis(iEl)), now2);
    if (gate === 'hold') return null;
    if (gate === 'timeout') {
      applyGated(ua, neutral, 'timeout');
      applyGated(la, IDENTITY, 'timeout');
      applyGated(sh, IDENTITY, 'timeout');
      return null;
    }
    const upperDir = safeNormalize(_v1.copy(p(iEl)).sub(p(iSh)), side === 'right' ? REST_R_ARM : REST_L_ARM);
    const elev = Math.max(0, upperDir.y);
    const shoulderQ = _q3.setFromAxisAngle(_axisZ, (side === 'right' ? -1 : 1) * elev * 0.3);
    clampRotation(shoulderQ, 0.35);
    applyGated(sh, shoulderQ, gate);

    const qUpperWorld = new THREE.Quaternion().setFromUnitVectors(rest, upperDir);
    applyGated(ua, _q3.copy(parentWorld).invert().multiply(qUpperWorld), gate);

    if (vis(iWr) < VIS_SOFT) {
      applyGated(la, IDENTITY, gate);
      return { lowerWorld: qUpperWorld, gate };
    }
    const lowerDir = safeNormalize(_v2.copy(p(iWr)).sub(p(iEl)), upperDir);
    const qLowerWorld = new THREE.Quaternion().setFromUnitVectors(rest, lowerDir);
    const relLower = new THREE.Quaternion().copy(qUpperWorld).invert().multiply(qLowerWorld);
    clampRotation(relLower, 2.7); // 팔꿈치 과도한 접힘 제한
    applyGated(la, relLower, gate);
    return { lowerWorld: qLowerWorld, gate };
  }

  function kneeBend(iHip, iKnee, iAnk) {
    if (Math.min(vis(iHip), vis(iKnee), vis(iAnk)) < VIS_SOFT) return 0;
    const d1 = safeNormalize(_v1.copy(p(iKnee)).sub(p(iHip)), Y_DOWN);
    const d2 = safeNormalize(_v2.copy(p(iAnk)).sub(p(iKnee)), Y_DOWN);
    const bend = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    return clamp01(bend / 1.9);
  }
}

// ── G. 다리: Foot Lock + two-bone IK ──
function solveLegs(vrm, qHipsWorld, now, dt) {
  const p = (i) => latestPose.get(i);
  const vis = (i) => latestVis.get(i) || 0;
  const scale = calib.scale;
  const hipsWorldY = (hipsRest ? hipsRest.y : 0.8) + hipsOffset.y;
  const hipsWorldX = (hipsRest ? hipsRest.x : 0) + hipsOffset.x;

  solveLeg('right', LM.L_HIP, LM.L_KNEE, LM.L_ANK, feet.right, chains.legRight);
  solveLeg('left', LM.R_HIP, LM.R_KNEE, LM.R_ANK, feet.left, chains.legLeft);

  function solveLeg(side, iHip, iKnee, iAnk, foot, chain) {
    const ul = side + 'UpperLeg', ll = side + 'LowerLeg', ft = side + 'Foot';
    const gate = chainGate(chain, Math.min(vis(iHip), vis(iKnee)), now);
    if (gate === 'hold') return;
    if (gate === 'timeout') {
      applyGated(ul, IDENTITY, 'timeout');
      applyGated(ll, IDENTITY, 'timeout');
      applyGated(ft, IDENTITY, 'timeout');
      foot.locked = false;
      return;
    }

    const ankVisible = vis(iAnk) >= VIS_SOFT;

    // 발목의 아바타 공간 위치 + 수직 속도 (접촉 판정용)
    let ankleWorld = null;
    if (ankVisible) {
      ankleWorld = new THREE.Vector3(
        hipsWorldX + p(iAnk).x * scale,
        hipsWorldY + p(iAnk).y * scale,
        0
      );
      const h = ankleWorld.y - calib.floorY;
      if (foot.prevY != null && dt > 0) foot.vy = foot.vy * 0.6 + ((ankleWorld.y - foot.prevY) / dt) * 0.4;
      foot.prevY = ankleWorld.y;

      // 접촉 판정: 낮고 + 느리게 움직일 때 잠금
      if (!foot.locked && h < FOOT_CONTACT_H && Math.abs(foot.vy) < FOOT_CONTACT_VY) {
        foot.locked = true;
        foot.lockPos.copy(ankleWorld);
        foot.lockPos.y = Math.max(calib.floorY, 0.02);
      } else if (foot.locked) {
        // 해제 판정: 들어올리거나 멀어지면
        if (h > FOOT_RELEASE_H || Math.hypot(ankleWorld.x - foot.lockPos.x, ankleWorld.y - foot.lockPos.y) > FOOT_RELEASE_DIST) {
          foot.locked = false;
        }
      }
    } else {
      foot.locked = false;
      foot.prevY = null;
    }

    let upperDir, lowerDir;

    if (foot.locked && skeleton && skeleton.upperLegLen > 0.05) {
      // two-bone IK: 골반 관절 → 잠긴 발 위치
      const hipNode = vrm.humanoid.getRawBoneNode(side + 'UpperLeg');
      const H = hipNode ? hipNode.getWorldPosition(_v3) : _v3.set(hipsWorldX + (side === 'left' ? 0.08 : -0.08), hipsWorldY, 0);
      const L1 = skeleton.upperLegLen, L2 = skeleton.lowerLegLen;
      const toT = new THREE.Vector3().copy(foot.lockPos).sub(H);
      let d = THREE.MathUtils.clamp(toT.length(), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.01);
      const toTn = safeNormalize(toT.clone(), Y_DOWN);
      // pole: 무릎은 앞(+Z)을 향함 + 실측 무릎 방향 반영
      const pole = new THREE.Vector3(0, 0, 1);
      if (vis(iKnee) >= VIS_SOFT) {
        const kneeOff = _v1.copy(p(iKnee)).sub(p(iHip)).multiplyScalar(scale);
        pole.x += kneeOff.x * 0.6;
      }
      const kneeSide = pole.sub(toTn.clone().multiplyScalar(pole.dot(toTn)));
      safeNormalize(kneeSide, FORWARD);
      const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      upperDir = toTn.clone().multiplyScalar(cosA).add(kneeSide.clone().multiplyScalar(sinA));
      const knee = H.clone().add(upperDir.clone().multiplyScalar(L1));
      lowerDir = safeNormalize(new THREE.Vector3().copy(foot.lockPos).sub(knee), upperDir);
    } else {
      // 일반 리타게팅
      upperDir = safeNormalize(new THREE.Vector3().copy(p(iKnee)).sub(p(iHip)), Y_DOWN);
      lowerDir = ankVisible ? safeNormalize(new THREE.Vector3().copy(p(iAnk)).sub(p(iKnee)), upperDir) : null;
    }

    // F. 무릎 역접힘 방지: 접히는 방향이 반대면 자연 방향으로 보정
    if (lowerDir) {
      const s = _v1.copy(upperDir).cross(lowerDir).dot(X_AXIS);
      if (s < -0.03) {
        const bendAngle = Math.acos(THREE.MathUtils.clamp(upperDir.dot(lowerDir), -1, 1));
        const axisNat = safeNormalize(_v2.copy(upperDir).cross(new THREE.Vector3(0, 0, -1)), X_AXIS);
        const fixed = upperDir.clone().applyAxisAngle(axisNat, bendAngle);
        lowerDir.lerp(fixed, 0.7).normalize();
      }
    }

    const qUpperWorld = new THREE.Quaternion().setFromUnitVectors(Y_DOWN, upperDir);
    applyGated(ul, _q3.copy(qHipsWorld).invert().multiply(qUpperWorld), gate);
    if (lowerDir) {
      const qLowerWorld = new THREE.Quaternion().setFromUnitVectors(Y_DOWN, lowerDir);
      const relLower = new THREE.Quaternion().copy(qUpperWorld).invert().multiply(qLowerWorld);
      clampRotation(relLower, 2.4);
      applyGated(ll, relLower, gate);
      // 발바닥은 바닥과 수평 유지
      applyGated(ft, _q3.copy(qLowerWorld).invert(), gate);
    } else {
      applyGated(ll, IDENTITY, gate);
      applyGated(ft, IDENTITY, gate);
    }
  }
}

// ── 손 (손목 방향 + 손가락) ──
function solveHand(side, arm) {
  const world = latestHands[side];
  const curls = smoothedCurls[side];

  if (!world || !arm) {
    setTargetSafe(side + 'Hand', IDENTITY);
    setFingerTargets(side, (f) => smoothCurl(curls, f, 0.15));
    return;
  }

  const pts = [];
  for (let i = 0; i < 21; i++) pts.push(conv(world[i]));

  if (HAND_ORIENT > 0) {
    const dir = safeNormalize(_v1.copy(pts[9]).sub(pts[0]), side === 'right' ? REST_R_ARM : REST_L_ARM);
    const vI = _v2.copy(pts[5]).sub(pts[0]);
    const vL = _v3.copy(pts[17]).sub(pts[0]);
    const palmN = safeNormalize(side === 'right' ? vI.clone().cross(vL) : vL.clone().cross(vI), Y_DOWN);
    const z = safeNormalize(dir.clone().cross(palmN), FORWARD);
    const y = z.clone().cross(dir).normalize();
    _m1.makeBasis(dir, y, z);
    const qTarget = new THREE.Quaternion().setFromRotationMatrix(_m1);
    const restX = side === 'right' ? REST_R_ARM : REST_L_ARM;
    const restZ = restX.clone().cross(new THREE.Vector3(0, -1, 0)).normalize();
    const restY = restZ.clone().cross(restX).normalize();
    _m1.makeBasis(restX, restY, restZ);
    const qRest = new THREE.Quaternion().setFromRotationMatrix(_m1);
    const qHandWorld = qTarget.multiply(qRest.invert());
    const local = _q3.copy(arm.lowerWorld).invert().multiply(qHandWorld);
    clampRotation(local, 1.6);
    const out = new THREE.Quaternion().copy(IDENTITY).slerp(local, HAND_ORIENT);
    setTargetSafe(side + 'Hand', out);
  } else {
    setTargetSafe(side + 'Hand', IDENTITY);
  }

  const raw = {
    Index: fingerCurl(world, 5),
    Middle: fingerCurl(world, 9),
    Ring: fingerCurl(world, 13),
    Little: fingerCurl(world, 17),
    Thumb: thumbCurl(world),
  };
  setFingerTargets(side, (f) => smoothCurl(curls, f, raw[f]));
}

function smoothCurl(store, finger, target) {
  if (store[finger] == null) store[finger] = target;
  store[finger] += (target - store[finger]) * 0.55;
  return store[finger];
}
function fingerCurl(w, mcp) {
  const a1 = segAngle(w, mcp, mcp + 1, mcp + 2);
  const a2 = segAngle(w, mcp + 1, mcp + 2, mcp + 3);
  return clamp01((a1 + a2) / 2.4);
}
function thumbCurl(w) {
  const a1 = segAngle(w, 1, 2, 3);
  const a2 = segAngle(w, 2, 3, 4);
  return clamp01((a1 + a2) / 1.6);
}
function segAngle(w, a, b, c) {
  const v1 = _v1.set(w[b].x - w[a].x, w[b].y - w[a].y, w[b].z - w[a].z).normalize();
  const v2 = _v2.set(w[c].x - w[b].x, w[c].y - w[b].y, w[c].z - w[b].z).normalize();
  const d = v1.dot(v2);
  if (!Number.isFinite(d)) return 0;
  return Math.acos(THREE.MathUtils.clamp(d, -1, 1));
}

const _axisZ = new THREE.Vector3(0, 0, 1);
const _axisY = new THREE.Vector3(0, 1, 0);

function setFingerTargets(side, curlOf) {
  const zSign = side === 'right' ? 1 : -1;
  const ySign = side === 'right' ? -1 : 1;
  for (const f of FINGERS) {
    const curl = curlOf(f);
    if (!Number.isFinite(curl)) continue;
    if (f === 'Thumb') {
      const a = curl * 0.55;
      targets[side + 'ThumbMetacarpal'].setFromAxisAngle(_axisY, ySign * a);
      targets[side + 'ThumbProximal'].setFromAxisAngle(_axisY, ySign * a);
      targets[side + 'ThumbDistal'].setFromAxisAngle(_axisY, ySign * curl * 0.4);
    } else {
      targets[side + f + 'Proximal'].setFromAxisAngle(_axisZ, zSign * curl * 1.1);
      targets[side + f + 'Intermediate'].setFromAxisAngle(_axisZ, zSign * curl * 1.3);
      targets[side + f + 'Distal'].setFromAxisAngle(_axisZ, zSign * curl * 0.8);
    }
  }
}

function clampAbs(v, limit) { return Math.min(limit, Math.max(-limit, v)); }

// ── H. 디버그 정보 ──
export function getDebugInfo() {
  return {
    fps: detectFps,
    inferMs,
    tracked,
    status: getStatus(),
    calib,
    calibProgress: getCalibProgress(),
    vrmVersion,
    rawPose,
    filteredPose: latestPose,
    vis: latestVis,
    poseImg,
    feet: {
      left: { locked: feet.left.locked, vy: feet.left.vy },
      right: { locked: feet.right.locked, vy: feet.right.vy },
    },
    filterParams: FILTER_PARAMS,
    LM,
  };
}
