// 앱 흐름: 시작 → 꾸미기 → 모션 체험 (키오스크)
import * as THREE from 'three';
import * as Avatar from './avatar.js';
import * as Motion from './motion.js';

const IDLE_RESET_MS = 60 * 1000; // 60초 무조작 시 처음 화면으로

const $ = (sel) => document.querySelector(sel);
const screens = {
  start: $('#screen-start'),
  custom: $('#screen-custom'),
  motion: $('#screen-motion'),
};

// 12색 팔레트 — 차분한 패션 톤
const COLORS = [
  '#1a1a1a', '#f4f1ea', '#8a8d91', '#1e2f4d',
  '#7b1f2b', '#2e4a3a', '#c8a06a', '#e8b4b8',
  '#9a8bb5', '#7fa8c9', '#c99a2e', '#d96c47',
];

let current = 'start';
let idleTimer = null;
let motionReady = false;
let cameraFailed = false;
let selectedPart = 'top';
let selectedPattern = 'solid';
let countdownBusy = false;

// ── 초기화 ──
async function boot() {
  await Avatar.initStage($('#stage'));

  const loadingText = $('#loading-text');
  try {
    await Avatar.loadAvatar((r) => {
      loadingText.textContent = `아바타를 불러오는 중… ${Math.round(r * 100)}%`;
    });
  } catch (e) {
    console.error(e);
    loadingText.textContent = '아바타 파일을 찾을 수 없어요. 폴더에 character.vrm 파일을 넣고 새로고침해 주세요.';
    return;
  }
  if (Avatar.state.usingSample) $('#sample-badge').classList.remove('hidden');
  adaptPartTabs();

  $('#loading').classList.add('hidden');

  buildPalette();
  bindUI();
  Avatar.enableDragRotate($('#stage'));
  startRenderLoop();

  // 모션 인식은 백그라운드에서 미리 준비 (화면 3 진입이 빨라짐)
  Motion.initTrackers().then(() => { motionReady = true; })
    .catch((e) => { console.error('모션 인식 초기화 실패', e); });
}

// ── 렌더 루프 ──
const clock = new THREE.Clock();
function startRenderLoop() {
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const { renderer, scene, camera, vrm } = Avatar.state;

    if (current === 'motion' && motionReady) {
      Motion.detect(performance.now());
      Motion.applyToVRM(vrm, dt);
      updateGuide();
    }
    if (vrm) vrm.update(dt);
    renderer.render(scene, camera);
  }
  tick();
}

// ── 화면 전환 ──
function show(name) {
  current = name;
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('active', key === name);
  }
  resetIdleTimer();
}

async function goStart() {
  Motion.stopCamera();
  Avatar.resetLook();          // 다음 관람객을 위해 초기화
  Avatar.resetAvatarRotation();
  if (Avatar.state.vrm) Avatar.applyNeutralArms(Avatar.state.vrm);
  syncPaletteUI();
  Avatar.setFraming('custom');
  show('start');
}

function goCustom() {
  Motion.stopCamera();
  Avatar.setFraming('custom');
  show('custom');
}

async function goMotion() {
  Avatar.resetAvatarRotation();
  Avatar.setFraming('motion');
  show('motion');
  cameraFailed = false;
  try {
    await Motion.startCamera($('#cam'));
  } catch (e) {
    console.error('카메라 오류', e);
    cameraFailed = true;
  }
  updateGuide();
}

function updateGuide() {
  const guide = $('#guide-msg');
  if (cameraFailed) {
    guide.textContent = '카메라를 사용할 수 없어요 — 웹캠 연결을 확인해 주세요';
    guide.classList.remove('hidden');
    return;
  }
  if (!motionReady) {
    guide.textContent = '모션 인식 준비 중…';
    guide.classList.remove('hidden');
    return;
  }
  if (Motion.isTracking()) {
    guide.classList.add('hidden');
    resetIdleTimer(); // 사람이 움직이는 동안은 초기화하지 않음
  } else {
    guide.textContent = '카메라 앞에 서 주세요';
    guide.classList.remove('hidden');
  }
}

// 아바타에 없는 부위 버튼은 숨김 (원피스 아바타면 "상의" → "의상")
function adaptPartTabs() {
  const btns = document.querySelectorAll('#part-tabs .seg-btn');
  let firstAvailable = null;
  for (const b of btns) {
    const ok = Avatar.partAvailable(b.dataset.part);
    b.style.display = ok ? '' : 'none';
    if (ok && !firstAvailable) firstAvailable = b;
  }
  if (!Avatar.partAvailable('bottom') && Avatar.partAvailable('top')) {
    document.querySelector('#part-tabs .seg-btn[data-part="top"]').textContent = '의상';
  }
  if (firstAvailable && !Avatar.partAvailable(selectedPart)) {
    selectedPart = firstAvailable.dataset.part;
    for (const b of btns) b.classList.toggle('active', b === firstAvailable);
  }
}

// ── 꾸미기 UI ──
function buildPalette() {
  const wrap = $('#palette');
  for (const hex of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.dataset.color = hex;
    b.setAttribute('aria-label', '색상 ' + hex);
    b.addEventListener('click', () => {
      const ok = Avatar.applyLook(selectedPart, hex, selectedPattern);
      if (!ok) { toast('이 아바타에서는 바꿀 수 없는 부위예요'); return; }
      syncPaletteUI();
    });
    wrap.appendChild(b);
  }
}

function syncPaletteUI() {
  const chosen = Avatar.state.chosen[selectedPart];
  for (const el of document.querySelectorAll('.swatch')) {
    el.classList.toggle('active', chosen.color === el.dataset.color);
  }
  selectedPattern = chosen.pattern || 'solid';
  for (const el of document.querySelectorAll('#pattern-tabs .seg-btn')) {
    el.classList.toggle('active', el.dataset.pattern === selectedPattern);
  }
}

function bindUI() {
  $('#btn-start').addEventListener('click', goCustom);
  $('#btn-done').addEventListener('click', goMotion);
  $('#btn-home-2').addEventListener('click', goStart);
  $('#btn-home-3').addEventListener('click', goStart);
  $('#btn-reset-color').addEventListener('click', () => {
    Avatar.resetLook();
    syncPaletteUI();
    toast('원래 모습으로 되돌렸어요');
  });

  for (const el of document.querySelectorAll('#part-tabs .seg-btn')) {
    el.addEventListener('click', () => {
      selectedPart = el.dataset.part;
      for (const s of document.querySelectorAll('#part-tabs .seg-btn')) s.classList.toggle('active', s === el);
      syncPaletteUI();
      if (!Avatar.partAvailable(selectedPart)) toast('이 아바타에서는 바꿀 수 없는 부위예요');
    });
  }

  for (const el of document.querySelectorAll('#pattern-tabs .seg-btn')) {
    el.addEventListener('click', () => {
      selectedPattern = el.dataset.pattern;
      for (const s of document.querySelectorAll('#pattern-tabs .seg-btn')) s.classList.toggle('active', s === el);
      const chosen = Avatar.state.chosen[selectedPart];
      const color = chosen.color || '#1a1a1a';
      Avatar.applyLook(selectedPart, color, selectedPattern);
      syncPaletteUI();
    });
  }

  $('#btn-photo').addEventListener('click', takePhoto);
  $('#btn-photo-close').addEventListener('click', () => {
    $('#photo-modal').classList.add('hidden');
  });

  // 무조작 감지
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, resetIdleTimer, { passive: true });
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── 사진 찍기: 3초 카운트다운 → 아바타 화면만 캡처 → 표시 + PNG 저장 ──
async function takePhoto() {
  if (countdownBusy) return;
  countdownBusy = true;
  const cd = $('#countdown');
  cd.classList.remove('hidden');
  for (const n of [3, 2, 1]) {
    cd.textContent = n;
    await wait(1000);
    if (current !== 'motion') { cd.classList.add('hidden'); countdownBusy = false; return; }
  }
  cd.classList.add('hidden');

  const flash = $('#flash');
  flash.classList.remove('hidden');
  setTimeout(() => flash.classList.add('hidden'), 550);

  const dataUrl = Avatar.capturePhoto();
  $('#photo-img').src = dataUrl;
  $('#photo-modal').classList.remove('hidden');

  const a = document.createElement('a');
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.download = `avatar_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.png`;
  a.href = dataUrl;
  a.click();

  countdownBusy = false;
  resetIdleTimer();
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 60초 무조작 시 처음으로 ──
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (current !== 'start') {
      $('#photo-modal').classList.add('hidden');
      goStart();
    } else {
      resetIdleTimer();
    }
  }, IDLE_RESET_MS);
}

boot();
