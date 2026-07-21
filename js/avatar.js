// 3D 아바타: 씬 구성, VRM 로드, 색상/패턴 꾸미기
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export const state = {
  renderer: null,
  scene: null,
  camera: null,
  vrm: null,
  usingSample: false,
  parts: { top: [], bottom: [], hair: [] },   // 부위별 머티리얼 목록
  chosen: {                                    // 부위별 현재 선택
    top:    { color: null, pattern: 'solid' },
    bottom: { color: null, pattern: 'solid' },
    hair:   { color: null, pattern: 'solid' },
  },
};

const CAMERA_FRAMING = {
  // 시작 화면: 아바타 전신을 화면 중앙에 예쁘게
  start:  { pos: new THREE.Vector3(0, 0.92, 4.0), look: new THREE.Vector3(0, 0.92, 0), shift: 0 },
  // 자유 체험(2단): 아바타 왼쪽 절반, 오른쪽 웹캠. 머리 안 잘리게 여유
  motion: { pos: new THREE.Vector3(0, 0.95, 3.7), look: new THREE.Vector3(0, 0.9, 0), shift: 0.22, shiftY: -0.03 },
  // 미션(3단): 아바타 왼쪽 1/3, 가운데 미션카드, 오른쪽 웹캠. 팔 든 자세까지 다 보이게
  mission:{ pos: new THREE.Vector3(0, 0.98, 4.3), look: new THREE.Vector3(0, 0.98, 0), shift: 0.34, shiftY: -0.03 },
};
CAMERA_FRAMING.custom = CAMERA_FRAMING.start; // 하위호환
// 모바일 세로: 좌우 밀기 없이 세로 배치 (하단은 카드/웹캠)
const CAMERA_FRAMING_MOBILE = {
  start:  { pos: new THREE.Vector3(0, 0.95, 3.6), look: new THREE.Vector3(0, 0.95, 0), shift: 0, shiftY: -0.05 },
  motion: { pos: new THREE.Vector3(0, 1.02, 3.5), look: new THREE.Vector3(0, 0.98, 0), shift: 0, shiftY: -0.1 },
  mission:{ pos: new THREE.Vector3(0, 1.0, 3.7), look: new THREE.Vector3(0, 1.0, 0), shift: 0, shiftY: -0.14 },
};
CAMERA_FRAMING_MOBILE.custom = CAMERA_FRAMING_MOBILE.start;
export const MOTION_SHIFT = CAMERA_FRAMING.motion.shift;

export function isPortrait() {
  return window.innerWidth <= 700 && window.innerHeight >= window.innerWidth;
}
function framingFor(mode) {
  return isPortrait() ? CAMERA_FRAMING_MOBILE[mode] : CAMERA_FRAMING[mode];
}

let container = null;
let viewShift = 0;  // 좌우 밀기(꾸미기·모션 데스크톱)
let viewShiftY = 0; // 상하 밀기(모바일)

export async function initStage(containerEl) {
  container = containerEl;

  // preserveDrawingBuffer: 영상 녹화(캔버스 복사)를 위해 필요
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 30);

  // 밝은 스튜디오 라이팅
  const hemi = new THREE.HemisphereLight(0xffffff, 0xdcd6cc, 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 3, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff2e2, 0.55);
  fill.position.set(-2, 1.5, 1);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(0, 2.5, -2.5);
  scene.add(rim);

  // 바닥의 은은한 원형 그림자 느낌
  const discTex = makeRadialTexture();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 48),
    new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.005;
  scene.add(disc);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;

  window.addEventListener('resize', onResize);
  setFraming('custom');
  return state;
}

function makeRadialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(23,21,15,0.22)');
  g.addColorStop(1, 'rgba(23,21,15,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function onResize() {
  const { renderer, camera } = state;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  // 화면 회전/크기 변경 시 현재 모드로 재배치 (모바일↔데스크톱 프레이밍 전환)
  if (state.vrm) setFraming(framingMode);
  else applyViewShift();
  camera.updateProjectionMatrix();
}

function applyViewShift() {
  const { camera } = state;
  const w = window.innerWidth, h = window.innerHeight;
  if (viewShift !== 0 || viewShiftY !== 0) {
    camera.setViewOffset(w, h, w * viewShift, h * viewShiftY, w, h);
  } else {
    camera.clearViewOffset();
  }
}

// 화면별 카메라 배치 ('custom' = 꾸미기, 'motion' = 모션 체험)
let framingMode = 'custom';
const motionCam = { z: 0, lookY: 0, lookX: 0 };

export function setFraming(mode) {
  framingMode = mode;
  const f = framingFor(mode);
  motionCam.z = f.pos.z;
  motionCam.lookY = f.look.y;
  motionCam.lookX = 0;
  state.camera.position.copy(f.pos);
  state.camera.lookAt(f.look);
  viewShift = f.shift;
  viewShiftY = f.shiftY || 0;
  applyViewShift();
  state.camera.updateProjectionMatrix();
}

// ── 웹캠 배율 맞춤용: 아바타 눈 사이 거리의 화면상 픽셀 크기와 눈높이 ──
// (아바타는 항상 전신 고정, 웹캠 표시 배율을 여기에 맞춘다)
export function getAvatarEyeScreen() {
  if (!state.vrm) return null;
  const h = state.vrm.humanoid;
  const l = h.getRawBoneNode('leftEye');
  const r = h.getRawBoneNode('rightEye');
  let a, b;
  if (l && r) {
    a = l.getWorldPosition(new THREE.Vector3());
    b = r.getWorldPosition(new THREE.Vector3());
  } else {
    const head = h.getRawBoneNode('head');
    if (!head) return null;
    const c = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
    a = c.clone().setX(c.x - 0.035);
    b = c.clone().setX(c.x + 0.035);
  }
  const w = window.innerWidth, hpx = window.innerHeight;
  const toPx = (v) => {
    const p = v.clone().project(state.camera);
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * hpx };
  };
  const pa = toPx(a), pb = toPx(b);
  return { px: Math.hypot(pa.x - pb.x, pa.y - pb.y), y: (pa.y + pb.y) / 2 };
}

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

function setupVrm(gltf) {
  const vrm = gltf.userData.vrm;

  // 성능 최적화 + VRM0 모델 방향 보정
  try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (e) {}
  try { VRMUtils.combineSkeletons(gltf.scene); } catch (e) {}
  VRMUtils.rotateVRM0(vrm);

  vrm.scene.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) obj.frustumCulled = false;
  });

  // 이전 아바타 제거
  toggleSkeletonHelper(false);
  if (state.vrm) {
    state.scene.remove(state.vrm.scene);
    try { VRMUtils.deepDispose(state.vrm.scene); } catch (e) {}
  }
  texCache.clear();

  state.scene.add(vrm.scene);
  state.vrm = vrm;

  // 아바타가 항상 관람객(화면) 쪽을 바라보게 — 눈맞춤 디테일
  if (vrm.lookAt) vrm.lookAt.target = state.camera;

  classifyMaterials(vrm);
  applyNeutralArms(vrm);
  return vrm;
}

export async function loadAvatar(onProgress) {
  const loader = makeLoader();
  let gltf;
  try {
    gltf = await loadWithProgress(loader, './character.vrm', onProgress);
    state.usingSample = false;
  } catch (e) {
    console.warn('character.vrm 로드 실패 → 샘플 아바타 사용', e);
    gltf = await loadWithProgress(loader, './sample_avatar.vrm', onProgress);
    state.usingSample = true;
  }
  return setupVrm(gltf);
}

// 관람객·학생이 직접 고른 .vrm 파일 불러오기
export async function loadAvatarFromFile(file, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const gltf = await loadWithProgress(makeLoader(), url, onProgress);
    state.usingSample = false;
    return setupVrm(gltf);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadWithProgress(loader, url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, (ev) => {
      if (onProgress && ev.total) onProgress(ev.loaded / ev.total);
    }, reject);
  });
}

// 팔을 자연스럽게 내린 기본 자세 (T포즈 방지)
export function applyNeutralArms(vrm) {
  const drop = THREE.MathUtils.degToRad(68);
  const l = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  const r = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
  if (l) l.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -drop);
  if (r) r.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), drop);
}

// ── 부위(상의/하의/헤어) 분류: VRoid 머티리얼 이름 규칙 사용 ──
const PART_RULES = [
  { part: 'top',    re: /(tops|onepiece|jacket|shirts|sweater|hoodie|dress|coat)/i },
  { part: 'bottom', re: /(bottoms|pants|skirt|shorts|jeans)/i },
  { part: 'hair',   re: /(hair)/i },
];

function classifyMaterials(vrm) {
  const seen = new Set();
  state.parts = { top: [], bottom: [], hair: [] };
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const name = m.name || '';
      for (const rule of PART_RULES) {
        if (rule.re.test(name)) {
          // 원본 상태 저장 (원래대로 되돌리기용)
          m.userData._orig = {
            map: m.map || null,
            shadeTex: m.shadeMultiplyTexture !== undefined ? m.shadeMultiplyTexture : undefined,
            color: m.color ? m.color.clone() : null,
          };
          state.parts[rule.part].push(m);
          break;
        }
      }
    }
  });
  console.log('부위 분류:',
    'top=' + state.parts.top.length,
    'bottom=' + state.parts.bottom.length,
    'hair=' + state.parts.hair.length);
}

export function partAvailable(part) {
  return state.parts[part] && state.parts[part].length > 0;
}

// ── 색상 + 패턴 적용 ──
// 원본 텍스처의 명암(주름·음영)을 유지하면서 새 색을 입힌다.
export function applyLook(part, colorHex, pattern) {
  const mats = state.parts[part];
  if (!mats || mats.length === 0) return false;

  state.chosen[part] = { color: colorHex, pattern };

  for (const m of mats) {
    const orig = m.userData._orig;
    if (orig.map && orig.map.image) {
      const tex = recolorTexture(orig.map, colorHex, pattern);
      m.map = tex;
      if (orig.shadeTex !== undefined && orig.shadeTex === orig.map) {
        m.shadeMultiplyTexture = tex;
      }
      if (m.color) m.color.set(0xffffff);
    } else if (m.color) {
      m.color.set(colorHex);
    }
    m.needsUpdate = true;
  }
  return true;
}

export function resetLook() {
  for (const part of Object.keys(state.parts)) {
    state.chosen[part] = { color: null, pattern: 'solid' };
    for (const m of state.parts[part]) {
      const orig = m.userData._orig;
      if (!orig) continue;
      m.map = orig.map;
      if (orig.shadeTex !== undefined) m.shadeMultiplyTexture = orig.shadeTex;
      if (orig.color && m.color) m.color.copy(orig.color);
      m.needsUpdate = true;
    }
  }
}

const texCache = new Map(); // 같은 조합은 다시 그리지 않기

function recolorTexture(origTex, colorHex, pattern) {
  const key = origTex.uuid + '|' + colorHex + '|' + pattern;
  if (texCache.has(key)) return texCache.get(key);

  const img = origTex.image;
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  // 1) 원본 → 2) 무채색화 → 3) 어두운 부분 밝기 올리기(검은 옷도 색이 입혀지도록)
  // → 4) 새 색을 곱하기 → 5) 패턴 → 6) 원본 알파 복원
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = '#6a6a6a';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, w, h);
  drawPattern(ctx, pattern, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = origTex.flipY;
  tex.colorSpace = origTex.colorSpace;
  tex.wrapS = origTex.wrapS;
  tex.wrapT = origTex.wrapT;
  tex.magFilter = origTex.magFilter;
  tex.minFilter = origTex.minFilter;
  tex.needsUpdate = true;

  texCache.set(key, tex);
  return tex;
}

function drawPattern(ctx, pattern, w, h) {
  if (pattern === 'solid') return;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(40, 34, 28, 0.30)';

  if (pattern === 'stripe') {
    const band = Math.max(8, Math.round(h / 28));
    for (let y = 0; y < h; y += band * 2) ctx.fillRect(0, y, w, band);
  } else if (pattern === 'dot') {
    const step = Math.max(24, Math.round(w / 20));
    const r = step * 0.22;
    for (let y = step / 2; y < h; y += step) {
      const off = (Math.round(y / step) % 2) * (step / 2);
      for (let x = step / 2; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x + off, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'check') {
    const band = Math.max(10, Math.round(w / 22));
    ctx.fillStyle = 'rgba(40, 34, 28, 0.20)';
    for (let y = 0; y < h; y += band * 2) ctx.fillRect(0, y, w, band);
    for (let x = 0; x < w; x += band * 2) ctx.fillRect(x, 0, band, h);
  }
}

// ── 미션 시범 포즈: 아바타를 목표 포즈로 부드럽게 세팅 (판정과 무관, 시각용) ──
const _demoNeutral = {};
const _tmpQuat = new THREE.Quaternion();
const _tmpAxis = new THREE.Vector3();
function demoNeutralQuat(name) {
  if (_demoNeutral[name]) return _demoNeutral[name];
  const drop = THREE.MathUtils.degToRad(68);
  let q = new THREE.Quaternion();
  if (name === 'leftUpperArm') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -drop);
  else if (name === 'rightUpperArm') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), drop);
  _demoNeutral[name] = q;
  return q;
}
// spec: [[boneName,[ax,ay,az],angle], ...]. dt로 부드럽게 보간. 명시 안 된 팔/몸통은 차렷.
const DEMO_BONES = ['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm', 'spine', 'chest', 'neck', 'head'];
// 거울 모드: 시범 포즈를 학생이 볼 때(=플레이 시 미러 결과)와 같게 좌우 반전
function mirrorBoneName(name) {
  if (name.startsWith('left')) return 'right' + name.slice(4);
  if (name.startsWith('right')) return 'left' + name.slice(5);
  return name; // spine/chest/neck/head 등 중앙 본
}
export function applyDemoPose(spec, dt) {
  if (!state.vrm) return;
  const h = state.vrm.humanoid;
  const targets = {};
  for (const [bone, axis, angle] of (spec || [])) {
    // 좌우 반전 + 각도 부호 반전 (거울 대칭)
    const mBone = mirrorBoneName(bone);
    targets[mBone] = _tmpQuat.clone().setFromAxisAngle(_tmpAxis.set(axis[0], axis[1], axis[2]), -angle).clone();
  }
  const k = 1 - Math.exp(-dt * 16);
  for (const name of DEMO_BONES) {
    const node = h.getNormalizedBoneNode(name);
    if (!node) continue;
    const tgt = targets[name] || demoNeutralQuat(name); // 명시 안 됨 → 차렷/기본
    node.quaternion.slerp(tgt, k);
  }
  // 손가락은 편 상태로
  for (const side of ['left', 'right']) {
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
      for (const j of (f === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'])) {
        const n = h.getNormalizedBoneNode(side + f + j);
        if (n) n.quaternion.slerp(_tmpQuat.identity(), k);
      }
    }
  }
}

// ── 아바타 골격 치수 측정 (모션 캘리브레이션용) ──
export function getSkeletonMeasures() {
  if (!state.vrm) return null;
  const h = state.vrm.humanoid;
  state.vrm.scene.updateMatrixWorld(true);
  const wp = (name) => {
    const n = h.getRawBoneNode(name);
    return n ? n.getWorldPosition(new THREE.Vector3()) : null;
  };
  const dist = (a, b) => (a && b) ? a.distanceTo(b) : 0;
  const hips = wp('hips');
  const neck = wp('neck') || wp('head');
  const lu = wp('leftUpperLeg'), ll = wp('leftLowerLeg'), lf = wp('leftFoot');
  const la = wp('leftUpperArm'), lel = wp('leftLowerArm'), lh = wp('leftHand');
  return {
    hipsY: hips ? hips.y : 0.8,
    hipHalf: dist(lu, wp('rightUpperLeg')) / 2 || 0.08,
    torsoLen: dist(hips, neck),
    upperLegLen: dist(lu, ll),
    lowerLegLen: dist(ll, lf),
    legLen: dist(lu, ll) + dist(ll, lf),
    armLen: dist(la, lel) + dist(lel, lh),
    shoulderW: dist(wp('leftUpperArm'), wp('rightUpperArm')),
  };
}

// ── 디버그: 본 축(스켈레톤) 표시 ──
let skeletonHelper = null;
export function toggleSkeletonHelper(on) {
  if (on && !skeletonHelper && state.vrm) {
    skeletonHelper = new THREE.SkeletonHelper(state.vrm.scene);
    state.scene.add(skeletonHelper);
  } else if (!on && skeletonHelper) {
    state.scene.remove(skeletonHelper);
    skeletonHelper = null;
  }
}

// ── 꾸미기 화면: 드래그로 아바타 회전 ──
export function enableDragRotate(el) {
  let dragging = false, lastX = 0;
  const down = (e) => { dragging = true; lastX = e.clientX; };
  const move = (e) => {
    if (!dragging || !state.vrm) return;
    state.vrm.scene.rotation.y += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  };
  const up = () => { dragging = false; };
  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function resetAvatarRotation() {
  if (state.vrm) state.vrm.scene.rotation.y = 0;
}

// 사진 캡처: 3D 화면만 합성 (웹캠 영상은 절대 포함하지 않음)
// 아바타를 가운데 두고 세로형(패션 화보 비율)으로 잘라서 저장
export function capturePhoto(bgPaint) {
  const { renderer, scene, camera } = state;

  // 캡처하는 동안만 아바타를 화면 정중앙으로
  const prevShift = viewShift;
  viewShift = 0;
  applyViewShift();
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const src = renderer.domElement;

  const outH = src.height;
  const outW = Math.min(src.width, Math.round(outH * 0.8)); // 4:5 세로형
  const sx = Math.round((src.width - outW) / 2);
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d');

  if (bgPaint) {
    bgPaint(ctx, out.width, out.height);
  } else {
    const g = ctx.createRadialGradient(
      out.width / 2, 0, out.height * 0.1,
      out.width / 2, 0, out.height * 1.1
    );
    g.addColorStop(0, '#f7f5f1');
    g.addColorStop(1, '#e9e5de');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(src, sx, 0, outW, outH, 0, 0, outW, outH);

  // 원래 화면 배치로 복구
  viewShift = prevShift;
  applyViewShift();
  camera.updateProjectionMatrix();

  // 하단 브랜드 문구
  ctx.fillStyle = 'rgba(168,121,74,0.95)';
  ctx.font = `700 ${Math.round(out.height * 0.028)}px "Malgun Gothic", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('FASHION  AVATAR  STUDIO', out.width / 2, out.height * 0.965);

  return out.toDataURL('image/png');
}
