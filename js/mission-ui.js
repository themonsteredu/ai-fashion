// 랜덤 포즈 미션 UI: 학생 진행 화면 · 결과 · 운영자 패널 · 포즈 테스트 모드 · 단축키
import { POSE_DEFS, POSE_BY_ID, CATEGORY_LABELS, DIFFICULTY_LABELS } from './poses.js';
import * as Engine from './mission.js';

let deps = null;      // { getSnapshot, capturePhoto, onExit, onManualPhoto }
let root = null;      // 오버레이 루트
let settings, enabled;
let game = null;      // 진행 중 게임 상태
let judge = null;
let lastTick = 0;
let active = false;
let testMode = null;  // 포즈 테스트 대상 pose

export function isActive() { return active; }

export function init(d) {
  deps = d;
  settings = Engine.loadSettings();
  enabled = Engine.loadEnabled();
  buildDOM();
  bindKeys();
}

// 매 프레임 (main 렌더 루프에서 호출)
export function tick(nowMs) {
  if (!active) return;
  const dt = lastTick ? Math.min(nowMs - lastTick, 100) : 16;
  lastTick = nowMs;

  const snap = deps.getSnapshot();

  if (testMode) { updateTestMode(snap); return; }
  if (!game || game.phase !== 'playing') { if (game && game.phase === 'ready') updateReady(snap); return; }

  // 전신 필요 포즈인데 전신이 안 보이면 안내 후 타이머 보류
  const cur = game.poses[game.index];
  if (cur.needsFullBody && snap.present && !snap.fullBody) {
    setBanner('조금 뒤로 이동해 전신이 보이게 서주세요');
    return;
  }
  if (!snap.present) {
    setBanner(snap.calibrated === false ? '잠깐 그대로 서 주세요…' : '카메라 앞에 서 주세요');
    return;
  }
  setBanner('');

  const r = judge.update(snap, dt, nowMs);
  setGauge(r.progress, r.state);

  if (r.state === 'success') return finishMission('success', r.elapsed);
  if (r.state === 'timeout') return onTimeout();
}

// ── 게임 시작 ──
export function start() {
  settings = Engine.loadSettings();
  enabled = Engine.loadEnabled();
  const set = Engine.buildMissionSet(settings, enabled);
  game = { poses: set.poses, index: 0, success: 0, retriesLeft: settings.retries, phase: 'intro', results: [] };
  active = true;
  lastTick = 0;
  root.classList.remove('hidden');
  root.classList.add('student');
  document.body.classList.add('mission-on'); // 학생 전체화면: 운영 컨트롤 숨김
  showMissionCard();
  q('#mm-warn').textContent = set.warn || '';
  q('#mm-warn').style.display = set.warn ? 'block' : 'none';
}

const READY_MS = 3000; // 준비 카운트다운 3-2-1 (자리 잡을 시간)

function showMissionCard() {
  const cur = game.poses[game.index];
  game.phase = 'ready';
  judge = null;
  q('#mm-num').textContent = `미션 ${game.index + 1} / ${game.poses.length}`;
  q('#mm-score').textContent = `⭐ ${game.success}개 성공`;
  q('#mm-title').textContent = cur.name;
  q('#mm-instruction').textContent = cur.shortInstruction;
  q('#mm-hint').textContent = cur.hintText || '';
  q('#mm-silhouette').textContent = poseEmoji(cur);
  setGauge(0, 'waiting');
  setBanner('');
  q('#mm-feedback').className = 'mm-feedback';
  q('#mm-feedback').textContent = '';
  q('#mm-countdown').classList.add('hidden');
  // 사람이 화면에 보이기 시작하면 그때부터 카운트다운 시작
  game.readyStart = null;
}
// 준비 단계: 사람이 보이면 3-2-1 카운트다운 후 시작 (자리 잡을 시간 확보)
function updateReady(snap) {
  const cd = q('#mm-countdown');
  if (!snap.present) {
    // 아직 안 보이면 카운트다운 보류 (기다려 줌)
    game.readyStart = null;
    cd.classList.add('hidden');
    setBanner(snap.calibrated === false ? '잠깐 그대로 서 주세요…' : '카메라 앞에 서 주세요');
    return;
  }
  setBanner('');
  if (game.readyStart == null) game.readyStart = performance.now();
  const remain = READY_MS - (performance.now() - game.readyStart);
  if (remain > 0) {
    const n = Math.ceil(remain / 1000);
    cd.textContent = n <= 0 ? '시작!' : String(n);
    cd.classList.remove('hidden');
  } else {
    cd.textContent = '시작!';
    setTimeout(() => q('#mm-countdown').classList.add('hidden'), 350);
    beginPlaying();
  }
}
function beginPlaying() {
  game.phase = 'playing';
  judge = new Engine.MissionJudge(game.poses[game.index], settings);
  game.playStart = performance.now();
}

function onTimeout() {
  game.phase = 'feedback'; // 판정 루프 재진입 방지
  judge = null;
  const cur = game.poses[game.index];
  if (game.retriesLeft > 0) {
    game.retriesLeft--;
    showFeedback('한 번 더 해볼까요?', 'retry');
    setTimeout(() => { if (active && game) { beginPlaying(); q('#mm-feedback').textContent = ''; } }, 1400);
  } else {
    Engine.recordResult(cur.id, 'timeout', 0);
    game.results.push({ id: cur.id, outcome: 'timeout' });
    showFeedback('도전 완료! 다음 포즈로 가볼까요?', 'retry');
    setTimeout(() => nextMission(), 1400);
  }
}

function finishMission(outcome, elapsed) {
  game.phase = 'feedback'; // ★ 성공 후 매 프레임 재판정되어 성공이 여러 번 찍히던 버그 방지
  judge = null;
  const cur = game.poses[game.index];
  Engine.recordResult(cur.id, outcome, elapsed);
  game.results.push({ id: cur.id, outcome });
  game.success++;
  celebrate();
  showFeedback('성공! 잘했어요! ⭐', 'success');
  q('#mm-score').textContent = `⭐ ${game.success}개 성공`;
  setTimeout(() => nextMission(), 1200);
}

// 운영자: 현재 미션 강제 성공 (준비/진행 중 모두 허용, 중복 방지)
export function forceSuccess() {
  if (!active || !game || (game.phase !== 'playing' && game.phase !== 'ready')) return;
  game.phase = 'feedback';
  judge = null;
  const cur = game.poses[game.index];
  Engine.recordResult(cur.id, 'manual', 0);
  game.results.push({ id: cur.id, outcome: 'manual' });
  game.success++;
  celebrate();
  showFeedback('성공! ⭐', 'success');
  q('#mm-score').textContent = `⭐ ${game.success}개 성공`;
  q('#mm-countdown').classList.add('hidden');
  setTimeout(() => nextMission(), 900);
}
export function restartMission() {
  if (!active || !game) return;
  game.retriesLeft = settings.retries;
  showMissionCard();
}
export function skipMission() {
  if (!active || !game) return;
  game.phase = 'feedback';
  judge = null;
  const cur = game.poses[game.index];
  game.results.push({ id: cur.id, outcome: 'skip' });
  nextMission();
}

function nextMission() {
  game.index++;
  q('#mm-feedback').textContent = '';
  game.retriesLeft = settings.retries;
  if (game.index >= game.poses.length) return showResult();
  showMissionCard();
}

// ── 결과 화면 ──
function showResult() {
  game.phase = 'result';
  const passed = game.success >= settings.passCount;
  q('#mm-card').style.display = 'none';
  const rc = q('#mm-result');
  rc.style.display = 'flex';
  rc.className = 'mm-result ' + (passed ? 'pass' : 'done');
  q('#mm-result-title').textContent = passed ? '미션 성공! 🎉' : '도전 완료! 👏';
  q('#mm-result-sub').textContent = passed ? '선물을 받아가세요!' : '멋지게 참여했어요!';
  q('#mm-result-score').textContent = `총 ${game.poses.length}개 미션 중 ${game.success}개 성공`;
  if (passed) celebrate();
}

// ── 피드백 / 게이지 / 배너 ──
function setGauge(p, state) {
  const fill = q('#mm-gauge-fill');
  fill.style.width = Math.round(p * 100) + '%';
  fill.className = 'mm-gauge-fill' + (state === 'holding' ? ' holding' : '');
}
function setBanner(txt) {
  const b = q('#mm-banner');
  b.textContent = txt;
  b.style.display = txt ? 'block' : 'none';
}
function showFeedback(txt, kind) {
  const f = q('#mm-feedback');
  f.textContent = txt;
  f.className = 'mm-feedback show ' + kind;
}
function celebrate() {
  const c = q('#mm-confetti');
  c.classList.remove('play'); void c.offsetWidth; c.classList.add('play');
}

function poseEmoji(p) {
  const map = {
    both_up: '🙌', left_up: '🙋', right_up: '🙋', both_side: '🛫', airplane: '🛫',
    superhero: '🦸', cheer: '📣', point_left: '👈', point_right: '👉', point_up: '☝️',
    overhead_heart: '🫶', v_left: '✌️', v_right: '✌️', v_both: '✌️', thumbsup_left: '👍',
    thumbsup_right: '👍', wave_left: '👋', wave_right: '👋', wave_both: '🙌',
    hands_hip: '🧍', attention: '🧍', robot: '🤖', surprise: '😲', chin_rest: '🤔',
  };
  return map[p.id] || '🕺';
}

// ── 종료 (다음 참가자) ──
export function endGame() {
  active = false;
  game = null; judge = null; testMode = null;
  document.body.classList.remove('mission-on');
  root.classList.add('hidden');
  q('#mm-result').style.display = 'none';
  q('#mm-card').style.display = '';
  if (deps.onExit) deps.onExit();
}

// ═════════ 운영자 패널 ═════════
function openAdmin() {
  buildAdminBody();
  q('#mm-admin').classList.remove('hidden');
}
function closeAdmin() { q('#mm-admin').classList.add('hidden'); }

function buildAdminBody() {
  settings = Engine.loadSettings();
  enabled = Engine.loadEnabled();
  const s = settings;
  const stats = Engine.loadStats();

  const numField = (label, key, min, max, step) =>
    `<label class="mm-fld">${label}<input type="number" data-set="${key}" value="${s[key]}" min="${min}" max="${max}" step="${step || 1}"></label>`;

  let rows = '';
  for (const p of POSE_DEFS) {
    const rate = Engine.poseSuccessRate(p.id);
    const flag = Engine.reliabilityFlag(p.id);
    const st = stats[p.id];
    const flagTxt = flag === 'poor' ? '<span class="mm-flag poor">비활성화 권장</span>'
      : flag === 'watch' ? '<span class="mm-flag watch">점검 필요</span>'
      : flag === 'good' ? '<span class="mm-flag good">안정</span>' : '';
    const avg = st && st.success ? (st.totalTime / st.success / 1000).toFixed(1) + 's' : '-';
    rows += `<tr>
      <td><input type="checkbox" data-en="${p.id}" ${enabled[p.id] ? 'checked' : ''}></td>
      <td>${p.name}</td>
      <td><span class="mm-rel ${p.reliability.toLowerCase()}">${p.reliability}</span></td>
      <td>${CATEGORY_LABELS[p.category]}·${DIFFICULTY_LABELS[p.difficulty]}</td>
      <td>${st ? st.shown : 0}</td>
      <td>${rate == null ? '-' : Math.round(rate * 100) + '%'} ${flagTxt}</td>
      <td>${avg}</td>
      <td><button class="mm-mini" data-test="${p.id}">테스트</button></td>
    </tr>`;
  }

  q('#mm-admin-body').innerHTML = `
    <div class="mm-admin-sec">
      <h3>미션 설정</h3>
      <div class="mm-fields">
        ${numField('총 미션 개수', 'totalMissions', 1, 10)}
        ${numField('합격 필요 성공', 'passCount', 1, 10)}
        ${numField('제한시간(ms)', 'timeoutMs', 3000, 20000, 500)}
        ${numField('유지시간(ms)', 'holdMs', 300, 3000, 100)}
        ${numField('성공 기준(0~1)', 'passScore', 0.4, 0.95, 0.01)}
        ${numField('재도전 횟수', 'retries', 0, 3)}
      </div>
      <label class="mm-chk"><input type="checkbox" data-set="onlyStable" ${s.onlyStable ? 'checked' : ''}> STABLE 포즈만 출제</label>
      <label class="mm-chk"><input type="checkbox" data-set="advanceOnFail" ${s.advanceOnFail ? 'checked' : ''}> 실패해도 다음 미션으로</label>
      <div class="mm-admin-btns">
        <button class="btn btn-primary" id="mm-save">설정 저장</button>
        <button class="btn btn-ghost" id="mm-reset-settings">박람회 기본으로 초기화</button>
        <button class="btn btn-ghost" id="mm-reset-stats">통계 초기화</button>
      </div>
      <p class="mm-preset-hint">빠른 설정:
        <button class="mm-mini" data-preset="3,2">3개 중 2개</button>
        <button class="mm-mini" data-preset="5,3">5개 중 3개</button>
        <button class="mm-mini" data-preset="5,4">5개 중 4개</button>
        <button class="mm-mini" data-preset="7,5">7개 중 5개</button>
      </p>
    </div>
    <div class="mm-admin-sec">
      <h3>포즈 목록 (${POSE_DEFS.length}개)</h3>
      <p class="mm-help">체크 = 출제 대상. STABLE만 출제가 켜져 있으면 EXPERIMENTAL은 체크해도 제외됩니다.</p>
      <div class="mm-table-wrap"><table class="mm-table">
        <thead><tr><th>출제</th><th>이름</th><th>등급</th><th>분류</th><th>출제</th><th>성공률</th><th>평균</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="mm-admin-sec">
      <h3>운영</h3>
      <div class="mm-admin-btns">
        <button class="btn btn-ghost" id="mm-op-start">미션 시작 / 다음 참가자</button>
        <button class="btn btn-ghost" id="mm-op-force">현재 미션 성공(Space)</button>
        <button class="btn btn-ghost" id="mm-op-skip">건너뛰기(N)</button>
        <button class="btn btn-ghost" id="mm-op-restart">다시 시작(R)</button>
        <button class="btn btn-ghost" id="mm-op-photo">기념사진</button>
        <button class="btn btn-ghost" id="mm-op-exit">미션 종료</button>
      </div>
      <p class="mm-help">단축키 — Space: 수동 성공 · R: 다시 · N: 다음 · Esc: 이 패널</p>
    </div>
  `;

  // 이벤트 연결
  q('#mm-save').onclick = () => {
    const ns = { ...settings };
    root.querySelectorAll('[data-set]').forEach((el) => {
      const k = el.dataset.set;
      ns[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
    });
    settings = Engine.saveSettings(ns);
    root.querySelectorAll('[data-en]').forEach((el) => { enabled[el.dataset.en] = el.checked; });
    Engine.saveEnabled(enabled);
    toast('설정을 저장했어요');
    buildAdminBody();
  };
  q('#mm-reset-settings').onclick = () => { settings = Engine.resetSettings(); toast('기본 설정으로'); buildAdminBody(); };
  q('#mm-reset-stats').onclick = () => { Engine.resetStats(); toast('통계 초기화'); buildAdminBody(); };
  root.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
    const [t, p] = b.dataset.preset.split(',').map(Number);
    q('[data-set="totalMissions"]').value = t;
    q('[data-set="passCount"]').value = p;
  });
  q('#mm-op-start').onclick = () => { closeAdmin(); start(); };
  q('#mm-op-force').onclick = forceSuccess;
  q('#mm-op-skip').onclick = skipMission;
  q('#mm-op-restart').onclick = restartMission;
  q('#mm-op-photo').onclick = () => { if (deps.onManualPhoto) deps.onManualPhoto(); };
  q('#mm-op-exit').onclick = () => { closeAdmin(); endGame(); };
  root.querySelectorAll('[data-test]').forEach((b) => b.onclick = () => { closeAdmin(); startTestMode(b.dataset.test); });
}

// ═════════ 포즈 테스트 모드 ═════════
function startTestMode(poseId) {
  testMode = POSE_BY_ID[poseId];
  active = true;
  lastTick = 0;
  document.body.classList.remove('mission-on');
  root.classList.remove('hidden', 'student');
  q('#mm-card').style.display = 'none';
  q('#mm-result').style.display = 'none';
  q('#mm-test').classList.remove('hidden');
  q('#mm-test-name').textContent = testMode.name + ' — 테스트';
}
function updateTestMode(snap) {
  const p = testMode;
  let res = { matched: false, confidence: 0, progress: 0, failedConditions: [] };
  if (snap.present) { try { res = p.detect(snap); } catch (e) {} }
  q('#mm-test-conf').textContent = (res.confidence * 100).toFixed(0) + '%';
  q('#mm-test-match').textContent = res.matched ? '✅ 성공 범위' : '⏳ 조건 미달';
  q('#mm-test-match').className = res.matched ? 'ok' : '';
  q('#mm-test-fail').textContent = res.failedConditions.length ? '부족: ' + res.failedConditions.join(', ') : '모든 조건 충족';
  q('#mm-test-vis').textContent = snap.present
    ? `전신 ${snap.fullBody ? 'O' : 'X'} · 손 L:${snap.hands.left.state} R:${snap.hands.right.state}`
    : '사람 미인식';
  const fill = q('#mm-test-fill');
  fill.style.width = Math.round(res.confidence * 100) + '%';
  fill.style.background = res.matched ? '#3fb56a' : '#a8794a';
}
function exitTestMode() {
  testMode = null;
  q('#mm-test').classList.add('hidden');
  q('#mm-card').style.display = '';
  openAdmin();
}

// ── DOM ──
function q(sel) { return root.querySelector(sel); }
let toastTimer = null;
function toast(msg) {
  const el = q('#mm-toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function buildDOM() {
  root = document.createElement('div');
  root.id = 'mission-root';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="mm-confetti"></div>
    <div id="mm-banner" class="mm-banner"></div>
    <div id="mm-countdown" class="mm-countdown hidden"></div>
    <div id="mm-card" class="mm-card">
      <div class="mm-top"><span id="mm-num">미션 1 / 3</span><span id="mm-score">⭐ 0개 성공</span></div>
      <div id="mm-silhouette" class="mm-silhouette">🕺</div>
      <div id="mm-title" class="mm-title"></div>
      <div id="mm-instruction" class="mm-instruction"></div>
      <div id="mm-hint" class="mm-hint"></div>
      <div class="mm-gauge"><div id="mm-gauge-fill" class="mm-gauge-fill"></div></div>
      <div id="mm-feedback" class="mm-feedback"></div>
      <div id="mm-timer" class="mm-timer"></div>
      <div id="mm-warn" class="mm-warn"></div>
    </div>
    <div id="mm-result" class="mm-result" style="display:none">
      <div id="mm-result-title" class="mm-result-title"></div>
      <div id="mm-result-sub" class="mm-result-sub"></div>
      <div id="mm-result-score" class="mm-result-score"></div>
      <div class="mm-result-btns">
        <button class="btn btn-primary btn-lg" id="mm-result-photo">📷 기념사진</button>
        <button class="btn btn-ghost btn-lg" id="mm-result-next">다음 참가자</button>
      </div>
    </div>
    <div id="mm-test" class="mm-test hidden">
      <div class="mm-test-head"><span id="mm-test-name"></span><button class="mm-mini" id="mm-test-exit">닫기</button></div>
      <div class="mm-test-bar"><div id="mm-test-fill"></div></div>
      <div class="mm-test-row">confidence: <b id="mm-test-conf">0%</b> <span id="mm-test-match"></span></div>
      <div class="mm-test-row" id="mm-test-fail"></div>
      <div class="mm-test-row" id="mm-test-vis"></div>
    </div>
    <div id="mm-admin" class="mm-admin hidden">
      <div class="mm-admin-card">
        <div class="mm-admin-head"><h2>운영자 설정</h2><button class="mm-mini" id="mm-admin-close">닫기(Esc)</button></div>
        <div id="mm-admin-body"></div>
      </div>
    </div>
    <div id="mm-toast" class="mm-toast"></div>
  `;
  document.body.appendChild(root);
  q('#mm-result-next').onclick = endGame;
  q('#mm-result-photo').onclick = () => { if (deps.onManualPhoto) deps.onManualPhoto(); };
  q('#mm-admin-close').onclick = closeAdmin;
  q('#mm-test-exit').onclick = exitTestMode;
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // 입력창 포커스 시 무시
    if (e.key === 'Escape') { e.preventDefault(); q('#mm-admin').classList.contains('hidden') ? openAdmin() : closeAdmin(); return; }
    if (!active) return;
    if (e.key === ' ') { e.preventDefault(); forceSuccess(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restartMission(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); skipMission(); }
  });
}

export function openOperator() { openAdmin(); }

// onExit 콜백 없이 즉시 중단 (홈으로 나갈 때 재귀 방지)
export function forceStop() {
  active = false;
  game = null; judge = null; testMode = null;
  document.body.classList.remove('mission-on');
  if (root) {
    root.classList.add('hidden');
    q('#mm-result').style.display = 'none';
    q('#mm-card').style.display = '';
    q('#mm-admin').classList.add('hidden');
    q('#mm-test').classList.add('hidden');
  }
}
