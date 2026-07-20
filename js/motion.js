// 모션 인식: MediaPipe(포즈+표정) → VRM 본 매핑 (거울 모드, 상반신 위주)
import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from '../lib/mediapipe/vision_bundle.mjs';

// ── 조정 가능한 상수 (아바타가 떨리면 SMOOTH_* 값을 낮추세요) ──
const SMOOTH_LM = 0.45;        // 관절 좌표 스무딩 (0~1, 낮을수록 부드럽고 느림)
const SMOOTH_BONE = 11;        // 본 회전 따라가는 속도 (낮을수록 부드러움)
const SMOOTH_FACE = 0.5;       // 표정 스무딩
const HEAD_PITCH_GAIN = 1.1;   // 고개 끄덕임 민감도
const HEAD_LIMIT = 0.55;       // 고개 회전 한계 (라디안)
const TORSO_AMOUNT = 0.7;      // 몸통 기울기 반영 비율
const VISIBILITY_MIN = 0.55;   // 이 값보다 인식 신뢰도가 낮으면 기본 자세 유지

// MediaPipe 포즈 관절 번호
const LM = { NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16 };

let poseLandmarker = null;
let faceLandmarker = null;
let video = null;
let stream = null;
let lastVideoTime = -1;
let frameCount = 0;

let latestPose = null;   // 스무딩된 관절 좌표 (아바타 좌표계)
let latestVis = null;    // 관절별 신뢰도
let faceValues = { aa: 0, blinkL: 0, blinkR: 0 };
let tracked = false;     // 현재 사람 인식 여부

const smoothedLm = new Map();

export function isTracking() { return tracked; }

export async function initTrackers(onStatus) {
  onStatus && onStatus('모션 인식 준비 중…');
  const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');

  async function make(delegate) {
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      outputFaceBlendshapes: true,
      numFaces: 1,
    });
    return { pose, face };
  }

  try {
    ({ pose: poseLandmarker, face: faceLandmarker } = await make('GPU'));
  } catch (e) {
    console.warn('GPU 모드 실패 → CPU 모드로 전환', e);
    ({ pose: poseLandmarker, face: faceLandmarker } = await make('CPU'));
  }
}

export async function startCamera(videoEl) {
  video = videoEl;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

export function stopCamera() {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  if (video) video.srcObject = null;
  tracked = false;
  latestPose = null;
  smoothedLm.clear();
}

// MediaPipe 좌표 → 아바타 좌표 (거울 반전 포함)
function conv(lm) { return new THREE.Vector3(-lm.x, -lm.y, -lm.z); }

// 매 프레임: 웹캠에서 관절 추출
export function detect(now) {
  if (!video || !poseLandmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  frameCount++;

  const poseResult = poseLandmarker.detectForVideo(video, now);
  const world = poseResult.worldLandmarks && poseResult.worldLandmarks[0];

  if (world && shoulderVisible(world)) {
    tracked = true;
    const pts = new Map();
    const vis = new Map();
    for (const idx of Object.values(LM)) {
      const p = conv(world[idx]);
      let s = smoothedLm.get(idx);
      if (!s) { s = p.clone(); smoothedLm.set(idx, s); }
      s.lerp(p, SMOOTH_LM);
      pts.set(idx, s);
      vis.set(idx, world[idx].visibility != null ? world[idx].visibility : 1);
    }
    latestPose = pts;
    latestVis = vis;
  } else {
    tracked = false;
  }

  // 표정은 두 프레임에 한 번 (성능)
  if (faceLandmarker && frameCount % 2 === 0) {
    const faceResult = faceLandmarker.detectForVideo(video, now + 0.001);
    const shapes = faceResult.faceBlendshapes && faceResult.faceBlendshapes[0];
    if (shapes) {
      let jaw = 0, bl = 0, br = 0;
      for (const c of shapes.categories) {
        if (c.categoryName === 'jawOpen') jaw = c.score;
        else if (c.categoryName === 'eyeBlinkLeft') bl = c.score;
        else if (c.categoryName === 'eyeBlinkRight') br = c.score;
      }
      faceValues.aa += (clamp01(jaw * 1.6) - faceValues.aa) * SMOOTH_FACE;
      // 거울 모드: 관람객 왼눈 → 아바타 오른눈
      faceValues.blinkR += (blinkCurve(bl) - faceValues.blinkR) * SMOOTH_FACE;
      faceValues.blinkL += (blinkCurve(br) - faceValues.blinkL) * SMOOTH_FACE;
    }
  }
}

function shoulderVisible(world) {
  const l = world[LM.L_SH], r = world[LM.R_SH];
  const lv = l.visibility != null ? l.visibility : 1;
  const rv = r.visibility != null ? r.visibility : 1;
  return lv > 0.5 && rv > 0.5;
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function blinkCurve(v) { return clamp01((v - 0.3) / 0.35); }

// ── VRM 본에 적용 ──
const X_AXIS = new THREE.Vector3(1, 0, 0);
const REST_L_ARM = new THREE.Vector3(1, 0, 0);   // 아바타 왼팔 T포즈 방향
const REST_R_ARM = new THREE.Vector3(-1, 0, 0);  // 아바타 오른팔 T포즈 방향
const IDENTITY = new THREE.Quaternion();

const NEUTRAL = {}; // 미인식 시 돌아갈 기본 자세
{
  const drop = THREE.MathUtils.degToRad(68);
  NEUTRAL.leftUpperArm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -drop);
  NEUTRAL.rightUpperArm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), drop);
}

const targets = {
  spine: new THREE.Quaternion(),
  chest: new THREE.Quaternion(),
  neck: new THREE.Quaternion(),
  head: new THREE.Quaternion(),
  leftUpperArm: NEUTRAL.leftUpperArm.clone(),
  leftLowerArm: new THREE.Quaternion(),
  rightUpperArm: NEUTRAL.rightUpperArm.clone(),
  rightLowerArm: new THREE.Quaternion(),
};

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

export function applyToVRM(vrm, dt) {
  if (!vrm) return;

  if (tracked && latestPose) {
    computeTargets();
  } else {
    // 사람이 없으면 기본 자세로 서서히 복귀
    targets.spine.identity();
    targets.chest.identity();
    targets.neck.identity();
    targets.head.identity();
    targets.leftUpperArm.copy(NEUTRAL.leftUpperArm);
    targets.rightUpperArm.copy(NEUTRAL.rightUpperArm);
    targets.leftLowerArm.identity();
    targets.rightLowerArm.identity();
  }

  const k = 1 - Math.exp(-dt * SMOOTH_BONE);
  for (const name of Object.keys(targets)) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) bone.quaternion.slerp(targets[name], k);
  }

  // 표정
  const em = vrm.expressionManager;
  if (em) {
    const value = tracked ? faceValues : { aa: 0, blinkL: 0, blinkR: 0 };
    safeSet(em, 'aa', value.aa);
    if (em.expressionMap && em.expressionMap['blinkLeft']) {
      safeSet(em, 'blinkLeft', value.blinkL);
      safeSet(em, 'blinkRight', value.blinkR);
    } else {
      safeSet(em, 'blink', Math.max(value.blinkL, value.blinkR));
    }
  }
}

function safeSet(em, name, v) {
  try { em.setValue(name, v); } catch (e) {}
}

function computeTargets() {
  const p = (i) => latestPose.get(i);
  const vis = (i) => latestVis.get(i);

  // ── 몸통: 어깨선 기울기/회전 ──
  // 거울 모드: 아바타 왼어깨 ← 관람객 오른어깨(R_SH)
  const across = _v1.copy(p(LM.R_SH)).sub(p(LM.L_SH)).normalize();
  _q1.setFromUnitVectors(X_AXIS, across);
  _q2.copy(IDENTITY).slerp(_q1, TORSO_AMOUNT);          // 몸통 전체 회전량
  targets.spine.copy(IDENTITY).slerp(_q2, 0.45);        // 허리에 45%
  const chestWorld = _q2.clone();
  targets.chest.copy(targets.spine).invert().multiply(chestWorld); // 나머지는 가슴에

  // ── 팔 ── (관람객 왼팔 → 아바타 오른팔)
  computeArm('right', LM.L_SH, LM.L_EL, LM.L_WR, REST_R_ARM, NEUTRAL.rightUpperArm, chestWorld);
  computeArm('left', LM.R_SH, LM.R_EL, LM.R_WR, REST_L_ARM, NEUTRAL.leftUpperArm, chestWorld);

  // ── 고개: 귀/눈/코 기반 ──
  const earMid = _v1.copy(p(LM.L_EAR)).add(p(LM.R_EAR)).multiplyScalar(0.5);
  const eyeMid = _v2.copy(p(LM.L_EYE)).add(p(LM.R_EYE)).multiplyScalar(0.5);
  const fwd = eyeMid.sub(earMid);
  const flen = fwd.length() || 1;
  const yaw = clampAbs(Math.atan2(fwd.x, Math.max(0.02, fwd.z)), HEAD_LIMIT);
  const pitch = clampAbs(Math.asin(clampAbs(-fwd.y / flen, 1)) * HEAD_PITCH_GAIN, HEAD_LIMIT * 0.8);
  // 좌우 갸웃: 귓선 기울기
  const earLine = _v2.copy(p(LM.R_EAR)).sub(p(LM.L_EAR)); // 아바타 왼귀 - 오른귀
  const roll = clampAbs(Math.atan2(earLine.y, Math.abs(earLine.x) || 0.01), HEAD_LIMIT * 0.8);

  const headWorld = _q1.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  // 목 40% + 머리 60%로 분배 (몸통 회전 제외)
  const rel = _q2.copy(chestWorld).invert().multiply(headWorld);
  targets.neck.copy(IDENTITY).slerp(rel, 0.4);
  targets.head.copy(targets.neck).invert().multiply(rel);

  function computeArm(side, iSh, iEl, iWr, rest, neutral, parentWorld) {
    const ua = side + 'UpperArm', la = side + 'LowerArm';
    if (Math.min(vis(iSh), vis(iEl)) < VISIBILITY_MIN) {
      targets[ua].copy(neutral);
      targets[la].identity();
      return;
    }
    const upperDir = _v1.copy(p(iEl)).sub(p(iSh)).normalize();
    const qUpperWorld = new THREE.Quaternion().setFromUnitVectors(rest, upperDir);
    targets[ua].copy(parentWorld).invert().multiply(qUpperWorld);

    if (vis(iWr) < VISIBILITY_MIN) {
      targets[la].identity();
      return;
    }
    const lowerDir = _v2.copy(p(iWr)).sub(p(iEl)).normalize();
    const qLowerWorld = new THREE.Quaternion().setFromUnitVectors(rest, lowerDir);
    targets[la].copy(qUpperWorld).invert().multiply(qLowerWorld);
  }
}

function clampAbs(v, limit) { return Math.min(limit, Math.max(-limit, v)); }
