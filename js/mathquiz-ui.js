// 수학 퀴즈 UI: 단계 선택 → 손 드는 법 안내 → (연습 문제) → 문제 → 결과
// 판정: 정답이 있는 쪽 손을 어깨 위로 들고 잠깐 유지하면 그 답을 고른 것으로 본다.
// 화면은 거울 모드라 학생의 왼손 = 화면 왼쪽 답, 오른손 = 화면 오른쪽 답.
import * as Quiz from './mathquiz.js';
import { demoFor } from './missionvisuals.js';

const HOWTO_MS = 4000;   // 손 드는 법 안내 (사람이 보이면 그때부터)
const REVEAL_MS = 2400;  // 정답 공개 후 다음 문제까지
const SLIP_MS = 250;     // 든 손이 순간 인식 안 돼도 유지로 봄
const RELEASE_MS = 250;  // 새 문제는 손을 이만큼 내린 뒤부터 답을 받음
const DEMO_SWAP_MS = 1100;

let deps = null;   // { getSnapshot, onExit, onManualPhoto, isPaused }
let root = null;
let active = false;
let settings = Quiz.loadQuizSettings();
let game = null;
let lastTick = 0;

export function isActive() { return active; }

export function init(d) {
  deps = d;
  buildDOM();
  bindKeys();
}

// ── 시작 / 종료 ──
export function start() {
  settings = Quiz.loadQuizSettings();
  active = true;
  lastTick = 0;
  root.classList.remove('hidden');
  document.body.classList.add('quiz-on');
  showLevelPicker();
}

// 결과 화면 "다음 참가자" → 처음 화면으로
function endGame() {
  forceStop();
  if (deps.onExit) deps.onExit();
}

// onExit 콜백 없이 즉시 중단 (홈으로 나갈 때 재귀 방지)
export function forceStop() {
  active = false;
  game = null;
  document.body.classList.remove('quiz-on');
  if (root) {
    root.classList.add('hidden');
    setBanner('');
  }
}

// ── 아바타 시범: 안내 중엔 왼손/오른손 번갈아 들기, 정답 공개 땐 기쁨/놀람 ──
export function getDemoPose() {
  if (!active || !game) return null;
  if (game.phase === 'howto') return demoFor(howtoSide() === 0 ? 'left_up' : 'right_up');
  if (game.phase === 'reveal') return demoFor(game.lastOk ? 'both_up' : 'surprise');
  return null; // 문제 풀 때는 학생을 그대로 따라 함
}
function howtoSide() { return Math.floor(performance.now() / DEMO_SWAP_MS) % 2; }

// ── 매 프레임 (main 렌더 루프에서 호출) ──
export function tick(nowMs) {
  if (!active || !game) return;
  const dt = lastTick ? Math.min(nowMs - lastTick, 100) : 16;
  lastTick = nowMs;
  if (deps.isPaused && deps.isPaused()) return; // 운영자 설정 열려 있으면 멈춤
  const snap = deps.getSnapshot();
  if (game.phase === 'howto') updateHowto(snap, nowMs);
  else if (game.phase === 'question') updateQuestion(snap, dt);
}

// ═════════ 1. 단계 선택 ═════════
function showLevelPicker() {
  game = { phase: 'level' };
  setPhase('level');
  setBanner('');
}

function chooseLevel(levelId) {
  if (!game || game.phase !== 'level') return;
  const level = Quiz.LEVELS[levelId] || Quiz.LEVELS.easy;
  const questions = Quiz.buildQuiz(level.id, settings.questionCount);
  const queue = settings.practice ? [Quiz.practiceQuestion(), ...questions] : questions;
  game = { phase: 'howto', level, queue, pos: 0, total: questions.length, correct: 0, results: [], readyStart: null };
  q('#qz-level-name').textContent = `${level.emoji} ${level.label}`;
  renderDots();
  setPhase('howto');
  q('#qz-num').textContent = '준비';
  q('#qz-question').innerHTML = '정답이 있는 쪽 손을 번쩍! ✋<small>1초 동안 들고 있으면 답이 골라져요</small>';
  q('#qz-c0').textContent = '왼쪽 답';
  q('#qz-c1').textContent = '오른쪽 답';
  root.classList.remove('qz-ox');
  clearChoiceState();
  setTimer(1);
  q('#qz-timer-text').textContent = '';
  setHint('');
}

// ═════════ 2. 손 드는 법 안내 ═════════
function updateHowto(snap, nowMs) {
  // 아바타 시범과 같은 쪽 카드를 반짝여서 "이 손 = 이 답"을 보여줌
  const side = howtoSide();
  for (const i of [0, 1]) choiceEl(i).classList.toggle('demo', i === side);

  if (!snap.present) {
    game.readyStart = null;
    setBanner(snap.calibrated === false ? '잠깐 그대로 서 주세요…' : '카메라 앞에 서 주세요 (두세 걸음 뒤로)');
    q('#qz-timer-text').textContent = '';
    return;
  }
  setBanner('');
  if (game.readyStart == null) game.readyStart = nowMs;
  const remain = HOWTO_MS - (nowMs - game.readyStart);
  if (remain > 0) {
    q('#qz-timer-text').textContent = `${Math.ceil(remain / 1000)}초 후 시작!`;
    setTimer(remain / HOWTO_MS);
  } else {
    showQuestion();
  }
}

// ═════════ 3. 문제 ═════════
function current() { return game.queue[game.pos]; }

function showQuestion() {
  const cur = current();
  Object.assign(game, { phase: 'question', elapsed: 0, cand: -1, holdMs: 0, slipMs: 0, armed: false, releaseMs: 0 });
  setPhase('question');
  const realNo = game.pos - (game.queue.length - game.total) + 1;
  q('#qz-num').textContent = cur.practice ? '연습 문제' : `문제 ${realNo} / ${game.total}`;
  q('#qz-practice-tag').style.display = cur.practice ? '' : 'none';
  q('#qz-question').innerHTML = cur.text;
  q('#qz-c0').innerHTML = cur.choices[0];
  q('#qz-c1').innerHTML = cur.choices[1];
  root.classList.toggle('qz-ox', !!cur.ox);
  clearChoiceState();
  setTimer(1);
  q('#qz-timer-text').textContent = `${settings.timeLimitSec}초`;
  setHint('');
  const play = q('#qz-play');
  play.classList.remove('pop'); void play.offsetWidth; play.classList.add('pop');
}

function updateQuestion(snap, dt) {
  if (!snap.present) {
    // 사람이 안 보이면 타이머도 멈춤 (불이익 없음)
    setBanner(snap.calibrated === false ? '잠깐 그대로 서 주세요…' : '카메라 앞에 서 주세요');
    setPick(-1, 0);
    return;
  }
  setBanner('');
  game.elapsed += dt;

  const side = readHands(snap);
  if (!game.armed) {
    // 이전에 든 손으로 바로 답이 골라지지 않도록, 한 번 손을 내린 뒤부터 받음
    if (side === -1) { game.releaseMs += dt; if (game.releaseMs >= RELEASE_MS) game.armed = true; }
    else game.releaseMs = 0;
    setHint(game.armed ? '' : '손을 내리고 문제를 읽어요 👇');
  } else {
    if (side === 0 || side === 1) {
      if (side === game.cand) { game.holdMs += dt; game.slipMs = 0; }
      else { game.cand = side; game.holdMs = dt; game.slipMs = 0; }
    } else if (game.cand !== -1) {
      game.slipMs += dt;
      if (game.slipMs > SLIP_MS) { game.cand = -1; game.holdMs = 0; }
    }
    setHint(side === 'both' ? '한 손만 들어요! ✋' : '');
  }
  setPick(game.cand, Math.min(1, game.holdMs / settings.holdMs));
  if (game.cand !== -1 && game.holdMs >= settings.holdMs) return answer(game.cand);

  const limit = settings.timeLimitSec * 1000;
  const remain = Math.max(0, limit - game.elapsed);
  setTimer(remain / limit);
  q('#qz-timer-text').textContent = `${Math.ceil(remain / 1000)}초`;
  if (remain <= 0) answer(null);
}

// 손 들기 판정: 손목이 어깨보다 위면 1점, 아래로 내려올수록 0점
// (손목이 화면 밖이라 안 보이면 팔꿈치가 어깨 위인지로 대신 판단)
function raiseScore(snap, side) {
  const P = snap.pts, V = snap.vis, sw = snap.shoulderW || 0.3;
  const sh = P[side + '_SH'];
  if (!sh) return 0;
  const ramp = (v, thr, margin) => (v >= thr ? 1 : Math.max(0, 1 - (thr - v) / margin));
  const wr = P[side + '_WR'], el = P[side + '_EL'];
  if (wr && (V[side + '_WR'] || 0) >= 0.35) return ramp((wr.y - sh.y) / sw, 0.25, 0.4);
  if (el && (V[side + '_EL'] || 0) >= 0.4) return ramp((el.y - sh.y) / sw, 0.15, 0.3);
  return 0;
}
// → 0(왼손=왼쪽 답) | 1(오른손=오른쪽 답) | 'both' | -1(안 듦/애매)
function readHands(snap) {
  const l = raiseScore(snap, 'L'), r = raiseScore(snap, 'R');
  if (l >= 0.85 && r >= 0.85) return 'both';
  if (l >= 0.85 && r < 0.5) return 0;
  if (r >= 0.85 && l < 0.5) return 1;
  return -1;
}

// ── 답 확정 → 정답 공개 ──
// choice: 0 | 1 | null(시간 초과)
function answer(choice) {
  if (!game || game.phase !== 'question') return;
  const cur = current();
  const ok = choice === cur.answer;
  game.phase = 'reveal';
  game.lastOk = ok;
  if (!cur.practice) {
    if (ok) game.correct++;
    game.results.push({ q: cur, choice, ok });
    renderDots();
  }
  setPhase('reveal');
  setPick(-1, 0);
  setHint('');
  if (choice != null) choiceEl(choice).classList.add('picked', ok ? 'right' : 'wrong');
  choiceEl(cur.answer).classList.add('answer');

  let title;
  if (cur.practice) title = ok ? '잘했어요! 이렇게 답하면 돼요 👍' : (choice == null ? '정답 쪽 손을 번쩍 들면 돼요!' : '괜찮아요! 이제 진짜 시작해요');
  else title = ok ? '정답! ⭕' : (choice == null ? '시간 초과! ⏰' : '아쉬워요! ❌');
  const rv = q('#qz-reveal');
  rv.className = 'qz-reveal show ' + (ok ? 'ok' : 'no');
  q('#qz-reveal-title').textContent = title;
  q('#qz-reveal-explain').innerHTML = cur.explain;
  if (ok) celebrate(choiceEl(cur.answer));

  later(REVEAL_MS, nextQuestion);
}

function nextQuestion() {
  q('#qz-reveal').className = 'qz-reveal';
  game.pos++;
  if (game.pos >= game.queue.length) showResult();
  else showQuestion();
}

// 운영자: 건너뛰기 (오답 처리 없이 기록만 '건너뜀')
function skipQuestion() {
  if (!game || game.phase !== 'question') return;
  const cur = current();
  game.phase = 'reveal';
  if (!cur.practice) { game.results.push({ q: cur, choice: null, ok: false, skipped: true }); renderDots(); }
  nextQuestion();
}

// ═════════ 4. 결과 ═════════
function showResult() {
  game.phase = 'result';
  setPhase('result');
  setBanner('');
  const passed = game.correct >= Math.min(settings.passCount, game.total);
  const rc = q('#qz-result');
  rc.classList.toggle('pass', passed);
  q('#qz-result-title').textContent = passed ? '수학 천재 인증! 🎉' : '도전 완료! 👏';
  q('#qz-result-sub').textContent = passed ? '선물을 받아가세요!' : '멋지게 참여했어요!';
  q('#qz-result-score').textContent = `${game.level.emoji} ${game.level.label} 단계 · ${game.total}문제 중 ${game.correct}문제 정답`;
  q('#qz-review').innerHTML = game.results.map((r) => {
    const ans = r.q.ox ? (r.q.answer === 0 ? '⭕ 맞는 식' : '❌ 틀린 식') : r.q.choices[r.q.answer];
    const mark = r.ok ? '✅' : r.skipped ? '⏭️' : '❌';
    return `<li class="${r.ok ? 'ok' : 'no'}"><span class="qz-rv-mark">${mark}</span><span class="qz-rv-q">${r.q.text.replace(/<br>/g, ' ')}</span><span class="qz-rv-a">정답 <b>${ans}</b></span></li>`;
  }).join('');
  if (passed) celebrate(null);
}

// ═════════ 화면 헬퍼 ═════════
function q(sel) { return root.querySelector(sel); }
function choiceEl(i) { return root.querySelector(`.qz-choice[data-choice="${i}"]`); }

function setPhase(phase) { root.dataset.phase = phase; }

// 게임이 바뀌었으면(종료·재시작) 예약된 진행을 취소
function later(ms, fn) {
  const g = game;
  setTimeout(() => { if (active && game === g) fn(); }, ms);
}

function clearChoiceState() {
  for (const i of [0, 1]) {
    const el = choiceEl(i);
    el.classList.remove('cand', 'picked', 'right', 'wrong', 'answer', 'demo');
    el.style.setProperty('--fill', '0');
  }
}

// 지금 들고 있는 쪽 카드에 게이지 채우기
function setPick(side, progress) {
  for (const i of [0, 1]) {
    const on = i === side;
    const el = choiceEl(i);
    el.classList.toggle('cand', on);
    el.style.setProperty('--fill', on ? progress.toFixed(3) : '0');
  }
}

function setTimer(frac) {
  const fill = q('#qz-timer-fill');
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
  fill.classList.toggle('low', game && game.phase === 'question' && frac < 0.3);
}

function setHint(txt) {
  const h = q('#qz-hint');
  h.textContent = txt;
  h.classList.toggle('show', !!txt);
}

function setBanner(txt) {
  const b = q('#qz-banner');
  b.textContent = txt;
  b.style.display = txt ? 'block' : 'none';
}

// 진행 점: 맞힘(초록) · 틀림(빨강) · 남은 문제(빈 칸)
function renderDots() {
  let html = '';
  for (let i = 0; i < game.total; i++) {
    const r = game.results[i];
    html += `<span class="qz-dot ${r ? (r.ok ? 'ok' : 'no') : ''}"></span>`;
  }
  q('#qz-dots').innerHTML = html;
  q('#qz-correct').textContent = `${game.correct}`;
}

// 정답 축하: 카드(또는 화면 가운데)에서 별·하트가 터짐
const PARTICLES = ['⭐', '💯', '✨', '🌟', '💙', '🎉'];
function celebrate(fromEl) {
  const box = fromEl ? fromEl.getBoundingClientRect() : { left: innerWidth / 2 - 1, top: innerHeight * 0.4, width: 2, height: 2 };
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  const layer = q('#qz-confetti');
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.className = 'qz-particle';
    s.textContent = PARTICLES[i % PARTICLES.length];
    const ang = (i / 18) * Math.PI * 2;
    const dist = 70 + (i % 4) * 30;
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * dist - 50 + 'px');
    s.style.fontSize = 20 + (i % 3) * 10 + 'px';
    s.style.animationDelay = (i % 5) * 0.03 + 's';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}

// ── 운영자 설정 패널(Esc)에 들어갈 "수학 퀴즈 설정" 칸 ──
export const adminSection = {
  html() {
    const s = Quiz.loadQuizSettings();
    const num = (label, key, min, max, step) =>
      `<label class="mm-fld">${label}<input type="number" data-qset="${key}" value="${s[key]}" min="${min}" max="${max}" step="${step || 1}"></label>`;
    return `
    <div class="mm-admin-sec">
      <h3>수학 퀴즈 설정</h3>
      <div class="mm-fields">
        ${num('문제 개수', 'questionCount', 1, 10)}
        ${num('선물 기준 정답 수', 'passCount', 1, 10)}
        ${num('문제당 제한시간(초)', 'timeLimitSec', 3, 30)}
        ${num('손 유지시간(ms)', 'holdMs', 300, 2000, 100)}
      </div>
      <label class="mm-chk"><input type="checkbox" data-qset="practice" ${s.practice ? 'checked' : ''}> 시작 전 연습 문제 1개 보여주기</label>
      <p class="mm-help">퀴즈 중 단축키 — ←/→: 왼쪽/오른쪽 답 고르기 · N: 문제 건너뛰기</p>
    </div>`;
  },
  save(container) {
    const ns = {};
    container.querySelectorAll('[data-qset]').forEach((el) => {
      ns[el.dataset.qset] = el.type === 'checkbox' ? el.checked : Number(el.value);
    });
    settings = Quiz.saveQuizSettings(ns);
  },
  reset() { settings = Quiz.resetQuizSettings(); },
};

// ── DOM ──
function buildDOM() {
  const levelBtns = Object.values(Quiz.LEVELS).map((lv) => `
    <button class="qz-level-btn" data-level="${lv.id}">
      <span class="qz-level-emoji">${lv.emoji}</span>
      <span class="qz-level-label">${lv.label}</span>
      <span class="qz-level-grade">${lv.grade}</span>
      <span class="qz-level-desc">${lv.desc}</span>
    </button>`).join('');

  root = document.createElement('div');
  root.id = 'quiz-root';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="qz-confetti"></div>
    <div id="qz-banner" class="qz-banner" role="status" aria-live="polite"></div>

    <section id="qz-level" class="qz-level" aria-labelledby="qz-level-title">
      <span class="qz-eyebrow">MATH QUIZ</span>
      <h2 id="qz-level-title">몸으로 푸는 수학 퀴즈</h2>
      <p class="qz-level-sub">정답이 있는 쪽 손을 들어 답해요. 단계를 골라 주세요!</p>
      <div class="qz-level-grid">${levelBtns}</div>
      <button class="btn btn-text qz-level-back" id="qz-level-back">← 처음으로</button>
    </section>

    <section id="qz-play" class="qz-play" aria-labelledby="qz-question">
      <header class="qz-top">
        <div class="qz-meta">
          <span class="qz-eyebrow">MATH QUIZ · <b id="qz-level-name"></b></span>
          <span id="qz-num" class="qz-num"></span>
          <span id="qz-practice-tag" class="qz-practice-tag" style="display:none">점수에 들어가지 않아요</span>
        </div>
        <div class="qz-score">
          <span class="qz-score-label">정답</span>
          <strong id="qz-correct">0</strong>
          <span id="qz-dots" class="qz-dots"></span>
        </div>
        <button class="qz-home" id="qz-home">← 처음으로</button>
      </header>
      <div class="qz-question-wrap">
        <div id="qz-question" class="qz-question" aria-live="polite"></div>
        <div class="qz-timer"><div id="qz-timer-fill" class="qz-timer-fill"></div></div>
        <div id="qz-timer-text" class="qz-timer-text"></div>
        <div id="qz-hint" class="qz-hint" aria-live="polite"></div>
      </div>
      <button class="qz-choice" data-choice="0">
        <span class="qz-hand"><span class="qz-hand-icon flip">✋</span>왼손</span>
        <span id="qz-c0" class="qz-choice-val"></span>
      </button>
      <button class="qz-choice" data-choice="1">
        <span class="qz-hand">오른손<span class="qz-hand-icon">✋</span></span>
        <span id="qz-c1" class="qz-choice-val"></span>
      </button>
      <div id="qz-reveal" class="qz-reveal" aria-live="assertive">
        <div id="qz-reveal-title" class="qz-reveal-title"></div>
        <div id="qz-reveal-explain" class="qz-reveal-explain"></div>
      </div>
    </section>

    <section id="qz-result" class="qz-result" aria-labelledby="qz-result-title">
      <div class="qz-result-card">
        <span class="qz-eyebrow">RESULT</span>
        <div id="qz-result-title" class="qz-result-title"></div>
        <div id="qz-result-sub" class="qz-result-sub"></div>
        <div id="qz-result-score" class="qz-result-score"></div>
        <ol id="qz-review" class="qz-review"></ol>
        <div class="qz-result-btns">
          <button class="btn btn-primary btn-lg" id="qz-photo">📷 기념사진</button>
          <button class="btn btn-ghost btn-lg" id="qz-again">다른 단계 도전</button>
          <button class="btn btn-ghost btn-lg" id="qz-next">다음 참가자</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('.qz-level-btn').forEach((b) => b.addEventListener('click', () => chooseLevel(b.dataset.level)));
  q('#qz-level-back').addEventListener('click', endGame);
  q('#qz-home').addEventListener('click', endGame);
  // 손 인식이 어려운 경우를 위한 터치/클릭 답하기
  for (const i of [0, 1]) choiceEl(i).addEventListener('click', () => { if (game && game.phase === 'question') answer(i); });
  q('#qz-photo').addEventListener('click', () => { if (deps.onManualPhoto) deps.onManualPhoto(); });
  q('#qz-again').addEventListener('click', showLevelPicker);
  q('#qz-next').addEventListener('click', endGame);
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (!active || !game) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (deps.isPaused && deps.isPaused()) return;
    if (e.key === 'ArrowLeft' && game.phase === 'question') { e.preventDefault(); answer(0); }
    else if (e.key === 'ArrowRight' && game.phase === 'question') { e.preventDefault(); answer(1); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); skipQuestion(); }
  });
}
