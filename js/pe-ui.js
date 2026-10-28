// 체육 동작 배우기 UI (SPEC §5–§9): 고르기 → 준비 → [① 보기 → 준비 자세 → ② 연습 → 시작 → ③ 따라 하기 → 칭찬] × 동작 → 결과
// 판정은 pe-engine.js(순수 계산), 동작 자료는 pe-moves.js. 이 파일은 화면·흐름·소리·운영자 설정만 다룬다.
// 시간은 전부 틱 시간(game.t, ms) — 상태를 바꾸는 setTimeout 없음(파티클 지우기만). 설정 창(Esc)·비밀번호 창이 열려 있으면 모두 멈춘다.
// 아바타(그림 선생님)는 항상 무대(fitRect) 안에 머리부터 신발까지 다 보인다: 카드·배너·웹캠은 무대 밖에만 둔다(R1).
import * as E from './pe-engine.js';
import * as M from './pe-moves.js';
import { peFigure, peMedal } from './pe-figure.js';
import * as Sound from './pe-sound.js';
import { THEMES } from './missionvisuals.js';

let deps = null;      // { getSnapshot, getOverlay, getVideoAspect, isMotionReady, onExit, onManualPhoto, isPaused, avatarCaps, refreshFraming, isPortrait, keepAlive }
let root = null, camGuide = null;
let settings = M.loadPESettings();
let active = false, game = null, lastTick = 0, lastDemo = null, debugOn = false, muted = false;
const sensor = new E.Sensor(), baseline = new E.Baseline();
const q = (sel) => root.querySelector(sel);
const KP = M.KP;

export function isActive() { return active; }

// ═════════ 공개 API (SPEC §8.3) ═════════
export function init(d) {
  deps = d;
  debugOn = M.isPEDebug();
  buildDOM();
  window.addEventListener('keydown', onKey);
  document.addEventListener('click', onDocClick); // 운영자 설정 안의 테스트·통계 초기화 버튼 (설정 창은 다시 그려지므로 위임)
}

// #btn-pe 클릭 안에서 동기로: 소리 잠금 해제 + 고르기 화면을 카메라 켜기 전에 바로 표시
export function prepare() {
  Sound.unlock();
  try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) { /* 무시 */ }
  settings = M.loadPESettings();
  debugOn = M.isPEDebug();
  muted = false; Sound.setMuted(false); Sound.setVolume(settings.volume);
  active = true; lastTick = 0;
  sensor.reset(); baseline.reset();
  game = newGame();
  clearUI();
  root.classList.remove('hidden');
  document.body.classList.add('pe-on', 'pe-cam-off');
  enterPick();
  lastDemo = game.demo;
  if (debugOn) window.__peTrace = [];
}

// 카메라 켜기가 끝난 뒤. 카메라가 안 되면 '보며 따라 하기'(선생님이 대신 세어 줌)
export function start({ cameraOk = true } = {}) {
  if (!active || !game) return;
  game.camStarted = true;
  game.cameraOk = cameraOk;
  if (!cameraOk) enterAssist('카메라를 쓸 수 없어요 — 보면서 따라 해요');
}

export function getDemoPose() {
  if (!active || !game) return null;
  if (document.body.classList.contains('photo-taking')) return null; // 기념사진: 아바타가 학생을 그대로 따라 함
  return lastDemo;
}
export function getDemoOpts() {
  const caps = deps.avatarCaps();
  return { root: { x: 0, y: 0 }, plant: !caps.picture };
}

// 아바타가 들어갈 빈 자리(px). main의 fit provider가 'pe' 모드에서 부른다 (SPEC §6.3)
export function fitRect() {
  const W = innerWidth, H = innerHeight, portrait = deps.isPortrait(), cap = deps.avatarCaps();
  const defPic = cap.picture && !cap.custom;
  const reach = defPic ? 1.18 : 1.3, halfWScale = portrait && defPic ? 0.5 : 0.6;
  const r = (sel) => { const e = root && root.querySelector(sel); const b = e && e.getBoundingClientRect(); return b && b.height > 0 ? b : null; };
  const gap = Math.max(H * 0.012, 8), ph = game ? game.phase : 'pick';
  if (ph === 'pick' || ph === 'result') {
    const head = r('.pe-pick-head'), panel = r(ph === 'result' ? '.pe-result-card' : '.pe-pick .pe-panel');
    const bottom = ph === 'result' ? H * 0.92 : H * 0.97;
    return portrait
      ? { left: W * 0.03, right: W * 0.97, top: (head ? head.bottom : H * 0.13) + gap, bottom: (panel ? panel.top : H * 0.47) - gap, reach, halfWScale }
      : { left: W * 0.02, right: (panel ? panel.left : W * 0.39) - W * 0.02, top: (head ? head.bottom : H * 0.2) + H * 0.015, bottom, reach, halfWScale };
  }
  const head = r('.pe-head'), coach = r('.pe-coach'), cam = document.querySelector('#cam-wrap')?.getBoundingClientRect();
  return portrait
    ? { left: W * 0.03, right: W * 0.97, top: Math.max(head ? head.bottom : H * 0.11, cam && cam.height ? cam.bottom : H * 0.14) + gap, bottom: (coach ? coach.top : H - 160) - gap, reach, halfWScale }
    : { left: W * 0.02, right: (coach ? coach.left : W * 0.638) - W * 0.018, top: (head ? head.bottom : H * 0.17) + H * 0.01, bottom: H * 0.97, reach, halfWScale };
}

// 여러 번 불러도 안전: 다음 친구를 위해 화면·소리·상태를 모두 비움 (onExit 콜백 없음)
export function forceStop() {
  active = false; game = null; lastDemo = null; lastTick = 0;
  document.body.classList.remove('pe-on', 'pe-cam-off', 'pe-flash');
  if (root) { root.classList.add('hidden'); clearUI(); }
  if (camGuide) camGuide.classList.add('hidden');
  Sound.cancel();
}

// 매 프레임 (main 렌더 루프)
export function tick(nowMs) {
  if (!active || !game) return;
  const dt = lastTick ? Math.min(nowMs - lastTick, 100) : 16;
  lastTick = nowMs;
  if (deps.isPaused()) return; // 설정 창이 열려 있으면 코치·타이머·세기 모두 그대로 멈춤
  const g = game;
  g.t += dt;
  const snap = deps.getSnapshot(), ov = deps.getOverlay();
  const s = sensor.update(snap, ov, deps.getVideoAspect(), g.t);
  g.s = s; g.snap = snap;
  if (debugOn && s.isNew && window.__peTrace && window.__peTrace.length < 20000) window.__peTrace.push({ t: g.t, snap, ov });
  if (g.Bm && (s.jumped || s.refLost)) baseline.markRebase();
  if (s.crowd) note('한 명씩 해요 🙋', 3000);
  g.want = '';
  g.fbWant = null;
  HANDLERS[g.phase](dt, s, snap, ov);
  if (!game || !active) return; // 처음으로 나감
  if (g.assist && PLAY.has(g.phase) && g.phase !== 'ready' && deps.keepAlive) deps.keepAlive(); // 인식이 없으니 무조작 타이머가 진행 중인 체육을 끝내지 않게
  lastDemo = g.demo;
  renderLive();
  writeDataset();
  if ((debugOn || g.phase === 'test') && g.t - (g.dbgT || 0) >= 100) { g.dbgT = g.t; renderDebug(); }
}

// ═════════ 상태 ═════════
const PLAY = new Set(['ready', 'watch', 'setup', 'step', 'go', 'reps', 'praise', 'test']);
const secOf = (ph) => (ph === 'pick' ? 'pick' : ph === 'result' ? 'result' : 'play');
function newGame() {
  return { phase: 'pick', t: 0, tPhase: 0, assist: false, camStarted: false, cameraOk: true, queue: [], qi: 0, course: false,
    results: [], cur: null, counter: null, coach: null, Bm: null, demo: KP.DOWN, s: null, note: null, fbNote: null, want: '', fbWant: null,
    presentMs: 0, autoMs: 0, resultMs: 0, photoStarMs: 0, absentMs: 0, holdUntil: 0, wasAbsent: false, flashUntil: 0, hitKey: null, hitUntil: 0, lastSayT: -1e9 };
}
const kSens = () => M.SENS_K[settings.sensitivity] || 1;
const unitOf = (mv) => (mv.unitMs || 1000) * (settings.tempo || 1);
const specOf = (mv, key) => ((mv.keys && mv.keys[key]) || {}).spec || [];
const courseIds = () => M.courseMoves(settings);
const theme = (mv) => THEMES[mv && mv.theme] || THEMES.mint;
function note(text, ms) { if (game) game.note = { text, until: game.t + ms }; }
function fbNote(text, ms) { if (game) game.fbNote = { text, until: game.t + ms }; }
function sfx(name) { if (name === 'tick' ? settings.beatTick : settings.sfx) Sound.play(name); }
function voice(text) { if (settings.voice && !muted) Sound.say(text); }

function setPhase(ph) {
  const g = game, prev = g.phase;
  g.phase = ph; g.tPhase = 0;
  root.dataset.phase = ph;
  document.body.classList.toggle('pe-cam-off', ph === 'pick' || ph === 'result');
  camGuide.classList.toggle('hidden', ph !== 'ready');
  renderStages();
  // 고르기 ↔ 진행 ↔ 결과는 무대 자리가 바뀜. 같은 화면 안에서도 머리말 높이가 바뀔 수 있음 (3% 규칙이 흔들림을 막음)
  if (secOf(prev) !== secOf(ph) || PLAY.has(ph)) deps.refreshFraming();
}

// ── 고르기 ──
function enterPick() {
  const g = game;
  Object.assign(g, { queue: [], qi: 0, course: false, results: [], cur: null, counter: null, coach: null, Bm: null,
    idle: new E.Coach(M.IDLE_MOVE, 1, 'loop'), presentMs: 0, autoMs: 0 });
  renderPicker();
  setPhase('pick');
  g.demo = g.idle.spec();
}
function startSession(ids, course) {
  if (!game || !active) return;
  ids = (ids || []).filter((id) => M.MOVES[id]);
  if (!ids.length) return;
  const g = game;
  Object.assign(g, { queue: ids, qi: 0, course, results: [], t0: g.t, readyMs: 0, legsWaitMs: 0, mpWaitMs: 0, waveT: 0, idle: null });
  g.legsNeeded = settings.legsMode !== 'upper' && ids.some((id) => M.getMove(id, settings).legs !== 'none');
  renderSessionHead();
  if (g.assist) { beginMove(0); return; }
  setPhase('ready');
}

// 카메라가 없거나 동작 인식이 준비되지 않음: 선생님이 박자대로 하고, 선생님이 자세에 닿을 때마다 하나씩 센다
function enterAssist(msg) {
  const g = game;
  if (!g || g.assist) return;
  g.assist = true;
  g.assistMsg = msg;
  note(msg, 4000);
  if (g.cur && !g.cur.finished) g.cur.variant = 'assist';
  if (g.phase === 'setup' || g.phase === 'step') enterGo();
}

// ── 동작 하나 시작 ──
function beginMove(i) {
  const g = game, id = g.queue[i], base = M.getMove(id, settings);
  const reps = M.repsFor(base, settings, g.course);
  const mv = M.resolveVariant(base, 'full');
  g.qi = i;
  g.cur = { id, base, mv, variant: g.assist ? 'assist' : 'full', reps, target: M.targetFor(mv, reps), count: 0, child: 0, manual: 0,
    t0: g.t, decided: base.legs === 'none', finished: false, legsLostMs: 0,
    practice: settings.practice && (!g.course || i === 0 || settings.practiceInCourse) };
  g.counter = null; g.Bm = null; g.replay = false; g.skipAt = null;
  M.recordPEStart(id);
  enterWatch();
  if (g.assist && g.assistMsg) { note(g.assistMsg, 3500); g.assistMsg = null; }
}
function enterWatch() {
  const g = game, c = g.cur, mv = c.mv, fast = settings.devFast;
  g.coach = new E.Coach(mv, unitOf(mv), 'watch', { watchCycles: fast ? 1 : mv.watchCycles[g.course ? 'course' : 'single'], watchSlow: fast ? 1 : 1.25 });
  setPhase('watch');
  renderMoveUI();
  voice(`${mv.name}! 잘 보세요`);
}
function endWatch() {
  const g = game, c = g.cur;
  if (g.replay || g.assist) return enterGo();
  if (c.decided) return enterSetup(false);
  if (settings.legsMode === 'upper') { applyFallback(); return; }
  if (g.s && g.s.legsOK) { c.decided = true; return enterSetup(false); }
  enterSetup(true); // 다리가 아직 안 보임: 준비 자세에서 3초 더 기다린 뒤 대체
}
// 다리가 안 보일 때 (따라 하기 전): 상체 버전 / 다른 동작 / 건너뛰기
function applyFallback() {
  const g = game, c = g.cur, fb = M.parseFallback(c.base);
  c.decided = true; c.legsPending = false;
  if (!fb) { if (g.phase !== 'setup') enterSetup(false); return; }
  if (fb.type === 'skip') {
    c.variant = 'skip';
    note('다리가 안 보여서 이 동작은 건너뛸게요 🙂', 1500);
    if (g.phase !== 'setup') enterSetup(false);
    g.skipAt = g.t + 1500;
    return;
  }
  if (fb.type === 'move') {
    const sub = M.getMove(fb.id, settings);
    c.mv = M.resolveVariant(sub, 'full'); c.variant = 'sub:' + fb.id; c.target = M.targetFor(c.mv, c.reps);
    note(`다리가 안 보여서 팔로 해요! ${sub.name} ${sub.emoji || ''}`.trim(), 1500);
    enterWatch(); // 대체 동작의 시범부터
    return;
  }
  c.mv = M.resolveVariant(c.base, fb.name); c.variant = fb.name === 'full' ? 'full' : 'upper'; c.target = M.targetFor(c.mv, c.reps);
  note(c.mv.variantLabel || '상체로 세어요', 1500);
  renderMoveUI();
  if (g.phase !== 'setup') enterSetup(false);
}

// ── 준비 자세 (기준 자세 재기) ──
function enterSetup(pending) {
  const g = game;
  baseline.reset();
  g.judge = new E.StepJudge({ holdMs: settings.holdMs, slipMs: settings.slipMs });
  g.cur.legsPending = !!pending; g.cur.legsPendMs = 0;
  setPhase('setup');
  renderMoveUI();
}
function finishSetup(s) {
  const g = game, c = g.cur;
  g.Bm = baseline.get(s ? s.R : null);
  if (g.Bm && g.Bm.T) sensor.tracker.setRef(g.Bm.T);
  if (c.practice && c.mv.steps && c.mv.steps.length && !g.assist) enterStep(0);
  else enterGo();
}

// ── 연습 ──
function enterStep(i) {
  const g = game, mv = g.cur.mv;
  g.si = i; g.stepT = 0; g.stepDoneAt = null; g.replays = 0;
  g.judge = new E.StepJudge({ holdMs: settings.holdMs, slipMs: settings.slipMs });
  g.anim = { from: specOf(mv, mv.ready), t: 0 };
  if (g.phase !== 'step') setPhase('step'); else renderStages();
  renderMoveUI();
  const st = mv.steps[i];
  voice((mv.keys[st.key] || {}).label || '');
}
function nextStep() {
  const g = game;
  if (g.si + 1 < g.cur.mv.steps.length) enterStep(g.si + 1); else enterGo();
}

// ── 시작 3-2-1 ──
function enterGo() {
  const g = game;
  g.goT = 0; g.goN = -1;
  setPhase('go');
  renderMoveUI();
}

// ── 따라 하기 ──
function makeCounter() {
  const c = game.cur, mv = c.mv;
  if (mv.rep.kind === 'hold') {
    const left = Math.max(1, c.target - c.count);
    const perSide = c.count > 0 ? Math.max(1, Math.ceil(left / mv.rep.sides.length)) : c.reps;
    return new E.HoldCounter(mv.rep, { countMs: mv.countMs || 700, perSide });
  }
  return new E.RepCounter(mv.rep, { minGapMs: mv.minGapMs });
}
function makeRepsCoach() {
  const c = game.cur, mv = c.mv;
  const co = new E.Coach(mv, unitOf(mv), game.assist ? 'loop' : 'reps');
  if (!game.assist && c.count > 0) { co.started += c.count; co.kidCount = c.count; }
  return co;
}
function enterReps() {
  const g = game;
  if (!g.counter || !g.replay) { g.counter = makeCounter(); g.repsT = 0; g.sinceCount = 0; g.stallShown = false; }
  g.coach = makeRepsCoach();
  g.replay = false; g.doneAt = null; g.assistHoldMs = 0;
  setPhase('reps');
  renderMoveUI();
}
function midSetFallback() {
  const g = game, c = g.cur, fb = M.parseFallback(c.base);
  c.legsLostMs = 0;
  if (!fb || fb.type === 'skip') { note('다리가 안 보여서 여기까지 할게요 🙂', 1500); finishMove(c.count > 0 ? 'partial' : 'skipped', c.count > 0); return; }
  if (fb.type === 'variant') { c.mv = M.resolveVariant(c.base, fb.name); c.variant = 'upper'; note(c.mv.variantLabel || '상체로 세어요', 1500); }
  else { const sub = M.getMove(fb.id, settings); c.mv = M.resolveVariant(sub, 'full'); c.variant = 'sub:' + fb.id; note(`다리가 안 보여서 팔로 해요! ${sub.name} ${sub.emoji || ''}`.trim(), 1500); }
  g.counter = makeCounter(); g.coach = makeRepsCoach(); g.sinceCount = 0;
  renderMoveUI();
}
function countOne({ side = null, key = null, word = null, manual = false, coachOnly = false } = {}) {
  const g = game, c = g.cur, mv = c.mv;
  c.count++;
  if (!coachOnly) c.child++;
  if (manual) c.manual++;
  g.sinceCount = 0; g.stallShown = false;
  sfx('tok');
  g.flashUntil = g.t + 220;
  // 박자 칸: 센 쪽(alt) 또는 목표 칸에 초록 불 300 ms
  const bk = g.beat;
  g.hitKey = bk && bk.alt && side ? (side === bk.A ? 'a' : side === bk.B ? 'b' : 'b') : 'b';
  g.hitUntil = g.t + 300;
  const n = c.count, T = g.phase === 'test' ? 0 : c.target;
  if (!mv.breath && g.t - g.lastSayT >= 350) {
    const w = word || M.countWord(n - 1);
    voice(T && n === T ? `${w}! 끝!` : T && n === T - 1 ? `${w}! 마지막!` : w);
  }
  g.lastSayT = g.t;
  const wEl = q('#pe-word');
  wEl.textContent = mv.breath ? '🌬️' : (word || M.countWord(n - 1));
  wEl.classList.remove('pop'); void wEl.offsetWidth; wEl.classList.add('pop');
  if (bk && bk.alt && side && g.phase === 'reps') fbNote(side === bk.A ? '반대쪽으로 ➡' : '⬅ 반대쪽으로', 1400);
  if (g.coach && g.phase === 'reps' && !g.assist) g.coach.onKidCount(key, c.count);
  if (T && n >= T && g.doneAt == null) g.doneAt = g.t + 300;
}

// 동작 끝: 결과 기록 → 칭찬(또는 바로 다음)
function finishMove(outcome, praise = true) {
  const g = game, c = g.cur;
  if (!c || c.finished) return;
  c.finished = true;
  if (!outcome) outcome = c.count >= c.target ? 'completed' : c.count > 0 ? 'partial' : 'skipped';
  if (g.assist && outcome !== 'skipped') outcome = 'assist';
  const variant = g.assist ? 'assist' : c.variant;
  const stars = outcome === 'skipped' || outcome === 'assist' ? null : E.starsFor(c.child, c.target);
  const ms = g.t - c.t0;
  const res = { id: c.id, base: c.base, mv: c.mv, variant, count: c.count, target: c.target, stars, outcome, ms, manual: c.manual };
  g.results.push(res);
  M.recordPEResult(c.id, { outcome, variant, stars, reps: c.count, ms, manual: c.manual });
  if (praise && outcome !== 'skipped') enterPraise(res); else nextMove();
}
function nextMove() {
  const g = game;
  if (g.qi + 1 < g.queue.length) beginMove(g.qi + 1); else enterResult();
}
// 20초 넘게 아무도 없음 등: 지금 동작은 부분 완료로 기록하고 결과로
function endSessionEarly() {
  const g = game, c = g.cur;
  if (c && !c.finished) {
    c.finished = true;
    const outcome = g.assist ? 'assist' : c.count > 0 ? 'partial' : 'skipped';
    const stars = outcome === 'partial' ? E.starsFor(c.child, c.target) : null;
    const res = { id: c.id, base: c.base, mv: c.mv, variant: g.assist ? 'assist' : c.variant, count: c.count, target: c.target, stars, outcome, ms: g.t - c.t0, manual: c.manual };
    g.results.push(res);
    M.recordPEResult(c.id, { outcome, variant: res.variant, stars, reps: c.count, ms: res.ms, manual: c.manual });
  }
  g.early = true;
  enterResult();
}

// ── 칭찬 ──
function enterPraise(res) {
  const g = game;
  g.praiseCoach = new E.Coach(M.PRAISE_MOVE, 1, 'loop');
  g.praiseRes = res;
  setPhase('praise');
  renderMoveUI();
  sfx('fanfare');
  voice('잘했어요!');
  particles();
}

// ── 결과 ──
function enterResult() {
  const g = game;
  g.resultMs = 0; g.photoStarMs = 0;
  M.recordPESession({ course: g.course });
  setPhase('result');
  renderResult();
  sfx('finale');
  if (g.course && !g.early) voice('준비운동 끝!');
}
function startPhoto() {
  const g = game;
  if (!g || g.phase !== 'result' || g.photoStarMs > 0 || document.body.classList.contains('photo-taking')) return;
  g.photoStarMs = 1200;
  g.resultMs = 0;
}

// ── 운영자 테스트 (Esc → 체육 표의 '테스트') ──
function enterTest(id) {
  const g = game;
  if (!g || !M.MOVES[id]) return;
  const base = M.getMove(id, settings);
  const fbk = M.parseFallback(base);
  const vname = settings.legsMode === 'upper' && fbk && fbk.type === 'variant' ? fbk.name : 'full';
  const mv = M.resolveVariant(base, vname);
  Object.assign(g, { queue: [id], qi: 0, course: false, results: [], Bm: null, testT: 0, idle: null });
  g.cur = { id, base, mv, variant: vname === 'full' ? 'full' : 'upper', reps: 0, target: 0, count: 0, child: 0, manual: 0, t0: g.t, finished: false, test: true };
  baseline.reset();
  g.counter = mv.rep.kind === 'hold' ? new E.HoldCounter(mv.rep, { countMs: mv.countMs || 700, perSide: 99 }) : new E.RepCounter(mv.rep, { minGapMs: mv.minGapMs });
  renderSessionHead();
  setPhase('test');
  renderMoveUI();
}

// ═════════ 단계별 처리 (틱마다) ═════════
// 사람이 없으면(디바운스 400 ms) 준비·연습·시작·따라 하기 시간과 세기를 멈추고 선생님은 준비 자세. 20초 → 결과
function presentGate(dt, s) {
  const g = game;
  if (g.assist) return true;
  if (!s.present) {
    g.absentMs += dt; g.wasAbsent = true;
    g.want = '카메라 앞에 서 주세요';
    g.demo = specOf(g.cur.mv, g.cur.mv.ready);
    if (g.absentMs >= 20000) endSessionEarly();
    return false;
  }
  if (g.wasAbsent) { g.wasAbsent = false; g.holdUntil = g.t + 800; note('다시 시작!', 800); }
  g.absentMs = 0;
  if (g.t < g.holdUntil) { g.demo = specOf(g.cur.mv, g.cur.mv.ready); return false; }
  return true;
}
function coachProgress(co) {
  let tot = 0, el = 0;
  co.tl.forEach(([, d], i) => { if (Number.isFinite(d)) { tot += d; if (i < co.i) el += d; } });
  if (Number.isFinite(co.tl[co.i][1])) el += Math.min(co.t, co.tl[co.i][1]);
  return tot ? Math.min(1, el / tot) : 0;
}
function onCoachEvents(ev) {
  const mv = game.cur && game.cur.mv;
  for (const e of ev || []) {
    if (e.type !== 'enter') continue;
    sfx('tick');
    if (mv && mv.breath && e.key === 'mid' && (game.phase === 'reps')) voice(e.next === 'up' ? '들이마시고~' : '내쉬고~');
  }
}

const HANDLERS = {
  pick(dt, s) {
    const g = game;
    if (!g.idle) g.idle = new E.Coach(M.IDLE_MOVE, 1, 'loop');
    g.idle.step(dt);
    g.demo = g.idle.spec();
    const sec = settings.autoStartSec, ids = courseIds();
    const auto = sec > 0 && ids.length > 0 && !g.assist;
    if (s.present) g.presentMs += dt; else { g.presentMs = 0; g.autoMs = 0; }
    const armed = auto && g.presentMs >= 2000;
    if (armed) g.autoMs += dt;
    g.heroRing = armed ? Math.min(1, g.autoMs / (sec * 1000)) : null;
    g.heroLeft = armed ? Math.max(1, Math.ceil(sec - g.autoMs / 1000)) : null;
    if (armed && g.autoMs >= sec * 1000) startSession(ids, true);
  },

  ready(dt, s, snap, ov) {
    const g = game;
    g.waveT += dt;
    const absentDemo = () => { const w = g.waveT % 4000; return w < 1400 ? (Math.floor(w / 350) % 2 ? KP.WAVE_B : KP.WAVE_A) : KP.DOWN; };
    g.demo = KP.DOWN;
    updateCamChips(snap, ov);
    if (g.assist) { beginMove(0); return; }
    if (!g.camStarted) { g.instrWant = ['카메라 준비 중…', '잠깐만 기다려 주세요']; return; }
    if (!deps.isMotionReady()) {
      g.mpWaitMs += dt;
      g.instrWant = ['동작 인식 준비 중…', '잠깐만 기다려 주세요'];
      if (g.mpWaitMs >= 15000) { enterAssist('동작 인식이 준비되지 않아서 보면서 따라 해요'); beginMove(0); }
      return;
    }
    if (!s.present) { g.readyMs = 0; g.demo = absentDemo(); g.instrWant = ['카메라 앞에 서 주세요', '바닥 스티커 위에 서요']; return; }
    g.readyMs += dt;
    g.instrWant = ['차렷! 그대로 서 있어요', '선생님처럼 바르게 서요'];
    const legsWait = g.legsNeeded && !s.legsOK;
    if (legsWait) { g.legsWaitMs += dt; g.want = '👣 두세 걸음 뒤로! 발까지 보여야 해요'; }
    g.readyRing = legsWait ? Math.min(1, g.legsWaitMs / 6000) : Math.min(1, g.readyMs / 600);
    if (g.readyMs >= 600 && (!legsWait || g.legsWaitMs >= 6000)) {
      if (legsWait) note('다리가 안 보여서 윗몸 동작으로 할게요', 1500);
      sfx('whistle'); voice('준비 끝!');
      beginMove(0);
    }
  },

  watch(dt, s) {
    const g = game, c = g.cur;
    onCoachEvents(g.coach.step(dt));
    g.demo = g.coach.spec();
    g.watchP = coachProgress(g.coach);
    if (!g.assist && !c.decided && settings.legsMode !== 'upper' && !s.legsOK && s.present) g.want = '👣 두세 걸음 뒤로! 발까지 보여야 해요';
    if (g.coach.done) endWatch();
  },

  setup(dt, s) {
    const g = game, c = g.cur, mv = c.mv, fast = settings.devFast;
    g.demo = specOf(mv, mv.ready);
    if (g.skipAt != null) { if (g.t >= g.skipAt) { g.skipAt = null; finishMove('skipped', false); } return; }
    if (!presentGate(dt, s)) return;
    g.tPhase += dt;
    if (c.legsPending) {
      g.want = '👣 두세 걸음 뒤로! 발까지 보여야 해요';
      if (s.legsOK) { c.legsPending = false; c.decided = true; }
      else if ((c.legsPendMs += dt) >= 3000) { applyFallback(); if (game.phase !== 'setup' || g.skipAt != null) return; }
    }
    const cm = g.cur.mv;
    const rs = cm.readyScore(s.R, s.legsOK);
    if (s.isNew) baseline.offer(s.R, g.t, s.still && rs >= 0.7, s.legsOK);
    const j = g.judge.update(rs, dt, s.ok);
    g.setupP = j.progress;
    if (g.tPhase >= 2500) g.fbWant = cm.readyLabel;
    if (c.legsPending) return;
    let go = j.done && baseline.ready() && (!fast || g.tPhase >= 500);
    if (!go && g.tPhase >= (fast ? 500 : 3000) && baseline.size() >= (fast ? 3 : 6)) { baseline.force(); go = true; }
    if (go || g.tPhase >= (fast ? 2000 : 6000)) finishSetup(s);
  },

  step(dt, s) {
    const g = game, mv = g.cur.mv, st = mv.steps[g.si], key = mv.keys[st.key] || {};
    g.demo = E.blendSpec(g.anim.from, key.spec || [], E.easeInOut(Math.min(1, g.anim.t / 600)));
    if (!presentGate(dt, s)) return;
    g.stepT += dt; g.anim.t += dt;
    if (g.stepDoneAt != null) { g.stepP = 1; if (g.t - g.stepDoneAt >= 500) nextStep(); return; }
    const F = E.relFeatures(s.R, g.Bm, s.legsOK), sc = E.scoreAll(mv.score, F, kSens())[st.score] || { s: 0, why: null };
    g.F = F; g.sc = { [st.score]: sc };
    const j = g.judge.update(sc.s, dt, s.ok);
    g.stepP = j.progress;
    if (j.done) { sfx('ding'); g.stepDoneAt = g.t; fbNote('좋아요! ✨', 600); return; }
    // 2.4 s 동안 안 되면 준비 → 연습 자세를 다시 보여 줌, 5 s에 한 번 더 + 힌트, 9 s면 '같이 해 봐요'로 통과
    if ((g.stepT >= 2400 && g.replays === 0 && j.progress === 0) || (g.stepT >= 5000 && g.replays < 2)) {
      g.replays = g.stepT >= 5000 ? 2 : 1; g.anim = { from: specOf(mv, mv.ready), t: 0 };
    }
    if (g.stepT >= 9000) { fbNote('괜찮아요! 같이 해 봐요', 900); g.stepDoneAt = g.t; return; }
    g.fbWant = sc.s >= 0.85 ? '좋아요! 그대로 ✨' : sc.s >= 0.6 ? '거의 됐어요!' : g.stepT >= 2500 ? M.hintText(sc.why, mv) : '';
  },

  go(dt, s) {
    const g = game, mv = g.cur.mv;
    g.demo = specOf(mv, mv.ready);
    if (!presentGate(dt, s)) return;
    g.goT += dt;
    const D = settings.devFast ? 600 : 1900, stepMs = D * 500 / 1900;
    const n = Math.min(3, Math.floor(g.goT / stepMs));
    if (n > g.goN) {
      g.goN = n;
      if (n < 3) sfx('beep'); else { sfx('whistle'); voice('시작!'); }
    }
    g.goWord = n < 3 ? String(3 - n) : '시작!';
    if (g.goT >= D) enterReps();
  },

  reps(dt, s) {
    const g = game, c = g.cur;
    if (g.doneAt != null) {
      onCoachEvents(g.coach.step(dt, c.count));
      g.demo = g.coach.spec();
      if (g.t >= g.doneAt) finishMove();
      return;
    }
    if (g.assist) return repsAssist(dt);
    if (!presentGate(dt, s)) return;
    const mv = c.mv, hold = mv.rep.kind === 'hold';
    // 다리를 놓침 (전신 버전): 1초 → 배너 + 세기 멈춤, 3초 더 → 대체 버전으로 (센 개수는 그대로)
    let legsHold = false;
    if (mv.needLegs && settings.legsMode !== 'upper') {
      if (!s.legsOK) {
        c.legsLostMs += dt;
        if (c.legsLostMs >= 1000) { legsHold = true; g.want = '👣 두세 걸음 뒤로!'; }
        if (c.legsLostMs >= 4000) { midSetFallback(); return; }
      } else c.legsLostMs = 0;
    }
    const cm = g.cur.mv;
    const F = E.relFeatures(s.R, g.Bm, s.legsOK), sc = E.scoreAll(cm.score, F, kSens());
    g.F = F; g.sc = sc;
    const ok = s.ok && !legsHold;
    const ev = g.counter.update(sc, dt, ok);
    if (s.isNew) { if (!hold && g.counter.restMs >= 400) baseline.refresh(s.R, g.t, s.legsOK); baseline.track(s.R, g.t); }
    for (const e of ev) {
      if (e.type === 'count') countOne({ side: e.side, key: e.key || e.side, word: hold ? M.NUM[(e.n - 1) % 4] : null });
      else if (e.type === 'hint') fbNote(M.hintText(e.key, cm), 1500);
      else if (e.type === 'lenient') fbNote('좋아요, 그 정도면 OK!', 1500);
      else if (e.type === 'switch') { g.coach.onSwitch(); fbNote(M.hintText('other_side', cm), 1500); }
      else if (e.type === 'pause') fbNote(M.hintText('foot_up', cm), 1200);
      if (game.phase !== 'reps' || g.doneAt != null) break;
    }
    if (game.phase !== 'reps') return;
    onCoachEvents(g.coach.step(dt, c.count, hold ? g.counter.expected() : undefined));
    g.demo = g.coach.spec();
    if (ok) { g.repsT += dt; g.sinceCount += dt; }
    if (g.doneAt != null) return;
    // 4초 멈추면 힌트 + '띠링', 12초 못 세거나 40초 지나면 여기까지
    if (g.counter.sinceProgress >= 4000) {
      const exp = g.counter.expected(), why = exp && sc[exp] ? sc[exp].why : null;
      const txt = M.hintText(why, cm);
      if (txt) { g.fbWant = txt; if (!g.stallShown) { g.stallShown = true; sfx('nudge'); } }
    } else g.stallShown = false;
    if (g.sinceCount >= settings.noProgressSec * 1000 || g.repsT >= settings.moveTimeLimitSec * 1000) {
      fbNote('여기까지! 잘했어요', 1600);
      finishMove('partial');
    }
  },

  praise(dt) {
    const g = game;
    g.praiseCoach.step(dt);
    g.demo = g.praiseCoach.spec();
    g.tPhase += dt;
    if (g.tPhase >= (settings.devFast ? 400 : 1600)) nextMove();
  },

  result(dt) {
    const g = game;
    g.demo = KP.STAR;
    const taking = document.body.classList.contains('photo-taking');
    if (g.photoStarMs > 0) {
      g.photoStarMs -= dt;
      if (g.photoStarMs <= 0) { g.photoStarMs = 0; if (deps.onManualPhoto) deps.onManualPhoto(); }
      return;
    }
    if (taking || !(settings.resultTimeoutSec > 0)) { g.resultMs = 0; return; }
    g.resultMs += dt;
    if (g.resultMs >= settings.resultTimeoutSec * 1000) exit();
  },

  test(dt, s) {
    const g = game, c = g.cur, mv = c.mv, hold = mv.rep.kind === 'hold';
    g.demo = specOf(mv, mv.targetKeys[0]);
    if (!s.present) { g.want = '카메라 앞에 서 주세요'; return; }
    if (!g.Bm) {
      if (s.isNew) baseline.offer(s.R, g.t, s.still, s.legsOK);
      g.testT += dt;
      g.fbWant = '기준 자세를 재는 중… 차렷하고 서 주세요';
      if (g.testT >= 1500 && baseline.size() >= 6) { baseline.force(); g.Bm = baseline.get(s.R); if (g.Bm.T) sensor.tracker.setRef(g.Bm.T); }
      return;
    }
    const F = E.relFeatures(s.R, g.Bm, s.legsOK), sc = E.scoreAll(mv.score, F, kSens());
    g.F = F; g.sc = sc;
    const ev = g.counter.update(sc, dt, s.ok);
    if (s.isNew) { if (!hold && g.counter.restMs >= 400) baseline.refresh(s.R, g.t, s.legsOK); baseline.track(s.R, g.t); }
    for (const e of ev) {
      if (e.type === 'count') countOne({ side: e.side, word: hold ? M.NUM[(e.n - 1) % 4] : null });
      else if (e.type === 'hint') fbNote(M.hintText(e.key, mv), 1500);
      else if (e.type === 'lenient') fbNote('좋아요, 그 정도면 OK!', 1500);
    }
  },
};

function repsAssist(dt) {
  const g = game, c = g.cur, mv = c.mv, hold = mv.rep.kind === 'hold';
  const ev = g.coach.step(dt);
  g.demo = g.coach.spec();
  onCoachEvents(ev);
  if (hold) {
    if (mv.targetKeys.includes(g.coach.key)) {
      g.assistHoldMs += dt;
      const per = (mv.countMs || 700) * (settings.tempo || 1);
      while (g.assistHoldMs >= per && g.doneAt == null) { g.assistHoldMs -= per; countOne({ coachOnly: true, word: M.NUM[c.count % 3] }); }
    } else g.assistHoldMs = 0;
  } else for (const e of ev) if (e.target && g.doneAt == null) countOne({ coachOnly: true });
}

// ═════════ 버튼·단축키 ═════════
function exit() {
  const f = deps && deps.onExit;
  forceStop();
  if (f) f();
}
function onSkip() {
  const g = game, ph = g.phase;
  if (ph === 'watch') endWatch();
  else if (ph === 'setup' || ph === 'step' || ph === 'go') operatorPass();
  else if (ph === 'reps') finishMove(null, false);
  else if (ph === 'test') enterPick();
}
function onReplay() {
  const g = game;
  if (g.phase === 'reps' && g.doneAt == null && !g.cur.finished) { g.replay = true; enterWatch(); }
  else if (g.phase === 'test') { baseline.reset(); g.Bm = null; g.testT = 0; g.counter = g.cur.mv.rep.kind === 'hold' ? new E.HoldCounter(g.cur.mv.rep, { countMs: g.cur.mv.countMs || 700, perSide: 99 }) : new E.RepCounter(g.cur.mv.rep, { minGapMs: g.cur.mv.minGapMs }); }
}
// Space / 건너뛰기: 운영자 도움 — 준비·연습 통과, 따라 하기는 +1 (manual로 기록)
function operatorPass() {
  const g = game, ph = g.phase;
  if (ph === 'watch') endWatch();
  else if (ph === 'setup') { if (g.skipAt != null) return; if (g.cur.legsPending) { applyFallback(); if (game.phase !== 'setup' || g.skipAt != null) return; } if (baseline.size()) baseline.force(); finishSetup(g.s); }
  else if (ph === 'step') { if (g.stepDoneAt == null) { sfx('ding'); g.stepDoneAt = g.t; } }
  else if (ph === 'go') enterReps();
  else if (ph === 'reps' && g.doneAt == null) countOne({ manual: true });
  else if (ph === 'test') countOne({ manual: true });
}
function onKey(e) {
  if (!active || !game || deps.isPaused()) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const g = game, ph = g.phase, k = e.key;
  if (ph === 'pick' && k === 'Enter') startSession(courseIds(), true);
  else if (ph === 'pick' && /^[0-9]$/.test(k)) {
    const tiles = [...root.querySelectorAll('.pe-tile')], i = k === '0' ? 9 : Number(k) - 1;
    if (!tiles[i]) return;
    startSession([tiles[i].dataset.move], false);
  } else if (k === ' ' && ph !== 'pick' && ph !== 'result') operatorPass();
  else if ((k === 'n' || k === 'N') && PLAY.has(ph) && ph !== 'test' && g.cur) {
    if (ph === 'ready') return;
    if (ph === 'praise') nextMove(); else finishMove(null, false);
  } else if ((k === 'r' || k === 'R') && PLAY.has(ph) && ph !== 'ready' && ph !== 'test' && ph !== 'praise' && g.cur) beginMove(g.qi);
  else if ((k === 'b' || k === 'B') && ph !== 'pick') enterPick();
  else if (k === 'm' || k === 'M') { muted = !muted; Sound.setMuted(muted); note(muted ? '🔇 소리 끔' : '🔊 소리 켬', 1200); }
  else return;
  e.preventDefault();
}
function onRootClick(e) {
  const b = e.target.closest && e.target.closest('button');
  if (!b || !game || !active || deps.isPaused()) return;
  if (b.classList.contains('pe-tile')) startSession([b.dataset.move], false);
  else if (b.classList.contains('pe-hero')) startSession(courseIds(), true);
  else if (b.id === 'pe-home' || b.id === 'pe-pick-home' || b.id === 'pe-next') exit();
  else if (b.id === 'pe-skip') onSkip();
  else if (b.id === 'pe-replay') onReplay();
  else if (b.id === 'pe-photo') startPhoto();
  else if (b.id === 'pe-again') enterPick();
  else return;
  try { b.blur(); } catch (err) { /* 무시 */ }
}
function onDocClick(e) {
  const t = e.target.closest && e.target.closest('[data-pe-test],[data-pe-reset-stats]');
  if (!t) return;
  if (t.hasAttribute('data-pe-reset-stats')) {
    M.resetPEStats();
    const sec = t.closest('.pe-admin');
    if (sec) sec.outerHTML = adminSection.html();
    return;
  }
  if (!active || !game) return;
  const close = document.querySelector('#mm-admin-close');
  if (close) close.click();
  enterTest(t.dataset.peTest);
}

// ═════════ 화면 그리기 ═════════
const RING_R = 52, RING_C = 2 * Math.PI * RING_R;
const track = `<circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="12"/>`;
function arcPath(a0, a1) {
  const p = (a) => { const r = (a - 90) * Math.PI / 180; return [60 + RING_R * Math.cos(r), 60 + RING_R * Math.sin(r)]; };
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${RING_R} ${RING_R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function ringArc(p, color, width = 12) {
  const v = Math.max(0, Math.min(1, p));
  return track + `<circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${(v * RING_C).toFixed(1)} ${RING_C.toFixed(1)}" transform="rotate(-90 60 60)"/>`;
}
function ringSegs(n, filled, color = '#27c47b') {
  if (!(n > 0)) return track;
  if (n === 1) return track + (filled ? `<circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="${color}" stroke-width="12"/>` : '');
  const span = 360 / n, gapDeg = n > 12 ? 3 : 4;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a0 = i * span + gapDeg / 2, a1 = (i + 1) * span - gapDeg / 2;
    out += `<path d="${arcPath(a0, a1)}" fill="none" stroke="${i < filled ? color : 'rgba(255,255,255,0.16)'}" stroke-width="12"/>`;
  }
  return out;
}
let ringKey = '';
function setRing(key, html) { if (key === ringKey) return; ringKey = key; q('.pe-ring svg').innerHTML = html; }
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const setHTML = (el, h) => { if (el && el.__h !== h) { el.__h = h; el.innerHTML = h; } };
const show = (el, on) => { if (el) el.classList.toggle('hidden', !on); };

function buildDOM() {
  root = document.createElement('div');
  root.id = 'pe-root';
  root.className = 'hidden';
  root.dataset.phase = 'pick';
  root.innerHTML = `
    <div id="pe-particles"></div>
    <section class="pe-pick" aria-labelledby="pe-pick-title">
      <header class="pe-pick-head"><p class="pe-eyebrow">PE CLASS · 체육 동작 배우기</p>
        <h2 id="pe-pick-title">선생님처럼<br>따라 해 볼까요?</h2><p class="pe-pick-sub">하고 싶은 동작을 손가락으로 콕!</p></header>
      <div class="pe-panel">
        <button class="pe-hero" data-course="warmup"><span class="pe-hero-txt"><b>🏃 준비운동 코스</b><span class="pe-hero-sub"></span></span>
          <span class="pe-hero-figs"></span><span class="pe-hero-ring"><svg viewBox="0 0 120 120"></svg><i>시작</i></span></button>
        <div class="pe-label-row"><p class="pe-label">한 가지만 배우기</p><button id="pe-pick-home" class="pe-chip">← 처음으로</button></div>
        <div class="pe-tiles"></div>
      </div>
    </section>
    <section class="pe-play" aria-labelledby="pe-name">
      <header class="pe-head"><div class="pe-headrow"><p class="pe-eyebrow">PE CLASS · 체육 동작 배우기</p><button id="pe-home" class="pe-chip">← 처음으로</button></div>
        <div class="pe-title"><span class="pe-icon"></span><h2 id="pe-name"></h2><span class="pe-dots"></span></div>
        <div class="pe-stages"><span data-stage="watch">① 보기</span><span data-stage="step">② 연습</span><span data-stage="reps">③ 따라 하기</span><span class="pe-minichip hidden">그림 선생님을 봐요 👉</span></div></header>
      <div class="pe-coach">
        <div id="pe-banner" class="pe-banner hidden" role="status" aria-live="polite"></div>
        <div class="pe-coach-top"><span id="pe-eyebrow2"></span><span class="pe-coach-btns"><button id="pe-replay" class="pe-chip">↺ 다시 보기</button><button id="pe-skip" class="pe-chip">건너뛰기 ▶</button></span></div>
        <div class="pe-instrrow"><div class="pe-mini hidden"></div><div class="pe-instr"><b id="pe-instr"></b><small id="pe-sub"></small></div></div>
        <div class="pe-countrow">
          <div class="pe-ring"><svg viewBox="0 0 120 120"></svg><div class="pe-ring-c"><b id="pe-word"></b>
            <span class="pe-num"><span id="pe-count">0</span> / <span id="pe-target">0</span></span></div></div>
          <div class="pe-side"><div class="pe-beat"><span class="pe-key a"></span><span class="pe-track"><i class="pe-ball"></i><span class="pe-holddots"></span></span><span class="pe-key b"></span></div>
            <p id="pe-fb" aria-live="polite"></p><span id="pe-variant" class="pe-variant hidden"></span></div>
        </div>
        <pre id="pe-debug" class="hidden"></pre>
      </div>
    </section>
    <section class="pe-result" aria-labelledby="pe-result-title"><div class="pe-panel pe-result-card">
      <p class="pe-eyebrow">PE CLASS · 오늘의 체육</p>
      <div class="pe-medal"></div><p class="pe-medal-name"></p><h2 id="pe-result-title"></h2><ul id="pe-result-rows"></ul><p id="pe-result-total"></p>
      <div class="pe-result-btns"><button id="pe-photo">📸 기념사진</button><button id="pe-again">🔁 다른 동작</button>
        <button id="pe-next"><svg class="pe-next-ring" viewBox="0 0 120 120"></svg><span>▶ 다음 친구</span></button></div>
    </div></section>`;
  document.body.appendChild(root);
  camGuide = document.createElement('div');
  camGuide.className = 'pe-cam-guide hidden';
  camGuide.innerHTML = '<div class="pe-cam-body"></div><div class="pe-cam-floor"></div><div class="pe-cam-chips"><span data-part="head">머리</span><span data-part="hands">손</span><span data-part="knees">무릎</span><span data-part="feet">발</span></div>';
  const wrap = document.querySelector('#cam-wrap');
  if (wrap) wrap.appendChild(camGuide);
  root.addEventListener('click', onRootClick);
  root.addEventListener('pointerdown', () => { if (game) { game.autoMs = 0; game.resultMs = 0; } }, { passive: true });
}

function clearUI() {
  if (!root) return;
  ringKey = '';
  for (const sel of ['#pe-fb', '#pe-instr', '#pe-sub', '#pe-word', '#pe-eyebrow2', '#pe-result-title', '#pe-result-total', '.pe-medal-name']) setText(q(sel), '');
  q('#pe-result-rows').innerHTML = ''; q('.pe-medal').innerHTML = ''; q('#pe-particles').innerHTML = '';
  const b = q('#pe-banner'); b.textContent = ''; b.classList.add('hidden');
  show(q('#pe-variant'), false); show(q('.pe-mini'), false); show(q('.pe-minichip'), false);
  const d = q('#pe-debug'); d.textContent = ''; d.classList.add('hidden');
  q('#pe-count').textContent = '0'; q('#pe-target').textContent = '0';
  for (const k of root.querySelectorAll('.pe-key')) k.classList.remove('hit');
  for (const el of root.querySelectorAll('[data-stage]')) el.className = '';
  root.dataset.phase = 'pick';
  for (const k of ['move', 'step', 'reps', 'target', 'variant', 'legs', 'present', 'coach']) delete root.dataset[k];
  document.body.classList.remove('pe-flash');
}

function tileFig(mv) { return peFigure(specOf(mv, mv.targetKeys[0])); }
function renderPicker() {
  const ids = M.enabledMoves(settings), course = courseIds();
  const tiles = ids.map((id, i) => {
    const base = M.getMove(id, settings), mv = M.resolveVariant(base, 'full'), th = theme(base), reps = M.repsFor(base, settings, false);
    const meta = `${'⭐'.repeat(base.diff || 1)} · ${base.kind === 'hold' ? `쪽마다 ${reps}번` : reps + '번'}`;
    return `<button class="pe-tile" data-move="${id}" style="--t1:${th.bg1};--t2:${th.bg2};--ta:${th.accent};--tk:${th.ink}" aria-label="${i + 1}. ${base.name}">
      <span class="pe-tile-fig">${tileFig(mv)}</span><b>${base.short || base.name}</b><small>${meta}</small>${base.legs !== 'none' ? '<span class="pe-badge">🦶 전신</span>' : ''}</button>`;
  }).join('');
  setHTML(q('.pe-tiles'), tiles);
  q('.pe-tiles').style.setProperty('--rows', String(Math.max(1, Math.ceil(ids.length / 5))));
  const hero = q('.pe-hero');
  show(hero, course.length > 0);
  hero.style.display = course.length ? '' : 'none';
  setHTML(q('.pe-hero-figs'), course.map((id) => tileFig(M.resolveVariant(M.getMove(id, settings), 'full'))).join(''));
  setText(q('.pe-hero-sub'), `${course.length}가지 동작 · 약 ${Math.max(1, Math.round(course.length * 20 / 60))}분 · 처음이면 여기!`);
  q('.pe-hero-ring svg').innerHTML = '';
  game.heroKey = '';
}
function renderSessionHead() {
  const g = game, first = M.getMove(g.queue[0], settings);
  const mv = M.resolveVariant(first, 'full');
  setText(q('#pe-name'), g.course ? '🏃 준비운동 코스' : first.name);
  setHTML(q('.pe-icon'), tileFig(mv));
  q('.pe-icon').style.color = theme(first).accent;
  renderDots();
}
function renderDots() {
  const g = game;
  setHTML(q('.pe-dots'), g.course && g.queue.length > 1 ? g.queue.map((_, i) => `<i class="${i < g.qi ? 'done' : i === g.qi && g.phase !== 'ready' ? 'on' : ''}"></i>`).join('') : '');
}
// 단계 칩: 지금 = 초록 채움, 끝남 = 초록 글자 ✓, 안 쓰는 단계 = 숨김
function renderStages() {
  const g = game;
  if (!g) return;
  const ph = g.phase, c = g.cur;
  const usesStep = !!(c && c.practice && c.mv.steps && c.mv.steps.length && !g.assist);
  const stOf = { watch: 'watch', setup: 'watch', step: 'step', go: 'reps', reps: 'reps', praise: 'done' }[ph];
  const order = ['watch', 'step', 'reps'], cur = stOf === 'done' ? 3 : order.indexOf(stOf);
  for (const el of root.querySelectorAll('[data-stage]')) {
    const st = el.dataset.stage, i = order.indexOf(st);
    const hidden = (st === 'step' && !usesStep) || !c || ph === 'ready' || ph === 'test';
    el.className = hidden ? 'hidden' : i === cur && !(ph === 'setup' && st === 'watch') ? 'on' : i < cur || (ph === 'setup' && st === 'watch') ? 'done' : '';
    const label = { watch: '① 보기', step: '② 연습', reps: '③ 따라 하기' }[st];
    setText(el, el.className === 'done' ? label + ' ✓' : label);
  }
}
function beatOf(mv) {
  const alt = mv.rep.kind === 'alt' || (mv.rep.kind === 'hold' && mv.rep.sides.length > 1);
  if (alt) {
    const T = mv.targetKeys;
    const A = T.find((k) => /left|L$/.test(k)) || T[0], B = T.find((k) => /right|R$/.test(k)) || T[1] || T[0];
    return { alt: true, A, B };
  }
  const restKey = mv.keys[mv.rep.rest] ? mv.rep.rest : (mv.cycle.find(([k]) => !mv.targetKeys.includes(k)) || [mv.ready])[0];
  return { alt: false, A: restKey, B: mv.targetKeys[0] };
}
function beatPos(bk, mv, key) {
  if (key === bk.B) return 1;
  if (key === bk.A) return 0;
  if (!bk.alt && mv.targetKeys.includes(key)) return 1;
  return 0.5;
}
// 동작이 바뀔 때마다: 머리말·안내 문구·박자 칸·변형 칩·미니 코치
function renderMoveUI() {
  const g = game, c = g.cur;
  if (!c) return;
  const mv = c.mv, th = theme(mv);
  setText(q('#pe-name'), mv.name);
  setHTML(q('.pe-icon'), tileFig(mv));
  q('.pe-icon').style.color = th.accent;
  renderDots(); renderStages();
  g.beat = beatOf(mv);
  setHTML(q('.pe-key.a'), peFigure(specOf(mv, g.beat.A)));
  setHTML(q('.pe-key.b'), peFigure(specOf(mv, g.beat.B)));
  const vtxt = g.assist ? '보며 따라 해요 👀' : c.variant === 'upper' ? (mv.variantLabel || '상체로 세어요') : c.variant.startsWith('sub:') ? `대신: ${mv.name}` : '';
  setText(q('#pe-variant'), vtxt); show(q('#pe-variant'), !!vtxt);
  const caps = deps.avatarCaps();
  const mini = (caps.mode === 'standee') || (caps.picture && caps.custom && caps.mode === 'upper' && c.base.legs !== 'none');
  show(q('.pe-mini'), mini); show(q('.pe-minichip'), mini);
  g.mini = mini;
  const hold = mv.rep.kind === 'hold';
  q('.pe-beat').classList.toggle('hold', hold);
}

// 매 틱: 바뀐 것만 다시 씀
function renderLive() {
  const g = game, ph = g.phase, c = g.cur, mv = c && c.mv;
  // 배너 (코치 카드 안, 무대 위에는 절대 안 나옴)
  const bannerTxt = g.note && g.t < g.note.until ? g.note.text : g.want || '';
  const b = q('#pe-banner'); setText(b, bannerTxt); show(b, !!bannerTxt);
  document.body.classList.toggle('pe-flash', g.t < g.flashUntil);
  if (ph === 'pick') {
    const key = g.heroRing == null ? 'off' : (g.heroRing * 100).toFixed(0);
    if (key !== g.heroKey) {
      g.heroKey = key;
      q('.pe-hero-ring svg').innerHTML = g.heroRing == null ? '' : `<circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(g.heroRing * RING_C).toFixed(1)} ${RING_C.toFixed(1)}" transform="rotate(-90 60 60)"/>`;
      const course = courseIds();
      setText(q('.pe-hero-sub'), g.heroLeft ? `${g.heroLeft}초 뒤 자동으로 시작해요` : `${course.length}가지 동작 · 약 ${Math.max(1, Math.round(course.length * 20 / 60))}분 · 처음이면 여기!`);
    }
    return;
  }
  if (ph === 'result') { renderResultLive(); return; }
  // ── 코치 카드 ──
  let eyebrow = '', instr = '', sub = '', word = '', ringHTML = null, rk = '', showNum = false, fb = '';
  const skipLbl = ph === 'reps' ? '⏭ 다음' : ph === 'test' ? '끝내기' : '건너뛰기 ▶';
  setText(q('#pe-skip'), skipLbl);
  setText(q('#pe-replay'), ph === 'test' ? '↺ 기준 다시' : '↺ 다시 보기');
  show(q('#pe-replay'), (ph === 'reps' && !g.assist) || ph === 'test');
  show(q('#pe-skip'), ph !== 'ready' && ph !== 'praise');
  if (ph === 'ready') {
    const [a, s2] = g.instrWant || ['차렷! 그대로 서 있어요', ''];
    eyebrow = '준비'; instr = a; sub = s2; word = '차렷';
    const p = g.readyRing || 0; ringHTML = ringArc(p, g.want ? '#ffc83d' : '#ffffff', 8); rk = 'r' + p.toFixed(2) + g.want;
  } else if (ph === 'watch') {
    eyebrow = '잘 보세요 👀'; instr = mv.text.main; sub = mv.text.sub; word = '👀';
    ringHTML = ringArc(g.watchP || 0, '#ffffff', 6); rk = 'w' + (g.watchP || 0).toFixed(2);
  } else if (ph === 'setup') {
    eyebrow = '준비 자세'; instr = mv.readyLabel; sub = mv.safety || ''; word = '준비';
    ringHTML = ringArc(g.setupP || 0, '#27c47b'); rk = 's' + (g.setupP || 0).toFixed(2);
  } else if (ph === 'step') {
    const n = mv.steps.length, st = mv.steps[g.si], lab = (mv.keys[st.key] || {}).label || '';
    eyebrow = `연습 ${['①', '②', '③', '④'][g.si] || g.si + 1}/${['①', '②', '③', '④'][n - 1] || n}`; instr = lab; sub = mv.text.sub;
    word = g.stepDoneAt != null ? '✓' : `${g.si + 1}/${n}`;
    ringHTML = ringArc(g.stepP || 0, '#27c47b'); rk = 'p' + g.si + (g.stepP || 0).toFixed(2);
    fb = g.fbWant || '';
  } else if (ph === 'go') {
    eyebrow = '③ 따라 하기'; instr = mv.text.main; sub = mv.safety || mv.text.sub; word = g.goWord || '3';
    ringHTML = ringSegs(c.target, 0); rk = 'g' + c.target;
    showNum = true;
  } else if (ph === 'reps' || ph === 'test') {
    eyebrow = ph === 'test' ? `테스트 · ${mv.name}` : g.assist ? '보며 따라 해요 👀' : '선생님과 같이!';
    instr = ph === 'test' ? ((mv.keys[mv.targetKeys[0]] || {}).label || mv.name) : mv.text.main; sub = mv.text.sub;
    word = null; // countOne이 직접 씀
    ringHTML = ringSegs(ph === 'test' ? Math.max(1, Math.min(16, c.count || 1)) : c.target, ph === 'test' ? (c.count ? Math.min(16, c.count) : 0) : c.count);
    rk = 'c' + c.target + '/' + c.count;
    showNum = true;
    fb = g.fbWant || '';
  } else if (ph === 'praise') {
    const res = g.praiseRes || {}, st = res.stars || 0;
    const partial = res.outcome === 'partial';
    eyebrow = '칭찬'; instr = partial ? '여기까지! 잘했어요' : st >= 3 ? '완벽해요!' : st === 2 ? '잘했어요!' : '멋지게 해냈어요!';
    const nxt = g.course && g.qi + 1 < g.queue.length ? M.getMove(g.queue[g.qi + 1], settings) : null;
    sub = (res.base ? res.base.praise : '') + (nxt ? `  ·  다음: ${nxt.name}` : '');
    word = res.outcome === 'assist' ? '👀' : '⭐'.repeat(Math.max(1, st));
    ringHTML = ringSegs(1, 1, '#ffc83d'); rk = 'gold';
    showNum = true;
  }
  setText(q('#pe-eyebrow2'), eyebrow);
  setText(q('#pe-instr'), instr);
  setText(q('#pe-sub'), sub || '');
  if (word != null) setText(q('#pe-word'), word);
  if (ringHTML != null) setRing(rk, ringHTML);
  q('.pe-num').classList.toggle('hidden', !showNum);
  if (c) { setText(q('#pe-count'), String(c.count)); setText(q('#pe-target'), ph === 'test' ? '∞' : String(c.target)); }
  const fbTxt = g.fbNote && g.t < g.fbNote.until ? g.fbNote.text : fb;
  setText(q('#pe-fb'), fbTxt || '');
  // 박자 공: 선생님 시범 진행과 함께 움직임
  if (c && g.beat) {
    const co = ph === 'praise' ? null : g.coach;
    let pos = 0;
    if ((ph === 'watch' || ph === 'reps') && co) { const f = co.frame(); pos = beatPos(g.beat, mv, f.a) + (beatPos(g.beat, mv, f.b) - beatPos(g.beat, mv, f.a)) * f.u; }
    else if (ph === 'step') { const st = mv.steps[g.si]; pos = beatPos(g.beat, mv, st.key); }
    q('.pe-ball').style.left = (pos * 100).toFixed(1) + '%';
    const hit = g.t < g.hitUntil ? g.hitKey : null;
    q('.pe-key.a').classList.toggle('hit', hit === 'a');
    q('.pe-key.b').classList.toggle('hit', hit === 'b');
    if (mv.rep.kind === 'hold' && g.counter && g.counter.counts) {
      const side = g.counter.expected(), per = g.counter.perSide > 20 ? 3 : g.counter.perSide, done = side ? g.counter.counts[side] || 0 : per;
      setHTML(q('.pe-holddots'), Array.from({ length: per }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join(''));
    }
  }
  if (g.mini && g.demo && g.t - (g.miniT || 0) >= 33) { g.miniT = g.t; q('.pe-mini').innerHTML = peFigure(g.demo); q('.pe-mini').style.color = theme(mv).accent; }
}

function renderResult() {
  const g = game, R = g.results;
  const done = R.filter((r) => r.outcome !== 'skipped');
  const courseDone = g.course && !g.early && R.length === g.queue.length && R.every((r) => r.outcome === 'completed' || r.outcome === 'assist');
  const allFull = R.length > 0 && R.every((r) => r.outcome === 'completed' || r.outcome === 'assist') && !g.early;
  let medalSpec = KP.STAR, medalName = '참 잘했어요 👏';
  if (courseDone) { medalName = '준비운동 마스터 🏅'; }
  else if (!g.course && done.length) { const r = done[0]; medalSpec = specOf(r.mv, r.mv.targetKeys[0]); medalName = r.base.badge; }
  else if (done.length) { const r = done.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0))[0]; medalSpec = specOf(r.mv, r.mv.targetKeys[0]); medalName = r.base.badge; }
  q('.pe-medal').innerHTML = peMedal(medalSpec, { size: 120 });
  setText(q('.pe-medal-name'), medalName);
  g.resultTitle = courseDone ? '준비운동 끝! 몸이 따뜻해졌어요 🔥' : !g.course && allFull && R[0] ? `${R[0].base.name} 완료! 🎉` : '여기까지 잘했어요! 👏';
  setText(q('#pe-result-title'), g.resultTitle);
  q('#pe-result-rows').innerHTML = R.map((r) => {
    const th = theme(r.base);
    const stars = r.outcome === 'skipped' ? '<span class="pe-skipped">건너뜀</span>' : r.outcome === 'assist' ? '<span>👀</span>' : `<span class="pe-stars">${'★'.repeat(r.stars || 1)}<span class="off">${'★'.repeat(3 - (r.stars || 1))}</span></span>`;
    const chip = r.variant === 'upper' ? '<span class="pe-chip-s">상체</span>' : String(r.variant).startsWith('sub:') ? `<span class="pe-chip-s">대신: ${r.mv.name}</span>` : '';
    return `<li><span class="pe-row-fig" style="color:${th.accent}">${tileFig(r.mv)}</span><b>${r.base.short || r.base.name}</b>${chip}${stars}<span class="pe-row-n">${r.count}/${r.target}</span></li>`;
  }).join('') + (R.some((r) => r.outcome === 'assist') ? '<li class="pe-row-note">보며 따라 했어요 👀</li>' : '');
  const total = R.reduce((a, r) => a + (r.count || 0), 0), sec = Math.round((g.t - (g.t0 || 0)) / 1000);
  q('#pe-result-total').innerHTML = `오늘 움직인 횟수 <b>${total}번</b> · ${Math.floor(sec / 60)}분 ${sec % 60}초`;
  show(q('#pe-next .pe-next-ring'), settings.resultTimeoutSec > 0);
  g.nextKey = '';
}
function renderResultLive() {
  const g = game;
  setText(q('#pe-result-title'), g.photoStarMs > 0 ? '⭐ 별 포즈로 찍어요!' : g.resultTitle || '');
  const T = settings.resultTimeoutSec * 1000;
  if (T > 0) {
    const p = 1 - Math.min(1, g.resultMs / T), key = p.toFixed(2);
    if (key !== g.nextKey) { g.nextKey = key; q('#pe-next .pe-next-ring').innerHTML = `<circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="${(p * 2 * Math.PI * 54).toFixed(1)} 400" transform="rotate(-90 60 60)"/>`; }
  }
}

function updateCamChips(snap, ov) {
  const vis = (snap && snap.vis) || {};
  const inside = (i) => !!(ov && ov[i] && ov[i].x >= 0.03 && ov[i].x <= 0.97 && ov[i].y >= 0.03 && ov[i].y <= 0.97);
  const okp = (k, i) => (vis[k] || 0) >= 0.6 && inside(i);
  const parts = { head: okp('NOSE', 0), hands: okp('L_WR', 15) && okp('R_WR', 16), knees: okp('L_KNEE', 25) && okp('R_KNEE', 26), feet: okp('L_ANK', 27) && okp('R_ANK', 28) };
  const on = !!(snap && snap.present);
  for (const el of camGuide.querySelectorAll('[data-part]')) el.classList.toggle('ok', on && !!parts[el.dataset.part]);
}

// 칭찬 파티클: 링에서 위·오른쪽으로만 (무대 쪽으로 날아가지 않게)
const PARTICLES = ['⭐', '✨', '🌟', '💚', '💫', '⭐'];
function particles() {
  const box = q('#pe-particles'), ring = q('.pe-ring');
  const r = ring && ring.getBoundingClientRect();
  if (!r || !r.width) return;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span');
    s.className = 'pe-particle';
    s.textContent = PARTICLES[i % PARTICLES.length];
    const ang = (-110 + (90 * i) / 11) * Math.PI / 180, d = 50 + (i % 4) * 22;
    s.style.left = cx + 'px'; s.style.top = cy + 'px';
    s.style.setProperty('--dx', (Math.cos(ang) * d).toFixed(0) + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * d).toFixed(0) + 'px');
    s.style.fontSize = (16 + (i % 3) * 7) + 'px';
    s.style.animationDelay = (i % 5) * 0.03 + 's';
    box.appendChild(s);
    setTimeout(() => s.remove(), 1400); // 파티클 지우기만 setTimeout
  }
}

// 시험 훅 (항상): #pe-root dataset
function writeDataset() {
  const g = game, c = g.cur, s = g.s || {}, d = root.dataset;
  const set = (k, v) => { if (d[k] !== v) d[k] = v; };
  set('phase', g.phase);
  set('move', c ? c.id : '');
  set('step', g.phase === 'step' ? String(g.si + 1) : '');
  set('reps', c ? String(c.count) : '0');
  set('target', c ? String(c.target) : '0');
  set('variant', c ? (g.assist ? 'assist' : c.variant) : '');
  set('legs', s.legsOK ? '1' : '0');
  set('present', s.present ? '1' : '0');
  const co = g.phase === 'pick' ? g.idle : g.phase === 'praise' ? g.praiseCoach : g.coach;
  set('coach', co && (g.phase === 'watch' || g.phase === 'reps' || g.phase === 'pick' || g.phase === 'praise') ? String(co.key) : '');
  if (debugOn) window.__pe = { F: g.F, scores: g.sc, legsOK: s.legsOK, counter: g.counter, coachKey: d.coach, Bm: g.Bm, s };
}

function renderDebug() {
  const g = game, el = q('#pe-debug'), s = g.s || {};
  if (!(debugOn || g.phase === 'test')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const f = (v) => (v == null ? '-' : typeof v === 'number' ? (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)) : typeof v === 'object' ? '·' : String(v));
  const F = g.F || {}, sc = g.sc || {}, ct = g.counter;
  const lines = [
    `phase ${g.phase} · move ${g.cur ? g.cur.mv.id : '-'} · ${g.cur ? g.cur.variant : '-'} · present ${s.present ? 1 : 0} ok ${s.ok ? 1 : 0} still ${s.still ? 1 : 0} legs ${s.legsOK ? 1 : 0}`,
    `Bm ${g.Bm ? `T ${f(g.Bm.T)} reach ${f(g.Bm.reach)} wide ${g.Bm.wide ? 1 : 0} hipOK ${g.Bm.ovHipOK ? 1 : 0}` : '(기준 없음)'}`,
    'F ' + ['elevL', 'elevR', 'upL', 'upR', 'reachRelL', 'reachRelR', 'wrElL', 'wrElR', 'lean', 'tilt', 'legOutL', 'legOutR', 'kneeUpL', 'kneeUpR', 'footUpL', 'footUpR', 'depth', 'drop', 'ovScale', 'gap'].map((k) => `${k} ${f(F[k])}`).join(' · '),
    'score ' + Object.entries(sc).map(([k, v]) => `${k} ${f(v.s)}${v.why ? `(${v.why})` : ''}`).join(' · '),
    ct ? `counter ${ct.state ?? ct.side ?? '-'} count ${ct.count} E ${f(ct.E)} rest ${f(ct.restMs)} since ${f(ct.sinceProgress)}` : '',
  ];
  el.textContent = lines.filter(Boolean).join('\n');
}

// ═════════ 운영자 설정 (Esc) — 미션 저장은 [data-set]/[data-en]만 읽으므로 체육은 data-peset/data-pe-* 를 쓴다 ═════════
export const adminSection = {
  html() {
    const s = M.loadPESettings(), stats = M.loadPEStats();
    const sel = (label, key, opts) => `<label class="mm-fld">${label}<select data-peset="${key}">${opts.map(([v, t]) => `<option value="${v}"${String(s[key]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const num = (label, key, min, max, step = 1) => `<label class="mm-fld">${label}<input type="number" data-peset="${key}" value="${s[key]}" min="${min}" max="${max}" step="${step}"></label>`;
    const chk = (label, key) => `<label class="mm-chk"><input type="checkbox" data-peset="${key}" ${s[key] ? 'checked' : ''}> ${label}</label>`;
    const f1 = (v, d = 1) => (v == null ? '-' : v.toFixed(d));
    const rows = M.CATALOG_ORDER.map((id) => {
      const mv = M.getMove(id, s), [lo, hi] = M.repsRange(id), st = M.summarizePEStats(stats[id]);
      const reps = typeof s.reps === 'number' ? s.reps : M.repsFor(mv, s, false);
      return `<tr><td><input type="checkbox" data-pe-en="${id}" ${s.enabled[id] !== false ? 'checked' : ''}></td>
        <td><input type="checkbox" data-pe-course="${id}" ${s.course[id] ? 'checked' : ''}></td>
        <td>${mv.name}</td><td><input type="number" class="pe-reps-in" data-pe-reps="${id}" value="${reps}" min="${lo}" max="${hi}">${id === 'tree' ? ' 쪽마다' : ''}</td>
        <td>${mv.legs === 'none' ? '' : '🦶'}</td>
        <td>${st.started}</td><td>${st.completed}</td><td>${f1(st.avgStars)}</td><td>${st.altPct == null ? '-' : st.altPct + '%'}</td><td>${st.avgSec == null ? '-' : f1(st.avgSec, 0) + 's'}</td>
        <td>${active ? `<button class="mm-mini" data-pe-test="${id}">테스트</button>` : '<span class="mm-help">체육 화면에서</span>'}</td></tr>`;
    }).join('');
    const vi = Sound.voiceInfo();
    return `
    <div class="mm-admin-sec pe-admin">
      <h3>체육 동작 배우기 설정</h3>
      <div class="mm-fields">
        ${sel('인식 기준', 'sensitivity', [['easy', '너그럽게 (어린 학생)'], ['normal', '보통'], ['strict', '엄격하게']])}
        ${sel('시범·따라 하기 속도', 'tempo', [['1.25', '느리게'], ['1', '보통'], ['0.85', '빠르게']])}
        ${sel('팔 벌려 뛰기 방식', 'jumpMode', [['step', '콩콩 (한 발씩, 조용히)'], ['jump', '점프']])}
        ${sel('다리 동작', 'legsMode', [['auto', '다리가 보이면 다리로 (자동)'], ['upper', '항상 상체 버전 (좁은 장소)']])}
        ${num('연습 유지시간(ms)', 'holdMs', 200, 1000, 50)}
        ${num('놓침 허용(ms)', 'slipMs', 0, 1000, 50)}
        ${num('자동 시작(초, 0=끔)', 'autoStartSec', 0, 60)}
        ${num('결과 자동 종료(초, 0=끔)', 'resultTimeoutSec', 0, 120)}
        ${num('동작 시간 제한(초)', 'moveTimeLimitSec', 15, 90)}
        ${num('멈추면 끝내기(초)', 'noProgressSec', 6, 40)}
        <label class="mm-fld">음량<input type="range" data-peset="volume" min="0" max="100" value="${s.volume}"></label>
      </div>
      ${chk('연습 단계 (한 가지 동작)', 'practice')}
      ${chk('코스에서도 모든 동작 연습', 'practiceInCourse')}
      ${chk('효과음', 'sfx')}${chk('구령 음성', 'voice')}${chk('박자 소리', 'beatTick')}
      <p class="mm-help">구령 음성: ${vi ? vi : '한국어 음성 없음 — 효과음만 (Windows 설정 → 시간 및 언어 → 음성 → 한국어 음성 추가)'}</p>
      <div class="mm-table-wrap pe-table-wrap"><table class="mm-table">
        <thead><tr><th>켜기</th><th>코스</th><th>이름</th><th>횟수</th><th>🦶</th><th>시작</th><th>완료</th><th>평균 별</th><th>상체·대체</th><th>평균 시간</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="mm-admin-btns"><button class="btn btn-ghost" data-pe-reset-stats>체육 통계 초기화</button></div>
      <p class="mm-help">코스 순서는 목록 순서이고 숨쉬기는 항상 마지막이에요. 횟수는 한 가지 동작과 코스 모두에 쓰여요(기본값이면 코스는 더 짧게).</p>
      <p class="mm-help">체육 중 단축키 — Enter: 코스 시작 · 1~9, 0: 동작 고르기 · Space: 도와주기(준비·연습 통과 / +1) · N: 다음 동작 · R: 이 동작 다시 · B: 고르기 화면 · M: 소리 끄기/켜기</p>
      <p class="mm-help">바닥 스티커: 카메라는 가슴 높이(1.0~1.2 m), 키 130 cm 학생이 손을 들어도 머리부터 발까지 다 보이는 곳(웹캠에 따라 약 2.4~3.1 m)에 붙이고, 1.5 m × 1.5 m를 비워 두세요.</p>
    </div>`;
  },
  save(container) {
    const cur = M.loadPESettings();
    const ns = { ...cur, enabled: { ...cur.enabled }, course: { ...cur.course }, reps: {} };
    container.querySelectorAll('[data-peset]').forEach((el) => { ns[el.dataset.peset] = el.type === 'checkbox' ? el.checked : el.value; });
    container.querySelectorAll('[data-pe-en]').forEach((el) => { ns.enabled[el.dataset.peEn] = el.checked; });
    container.querySelectorAll('[data-pe-course]').forEach((el) => { ns.course[el.dataset.peCourse] = el.checked; });
    container.querySelectorAll('[data-pe-reps]').forEach((el) => { ns.reps[el.dataset.peReps] = el.value; });
    settings = M.savePESettings(ns);
    Sound.setVolume(settings.volume);
    if (active && game && game.phase === 'pick') renderPicker();
  },
  reset() {
    settings = M.resetPESettings();
    Sound.setVolume(settings.volume);
    if (active && game && game.phase === 'pick') renderPicker();
  },
};
