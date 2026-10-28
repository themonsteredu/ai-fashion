// 체육 동작 배우기 소리: 소리 파일 없이 WebAudio로 만든 짧은 효과음 + 이 기기에 설치된 한국어 음성(오프라인)만 쓴다.
// 오디오가 막혔거나 한국어 음성이 없으면 아무 소리 없이 넘어간다(오류를 내지 않음). 모든 호출은 try/catch.
let ctx = null, master = null, muted = false, volume = 70, voice = null, voiceHooked = false;

// #btn-pe 클릭 안에서 동기로 호출 (브라우저 자동재생 정책: 사용자 동작 안에서 AudioContext를 만들어야 소리가 난다)
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    applyGain();
  } catch (e) { ctx = null; master = null; }
  pickVoice();
}

export function setVolume(v) { volume = Math.max(0, Math.min(100, Number(v) || 0)); applyGain(); }
export function setMuted(b) { muted = !!b; applyGain(); if (muted) cancel(); }
export function isMuted() { return muted; }
function applyGain() { try { if (master) master.gain.value = muted ? 0 : volume / 100; } catch (e) { /* 무시 */ } }

// 오프라인 한국어 음성만 (Windows: 'Microsoft Heami' — 설정 → 시간 및 언어 → 음성 → 한국어 음성 팩). 인터넷 음성은 쓰지 않는다
function pickVoice() {
  try {
    const ss = window.speechSynthesis;
    if (!ss) return;
    voice = ss.getVoices().find((v) => /^ko/i.test(v.lang || '') && v.localService) || null;
    if (!voiceHooked) { voiceHooked = true; ss.addEventListener?.('voiceschanged', pickVoice); }
  } catch (e) { voice = null; }
}
export function voiceInfo() { if (!voice) pickVoice(); return voice ? voice.name + ' ✓' : null; }

// 화살표·이모지는 읽지 않게 지운다
const clean = (t) => String(t || '').replace(/[←-⇿⌀-⏿☀-➿⬀-⯿️‍]|[\u{1f000}-\u{1faff}]/gu, '').replace(/\s+/g, ' ').trim();
export function say(text) {
  try {
    if (muted || !voice) return false;
    const ss = window.speechSynthesis, t = clean(text);
    if (!ss || !t) return false;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.voice = voice; u.lang = voice.lang; u.rate = 1.15; u.pitch = 1.15; u.volume = Math.min(1, volume / 100 + 0.2);
    ss.speak(u);
    return true;
  } catch (e) { return false; }
}
export function cancel() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* 무시 */ } }

// ── 효과음 ──
// type 파형, f0→f1 Hz, t0초 뒤 시작, dur초, g 음량, decay: 지수 감쇠(종소리)
function tone(type, f0, f1, t0, dur, g, decay = false, filterHz = 0) {
  const now = ctx.currentTime + t0;
  const o = ctx.createOscillator(), a = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, now);
  if (f1 && f1 !== f0) o.frequency.linearRampToValueAtTime(f1, now + dur);
  a.gain.setValueAtTime(0.0001, now);
  a.gain.linearRampToValueAtTime(g, now + Math.min(0.008, dur / 4));
  if (decay) a.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  else { a.gain.setValueAtTime(g, now + Math.max(0.01, dur - 0.02)); a.gain.linearRampToValueAtTime(0.0001, now + dur); }
  let out = o;
  if (filterHz) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz; o.connect(f); out = f; }
  out.connect(a); a.connect(master);
  o.start(now); o.stop(now + dur + 0.03);
  return o;
}
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
const SOUNDS = {
  whistle() {   // 삐익: 사각파 2800 Hz ± 120 Hz 떨림(28 Hz)
    const o = tone('square', 2800, 2800, 0, 0.45, 0.12, false, 4000);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 28; lg.gain.value = 120; lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(); lfo.stop(ctx.currentTime + 0.5);
  },
  tick() { tone('sine', 1200, 1200, 0, 0.025, 0.07); },            // 선생님이 자세에 닿을 때 (박자)
  beep() { tone('sine', 520, 520, 0, 0.12, 0.2); },                // 3-2-1
  tok() { tone('triangle', 880, 660, 0, 0.07, 0.35); },           // 한 번 셀 때마다
  ding() { tone('sine', 1319, 1319, 0, 0.25, 0.25, true); tone('sine', 1976, 1976, 0, 0.25, 0.12, true); },
  nudge() { tone('sine', 784, 659, 0, 0.11, 0.15); tone('sine', 784, 659, 0.13, 0.11, 0.15); },
  fanfare() { [C5, E5, G5].forEach((f, i) => tone('triangle', f, f, i * 0.09, 0.09, 0.25)); tone('triangle', C6, C6, 0.27, 0.3, 0.25); },
  finale() { SOUNDS.fanfare(); for (const f of [C5, E5, G5]) tone('sine', f, f, 0.6, 0.6, 0.12, true); },
};
export function play(name) {
  try {
    if (muted || !ctx || !master || !SOUNDS[name]) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    SOUNDS[name]();
  } catch (e) { /* 소리 없이 계속 */ }
}
