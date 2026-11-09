import { RelaySession, getRelayMissions } from './pe-relay-engine.js';
import { peFigure, peMedal } from './pe-figure.js';
import { loadPESettings } from './pe-moves.js';
import * as Sound from './pe-sound.js';

const WATCH_MS = 2000;
const MOVEMENT_WATCH_MS = 2800;
const MOVEMENT_FRAME_MS = 700;
const TOTAL = 20;
let deps, root, els, cam, layoutObserver;
let relay = null;
const visible = (el, show) => { el.hidden = !show; };
const paused = () => document.hidden || deps.isPaused();

export function init(d) {
  deps = d;
  cam = document.getElementById('cam-wrap');
  root = document.createElement('section');
  root.id = 'pe-relay-root';
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'relay-heading');
  root.innerHTML = `
    <header class="relay-header">
      <div class="relay-brand">
        <p class="relay-eyebrow">체육 동작 배우기</p>
        <h1 id="relay-heading">20명 포즈 릴레이</h1>
      </div>
      <div class="relay-tools">
        <button type="button" data-relay-action="sound" aria-label="소리 끄기" aria-pressed="false">소리 켜짐</button>
        <button type="button" data-relay-action="exit">처음으로</button>
      </div>
      <ol class="relay-progress" aria-label="학생 순서">
        ${Array.from({ length: TOTAL }, (_, i) => `<li data-turn="${i + 1}">${i + 1}</li>`).join('')}
      </ol>
    </header>
    <div class="relay-layout">
      <div class="relay-stage">
        <div class="relay-stage-fit"></div>
        <span class="relay-stage-label">시범 아바타</span>
        <div class="relay-cam-slot" aria-hidden="true"></div>
      </div>
      <div class="relay-panel" data-relay-view="setup">
        <p class="relay-eyebrow">수업 준비</p>
        <h2>한 명씩 나와 자세를 바꿔요</h2>
        <p class="relay-description">교과서에 나온 움직임을 20명이 번호 순서대로 하나씩 표현해요. 앞 친구가 마치면 다음 번호 학생이 나와요.</p>
        <div class="relay-concepts" aria-label="오늘의 학습 주제"><span>제자리 움직임</span><span>이동 움직임</span><span>공간 표현</span></div>
        <label class="relay-mode" for="relay-upper-body">
          <span><strong>상체만 사용</strong><small>이동하거나 다리를 쓰는 미션을 팔과 몸통으로 표현해요.</small></span>
          <input type="checkbox" id="relay-upper-body" role="switch">
        </label>
        <div class="relay-setup-actions">
          <button type="button" class="relay-primary" data-relay-action="start">릴레이 시작</button>
          <button type="button" data-relay-action="practice">개별 동작 연습</button>
        </div>
        <p class="relay-camera-note" data-ref="camera"></p>
      </div>
      <div class="relay-panel relay-play" data-relay-view="play" hidden>
        <div class="relay-turn">
          <div class="relay-current"><strong data-ref="turn">01</strong><span>/ <b data-ref="total">20</b>번</span></div>
          <div class="relay-next" data-ref="next"></div>
        </div>
        <div class="relay-target">
          <div class="relay-figure" data-ref="figure"></div>
          <div class="relay-target-copy">
            <p class="relay-eyebrow" data-ref="focus">오늘의 미션</p>
            <h2 data-ref="title"></h2>
            <p class="relay-instruction" data-ref="instruction"></p>
            <p class="relay-followup" data-ref="followup" hidden></p>
          </div>
        </div>
        <div class="relay-feedback" role="status">
          <p data-ref="status"></p>
          <progress data-ref="hold" max="1" value="0" aria-label="자세 유지 진행률" hidden></progress>
        </div>
        <div class="relay-actions">
          <button type="button" class="relay-primary" data-relay-action="student" hidden></button>
          <button type="button" data-relay-action="retry" hidden>다시 시범 보기</button>
          <button type="button" data-relay-action="complete" hidden>교사 확인 완료</button>
          <button type="button" class="relay-primary" data-relay-action="next" hidden></button>
        </div>
      </div>
      <div class="relay-panel relay-result" data-relay-view="done" hidden>
        <div class="relay-medal" data-ref="medal"></div>
        <p class="relay-eyebrow">릴레이 완료</p>
        <h2>20명 모두 마쳤어요!</h2>
        <p class="relay-description">우리 반이 교과서 속 움직임 미션 20가지를 완주했어요.</p>
        <dl class="relay-counts">
          <div><dt>카메라 인식</dt><dd data-ref="automatic">0명</dd></div>
          <div><dt>교사 확인</dt><dd data-ref="manual">0명</dd></div>
        </dl>
        <button type="button" class="relay-primary" data-relay-action="restart">새 릴레이 준비</button>
      </div>
    </div>`;
  document.body.append(root);
  els = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map(el => [el.dataset.ref, el]));
  els.stage = root.querySelector('.relay-stage');
  els.fit = root.querySelector('.relay-stage-fit');
  els.camSlot = root.querySelector('.relay-cam-slot');
  els.stageLabel = root.querySelector('.relay-stage-label');
  els.upperBody = root.querySelector('#relay-upper-body');
  els.progress = root.querySelector('.relay-progress');
  els.turns = [...els.progress.children];
  els.views = Object.fromEntries([...root.querySelectorAll('[data-relay-view]')].map(el => [el.dataset.relayView, el]));
  els.buttons = Object.fromEntries([...root.querySelectorAll('[data-relay-action]')].map(el => [el.dataset.relayAction, el]));
  visible(els.buttons.practice, !!deps.onPractice);
  root.addEventListener('click', onClick);
  els.upperBody.addEventListener('change', () => {
    if (relay) relay.upperBodyOnly = els.upperBody.checked;
  });
  document.addEventListener('visibilitychange', () => {
    if (!relay) return;
    relay.lastTick = null;
    relay.session?.setPaused(paused());
    if (document.hidden) Sound.cancel();
  });
  if (typeof ResizeObserver === 'function') {
    layoutObserver = new ResizeObserver(refreshLayout);
    layoutObserver.observe(els.fit);
    layoutObserver.observe(els.camSlot);
  }
}

export function prepare() {
  Sound.unlock();
  Sound.setMuted(false);
  const settings = loadPESettings();
  Sound.setVolume(settings.volume);
  relay = { camera: 'pending', settings, muted: false, upperBodyOnly: false, lastKeepAlive: -Infinity };
  document.activeElement?.blur();
  root.hidden = false;
  document.body.classList.add('relay-on');
  showSetup();
}

export function start({ cameraOk = true } = {}) {
  if (!relay) return;
  relay.camera = cameraOk ? 'ready' : 'failed';
  render();
}

export function isActive() { return relay !== null; }

export function forceStop() {
  if (!relay) return;
  relay = null;
  root.hidden = true;
  document.body.classList.remove('relay-on', 'relay-cam-on');
  if (cam) for (const edge of ['left', 'top', 'width', 'height']) cam.style.removeProperty(`--relay-cam-${edge}`);
  Sound.cancel();
  Sound.setMuted(false);
}

export function getDemoPose() {
  if (!relay) return null;
  const { phase, target } = getView();
  if (phase === 'active') return null;
  const watch = relay.watch;
  const frames = watch?.mission.demoFrames;
  if (frames) return frames[Math.floor(watch.elapsed / MOVEMENT_FRAME_MS) % frames.length];
  return target?.demo || relay.missions[0].steps[0].demo;
}

export function getDemoOpts() {
  return { root: { x: 0, y: 0 }, plant: !deps.avatarCaps().picture };
}

export function fitRect() {
  if (!relay) return null;
  const rect = els.fit.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const caps = deps.avatarCaps();
  const defaultPicture = caps.picture && !caps.custom;
  const gap = Math.min(12, rect.height * 0.035);
  return {
    left: rect.left + gap, right: rect.right - gap,
    top: rect.top + gap, bottom: rect.bottom - gap,
    reach: defaultPicture ? 1.18 : 1.3,
    halfWScale: deps.isPortrait() && defaultPicture ? 0.5 : 0.6,
  };
}

export function tick(nowMs) {
  if (!relay) return;
  if (nowMs - relay.lastKeepAlive >= 1000) {
    deps.keepAlive?.();
    relay.lastKeepAlive = nowMs;
  }
  const dt = relay.lastTick === null ? 0 : Math.max(0, Math.min(100, nowMs - relay.lastTick));
  relay.lastTick = nowMs;
  const session = relay.session;
  if (!session) return;
  const isPaused = paused();
  session.setPaused(isPaused);
  if (isPaused) return;
  const watch = relay.watch;
  if (watch) {
    watch.elapsed += dt;
    const step = Math.floor(watch.elapsed / watch.interval);
    if (step >= watch.mission.steps.length) {
      relay.watch = null;
      if (!watch.retry) session.startTurn();
      sfx('ding');
    } else if (step !== watch.step) {
      watch.step = step;
      announceDemo();
    }
    render();
    return;
  }
  const previous = session.getState();
  if (previous.phase !== 'active' || relay.camera !== 'ready' || !deps.isMotionReady()) return;
  const next = session.update(deps.getSnapshot(), nowMs, deps.getOverlay());
  if (next.phase === 'handoff' || next.phase === 'done') recordResult(next);
  else if (next.step !== previous.step) sfx('tok');
  render();
}

function showSetup() {
  relay.session = null;
  relay.watch = null;
  relay.lastTick = null;
  relay.missions = getRelayMissions({ upperBodyOnly: relay.upperBodyOnly });
  relay.results = new Map();
  relay.lastTarget = null;
  els.upperBody.checked = relay.upperBodyOnly;
  render();
}

function beginWatch(retry = false) {
  const state = relay.session.getState();
  const turn = state.phase === 'handoff' ? state.turn + 1 : state.turn;
  const mission = relay.missions[turn - 1];
  if (!mission) return;
  if (retry) relay.session.retryTurn();
  else deps.resetStudent?.();
  relay.lastTick = null;
  const interval = mission.demoFrames ? MOVEMENT_WATCH_MS : WATCH_MS;
  relay.watch = { turn, mission, retry, interval, step: 0, elapsed: 0 };
  Sound.unlock();
  announceDemo();
  render();
}

function announceDemo() {
  const { mission, step } = relay.watch;
  sfx('beep');
  if (relay.settings.voice && !relay.muted) Sound.say(mission.steps[step].instruction);
}

function onClick(event) {
  const button = event.target.closest('[data-relay-action]');
  if (!button || button.disabled || !relay || paused()) return;
  switch (button.dataset.relayAction) {
    case 'start':
      relay.missions = getRelayMissions({ upperBodyOnly: relay.upperBodyOnly });
      relay.session = new RelaySession({ upperBodyOnly: relay.upperBodyOnly });
      relay.session.start();
      render();
      break;
    case 'student':
    case 'next':
      beginWatch();
      break;
    case 'retry':
      beginWatch(true);
      break;
    case 'complete':
      recordResult(relay.session.completeTurn());
      render();
      break;
    case 'restart':
      showSetup();
      break;
    case 'sound':
      relay.muted = !relay.muted;
      Sound.setMuted(relay.muted);
      if (!relay.muted) Sound.unlock();
      render();
      break;
    case 'practice':
      deps.onPractice?.();
      break;
    case 'exit':
      forceStop();
      deps.onExit();
      break;
  }
}

function sfx(name) {
  if (relay.settings.sfx && !relay.muted) Sound.play(name);
}

function recordResult(state) {
  if (!state.result || relay.results.has(state.result.turn)) return;
  relay.results.set(state.result.turn, state.result.method);
  sfx(state.completed === state.total ? 'finale' : 'fanfare');
}

function getView() {
  const state = relay.session?.getState();
  if (!state) return { phase: 'setup', total: relay.missions.length, completed: 0 };
  if (relay.watch) {
    const { mission, turn, step } = relay.watch;
    return { ...state, phase: 'watch', mission, turn, step, target: mission.steps[step] };
  }
  return { ...state, target: state.mission?.steps[state.step] };
}

function updateText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

function render() {
  const view = getView();
  const { phase } = view;
  const phaseChanged = root.dataset.phase !== phase;
  const focused = root.contains(document.activeElement) ? document.activeElement : null;
  root.dataset.phase = phase;
  const play = phase !== 'setup' && phase !== 'done';
  visible(els.views.setup, phase === 'setup');
  visible(els.views.play, play);
  visible(els.views.done, phase === 'done');
  visible(els.progress, phase !== 'setup');
  const camOn = play && relay.camera === 'ready';
  if (document.body.classList.contains('relay-cam-on') !== camOn || phaseChanged) {
    document.body.classList.toggle('relay-cam-on', camOn);
    refreshLayout();
  }
  updateText(els.buttons.sound, relay.muted ? '소리 꺼짐' : '소리 켜짐');
  els.buttons.sound.setAttribute('aria-pressed', String(relay.muted));
  els.buttons.practice.disabled = relay.camera === 'pending';
  updateText(els.camera, {
    pending: '카메라 연결을 기다리는 중이에요. 교사가 직접 확인할 수 있어요.',
    ready: '카메라 연결 완료',
    failed: '카메라 없이 진행해요. 교사가 자세를 보고 완료를 눌러요.',
  }[relay.camera]);

  if (play) renderPlay(view);
  if (phase === 'done') renderResult();
  if (phaseChanged && phase !== 'setup') renderProgress(view);
  if (focused && focused.closest('[hidden]')) {
    const action = { setup: 'start', ready: 'student', handoff: 'next', done: 'restart' }[phase];
    if (action) els.buttons[action].focus({ preventScroll: true });
  }
}

function renderProgress({ phase, turn, completed }) {
  for (const el of els.turns) {
    const n = Number(el.dataset.turn);
    const current = n === turn && phase !== 'done';
    el.classList.toggle('is-complete', n <= completed);
    el.classList.toggle('is-current', current);
    if (current) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
    el.setAttribute('aria-label', `${n}번${n <= completed ? ' 완료' : current ? ' 차례' : ''}`);
  }
}

function renderPlay({ phase, turn, total, mission, step, target, progress, hint, hintType, result }) {
  updateText(els.turn, String(turn).padStart(2, '0'));
  updateText(els.total, String(total));
  updateText(els.next, turn < total ? `다음 ${turn + 1}번` : '마지막 차례');
  updateText(els.focus, mission.steps.length > 1 ? `${mission.focus} · ${step + 1}/${mission.steps.length}` : mission.focus);
  updateText(els.title, mission.title);
  updateText(els.instruction, target.instruction);
  const followup = mission.steps[step + 1];
  visible(els.followup, !!followup && (phase === 'ready' || phase === 'active'));
  if (followup) updateText(els.followup, `이어서 ${followup.instruction}`);
  if (relay.lastTarget !== target) {
    els.figure.innerHTML = peFigure(target.demo);
    relay.lastTarget = target;
  }
  updateText(els.buttons.student, `${turn}번 학생 시작`);
  updateText(els.buttons.next, `${turn + 1}번 학생 시작`);
  visible(els.buttons.student, phase === 'ready');
  visible(els.buttons.retry, phase === 'active');
  visible(els.buttons.complete, phase === 'active');
  visible(els.buttons.next, phase === 'handoff' && turn < total);
  const trackingReady = relay.camera === 'ready' && deps.isMotionReady();
  const teacherReview = mission.assessment === 'teacher';
  const canRecognize = trackingReady && !teacherReview;
  updateText(els.stageLabel, phase === 'active' && trackingReady ? '따라 하는 아바타' : '시범 아바타');
  els.buttons.complete.classList.toggle('relay-primary', !canRecognize);
  visible(els.hold, phase === 'active' && canRecognize);
  els.hold.value = progress || 0;
  const interval = relay.watch?.interval ?? WATCH_MS;
  const watchSeconds = Math.ceil((interval - (relay.watch?.elapsed || 0) % interval) / 1000);
  let status = {
    ready: `${turn}번 학생이 카메라 앞에 서면 시작해요.`,
    watch: `아바타의 시범을 봐요 · ${watchSeconds}초`,
    active: '자세를 만들고 잠깐 그대로 있어요.',
    handoff: result?.method === 'teacher' ? '교사가 동작을 확인했어요!' : '자세를 인식했어요. 미션 성공!',
  }[phase];
  if (phase === 'active') {
    if (relay.camera === 'failed') status = '카메라 없이 진행해요. 교사가 동작을 보고 완료를 눌러요.';
    else if (teacherReview) status = '동작을 끝내면 선생님이 확인해요.';
    else if (!canRecognize) status = '카메라 인식을 준비 중이에요. 교사가 직접 확인할 수 있어요.';
    else if (hint) status = hint;
  }
  els.status.dataset.hint = phase === 'active' && canRecognize ? hintType || '' : phase;
  updateText(els.status, status);
}

function renderResult() {
  if (!els.medal.firstElementChild) els.medal.innerHTML = peMedal(relay.missions.at(-1).steps.at(-1).demo);
  const automatic = [...relay.results.values()].filter(method => method === 'camera').length;
  updateText(els.automatic, `${automatic}명`);
  updateText(els.manual, `${relay.results.size - automatic}명`);
  updateText(els.stageLabel, '시범 아바타');
}

function refreshLayout() {
  if (!relay) return;
  if (cam && document.body.classList.contains('relay-cam-on')) {
    const rect = els.camSlot.getBoundingClientRect();
    for (const edge of ['left', 'top', 'width', 'height']) {
      cam.style.setProperty(`--relay-cam-${edge}`, `${rect[edge]}px`);
    }
  }
  deps.refreshFraming();
}
