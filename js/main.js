// 앱 흐름: 시작 → 꾸미기 → 모션 체험 (키오스크)
import * as THREE from 'three';
import * as Avatar from './avatar.js';
import * as Motion from './motion.js';
import { Debug } from './debug.js';
import { BACKGROUNDS, getBackground } from './backgrounds.js';
import * as CamBG from './cambg.js';

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
let selectedBgId = 'studio';
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
  Motion.setAvatar(Avatar.state.vrm, Avatar.getSkeletonMeasures());

  $('#loading').classList.add('hidden');

  buildPalette();
  buildBgRow();
  bindUI();
  Avatar.enableDragRotate($('#stage'));
  Debug.init((on) => Avatar.toggleSkeletonHelper(on));
  startRenderLoop();

  // 모션 인식은 백그라운드에서 미리 준비 (화면 3 진입이 빨라짐)
  Motion.initTrackers().then(() => { motionReady = true; })
    .catch((e) => { console.error('모션 인식 초기화 실패', e); });
  CamBG.init().catch((e) => { console.error('배경 분리 초기화 실패', e); });
}

// ── 렌더 루프 ──
const clock = new THREE.Clock();
function startRenderLoop() {
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const { renderer, scene, camera, vrm } = Avatar.state;

    if (current === 'motion' && motionReady) {
      const nowMs = performance.now();
      Motion.detect(nowMs);
      Motion.applyToVRM(vrm, dt);
      updateCamMatch(dt); // 웹캠 표시 배율을 아바타 크기에 맞춤
      CamBG.process($('#cam'), nowMs);
      updateCamView();
      updateGuide();
      if (Debug.enabled) Debug.update(Motion.getDebugInfo(), $('#cam'));
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
  cancelVideo(); // 녹화 중이었다면 저장 없이 중단
  $('#video-choice').classList.add('hidden');
  resetCamMatch();
  Motion.stopCamera();
  // 다음 관람객을 위해 배경/웹캠 효과 초기화
  applyBackground('studio');
  CamBG.setMode('off');
  for (const c of document.querySelectorAll('#cambg-tabs .chip')) {
    c.classList.toggle('active', c.dataset.cambg === 'off');
  }
  $('#cam-view').classList.add('hidden');
  $('#cam').style.visibility = 'visible';
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

// ── 웹캠 표시 배율 맞춤: 아바타는 그대로, 웹캠 "카드" 자체가 내 모습 크기에 맞춰
//    줄어들어 아바타 눈높이 옆에 떠 있음 (검은 여백 없음) ──
const camMatch = { s: 1, top: null };

function updateCamMatch(dt) {
  const wrap = $('#cam-wrap');
  const hint = motionReady ? Motion.getHeadHint() : null;
  const vh = window.innerHeight, vw = window.innerWidth;
  const H0 = vh * 0.74, W0 = vw * 0.40; // 기본 카드 크기
  let targetS = 1;
  let targetTop = vh * 0.46 - H0 / 2;

  const eye = hint ? Avatar.getAvatarEyeScreen() : null;
  if (hint && eye && eye.px > 1) {
    const userEyePx0 = hint.eyeFrac * H0; // 기본 크기일 때 내 눈 사이 픽셀
    if (userEyePx0 > 2) {
      targetS = THREE.MathUtils.clamp(eye.px / userEyePx0, 0.28, 1.1);
      const h = H0 * targetS;
      // 내 눈높이가 아바타 눈높이와 같은 화면 높이에 오도록 카드 위치 조정
      targetTop = THREE.MathUtils.clamp(eye.y - hint.eyeY * h, vh * 0.03, vh * 0.95 - h);
    }
  }
  const k = 1 - Math.exp(-dt * 3);
  camMatch.s += (targetS - camMatch.s) * k;
  if (camMatch.top == null) camMatch.top = targetTop;
  camMatch.top += (targetTop - camMatch.top) * k;

  wrap.style.height = (H0 * camMatch.s).toFixed(1) + 'px';
  wrap.style.width = (W0 * camMatch.s).toFixed(1) + 'px';
  wrap.style.top = camMatch.top.toFixed(1) + 'px';
  wrap.style.transform = 'none';
}

// 웹캠 배경 효과가 켜져 있으면 합성 캔버스를 표시
function updateCamView() {
  const camEl = $('#cam');
  const view = $('#cam-view');
  const effectOn = CamBG.getMode() !== 'off' && CamBG.isReady();
  view.classList.toggle('hidden', !effectOn);
  camEl.style.visibility = effectOn ? 'hidden' : 'visible';
  if (!effectOn) return;

  const wrap = $('#cam-wrap');
  const w = Math.max(2, Math.round(wrap.clientWidth));
  const h = Math.max(2, Math.round(wrap.clientHeight));
  if (view.width !== w) view.width = w;
  if (view.height !== h) view.height = h;
  CamBG.draw(view.getContext('2d'), w, h, camEl, getBackground(selectedBgId).paint);
}

function resetCamMatch() {
  camMatch.s = 1;
  camMatch.top = null;
  const wrap = $('#cam-wrap');
  if (wrap) {
    wrap.style.height = '';
    wrap.style.width = '';
    wrap.style.top = '';
    wrap.style.transform = '';
  }
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
  const status = Motion.getStatus();
  if (status === 'ok') {
    guide.classList.add('hidden');
    resetIdleTimer(); // 사람이 움직이는 동안은 초기화하지 않음
  } else if (status === 'calibrating') {
    guide.textContent = `그대로 편하게 서 주세요… ${Math.round(Motion.getCalibProgress() * 100)}%`;
    guide.classList.remove('hidden');
    resetIdleTimer();
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

// ── 배경 선택 ──
function buildBgRow() {
  const row = $('#bg-row');
  for (const bg of BACKGROUNDS) {
    const b = document.createElement('button');
    b.className = 'bg-swatch' + (bg.id === selectedBgId ? ' active' : '');
    b.style.background = bg.css;
    b.dataset.bg = bg.id;
    b.title = bg.name;
    b.setAttribute('aria-label', '배경 ' + bg.name);
    b.addEventListener('click', () => applyBackground(bg.id));
    row.appendChild(b);
  }
}

function applyBackground(id) {
  selectedBgId = id;
  document.body.style.background = getBackground(id).css;
  for (const el of document.querySelectorAll('.bg-swatch')) {
    el.classList.toggle('active', el.dataset.bg === id);
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
  $('#btn-video').addEventListener('click', toggleVideo);
  $('#btn-rec-avatar').addEventListener('click', () => {
    $('#video-choice').classList.add('hidden');
    startVideo('avatar');
  });
  $('#btn-rec-both').addEventListener('click', () => {
    $('#video-choice').classList.add('hidden');
    startVideo('both');
  });
  $('#btn-rec-cancel').addEventListener('click', () => {
    $('#video-choice').classList.add('hidden');
  });

  // 내 배경: 그대로 / 흐리게 / 아바타 배경
  for (const el of document.querySelectorAll('#cambg-tabs .chip')) {
    el.addEventListener('click', () => {
      CamBG.setMode(el.dataset.cambg);
      for (const c of document.querySelectorAll('#cambg-tabs .chip')) c.classList.toggle('active', c === el);
      if (el.dataset.cambg !== 'off' && !CamBG.isReady()) toast('배경 효과 준비 중이에요, 잠시만요');
    });
  }
  $('#btn-photo-close').addEventListener('click', () => {
    $('#photo-modal').classList.add('hidden');
    const v = $('#video-preview');
    v.pause();
    v.removeAttribute('src');
  });

  // 내 아바타(.vrm) 불러오기
  $('#btn-upload').addEventListener('click', () => $('#vrm-file').click());
  $('#vrm-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const loading = $('#loading');
    const loadingText = $('#loading-text');
    loading.classList.remove('hidden');
    loadingText.textContent = '아바타를 불러오는 중…';
    try {
      await Avatar.loadAvatarFromFile(file, (r) => {
        loadingText.textContent = `아바타를 불러오는 중… ${Math.round(r * 100)}%`;
      });
      Motion.setAvatar(Avatar.state.vrm, Avatar.getSkeletonMeasures());
      $('#sample-badge').classList.add('hidden');
      selectedPart = 'top';
      selectedPattern = 'solid';
      adaptPartTabs();
      syncPaletteUI();
      loading.classList.add('hidden');
      goCustom();
      toast('아바타를 불러왔어요! 이제 꾸며 보세요');
    } catch (err) {
      console.error('VRM 로드 실패', err);
      loading.classList.add('hidden');
      alert('이 파일은 열 수 없어요. VRoid Studio에서 내보낸 .vrm 파일인지 확인해 주세요.');
    }
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

  const dataUrl = Avatar.capturePhoto(getBackground(selectedBgId).paint);
  $('#photo-img').src = dataUrl;
  $('#photo-img').classList.remove('hidden');
  $('#video-preview').classList.add('hidden');
  $('#save-note').textContent = '사진이 저장되었어요 (다운로드 폴더)';
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

// ── 동영상 찍기: 아바타 화면만 녹화 (웹캠 미포함, 최대 30초) ──
let recorder = null;
let recTimer = null;
const VIDEO_MAX_SEC = 30;

let recCopyRaf = null;

function toggleVideo() {
  if (recorder) { stopVideo(); return; }
  $('#video-choice').classList.remove('hidden'); // 아바타만 / 아바타+내 모습 선택
}

// mode: 'avatar' = 아바타만, 'both' = 왼쪽 아바타 + 오른쪽 내 모습
function startVideo(mode) {
  if (recorder) return;
  const src = Avatar.state.renderer.domElement;
  const cam = $('#cam');

  const rec = document.createElement('canvas');
  const h = src.height;
  rec.height = h;
  rec.width = mode === 'both' ? Math.round(h * 16 / 9) : Math.round(src.width * 0.5);
  const rctx = rec.getContext('2d');

  // 렌더 화면에서 아바타가 있는 위치 (가운데에서 왼쪽으로 밀려 있음)
  const avatarCx = (0.5 - Avatar.MOTION_SHIFT) * src.width;

  const bgPaint = getBackground(selectedBgId).paint;
  const copyFrame = () => {
    bgPaint(rctx, rec.width, rec.height);

    if (mode === 'both') {
      const half = Math.round(rec.width / 2);
      // 왼쪽: 아바타
      const sxA = Math.min(Math.max(0, Math.round(avatarCx - half / 2)), Math.max(0, src.width - half));
      rctx.drawImage(src, sxA, 0, half, h, 0, 0, half, h);
      // 오른쪽: 웹캠 (배경 효과가 켜져 있으면 합성 화면, 거울 모드)
      const camSrc = CamBG.getMode() !== 'off' && CamBG.isReady() ? $('#cam-view') : cam;
      const cw = camSrc.videoWidth || camSrc.width, ch2 = camSrc.videoHeight || camSrc.height;
      if (cw > 0 && ch2 > 0) {
        const targetAspect = half / h;
        let sw = ch2 * targetAspect, sh = ch2, sx = (cw - sw) / 2, sy = 0;
        if (sw > cw) {
          sw = cw; sh = cw / targetAspect;
          sx = 0; sy = (ch2 - sh) / 2;
        }
        rctx.save();
        rctx.translate(rec.width, 0);
        rctx.scale(-1, 1);
        rctx.drawImage(camSrc, sx, sy, sw, sh, 0, 0, half, h);
        rctx.restore();
      }
      // 가운데 구분선
      rctx.fillStyle = 'rgba(255,255,255,0.9)';
      rctx.fillRect(half - 3, 0, 6, h);
    } else {
      const cropW = rec.width;
      const sxA = Math.min(Math.max(0, Math.round(avatarCx - cropW / 2)), Math.max(0, src.width - cropW));
      rctx.drawImage(src, sxA, 0, cropW, h, 0, 0, cropW, h);
    }
    recCopyRaf = requestAnimationFrame(copyFrame);
  };
  copyFrame();

  const recStream = rec.captureStream(30);
  // MP4 우선, 미지원 브라우저에서만 webm으로 대체
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || 'video/webm';
  const isMp4 = mime.startsWith('video/mp4');
  const chunks = [];
  recorder = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const t = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const prefix = mode === 'both' ? 'avatar_with_me' : 'avatar_video';
    a.download = `${prefix}_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.${isMp4 ? 'mp4' : 'webm'}`;
    a.href = url;
    a.click();

    $('#photo-img').classList.add('hidden');
    const v = $('#video-preview');
    v.classList.remove('hidden');
    v.src = url;
    $('#save-note').textContent = isMp4
      ? '영상이 MP4로 저장되었어요 (다운로드 폴더)'
      : '영상이 저장되었어요 (다운로드 폴더, webm)';
    $('#photo-modal').classList.remove('hidden');
  };
  recorder.start(250);

  const btn = $('#btn-video');
  btn.classList.add('recording');
  const t0 = Date.now();
  recTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    btn.textContent = `⏹ 저장하기 ${String(Math.floor(sec / 60))}:${String(sec % 60).padStart(2, '0')}`;
    if (sec >= VIDEO_MAX_SEC) stopVideo();
  }, 250);
  btn.textContent = '⏹ 저장하기 0:00';
  resetIdleTimer();
}

function cancelVideo() {
  if (!recorder) return;
  recorder.onstop = null; // 저장하지 않고 버림
  stopVideo();
}

function stopVideo() {
  if (!recorder) return;
  clearInterval(recTimer);
  recTimer = null;
  if (recCopyRaf) { cancelAnimationFrame(recCopyRaf); recCopyRaf = null; }
  try { recorder.stop(); } catch (e) {}
  recorder = null;
  const btn = $('#btn-video');
  btn.classList.remove('recording');
  btn.textContent = '🎥 영상 찍기';
  resetIdleTimer();
}

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
