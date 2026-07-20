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
  custom: { pos: new THREE.Vector3(0, 1.05, 2.5), look: new THREE.Vector3(0, 0.9, 0), shift: 0.16 },
  // 모션 화면: 카메라를 뒤로 빼서 아바타 위아래 여백 확보 + 왼쪽 절반에 배치(오른쪽은 웹캠)
  motion: { pos: new THREE.Vector3(0, 0.95, 3.4), look: new THREE.Vector3(0, 0.87, 0), shift: 0.23 },
};
export const MOTION_SHIFT = CAMERA_FRAMING.motion.shift;

let container = null;
let viewShift = 0; // 화면 가로 비율만큼 아바타를 왼쪽으로 밀기(꾸미기 화면)

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
  applyViewShift();
  camera.updateProjectionMatrix();
}

function applyViewShift() {
  const { camera } = state;
  const w = window.innerWidth, h = window.innerHeight;
  if (viewShift !== 0) {
    camera.setViewOffset(w, h, w * viewShift, 0, w, h);
  } else {
    camera.clearViewOffset();
  }
}

// 화면별 카메라 배치 ('custom' = 꾸미기, 'motion' = 모션 체험)
let framingMode = 'custom';
const motionCam = { z: 0, lookY: 0, lookX: 0 };

export function setFraming(mode) {
  framingMode = mode;
  const f = CAMERA_FRAMING[mode];
  motionCam.z = f.pos.z;
  motionCam.lookY = f.look.y;
  motionCam.lookX = 0;
  state.camera.position.copy(f.pos);
  state.camera.lookAt(f.look);
  viewShift = f.shift;
  applyViewShift();
  state.camera.updateProjectionMatrix();
}

// ── 모션 화면: 관람객 머리 크기에 맞춰 아바타 배율 자동 조절 ──
// 관람객이 가까이 있으면(상반신만 보이면) 아바타도 상반신 위주로 확대,
// 뒤로 물러나 전신이 보이면 아바타도 전신으로.
const ZOOM_MIN_Z = 1.15;      // 최대 확대 (가슴 위)
const ZOOM_MATCH = 0.74;      // 웹캠 화면이 차지하는 세로 비율 (74vh)

let cachedEyeDist = 0;

export function updateMotionFraming(hint, dt) {
  if (framingMode !== 'motion' || !state.vrm) return;
  const f = CAMERA_FRAMING.motion;
  let targetZ = f.pos.z, targetLookY = f.look.y, targetLookX = 0;

  if (hint && hint.eyeFrac) {
    const eyeW = avatarEyeDist();
    const fovTan = Math.tan(THREE.MathUtils.degToRad(state.camera.fov / 2));
    const desired = eyeW / (2 * fovTan * hint.eyeFrac * ZOOM_MATCH);
    targetZ = THREE.MathUtils.clamp(desired, ZOOM_MIN_Z, f.pos.z);
    const t = (f.pos.z - targetZ) / Math.max(0.001, f.pos.z - ZOOM_MIN_Z);
    const head = headWorldPos();
    targetLookY = THREE.MathUtils.lerp(f.look.y, head.y - 0.05, t);
    targetLookX = THREE.MathUtils.lerp(0, head.x, t);
  }

  const k = 1 - Math.exp(-dt * 2.2);
  motionCam.z += (targetZ - motionCam.z) * k;
  motionCam.lookY += (targetLookY - motionCam.lookY) * k;
  motionCam.lookX += (targetLookX - motionCam.lookX) * k;

  const t2 = (f.pos.z - motionCam.z) / Math.max(0.001, f.pos.z - ZOOM_MIN_Z);
  const camY = THREE.MathUtils.lerp(f.pos.y, motionCam.lookY + 0.05, t2);
  state.camera.position.set(motionCam.lookX, camY, motionCam.z);
  state.camera.lookAt(motionCam.lookX, motionCam.lookY, 0);
}

const _wp = new THREE.Vector3();

function avatarEyeDist() {
  if (cachedEyeDist > 0) return cachedEyeDist;
  const h = state.vrm.humanoid;
  const l = h.getRawBoneNode('leftEye');
  const r = h.getRawBoneNode('rightEye');
  if (l && r) {
    const d = l.getWorldPosition(new THREE.Vector3()).distanceTo(r.getWorldPosition(_wp));
    if (d > 0.01 && d < 0.35) { cachedEyeDist = d; return d; }
  }
  cachedEyeDist = 0.07;
  return cachedEyeDist;
}

function headWorldPos() {
  const head = state.vrm.humanoid.getRawBoneNode('head');
  if (head) return head.getWorldPosition(_wp).clone().add(new THREE.Vector3(0, 0.06, 0));
  return new THREE.Vector3(0, 1.3, 0);
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
  cachedEyeDist = 0;

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
export function capturePhoto() {
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

  const g = ctx.createRadialGradient(
    out.width / 2, 0, out.height * 0.1,
    out.width / 2, 0, out.height * 1.1
  );
  g.addColorStop(0, '#f7f5f1');
  g.addColorStop(1, '#e9e5de');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, out.width, out.height);
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
