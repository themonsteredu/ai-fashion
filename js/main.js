// 앱 흐름: 시작 → 꾸미기 → 모션 체험 (키오스크)
import * as THREE from 'three';
import * as Avatar from './avatar.js';
import * as Motion from './motion.js';
import { Debug } from './debug.js';
import { BACKGROUNDS, getBackground, setCustomBackground, getCustom, setCustomVisible } from './backgrounds.js';
import * as CamBG from './cambg.js';
import * as MissionUI from './mission-ui.js';
import * as Puppet from './puppet.js';
import * as QuizUI from './mathquiz-ui.js';

const IDLE_RESET_MS = 60 * 1000; // 60초 무조작 시 처음 화면으로

const $ = (sel) => document.querySelector(sel);
const screens = {
  start: $('#screen-start'),
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
let customAvatar = false; // 관람객이 직접 불러온 아바타(.vrm/그림)를 쓰는 중이면 true

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
  Motion.setAvatar(Avatar.state.vrm, Avatar.getSkeletonMeasures());

  // 폴더에 character.png(그림 캐릭터)가 있으면 그 그림으로 보여 준다.
  // 3D 아바타는 숨겨진 채로 동작 계산에만 쓰인다. (그림을 지우면 다시 3D 캐릭터)
  let usingPicture = false;
  try {
    usingPicture = !!(await Puppet.activateDefault((t) => { loadingText.textContent = t; }));
  } catch (e) {
    console.warn('그림 캐릭터 준비 실패 → 3D 캐릭터 사용', e);
    setTimeout(() => toast('그림 캐릭터(character.png)를 열지 못해 3D 캐릭터로 시작했어요'), 500);
  }
  if (Avatar.state.usingSample && !usingPicture) $('#sample-badge').classList.remove('hidden');

  $('#loading').classList.add('hidden');

  bindUI();
  Avatar.enableDragRotate($('#stage'));
  Debug.init((on) => Avatar.toggleSkeletonHelper(on));
  MissionUI.init({
    getSnapshot: () => Motion.getPoseSnapshot(),
    onExit: goStart,
    onManualPhoto: takePhoto,
    adminSections: [QuizUI.adminSection], // 운영자 설정(Esc)에 수학 퀴즈 설정도 함께
  });
  QuizUI.init({
    getSnapshot: () => Motion.getPoseSnapshot(),
    onExit: goStart,
    onManualPhoto: takePhoto,
    isPaused: () => MissionUI.isAdminOpen(),
  });
  // 미션: 아래 설명 카드 위 빈 자리에 아바타 전신이 다 들어오게 (카드가 다리·발을 가리지 않게)
  Avatar.setFitProvider(missionFitRect);
  const mmCard = document.querySelector('#mission-root .mm-mid');
  if (mmCard && window.ResizeObserver) {
    new ResizeObserver(() => { if (document.body.classList.contains('mission-on')) Avatar.refreshFraming(); }).observe(mmCard);
  }
  startRenderLoop();

  // 모션 인식은 백그라운드에서 미리 준비 (화면 3 진입이 빨라짐)
  Motion.initTrackers().then(() => { motionReady = true; })
    .catch((e) => { console.error('모션 인식 초기화 실패', e); });
  CamBG.init().catch((e) => { console.error('배경 분리 초기화 실패', e); });
}

function missionFitRect(mode) {
  if (mode !== 'mission') return null;
  const w = window.innerWidth, h = window.innerHeight;
  const portrait = Avatar.isPortrait();
  const card = document.querySelector('#mission-root .mm-mid');
  const r = card ? card.getBoundingClientRect() : null;
  // 카드가 아직 안 보이면 평소 높이로 짐작
  const cardTop = r && r.height > 0 ? r.top : (portrait ? h - 250 : h * 0.955 - 260);
  // 휴대폰 세로: 위쪽 제목·작은 웹캠 아래 ~ 설명 카드 위
  if (portrait) return { left: w * 0.04, right: w * 0.96, top: h * 0.2, bottom: cardTop - Math.max(h * 0.02, 16) };
  // 가로 화면: 왼쪽 끝 ~ 오른쪽 웹캠 카드 앞, 화면 위 ~ 설명 카드 위
  return { left: w * 0.04, right: w * 0.64, top: h * 0.035, bottom: cardTop - Math.max(h * 0.03, 20) };
}

// ── 렌더 루프 ──
const clock = new THREE.Clock();
function startRenderLoop() {
  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return; // 창이 숨겨져 있으면 인식·렌더링 중지 (성능)
    const dt = Math.min(clock.getDelta(), 0.05);
    const { renderer, scene, camera, vrm } = Avatar.state;

    if (current === 'motion' && motionReady) {
      const nowMs = performance.now();
      Motion.detect(nowMs);
      // 미션 준비 단계면 아바타가 목표 포즈를 시범으로 보여줌, 아니면 웹캠 따라 움직임
      const gameOn = MissionUI.isActive() || QuizUI.isActive();
      const demo = MissionUI.isActive() ? MissionUI.getDemoPose()
        : QuizUI.isActive() ? QuizUI.getDemoPose() : null;
      if (demo) Avatar.applyDemoPose(Puppet.isActive() ? Puppet.flattenDemo(demo) : demo, dt); // 그림 아바타는 화면 평면 시범
      else Motion.applyToVRM(vrm, dt);
      updateCamMatch(dt); // 웹캠 표시 배율을 아바타 크기에 맞춤
      CamBG.process($('#cam'), nowMs);
      updateCamView();
      updateMissionPoseOverlay();
      MissionUI.tick(nowMs);
      QuizUI.tick(nowMs);
      if (!gameOn) updateGuide();
      // 미션·퀴즈 중에는 사람이 화면 앞에 있는 동안 "무조작 → 처음 화면" 타이머를 미룸
      else { const st = Motion.getStatus(); if (st === 'ok' || st === 'calibrating') resetIdleTimer(); }
      if (Debug.enabled) Debug.update({ ...Motion.getDebugInfo(), segFps: CamBG.getSegFps() }, $('#cam'));
    }
    if (vrm) vrm.update(dt);
    Puppet.update(dt, current === 'motion'); // 그림 아바타: 3D 아바타 자세를 그림에 옮김
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

let motionSeq = 0; // 카메라 켜는 도중 '처음으로'를 누르면 늦게 끝난 시작 처리를 무시하기 위한 번호

async function goStart() {
  motionSeq++;
  cancelVideo(); // 녹화 중이었다면 저장 없이 중단
  $('#video-choice').classList.add('hidden');
  MissionUI.forceStop();
  QuizUI.forceStop();
  document.body.classList.remove('photo-taking');
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
  Avatar.resetAvatarRotation();
  if (Avatar.state.vrm) Avatar.applyNeutralArms(Avatar.state.vrm);
  Avatar.setFraming('start');
  show('start');
}

// mode: 'free'(자유 체험) | 'mission'(포즈 미션) | 'quiz'(수학 퀴즈)
async function goMotion(mode) {
  const seq = ++motionSeq;
  Avatar.resetAvatarRotation();
  Avatar.setFraming(mode === 'free' ? 'motion' : mode);
  show('motion');
  cameraFailed = false;
  try {
    await Motion.startCamera($('#cam'));
    // 흐릿한 배경 채움용 영상: 같은 스트림 공유 (전신이 다 보이도록 앞 영상은 contain)
    const bg = $('#cam-bg');
    if (bg && $('#cam').srcObject) { bg.srcObject = $('#cam').srcObject; bg.play().catch(() => {}); }
  } catch (e) {
    console.error('카메라 오류', e);
    cameraFailed = true;
  }
  // 카메라를 기다리는 사이 처음으로 돌아갔거나 다른 모드로 바뀌었으면 여기서 멈춤
  if (seq !== motionSeq || current !== 'motion') {
    if (current !== 'motion') Motion.stopCamera();
    return;
  }
  if (mode === 'mission') MissionUI.start();
  else if (mode === 'quiz') QuizUI.start();
  updateGuide();
}

// ── 웹캠 표시 배율 맞춤: 아바타는 그대로, 웹캠 "카드" 자체가 내 모습 크기에 맞춰
//    줄어들어 아바타 눈높이 옆에 떠 있음 (검은 여백 없음) ──
const camMatch = { s: 1, top: null };

function updateCamMatch(dt) {
  const wrap = $('#cam-wrap');
  // 모바일 세로 또는 미션(3단 고정 레이아웃): JS 배율 맞춤 끔 → CSS 고정 위치 사용
  const bodyCls = document.body.classList;
  if (Avatar.isPortrait() || bodyCls.contains('mission-on') || bodyCls.contains('quiz-on')) {
    if (wrap.style.width) { wrap.style.width = wrap.style.height = wrap.style.top = wrap.style.transform = ''; }
    return;
  }
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

// 미션 중 웹캠 위에 최소한의 포즈 추적 HUD를 표시한다.
// MediaPipe 결과를 읽어 그리기만 하며 아바타 구동·미션 판정은 건드리지 않는다.
const MISSION_POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const MISSION_POSE_POINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function updateMissionPoseOverlay() {
  const canvas = $('#cam-pose');
  const wrap = $('#cam-wrap');
  const camEl = $('#cam');
  if (!canvas || !wrap || !camEl) return;

  const points = MissionUI.isActive() || QuizUI.isActive() ? Motion.getPoseOverlay() : null;
  const visible = !!points;
  canvas.classList.toggle('hidden', !visible);
  if (!visible) return;

  const w = Math.max(2, Math.round(wrap.clientWidth));
  const h = Math.max(2, Math.round(wrap.clientHeight));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // object-fit: contain의 레터박스를 고려해 비디오 실제 표시 영역에 맞춘다.
  const videoAspect = (camEl.videoWidth || 640) / (camEl.videoHeight || 480);
  const boxAspect = w / h;
  let drawW, drawH, offsetX, offsetY;
  if (videoAspect > boxAspect) {
    drawW = w; drawH = w / videoAspect; offsetX = 0; offsetY = (h - drawH) / 2;
  } else {
    drawH = h; drawW = h * videoAspect; offsetY = 0; offsetX = (w - drawW) / 2;
  }
  const screenPoint = (p) => ({ x: offsetX + (1 - p.x) * drawW, y: offsetY + p.y * drawH });
  const usable = (p) => p && (p.visibility ?? 1) > 0.35;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [a, b] of MISSION_POSE_CONNECTIONS) {
    if (!usable(points[a]) || !usable(points[b])) continue;
    const pa = screenPoint(points[a]), pb = screenPoint(points[b]);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = 'rgba(5, 8, 16, 0.72)'; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = '#315cff'; ctx.lineWidth = 3; ctx.stroke();
  }
  for (const index of MISSION_POSE_POINTS) {
    if (!usable(points[index])) continue;
    const p = screenPoint(points[index]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#315cff'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
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
    // 전신(발목)이 안 보이면 뒤로 물러나도록 부드럽게 안내
    const snap = Motion.getPoseSnapshot();
    if (snap && snap.present && !snap.fullBody) {
      guide.textContent = '🦶 전신이 다 보이게 두세 걸음 뒤로 서보세요';
      guide.classList.remove('hidden');
    } else {
      guide.classList.add('hidden');
    }
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
// 배경 초기화 (기본 스튜디오). 배경 선택 기능은 추후 추가 예정.
function applyBackground(id) {
  const bg = getBackground(id);
  selectedBgId = bg.id;
  document.body.style.background = bg.css;
  setCustomVisible(bg.id === 'custom' && bg.type === 'video');
}

function bindUI() {
  $('#btn-done').addEventListener('click', () => goMotion('free'));
  $('#btn-mission').addEventListener('click', () => goMotion('mission'));
  $('#btn-quiz').addEventListener('click', () => goMotion('quiz'));
  $('#btn-home-3').addEventListener('click', goStart);

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
    document.body.classList.remove('photo-taking'); // 미션·퀴즈 결과창 다시 보이기
    const v = $('#video-preview');
    v.pause();
    v.removeAttribute('src');
  });

  // 내 아바타(.vrm 또는 그림 .png/.jpg) 불러오기
  $('#btn-upload').addEventListener('click', () => $('#vrm-file').click());
  $('#vrm-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    resetIdleTimer(); // 파일 고르는 시간은 무조작으로 치지 않음
    const loading = $('#loading');
    const loadingText = $('#loading-text');
    loading.classList.remove('hidden');
    loadingText.textContent = '아바타를 불러오는 중…';
    try {
      if (await Puppet.isImageFile(file)) {
        // 그림 파일 → 그림 아바타 (3D 아바타는 숨겨서 동작 계산에만 사용)
        const { mode, armsTouching } = await Puppet.activate(file, { onStatus: (t) => { loadingText.textContent = t; } });
        customAvatar = true;
        $('#sample-badge').classList.add('hidden');
        Avatar.setFraming('start');
        loading.classList.add('hidden');
        toast(mode === 'full' ? '그림 아바타를 만들었어요! 팔·다리가 따라 움직여요'
          : mode === 'upper' ? '그림 아바타를 만들었어요! 팔·몸통이 따라 움직여요'
          : armsTouching ? '팔이 몸에 붙은 그림이라 몸 전체가 함께 움직여요 (팔을 살짝 뗀 그림이면 팔도 움직여요)'
          : '그림 전체가 함께 움직여요 (정면 전신 그림이면 팔·다리도 움직여요)', 4500);
        return;
      }
      await Avatar.loadAvatarFromFile(file, (r) => {
        loadingText.textContent = `아바타를 불러오는 중… ${Math.round(r * 100)}%`;
      });
      Puppet.deactivate(); // 3D 아바타를 다시 보이게
      customAvatar = true;
      Motion.setAvatar(Avatar.state.vrm, Avatar.getSkeletonMeasures());
      $('#sample-badge').classList.add('hidden');
      Avatar.setFraming('start');
      loading.classList.add('hidden');
      toast('아바타를 불러왔어요! 미션이나 자유 체험을 시작해 보세요');
    } catch (err) {
      console.error('아바타 불러오기 실패', file.name, err);
      loading.classList.add('hidden');
      const why = (err && err.userMessage) || '이 파일은 열 수 없어요. VRoid Studio에서 내보낸 .vrm 파일이나 PNG·JPG 그림인지 확인해 주세요.';
      alert(`${why}\n\n(선택한 파일: ${file.name})`);
    } finally {
      resetIdleTimer(); // 불러오기가 끝난 시점부터 60초
    }
  });

  // 무조작 감지
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, resetIdleTimer, { passive: true });
  }
}

let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── 사진 찍기: 3초 카운트다운 → 아바타 화면만 캡처 → 표시 + PNG 저장 ──
async function takePhoto() {
  if (countdownBusy) return;
  countdownBusy = true;
  document.body.classList.add('photo-taking');
  const cd = $('#countdown');
  cd.classList.remove('hidden');
  for (const n of [3, 2, 1]) {
    cd.textContent = n;
    await wait(1000);
    if (current !== 'motion') { cd.classList.add('hidden'); countdownBusy = false; document.body.classList.remove('photo-taking'); return; }
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
    if (MissionUI.isAdminOpen()) { resetIdleTimer(); return; } // 운영자 설정 창(Esc)이 열려 있으면 기다림
    // 관람객이 불러온 아바타는 그 사람 체험 동안만 — 다음 관람객은 부스 기본 캐릭터로 (사진 개인정보 보호)
    if (customAvatar && !recorder && !countdownBusy) {
      if (!$('#loading').classList.contains('hidden')) { resetIdleTimer(); return; } // 불러오는 중이면 기다림
      location.reload(); return;
    }
    if (current !== 'start') {
      $('#photo-modal').classList.add('hidden');
      goStart();
    } else {
      resetIdleTimer();
    }
  }, IDLE_RESET_MS);
}

boot();
