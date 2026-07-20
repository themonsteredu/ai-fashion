// 모션 인식: MediaPipe(포즈+손+표정) → VRM 본 매핑 (거울 모드, 전신)
import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker, FaceLandmarker, HandLandmarker } from '../lib/mediapipe/vision_bundle.mjs';

// ── 조정 가능한 상수 (아바타가 떨리면 SMOOTH_* 값을 낮추세요) ──
const SMOOTH_LM = 0.45;        // 관절 좌표 스무딩 (0~1, 낮을수록 부드럽고 느림)
const SMOOTH_BONE = 11;        // 본 회전 따라가는 속도 (낮을수록 부드러움)
const SMOOTH_LEG = 8;          // 다리 회전 속도 (팔보다 천천히 = 덜 떨림)
const SMOOTH_FACE = 0.5;       // 표정 스무딩
const FINGER_SMOOTH = 0.55;    // 손가락 스무딩
const HEAD_PITCH_GAIN = 1.1;   // 고개 끄덕임 민감도
const HEAD_LIMIT = 0.55;       // 고개 회전 한계 (라디안)
const TORSO_AMOUNT = 0.7;      // 몸통 기울기 반영 비율
const HIPS_AMOUNT = 0.5;       // 골반 회전 반영 비율 (런웨이 힙 스웨이)
const HAND_ORIENT = 0.85;      // 손목 방향 반영 비율 (0이면 손목 방향 끔)
const CROUCH_DEPTH = 0.42;     // 앉을 때 내려가는 깊이 (골반 높이 대비 비율)
const SIDE_STEP_RANGE = 1.0;   // 좌우 이동 반영 폭
const VISIBILITY_MIN = 0.55;   // 팔: 인식 신뢰도 최소값
const LEG_VISIBILITY_MIN = 0.6;// 다리: 인식 신뢰도 최소값 (튀지 않게 더 엄격히)

// MediaPipe 포즈 관절 번호
const LM = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28,
};

let poseLandmarker = null;
let faceLandmarker = null;
let handLandmarker = null;
let video = null;
let stream = null;
let lastVideoTime = -1;
let frameCount = 0;

let latestPose = null;   // 스무딩된 관절 좌표 (아바타 좌표계)
let latestVis = null;    // 관절별 신뢰도
let poseImg = null;      // 화면 기준 좌표 (좌우 이동·손 배정용)
let latestHands = { left: null, right: null }; // 아바타 기준 좌우
let faceValues = { aa: 0, blinkL: 0, blinkR: 0 };
let tracked = false;

const smoothedLm = new Map();
const smoothedCurls = { left: {}, right: {} };

export function isTracking() { return tracked; }

// 새 아바타를 불러왔을 때 호출 (기억해 둔 기준 자세 초기화)
export function resetForNewAvatar() {
  hipsRest = null;
  smoothedLm.clear();
  hipsOffset.set(0, 0, 0);
}

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
    const hand = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 2,
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
  latestHands.left = latestHands.right = null;
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
  poseImg = (poseResult.landmarks && poseResult.landmarks[0]) || null;

  if (world && poseImg && shoulderVisible(world)) {
    tracked = true;
    // 좌표 혼합: 좌우/상하는 화면 좌표(정확함), 깊이는 3D 추정값 사용
    // → 꽃받침처럼 손이 몸 가운데로 모일 때 팔이 엇갈리는 문제 방지
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

    const pts = new Map();
    const vis = new Map();
    for (const idx of Object.values(LM)) {
      const hybrid = {
        x: (poseImg[idx].x * aspect - originX) * scale,
        y: (poseImg[idx].y - originY) * scale,
        z: world[idx].z,
      };
      const p = conv(hybrid);
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

  // 손가락: 매 프레임
  if (handLandmarker && tracked) {
    const handResult = handLandmarker.detectForVideo(video, now);
    latestHands.left = latestHands.right = null;
    const hands = handResult.landmarks || [];
    if (hands.length > 0 && poseImg) {
      if (hands.length >= 2) {
        // 두 손이 가까이 붙어 있어도(꽃받침 등) 좌우가 뒤바뀌지 않도록
        // 두 가지 배정 중 전체 거리가 짧은 쪽을 선택
        const d = (i, wr) => dist2(hands[i][0], poseImg[wr]);
        const costA = d(0, LM.L_WR) + d(1, LM.R_WR); // 0=왼손, 1=오른손
        const costB = d(0, LM.R_WR) + d(1, LM.L_WR);
        if (costA <= costB) {
          latestHands.right = handResult.worldLandmarks[0]; // 거울: 관람객 왼손 → 아바타 오른손
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
  } else {
    latestHands.left = latestHands.right = null;
  }

  // 표정은 세 프레임에 한 번 (성능)
  if (faceLandmarker && frameCount % 3 === 0) {
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
      faceValues.blinkR += (blinkCurve(bl) - faceValues.blinkR) * SMOOTH_FACE;
      faceValues.blinkL += (blinkCurve(br) - faceValues.blinkL) * SMOOTH_FACE;
    }
  }
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

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
const Y_DOWN = new THREE.Vector3(0, -1, 0);
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
  leftUpperArm: NEUTRAL.leftUpperArm.clone(),
  leftLowerArm: new THREE.Quaternion(),
  leftHand: new THREE.Quaternion(),
  rightUpperArm: NEUTRAL.rightUpperArm.clone(),
  rightLowerArm: new THREE.Quaternion(),
  rightHand: new THREE.Quaternion(),
  leftUpperLeg: new THREE.Quaternion(),
  leftLowerLeg: new THREE.Quaternion(),
  rightUpperLeg: new THREE.Quaternion(),
  rightLowerLeg: new THREE.Quaternion(),
};
// 손가락 본 타깃 등록 (좌우 × 5손가락 × 3마디)
for (const side of ['left', 'right']) {
  for (const f of FINGERS) {
    const joints = f === 'Thumb' ? FINGER_JOINTS.Thumb : FINGER_JOINTS.other;
    for (const j of joints) targets[side + f + j] = new THREE.Quaternion();
  }
}

const LEG_BONES = ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg'];

let hipsRest = null;                       // 골반 기본 위치 (일어선 상태)
const hipsOffset = new THREE.Vector3();    // 앉기/좌우 이동량 (스무딩됨)
const hipsOffsetTarget = new THREE.Vector3();

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();

export function applyToVRM(vrm, dt) {
  if (!vrm) return;

  if (tracked && latestPose) {
    computeTargets();
  } else {
    // 사람이 없으면 기본 자세로 서서히 복귀
    for (const name of Object.keys(targets)) targets[name].identity();
    targets.leftUpperArm.copy(NEUTRAL.leftUpperArm);
    targets.rightUpperArm.copy(NEUTRAL.rightUpperArm);
    hipsOffsetTarget.set(0, 0, 0);
  }

  const k = 1 - Math.exp(-dt * SMOOTH_BONE);
  const kLeg = 1 - Math.exp(-dt * SMOOTH_LEG);
  for (const name of Object.keys(targets)) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) bone.quaternion.slerp(targets[name], LEG_BONES.includes(name) ? kLeg : k);
  }

  // 골반 위치 (앉기 + 좌우 이동)
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  if (hipsNode) {
    if (!hipsRest) hipsRest = hipsNode.position.clone();
    hipsOffset.lerp(hipsOffsetTarget, kLeg);
    hipsNode.position.set(
      hipsRest.x + hipsOffset.x,
      hipsRest.y + hipsOffset.y,
      hipsRest.z
    );
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

  // ── 골반: 엉덩이선 회전 (런웨이 힙 스웨이) ──
  const hipAcross = _v1.copy(p(LM.R_HIP)).sub(p(LM.L_HIP)).normalize();
  _q1.setFromUnitVectors(X_AXIS, hipAcross);
  const qHipsWorld = new THREE.Quaternion().copy(IDENTITY).slerp(_q1, HIPS_AMOUNT);
  targets.hips.copy(qHipsWorld);

  // ── 몸통: 어깨선 (골반 회전과의 차이를 허리·가슴에 분배) ──
  const across = _v1.copy(p(LM.R_SH)).sub(p(LM.L_SH)).normalize();
  _q1.setFromUnitVectors(X_AXIS, across);
  const qChestWorld = new THREE.Quaternion().copy(IDENTITY).slerp(_q1, TORSO_AMOUNT);
  const relTorso = _q2.copy(qHipsWorld).invert().multiply(qChestWorld);
  targets.spine.copy(IDENTITY).slerp(relTorso, 0.5);
  targets.chest.copy(targets.spine).invert().multiply(relTorso);

  // ── 팔 ── (관람객 왼팔 → 아바타 오른팔)
  const armR = computeArm('right', LM.L_SH, LM.L_EL, LM.L_WR, REST_R_ARM, NEUTRAL.rightUpperArm, qChestWorld);
  const armL = computeArm('left', LM.R_SH, LM.R_EL, LM.R_WR, REST_L_ARM, NEUTRAL.leftUpperArm, qChestWorld);

  // ── 손목 방향 + 손가락 ──
  solveHand('right', armR);
  solveHand('left', armL);

  // ── 다리 ── (관람객 왼다리 → 아바타 오른다리)
  computeLeg('right', LM.L_HIP, LM.L_KNEE, LM.L_ANK, qHipsWorld);
  computeLeg('left', LM.R_HIP, LM.R_KNEE, LM.R_ANK, qHipsWorld);

  // ── 앉기: 무릎 굽힘 정도 → 골반 내리기 ──
  let crouch = 0;
  crouch = Math.max(crouch, kneeBend(LM.L_HIP, LM.L_KNEE, LM.L_ANK));
  crouch = Math.max(crouch, kneeBend(LM.R_HIP, LM.R_KNEE, LM.R_ANK));
  const hipsH = hipsRest ? hipsRest.y : 0.8;
  hipsOffsetTarget.y = -crouch * CROUCH_DEPTH * hipsH;

  // ── 좌우 이동: 화면 속 몸 위치 따라가기 ──
  if (poseImg) {
    const hipMidX = (poseImg[LM.L_HIP].x + poseImg[LM.R_HIP].x) / 2;
    hipsOffsetTarget.x = THREE.MathUtils.clamp((0.5 - hipMidX) * SIDE_STEP_RANGE, -0.45, 0.45);
  }

  // ── 고개 ──
  const earMid = _v1.copy(p(LM.L_EAR)).add(p(LM.R_EAR)).multiplyScalar(0.5);
  const eyeMid = _v2.copy(p(LM.L_EYE)).add(p(LM.R_EYE)).multiplyScalar(0.5);
  const fwd = eyeMid.sub(earMid);
  const flen = fwd.length() || 1;
  const yaw = clampAbs(Math.atan2(fwd.x, Math.max(0.02, fwd.z)), HEAD_LIMIT);
  const pitch = clampAbs(Math.asin(clampAbs(-fwd.y / flen, 1)) * HEAD_PITCH_GAIN, HEAD_LIMIT * 0.8);
  const earLine = _v2.copy(p(LM.R_EAR)).sub(p(LM.L_EAR));
  const roll = clampAbs(Math.atan2(earLine.y, Math.abs(earLine.x) || 0.01), HEAD_LIMIT * 0.8);

  const headWorld = _q1.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  const rel = _q2.copy(qChestWorld).invert().multiply(headWorld);
  targets.neck.copy(IDENTITY).slerp(rel, 0.4);
  targets.head.copy(targets.neck).invert().multiply(rel);

  function computeArm(side, iSh, iEl, iWr, rest, neutral, parentWorld) {
    const ua = side + 'UpperArm', la = side + 'LowerArm';
    if (Math.min(vis(iSh), vis(iEl)) < VISIBILITY_MIN) {
      targets[ua].copy(neutral);
      targets[la].identity();
      return null;
    }
    const upperDir = _v1.copy(p(iEl)).sub(p(iSh)).normalize();
    const qUpperWorld = new THREE.Quaternion().setFromUnitVectors(rest, upperDir);
    targets[ua].copy(parentWorld).invert().multiply(qUpperWorld);

    if (vis(iWr) < VISIBILITY_MIN) {
      targets[la].identity();
      return { lowerWorld: qUpperWorld, rest };
    }
    const lowerDir = _v2.copy(p(iWr)).sub(p(iEl)).normalize();
    const qLowerWorld = new THREE.Quaternion().setFromUnitVectors(rest, lowerDir);
    targets[la].copy(qUpperWorld).invert().multiply(qLowerWorld);
    return { lowerWorld: qLowerWorld, rest };
  }

  function computeLeg(side, iHip, iKnee, iAnk, parentWorld) {
    const ul = side + 'UpperLeg', ll = side + 'LowerLeg';
    if (Math.min(vis(iHip), vis(iKnee)) < LEG_VISIBILITY_MIN) {
      targets[ul].identity();
      targets[ll].identity();
      return;
    }
    const upperDir = _v1.copy(p(iKnee)).sub(p(iHip)).normalize();
    const qUpperWorld = new THREE.Quaternion().setFromUnitVectors(Y_DOWN, upperDir);
    targets[ul].copy(parentWorld).invert().multiply(qUpperWorld);

    if (vis(iAnk) < LEG_VISIBILITY_MIN) {
      targets[ll].identity();
      return;
    }
    const lowerDir = _v2.copy(p(iAnk)).sub(p(iKnee)).normalize();
    const qLowerWorld = new THREE.Quaternion().setFromUnitVectors(Y_DOWN, lowerDir);
    targets[ll].copy(qUpperWorld).invert().multiply(qLowerWorld);
  }

  function kneeBend(iHip, iKnee, iAnk) {
    if (Math.min(vis(iHip), vis(iKnee), vis(iAnk)) < LEG_VISIBILITY_MIN) return 0;
    const d1 = _v1.copy(p(iKnee)).sub(p(iHip)).normalize();
    const d2 = _v2.copy(p(iAnk)).sub(p(iKnee)).normalize();
    const bend = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1)); // 편 다리 = 0
    return clamp01(bend / 1.9);
  }
}

// ── 손: 손목 방향 + 손가락 굽힘 (브이 등 손모양) ──
function solveHand(side, arm) {
  const world = latestHands[side];
  const curls = smoothedCurls[side];

  if (!world || !arm) {
    // 손 미인식: 살짝 쥔 자연스러운 손 + 손목은 팔 방향 그대로
    targets[side + 'Hand'].identity();
    setFingerTargets(side, (f) => smoothCurl(curls, f, 0.15));
    return;
  }

  // 손 좌표 변환 (거울)
  const pts = [];
  for (let i = 0; i < 21; i++) pts.push(conv(world[i]));

  if (HAND_ORIENT > 0) {
    // 손 방향 기저: 손가락 방향 + 손바닥 법선
    const dir = _v1.copy(pts[9]).sub(pts[0]).normalize();             // 손목→중지 뿌리
    const vI = _v2.copy(pts[5]).sub(pts[0]);
    const vL = _v3.copy(pts[17]).sub(pts[0]);
    const palmN = (side === 'right' ? vI.clone().cross(vL) : vL.clone().cross(vI)).normalize();
    const z = dir.clone().cross(palmN).normalize();
    const y = z.clone().cross(dir).normalize();
    _m1.makeBasis(dir, y, z);
    const qTarget = new THREE.Quaternion().setFromRotationMatrix(_m1);
    // 기본 자세 기저: 오른손 (-1,0,0)/(0,-1,0), 왼손 (1,0,0)/(0,-1,0)
    const restX = side === 'right' ? REST_R_ARM : REST_L_ARM;
    const restZ = restX.clone().cross(new THREE.Vector3(0, -1, 0)).normalize();
    const restY = restZ.clone().cross(restX).normalize();
    _m1.makeBasis(restX, restY, restZ);
    const qRest = new THREE.Quaternion().setFromRotationMatrix(_m1);
    const qHandWorld = qTarget.multiply(qRest.invert());
    const local = _q3.copy(arm.lowerWorld).invert().multiply(qHandWorld);
    // 과도한 손목 꺾임 방지
    if (local.angleTo(IDENTITY) > 1.7) local.slerp(IDENTITY, 0.5);
    targets[side + 'Hand'].copy(IDENTITY).slerp(local, HAND_ORIENT);
  } else {
    targets[side + 'Hand'].identity();
  }

  // 손가락 굽힘 (0=쫙 폄, 1=주먹)
  const raw = {};
  raw.Index = fingerCurl(world, 5);
  raw.Middle = fingerCurl(world, 9);
  raw.Ring = fingerCurl(world, 13);
  raw.Little = fingerCurl(world, 17);
  raw.Thumb = thumbCurl(world);
  setFingerTargets(side, (f) => smoothCurl(curls, f, raw[f]));
}

function smoothCurl(store, finger, target) {
  if (store[finger] == null) store[finger] = target;
  store[finger] += (target - store[finger]) * FINGER_SMOOTH;
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
  return Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1));
}

const _axisZ = new THREE.Vector3(0, 0, 1);
const _axisY = new THREE.Vector3(0, 1, 0);

function setFingerTargets(side, curlOf) {
  const zSign = side === 'right' ? 1 : -1;   // 오른손: +Z 회전이 손바닥 쪽
  const ySign = side === 'right' ? -1 : 1;   // 엄지 접기 방향
  for (const f of FINGERS) {
    const curl = curlOf(f);
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
