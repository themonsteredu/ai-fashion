// 수학 퀴즈 모드 — 문제 생성기 + 설정 저장 (화면·판정은 mathquiz-ui.js)
//
// 모든 문제는 2지선다: 화면 왼쪽/오른쪽에 답이 하나씩 나오고
// 학생은 정답이 있는 쪽 손을 들어 답한다.
// 문제는 매 판 새로 만들어지므로 같은 판이 반복되지 않는다.

const LS_QUIZ_SETTINGS = 'fas_quiz_settings_v1';

// ── 기본 박람회 설정 (운영자 설정 Esc 에서 변경 가능) ──
export const QUIZ_DEFAULTS = {
  questionCount: 5,  // 한 판 문제 수
  passCount: 3,      // 선물 기준 정답 수
  timeLimitSec: 10,  // 문제당 제한시간(초)
  holdMs: 800,       // 손을 이만큼 들고 있어야 답으로 인정 (실수 방지)
  practice: true,    // 시작 전 연습 문제 1개 (점수에 안 들어감)
};

export function loadQuizSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_QUIZ_SETTINGS));
    return { ...QUIZ_DEFAULTS, ...(s || {}) };
  } catch (e) { return { ...QUIZ_DEFAULTS }; }
}
export function saveQuizSettings(s) {
  const clean = { ...QUIZ_DEFAULTS, ...s };
  clean.questionCount = clamp(Math.round(clean.questionCount) || QUIZ_DEFAULTS.questionCount, 1, 10);
  clean.passCount = clamp(Math.round(clean.passCount) || 1, 1, clean.questionCount); // 합격 ≤ 문제 수
  clean.timeLimitSec = clamp(Number(clean.timeLimitSec) || QUIZ_DEFAULTS.timeLimitSec, 3, 30);
  clean.holdMs = clamp(Number(clean.holdMs) || QUIZ_DEFAULTS.holdMs, 300, 2000);
  localStorage.setItem(LS_QUIZ_SETTINGS, JSON.stringify(clean));
  return clean;
}
export function resetQuizSettings() {
  localStorage.removeItem(LS_QUIZ_SETTINGS);
  return { ...QUIZ_DEFAULTS };
}

// ── 단계 (관람객이 시작할 때 고름) ──
export const LEVELS = {
  easy:   { id: 'easy',   label: '쉬움',   emoji: '🌱', grade: '초등 1~2학년', desc: '덧셈 · 뺄셈 · 수 비교' },
  normal: { id: 'normal', label: '보통',   emoji: '🔥', grade: '초등 3~6학년', desc: '구구단 · 나눗셈 · 분수' },
  hard:   { id: 'hard',   label: '어려움', emoji: '🚀', grade: '중학생',       desc: '음수 · 방정식 · 거듭제곱' },
};

// ── 표기 헬퍼 (문제·답은 모두 여기서 만든 HTML이라 외부 입력 없음) ──
const MINUS = '−';
function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function n(v) { return v < 0 ? MINUS + (-v) : String(v); }        // 답으로 쓰는 수: −12
function p(v) { return v < 0 ? `(${MINUS}${-v})` : String(v); }   // 식 안의 음수는 괄호: (−3)
function frac(a, b) { return `<span class="qz-frac"><span>${a}</span><span>${b}</span></span>`; }
function dec(v) { return String(Math.round(v * 100) / 100); }      // 0.75, 0.3
const X = '<i>x</i>';
// 정답과 다른 오답 하나 (후보 중 조건에 맞는 첫 값)
function wrongOf(correct, cands, ok = () => true) {
  for (const c of cands) if (c !== correct && ok(c)) return c;
  return correct + 1;
}
function nearWrong(correct, min = 0) {
  const d = pick([1, 2, -1, -2]);
  return wrongOf(correct, [correct + d, correct - d, correct + 1], (v) => v >= min);
}

// ── 문제 유형 ──
// 각 함수 → { text, correct, wrong, explain, ox? }
// ox: true 면 보기가 [⭕ 맞아요, ❌ 틀려요]로 고정 (왼쪽 O · 오른쪽 X)
const TYPES = {
  easy: [
    { id: 'add', w: 3, make() {
      const a = ri(2, 9), b = ri(1, 9), c = a + b;
      return { text: `${a} + ${b} = ?`, correct: c, wrong: nearWrong(c, 1), explain: `${a} + ${b} = ${c}` };
    } },
    { id: 'sub', w: 3, make() {
      const a = ri(6, 18), b = ri(2, Math.min(9, a - 1)), c = a - b;
      return { text: `${a} ${MINUS} ${b} = ?`, correct: c, wrong: nearWrong(c, 0), explain: `${a} ${MINUS} ${b} = ${c}` };
    } },
    { id: 'add2', w: 2, make() {
      const t = ri(1, 4), o = ri(1, 7), b = ri(1, 9 - o), a = t * 10 + o, c = a + b;
      return { text: `${a} + ${b} = ?`, correct: c, wrong: pick([c + 10, c - 10, c + 1]), explain: `일의 자리끼리 더해요 → ${c}` };
    } },
    { id: 'compare', w: 2, make() {
      let x = ri(1, 9), y = ri(1, 9);
      while (y === x) y = ri(1, 9);
      const big = Math.max(x, y) * 10 + Math.min(x, y), small = Math.min(x, y) * 10 + Math.max(x, y);
      return { text: '더 큰 수는?', correct: big, wrong: small, explain: `십의 자리 숫자를 먼저 비교해요 → ${big}` };
    } },
    { id: 'pattern', w: 2, make() {
      const step = pick([2, 3, 5, 10]), s = step * ri(0, 3) + (step === 10 ? 10 : step);
      const seq = [s, s + step, s + step * 2, s + step * 3], next = s + step * 4;
      return { text: `${seq.join(', ')}, ?`, correct: next, wrong: wrongOf(next, [next + 1, next - 1]), explain: `${step}씩 커져요 → ${next}` };
    } },
    { id: 'ox_add', w: 2, make() {
      const a = ri(2, 9), b = ri(2, 9), real = a + b, ok = Math.random() < 0.5, shown = ok ? real : real + pick([1, -1]);
      return { text: `${a} + ${b} = ${shown}`, ox: true, correct: ok, explain: `${a} + ${b} = ${real}` };
    } },
    { id: 'fact', w: 2, make() {
      const [q, c, w] = pick([
        ['삼각형의 꼭짓점은 몇 개?', 3, 4], ['사각형의 변은 몇 개?', 4, 3], ['오각형의 꼭짓점은 몇 개?', 5, 6],
        ['1시간은 몇 분?', 60, 100], ['1m는 몇 cm?', 100, 10], ['일주일은 며칠?', 7, 5],
      ]);
      return { text: q, correct: c, wrong: w, explain: `정답은 ${c}` };
    } },
  ],
  normal: [
    { id: 'times', w: 4, make() {
      const a = ri(2, 9), b = ri(3, 9), c = a * b;
      return { text: `${a} × ${b} = ?`, correct: c, wrong: a * (b + pick([1, -1])), explain: `${a} × ${b} = ${c}` };
    } },
    { id: 'div', w: 2, make() {
      const b = ri(2, 9), q = ri(2, 9);
      return { text: `${b * q} ÷ ${b} = ?`, correct: q, wrong: nearWrong(q, 1), explain: `${b} × ${q} = ${b * q} 이므로 답은 ${q}` };
    } },
    { id: 'carry', w: 2, make() {
      let a, b;
      do { a = ri(15, 69); b = ri(15, 29); } while ((a % 10) + (b % 10) < 10);
      const c = a + b;
      return { text: `${a} + ${b} = ?`, correct: c, wrong: c - 10, explain: `일의 자리에서 받아올림을 잊지 마세요! → ${c}` };
    } },
    { id: 'order', w: 2, make() {
      const a = ri(2, 9), b = ri(2, 6), c = ri(2, 6), ans = a + b * c;
      return { text: `${a} + ${b} × ${c} = ?`, correct: ans, wrong: (a + b) * c, explain: `곱셈 먼저! ${b} × ${c} = ${b * c}, ${a} + ${b * c} = ${ans}` };
    } },
    { id: 'unitfrac', w: 2, make() {
      let a = ri(2, 9), b = ri(2, 9);
      while (b === a) b = ri(2, 9);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return { text: '더 큰 분수는?', correct: frac(1, lo), wrong: frac(1, hi), explain: `똑같이 나눈 조각이 적을수록 한 조각이 커요 → ${frac(1, lo)}` };
    } },
    { id: 'fracadd', w: 2, make() {
      const d = ri(5, 9), a = ri(1, d - 2), b = ri(1, d - 1 - a);
      return { text: `${frac(a, d)} + ${frac(b, d)} = ?`, correct: frac(a + b, d), wrong: frac(a + b, d * 2), explain: `분모는 그대로, 분자끼리 더해요 → ${frac(a + b, d)}` };
    } },
    { id: 'decimal', w: 1, make() {
      const a = ri(1, 7), bc = pick([12, 15, 18, 21, 25, 26, 28]), right = (a * 10 + bc) / 100, bad = (a + bc) / 100;
      return { text: `0.${a} + ${dec(bc / 100)} = ?`, correct: dec(right), wrong: dec(bad), explain: `소수점 자리를 맞춰서 더해요 → ${dec(right)}` };
    } },
    { id: 'ox_times', w: 2, make() {
      const a = ri(3, 9), b = ri(3, 9), real = a * b, ok = Math.random() < 0.5, shown = ok ? real : a * (b + pick([1, -1]));
      return { text: `${a} × ${b} = ${shown}`, ox: true, correct: ok, explain: `${a} × ${b} = ${real}` };
    } },
    { id: 'unit', w: 1, make() {
      const [q, c, w] = pick([
        ['1km는 몇 m?', 1000, 100], ['1L는 몇 mL?', 1000, 100], ['1분은 몇 초?', 60, 100],
        ['하루는 몇 시간?', 24, 12], ['1kg은 몇 g?', 1000, 100],
      ]);
      return { text: q, correct: c, wrong: w, explain: `정답은 ${c}` };
    } },
  ],
  hard: [
    { id: 'intmul', w: 3, make() {
      const a = ri(2, 9), b = ri(2, 9), sa = pick([1, -1]), sb = sa < 0 ? pick([1, -1]) : -1;
      const x = sa * a, y = sb * b, c = x * y;
      return { text: `${p(x)} × ${p(y)} = ?`, correct: n(c), wrong: n(-c), explain: `부호가 같으면 +, 다르면 ${MINUS} → ${n(c)}` };
    } },
    { id: 'intadd', w: 2, make() {
      const a = ri(2, 12); let b = ri(2, 12);
      while (b === a) b = ri(2, 12);
      const c = b - a;
      return { text: `${p(-a)} + ${b} = ?`, correct: n(c), wrong: n(-c), explain: `${b} ${MINUS} ${a} = ${n(c)}` };
    } },
    { id: 'linear', w: 3, make() {
      const x = ri(2, 9), a = ri(2, 6), b = ri(1, 15), c = a * x + b;
      const alt = (c + b) % a === 0 ? (c + b) / a : x + pick([1, -1]);
      return { text: `${a}${X} + ${b} = ${c}<br><small>${X} = ?</small>`, correct: x, wrong: wrongOf(x, [alt, x + 1]),
        explain: `${a}${X} = ${c} ${MINUS} ${b} = ${c - b} → ${X} = ${x}` };
    } },
    { id: 'power', w: 2, make() {
      const [base, exp] = pick([[2, 3], [2, 4], [2, 5], [2, 6], [3, 2], [3, 3], [3, 4], [4, 3], [5, 2], [5, 3]]);
      const c = base ** exp;
      return { text: `${base}<sup>${exp}</sup> = ?`, correct: c, wrong: base * exp, explain: `${Array(exp).fill(base).join(' × ')} = ${c}` };
    } },
    { id: 'sqrt', w: 1, make() {
      const k = pick([4, 6, 8, 10, 12, 14]), sq = k * k;
      return { text: `√${sq} = ?`, correct: k, wrong: sq / 2, explain: `${k} × ${k} = ${sq} 이므로 √${sq} = ${k}` };
    } },
    { id: 'distrib', w: 2, make() {
      const a = ri(2, 6), b = ri(2, 9);
      return { text: `${a}(${X} + ${b}) = ?`, correct: `${a}${X} + ${a * b}`, wrong: `${a}${X} + ${b}`, explain: `괄호 안의 모든 항에 곱해요 → ${a}${X} + ${a * b}` };
    } },
    { id: 'like', w: 1, make() {
      const a = ri(2, 7), b = ri(2, 7);
      return { text: `${a}${X} + ${b}${X} = ?`, correct: `${a + b}${X}`, wrong: `${a + b}${X}<sup>2</sup>`, explain: `문자가 같은 항끼리 계수만 더해요 → ${a + b}${X}` };
    } },
    { id: 'ox_power', w: 2, make() {
      const a = ri(2, 5), e = pick([2, 3]), real = (-a) ** e, ok = Math.random() < 0.5, shown = ok ? real : -real;
      return { text: `(${MINUS}${a})<sup>${e}</sup> = ${n(shown)}`, ox: true, correct: ok, explain: `(${MINUS}${a})<sup>${e}</sup> = ${n(real)}` };
    } },
    { id: 'geo', w: 1, make() {
      const [q, c, w] = pick([
        ['삼각형 세 각의 합은?', '180°', '360°'], ['사각형 네 각의 합은?', '360°', '180°'],
        ['직각은 몇 도?', '90°', '180°'], ['정육면체의 면은 몇 개?', 6, 8], ['정육면체의 꼭짓점은 몇 개?', 8, 6],
      ]);
      return { text: q, correct: c, wrong: w, explain: `정답은 ${c}` };
    } },
  ],
};

const OX_CHOICES = ['⭕', '❌'];

// 유형 결과 → 화면용 문제 { text, choices[2], answer(0|1), answerText, explain, ox }
function finalize(raw, side) {
  if (raw.ox) {
    return { text: raw.text, choices: OX_CHOICES.slice(), answer: raw.correct ? 0 : 1, explain: raw.explain, ox: true };
  }
  const choices = side === 0 ? [raw.correct, raw.wrong] : [raw.wrong, raw.correct];
  return { text: raw.text, choices: choices.map(String), answer: side, explain: raw.explain, ox: false };
}

// 연습 문제: 단계와 상관없이 아주 쉽게 (손 드는 방법 익히기)
export function practiceQuestion() {
  const side = Math.random() < 0.5 ? 0 : 1;
  return { ...finalize({ text: '1 + 1 = ?', correct: 2, wrong: 3, explain: '1 + 1 = 2' }, side), practice: true };
}

// 한 판 문제 만들기: 같은 유형 연속 X, 같은 문제 중복 X,
// 정답 위치(왼/오)는 무작위지만 같은 쪽이 3번 연속 나오지 않게
export function buildQuiz(levelId, count) {
  const types = TYPES[levelId] || TYPES.easy;
  const out = [];
  const seen = new Set();
  let lastType = null;
  for (let i = 0; i < count; i++) {
    let q = null;
    for (let tries = 0; tries < 30 && !q; tries++) {
      const cands = types.filter((t) => t.id !== lastType || types.length === 1);
      const t = weighted(cands);
      const raw = t.make();
      if (seen.has(raw.text)) continue;
      const [s1, s2] = out.slice(-2).map((x) => x.answer);
      let side = Math.random() < 0.5 ? 0 : 1;
      if (s1 != null && s1 === s2 && side === s1) side = 1 - side;
      const fq = finalize(raw, side);
      // O/X 는 보기 위치가 고정이라 같은 쪽 3연속이면 다른 문제로 다시 뽑음
      if (fq.ox && s1 != null && s1 === s2 && fq.answer === s1 && tries < 20) continue;
      q = fq;
      seen.add(raw.text);
      lastType = t.id;
    }
    out.push(q || finalize(types[0].make(), i % 2));
  }
  return out;
}

function weighted(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return it; }
  return items[items.length - 1];
}
