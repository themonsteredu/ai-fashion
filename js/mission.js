// 랜덤 포즈 미션 엔진: 설정·통계(localStorage), 랜덤 출제, 유지시간 판정, 게임 상태머신
import { POSE_DEFS, POSE_BY_ID } from './poses.js';

const LS_SETTINGS = 'fas_mission_settings_v1';
const LS_STATS = 'fas_mission_stats_v1';
const LS_ENABLED = 'fas_mission_enabled_v1';
const LS_LASTPOSES = 'fas_mission_lastposes_v1'; // 직전 학생들에게 나온 포즈(편중 방지)

// ── 기본 박람회 설정 ──
export const DEFAULT_SETTINGS = {
  totalMissions: 3,
  passCount: 2,
  timeoutMs: 8000,
  holdMs: 700,
  passScore: 0.68,      // 이 confidence 이상 유지 시 성공
  enterFrames: 4,       // 진입 안정화
  slipMs: 250,          // 순간 이탈 허용
  retries: 1,           // 미션별 재도전
  advanceOnFail: true,  // 실패해도 다음 미션으로
  onlyStable: true,     // STABLE 포즈만 출제
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  const clean = { ...s };
  clean.passCount = Math.min(clean.passCount, clean.totalMissions); // 합격≤총개수
  localStorage.setItem(LS_SETTINGS, JSON.stringify(clean));
  return clean;
}
export function resetSettings() {
  localStorage.removeItem(LS_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

// ── 포즈 활성화 상태 (강사가 체크박스로 조정) ──
// 기본: STABLE = 켬, EXPERIMENTAL/DISABLED = 끔
export function loadEnabled() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(LS_ENABLED)) || {}; } catch (e) {}
  const map = {};
  for (const p of POSE_DEFS) {
    map[p.id] = stored[p.id] != null ? stored[p.id] : (p.reliability === 'STABLE');
  }
  return map;
}
export function saveEnabled(map) {
  localStorage.setItem(LS_ENABLED, JSON.stringify(map));
}

// ── 포즈별 통계 (개인정보·영상 저장 안 함, 집계만) ──
export function loadStats() {
  try { return JSON.parse(localStorage.getItem(LS_STATS)) || {}; } catch (e) { return {}; }
}
function saveStats(stats) { localStorage.setItem(LS_STATS, JSON.stringify(stats)); }
export function recordResult(poseId, outcome, elapsedMs) {
  const stats = loadStats();
  const st = stats[poseId] || { shown: 0, success: 0, fail: 0, timeout: 0, manual: 0, totalTime: 0 };
  st.shown++;
  if (outcome === 'success') { st.success++; st.totalTime += elapsedMs || 0; }
  else if (outcome === 'manual') { st.success++; st.manual++; }
  else if (outcome === 'timeout') { st.timeout++; st.fail++; }
  else st.fail++;
  stats[poseId] = st;
  saveStats(stats);
}
export function resetStats() { localStorage.removeItem(LS_STATS); }
export function poseSuccessRate(poseId) {
  const st = loadStats()[poseId];
  if (!st || st.shown === 0) return null;
  return st.success / st.shown;
}
// 성공률 등급: 'good' | 'watch' | 'poor'
export function reliabilityFlag(poseId) {
  const rate = poseSuccessRate(poseId);
  if (rate == null) return null;
  if (rate >= 0.8) return 'good';
  if (rate >= 0.65) return 'watch';
  return 'poor';
}

// ── 활성 포즈 목록 (설정 반영) ──
export function activePoses(settings, enabled) {
  return POSE_DEFS.filter((p) => {
    if (!enabled[p.id]) return false;
    if (settings.onlyStable && p.reliability !== 'STABLE') return false;
    return true;
  });
}

// ── 랜덤 출제 엔진 ──
// 규칙: 게임 내 중복 X, 직전 학생 포즈 확률↓, 같은 카테고리·cooldownGroup 연속 방지,
//       좌우 계열 연속 방지, 난이도 믹스(EASY→NORMAL→CHALLENGE 경향)
function poseSide(p) {
  const n = p.id;
  if (/left|_l$|lup|lside|l_/.test(n) || /왼/.test(p.name)) return 'L';
  if (/right|_r$|rup|rside|r_/.test(n) || /오른/.test(p.name)) return 'R';
  return null;
}
function loadLastPoses() {
  try { return JSON.parse(localStorage.getItem(LS_LASTPOSES)) || []; } catch (e) { return []; }
}
function pushLastPoses(ids) {
  const prev = loadLastPoses();
  const merged = [...ids, ...prev].slice(0, 8);
  localStorage.setItem(LS_LASTPOSES, JSON.stringify(merged));
}

// 난이도 목표 배분: 대체로 EASY→NORMAL→CHALLENGE
function difficultyPlan(n) {
  if (n <= 1) return ['EASY'];
  if (n === 2) return ['EASY', 'NORMAL'];
  if (n === 3) return ['EASY', 'EASY', 'NORMAL'];
  const plan = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    plan.push(t < 0.4 ? 'EASY' : t < 0.8 ? 'NORMAL' : 'CHALLENGE');
  }
  return plan;
}

export function buildMissionSet(settings, enabled) {
  const pool = activePoses(settings, enabled);
  const n = settings.totalMissions;
  const warn = pool.length < n
    ? `활성 포즈(${pool.length})가 미션 개수(${n})보다 적어요. 일부 포즈가 반복될 수 있습니다.`
    : null;

  const lastStudent = loadLastPoses();
  const plan = difficultyPlan(n);
  const chosen = [];
  const usedGroups = new Set();
  let lastCat = null, lastSide = null;

  for (let i = 0; i < n; i++) {
    const wantDiff = plan[i];
    // 후보 필터링 (엄격→완화 순서로 시도해 항상 하나는 뽑음)
    const tryPick = (relax) => {
      let cands = pool.filter((p) => !chosen.includes(p));
      if (cands.length === 0) cands = pool.slice(); // 부족하면 중복 허용
      let filtered = cands;
      if (relax < 3) filtered = filtered.filter((p) => !usedGroups.has(p.cooldownGroup || p.id));
      if (relax < 2) filtered = filtered.filter((p) => p.category !== lastCat);
      if (relax < 2) filtered = filtered.filter((p) => { const s = poseSide(p); return !(s && s === lastSide); });
      if (relax < 1) filtered = filtered.filter((p) => p.difficulty === wantDiff);
      return filtered.length ? filtered : null;
    };
    let cands = null;
    for (let relax = 0; relax <= 3 && !cands; relax++) cands = tryPick(relax);
    if (!cands) cands = pool.slice();

    // 가중치: 포즈 weight × 직전 학생 등장 페널티
    const weighted = cands.map((p) => {
      let w = p.weight || 1;
      const recentIdx = lastStudent.indexOf(p.id);
      if (recentIdx >= 0) w *= 0.35 + 0.08 * recentIdx; // 최근일수록 확률 낮춤
      return { p, w };
    });
    const pick = weightedRandom(weighted);
    chosen.push(pick);
    usedGroups.add(pick.cooldownGroup || pick.id);
    lastCat = pick.category;
    const sd = poseSide(pick); if (sd) lastSide = sd;
  }

  pushLastPoses(chosen.map((p) => p.id));
  return { poses: chosen, warn };
}

function weightedRandom(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return it.p; }
  return items[items.length - 1].p;
}

// ── 단일 미션 판정기 (유지시간 + 순간이탈 허용 + 진입 안정화) ──
export class MissionJudge {
  constructor(pose, settings) {
    this.pose = pose;
    this.settings = settings;
    this.reset();
  }
  reset() {
    this.enterCount = 0;
    this.holdMs = 0;
    this.slipMs = 0;
    this.started = false;
    this.startTime = 0;
    this.lastConfidence = 0;
    this.lastResult = null;
  }
  // dt(ms), snapshot → { state:'waiting'|'holding'|'success'|'timeout', progress, confidence, result }
  update(snapshot, dtMs, nowMs) {
    if (!this.started) { this.started = true; this.startTime = nowMs; }
    let res;
    try { res = this.pose.detect(snapshot); } catch (e) { res = { matched: false, confidence: 0, progress: 0, failedConditions: [] }; }
    this.lastResult = res;
    this.lastConfidence = res.confidence;

    const above = res.confidence >= this.settings.passScore;
    if (above) {
      this.enterCount++;
      if (this.enterCount >= this.settings.enterFrames) {
        this.holdMs += dtMs;
        this.slipMs = 0;
      }
    } else {
      // 진입 후 잠깐 벗어남은 slip 허용
      if (this.holdMs > 0) {
        this.slipMs += dtMs;
        if (this.slipMs > this.settings.slipMs) { this.holdMs = 0; this.enterCount = 0; }
      } else {
        this.enterCount = Math.max(0, this.enterCount - 1);
      }
    }

    const elapsed = nowMs - this.startTime;
    // 진행 게이지: confidence 진행 + 유지 진행 혼합 (부드럽게 차오름)
    const holdProg = Math.min(1, this.holdMs / this.settings.holdMs);
    const gauge = Math.max(res.progress * 0.5, holdProg);

    if (this.holdMs >= this.settings.holdMs) {
      return { state: 'success', progress: 1, confidence: res.confidence, elapsed, result: res };
    }
    if (elapsed >= this.settings.timeoutMs) {
      return { state: 'timeout', progress: gauge, confidence: res.confidence, elapsed, result: res };
    }
    return { state: this.holdMs > 0 ? 'holding' : 'waiting', progress: gauge, confidence: res.confidence, elapsed, result: res };
  }
}
