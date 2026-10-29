// 체육 동작 배우기: 동작 목록·핵심 자세·판정 점수·힌트 문구·설정/통계 저장 (순수 데이터, DOM·three.js 없음)
// 좌우는 항상 '학생 자신의' 쪽. 그림 선생님은 거울이라 학생 왼쪽이 화면 왼쪽에 보인다.
// 스펙 형식 [[뼈, [0,0,1], rad], …] — 체육은 Z축 회전만 쓴다(그림 아바타·3D 아바타가 같은 배열을 그대로 씀).
//   leftUpperArm +: 학생 왼팔 올림(−1.15 차렷 · 0.05 T · 1.45 만세) / rightUpperArm −: 학생 오른팔 올림
//   leftUpperLeg +: 왼다리 옆으로 / rightUpperLeg −: 오른다리 옆으로 / spine·chest·neck·head +: 학생 오른쪽(화면 오른쪽)으로
// 스펙에 없는 뼈는 중립(위팔 ∓1.187, 나머지 0)으로 돌아간다. 위팔 머리 위 ≤ 1.8(얼굴 가림), 허벅지 ≤ 1.4(그림 한계).
//
// 명세(SPEC §3)와 다른 점 / 추가된 것:
//  - neck 점수는 눈 선(tilt)이 안 잡히면 why 'face_front'(정면을 봐 주세요)를 돌려준다.
//  - getMove(id, settings)는 settings가 없어도 된다.
//  - 추가 export: HINTS·hintText, SENS_K, TEMPO_CHOICES, PE_DEFAULTS·normalizePESettings·loadPESettings·savePESettings·resetPESettings,
//    loadPEStats·recordPEStart·recordPEResult·recordPESession·resetPEStats·summarizePEStats, isPEDebug,
//    resolveVariant, parseFallback, legsDecision, enabledMoves, courseMoves, repsFor, targetFor, IDLE_MOVE, PRAISE_MOVE, LS_PE_*.
//
// 현장에서 맞춰야 할 값 (TUNE, SPEC §3.9) — 아래 숫자만 바꾸면 된다. 디버그 패널(fas_pe_debug=1, Esc → 테스트)로 3명 × 5회:
//  - neck 기울기 4→11°: 가만히 있을 때 |tilt| 95 % + 1° ≤ lo, 정직한 동작 하위 25 % ≥ hi (서 있는 사람 측정 +18/−22°)
//  - arm_push reachRel 0.75→0.55 / wrEl −0.10→0.15: 손끝 어깨(SHOULDER)·T 자세를 아직 못 쟀다 → 첫 측정값의 중간으로
//  - squat drop 0.08→0.20, depth 0.04→0.10: 아이는 얕게 앉는다(합성 아이: 깊이 경로는 약 5 cm부터 센다), 카메라 높이에 따라 drop이 변함
//  - squat upper(엉덩이가 화면 밖): 단위 = 1.5 × 어깨너비(화면) — 아이로 확인 안 됨
//  - knee_up 0.15→0.32 / 0.12→0.28 (측정 0.42 / 0.39), tree footUp 0.10→0.30 (측정 1.04, 발끝만 0.07은 일부러 안 셈),
//    jumping_jack 다리 6→13° (측정 21–24°), LegsGate vis 0.6 / 70 %
import { ramp, band, A, all, mn, mx, neg } from './pe-engine.js';

export const Z = [0, 0, 1];
const arms = (l, r) => [['leftUpperArm', Z, l], ['rightUpperArm', Z, r]];
export const mirror = (spec) => spec.map(([b, ax, a]) => [
  b.startsWith('left') ? 'right' + b.slice(4) : b.startsWith('right') ? 'left' + b.slice(5) : b, ax, -a]);
export const KP = {
  DOWN: arms(-1.15, 1.15),                                                                                   // 차렷
  UP: arms(1.45, -1.45),                                                                                     // 만세
  T: arms(0.05, -0.05),                                                                                      // 양팔 옆
  HIP: [['leftUpperArm', Z, -0.7], ['leftLowerArm', Z, -1.6], ['rightUpperArm', Z, 0.7], ['rightLowerArm', Z, 1.6]],         // 허리에 손
  SHOULDER: [['leftUpperArm', Z, -1.15], ['leftLowerArm', Z, 2.9], ['rightUpperArm', Z, 1.15], ['rightLowerArm', Z, -2.9]],  // 손끝 어깨
  HANDS_UP: [['leftUpperArm', Z, 1.5], ['leftLowerArm', Z, 0.25], ['rightUpperArm', Z, -1.5], ['rightLowerArm', Z, -0.25]],  // 머리 위 손 모아 (얼굴 보임)
  CHEER: [['leftUpperArm', Z, 1.3], ['leftLowerArm', Z, 0.35], ['rightUpperArm', Z, -1.3], ['rightLowerArm', Z, -0.35]],      // 칭찬
  STAR: [['leftUpperArm', Z, 0.75], ['rightUpperArm', Z, -0.75], ['leftUpperLeg', Z, 0.5], ['rightUpperLeg', Z, -0.5]],       // 별
  WAVE_A: [['leftUpperArm', Z, -1.15], ['rightUpperArm', Z, -1.45], ['rightLowerArm', Z, -0.35]],                            // 인사 (오른손 위)
  WAVE_B: [['leftUpperArm', Z, -1.15], ['rightUpperArm', Z, -1.45], ['rightLowerArm', Z, 0.35]],
};
export const IDLE_LOOP = [['DOWN', 1200], ['WAVE_A', 350], ['WAVE_B', 350], ['WAVE_A', 350], ['WAVE_B', 350], ['DOWN', 800], ['UP', 1400], ['DOWN', 1000]]; // 고르기 화면; ms

const handsHip = (R) => Math.min(band(R.upL, -0.70, -0.15, 0.15), band(R.upR, -0.70, -0.15, 0.15)); // 허리 −0.36/−0.51, 차렷 −0.88 → 0
const armsDown = (R) => ramp(R.maxElev, 50, 30);
const armsT = (R) => Math.min(band(R.elevL, 70, 115, 20), band(R.elevR, 70, 115, 20));
const tiltOr = (F, fn) => (F.tilt == null ? { s: 0, why: 'face_front' } : fn());           // 눈이 안 잡히면 '정면을 봐 주세요'

export const MOVES = {
  neck: { id: 'neck', name: '목 운동', short: '목 운동', emoji: '🙆', theme: 'sky', diff: 1, legs: 'none', kind: 'alt',
    reps: { single: 4, course: 4 }, unitMs: 900, minGapMs: 600, watchCycles: { single: 1, course: 1 },
    text: { main: '고개를 옆으로 콩!\n귀가 어깨 쪽으로', sub: '천천히, 어깨는 그대로', why: '목을 부드럽게 풀어 줘요' },
    keys: { center: { spec: KP.HIP, label: '바르게' },
            right: { spec: [...KP.HIP, ['neck', Z, 0.25], ['head', Z, 0.3]], label: '오른쪽으로 갸우뚱 ➡' },
            left:  { spec: [...KP.HIP, ['neck', Z, -0.25], ['head', Z, -0.3]], label: '⬅ 왼쪽으로 갸우뚱' } },
    ready: 'center', readyLabel: '손은 허리에!', readyScore: (R) => handsHip(R),
    cycle: [['right', 1], ['center', 0.7], ['left', 1], ['center', 0.7]], targetKeys: ['right', 'left'],
    steps: [{ key: 'right', score: 'right' }, { key: 'left', score: 'left' }],
    rep: { kind: 'alt', rest: 'center', sides: ['right', 'left'] },
    variants: { full: { score: {
      center: (F) => tiltOr(F, () => all(['head_center', ramp(Math.abs(F.tilt), 7, 3)])),
      right:  (F, k) => tiltOr(F, () => all(['head_more', ramp(F.tilt, ...A(k, 4, 11))])),            // TUNE (아이 기울기)
      left:   (F, k) => tiltOr(F, () => all(['head_more', ramp(neg(F.tilt), ...A(k, 4, 11))])) } } },
    fallback: null, praise: '목이 시원해졌어요 😌', badge: '부드러운 목 🦒',
    safety: '옆으로 갸우뚱만 — 돌리거나 뒤로 젖히지 않아요' },

  arm_push: { id: 'arm_push', name: '팔 운동', short: '팔 운동', emoji: '💪', theme: 'yellow', diff: 1, legs: 'none', kind: 'cycle',
    reps: { single: 8, course: 4 }, unitMs: 700, minGapMs: 450, watchCycles: { single: 2, course: 1 },
    text: { main: '손끝을 어깨에 콕!\n팔을 옆으로 쭉!', sub: '팔꿈치를 쭉 펴요', why: '어깨와 팔꿈치를 깨워요' },
    keys: { down: { spec: KP.DOWN, label: '차렷' }, bent: { spec: KP.SHOULDER, label: '어깨에 콕' }, out: { spec: KP.T, label: '옆으로 쭉' } },
    ready: 'down', readyLabel: '차렷!', readyScore: armsDown,
    cycle: [['bent', 1], ['out', 1]], targetKeys: ['out'],
    steps: [{ key: 'bent', score: 'bent' }, { key: 'out', score: 'out' }],
    rep: { kind: 'cycle', rest: 'rest', peak: 'out' },
    variants: { full: { score: {
      bent: (F) => all(['bend_elbows', ramp(mx(F.reachRelL, F.reachRelR), 0.75, 0.55)], ['hands_up', ramp(mn(F.wrElL, F.wrElR), -0.10, 0.15)]), // TUNE (아직 측정 전)
      rest: (F) => { const b = all(['bend_elbows', ramp(mx(F.reachRelL, F.reachRelR), 0.75, 0.55)], ['hands_up', ramp(mn(F.wrElL, F.wrElR), -0.10, 0.15)]);
                     const d = ramp(F.maxElev, 55, 35); return d > b.s ? { s: d, why: null } : b; },   // 팔을 완전히 내려도 다시 준비됨
      out:  (F) => all(['arms_out', ramp(mn(F.reachRelL, F.reachRelR), 0.70, 0.85)],
                       ['arms_level', Math.min(band(F.elevL, 65, 120, 20), band(F.elevR, 65, 120, 20))]) } } },
    fallback: null, praise: '팔이 쭉쭉! 어깨가 가벼워졌어요', badge: '튼튼 팔 💪', safety: '양옆에 친구가 없는지 봐요' },

  sky_punch: { id: 'sky_punch', name: '하늘 찌르기', short: '하늘 찌르기', emoji: '☝️', theme: 'coral', diff: 1, legs: 'none', kind: 'alt',
    reps: { single: 8, course: 8 }, unitMs: 550, minGapMs: 350, watchCycles: { single: 1, course: 1 },
    text: { main: '한 팔씩 번갈아\n하늘을 쭉 찔러요!', sub: '반대 팔은 내려요', why: '팔과 어깨를 신나게 깨워요' },
    keys: { center: { spec: KP.DOWN, label: '차렷' },
            left:  { spec: [['leftUpperArm', Z, 1.5], ['rightUpperArm', Z, 1.15]], label: '⬅ 왼팔 쭉' },
            right: { spec: [['rightUpperArm', Z, -1.5], ['leftUpperArm', Z, -1.15]], label: '오른팔 쭉 ➡' } },
    ready: 'center', readyLabel: '차렷!', readyScore: armsDown,
    cycle: [['left', 1], ['center', 0.8], ['right', 1], ['center', 0.8]], targetKeys: ['left', 'right'],
    steps: [{ key: 'left', score: 'left' }, { key: 'right', score: 'right' }],
    rep: { kind: 'alt', rest: 'center', sides: ['left', 'right'] },
    variants: { full: { score: {
      center: (F) => all(['arms_down', ramp(F.maxElev, 80, 55)]),
      left:   (F, k) => all(['arm_higher', ramp(F.elevL, ...A(k, 115, 145, 165))], ['other_down', ramp(F.elevR, 80, 50)]),
      right:  (F, k) => all(['arm_higher', ramp(F.elevR, ...A(k, 115, 145, 165))], ['other_down', ramp(F.elevL, 80, 50)]) } } },
    fallback: null, praise: '하늘까지 닿겠어요! ☁️', badge: '하늘 찌르기왕 ☝️', safety: '앞이 아니라 하늘로 곧게' },

  breathe: { id: 'breathe', name: '숨쉬기 운동', short: '숨쉬기', emoji: '🌬️', theme: 'sky', diff: 1, legs: 'none', kind: 'cycle',
    reps: { single: 2, course: 2 }, unitMs: 1400, minGapMs: 1500, watchCycles: { single: 1, course: 1 }, breath: true,
    text: { main: '팔을 크게 올리며 들이마시고~\n내리며 후~', sub: '천천히, 크게', why: '숨을 고르고 몸을 차분하게' },
    keys: { down: { spec: KP.DOWN, label: '내쉬고 후~' }, mid: { spec: KP.T, label: '' }, up: { spec: KP.UP, label: '들이마시고 흡~' } },
    ready: 'down', readyLabel: '차렷!', readyScore: armsDown,
    cycle: [['mid', 0.7], ['up', 1], ['mid', 0.7], ['down', 1]], targetKeys: ['up'],
    steps: [],                                   // 쉽고 느린 동작: 연습 없음
    rep: { kind: 'cycle', rest: 'down', peak: 'up' },
    variants: { full: { score: {
      down: (F) => all(['arms_down', ramp(F.maxElev, 50, 30)]),
      up:   (F, k) => all(['arms_higher', ramp(F.minElev, ...A(k, 115, 145, 165))]) } } },
    fallback: null, praise: '숨이 차분해졌어요 🌿', badge: '숨쉬기 박사 🌬️', safety: '어지러우면 더 천천히' },

  side_bend: { id: 'side_bend', name: '옆구리 운동', short: '옆구리', emoji: '🌙', theme: 'lavender', diff: 2, legs: 'none', kind: 'alt',
    reps: { single: 4, course: 4 }, unitMs: 1000, minGapMs: 700, watchCycles: { single: 1, course: 1 },
    text: { main: '한 팔을 머리 위로 쭉,\n반대쪽으로 기울여요', sub: '엉덩이는 가운데에 그대로', why: '몸통 옆을 쭉 늘려요' },
    keys: { center: { spec: KP.HIP, label: '바르게' },
            right: { spec: [['spine', Z, 0.3], ['chest', Z, 0.2], ['leftUpperArm', Z, 1.7], ['rightUpperArm', Z, 0.7], ['rightLowerArm', Z, 1.6]], label: '오른쪽으로 ➡' },
            left:  { spec: [['spine', Z, -0.3], ['chest', Z, -0.2], ['rightUpperArm', Z, -1.7], ['leftUpperArm', Z, -0.7], ['leftLowerArm', Z, -1.6]], label: '⬅ 왼쪽으로' } },
    ready: 'center', readyLabel: '손은 허리에!', readyScore: (R) => handsHip(R),
    cycle: [['right', 1], ['center', 0.7], ['left', 1], ['center', 0.7]], targetKeys: ['right', 'left'],
    steps: [{ key: 'right', score: 'right' }, { key: 'left', score: 'left' }],
    rep: { kind: 'alt', rest: 'center', sides: ['right', 'left'] },
    variants: { full: { score: {
      center: (F) => all(['stand_straight', ramp(Math.abs(F.lean ?? 99), 7, 3)]),
      right:  (F, k) => { const l = ramp(F.lean, ...A(k, 5, 12)); return all(['lean_more', l * (0.75 + 0.25 * ramp(F.elevL, 90, 130))], ['arm_over', l >= 0.99 ? 1 : ramp(F.elevL, 90, 130)]); },
      left:   (F, k) => { const l = ramp(neg(F.lean), ...A(k, 5, 12)); return all(['lean_more', l * (0.75 + 0.25 * ramp(F.elevR, 90, 130))], ['arm_over', l >= 0.99 ? 1 : ramp(F.elevR, 90, 130)]); } } } },
    fallback: null, praise: '몸통이 쭉 늘어났어요 🌙', badge: '유연왕 🌙', safety: '편한 만큼만 기울여요' },

  squat: { id: 'squat', name: '말 타기 앉았다 일어서기', short: '말 타기', emoji: '🐴', theme: 'peach', diff: 2, legs: 'prefer', kind: 'cycle',
    reps: { single: 8, course: 4 }, unitMs: 900, minGapMs: 600, watchCycles: { single: 2, course: 1 },
    text: { main: '다리를 넓게,\n말 타듯 살짝 앉았다 일어나요', sub: '무릎은 발끝 방향으로', why: '허벅지와 무릎을 깨워요' },
    keys: { up:   { spec: [...KP.HIP, ['leftUpperLeg', Z, 0.35], ['rightUpperLeg', Z, -0.35]], label: '다리 넓게 서기' },
            down: { spec: [...KP.HIP, ['leftUpperLeg', Z, 1.0], ['rightUpperLeg', Z, -1.0], ['leftLowerLeg', Z, -1.15], ['rightLowerLeg', Z, 1.15]], label: '살짝 앉기' } },
    ready: 'up', readyLabel: '다리를 넓게, 손은 허리에!',
    readyScore: (R, legsOK) => (legsOK ? Math.min(ramp(R.legAngL, 4, 8), ramp(R.legAngR, 4, 8)) : handsHip(R)),
    cycle: [['down', 1], ['up', 1]], targetKeys: ['down'],
    steps: [{ key: 'up', score: 'up' }, { key: 'down', score: 'down' }],
    rep: { kind: 'cycle', rest: 'up', peak: 'down' },
    variants: {
      // 앉기는 주로 화면의 엉덩이 내려감(drop)으로 센다: 다리 넓이와 상관없음. depth(엉덩이~발목)는 기준 자세가 넓게 서 있을 때만
      full: { needLegs: true, score: {
        up:   (F) => { const t = []; if (F.ovOK) t.push(ramp(F.drop, 0.06, 0.03)); if (F.depth != null) t.push(ramp(F.depth, 0.06, 0.03));
                       return { s: t.length ? Math.min(...t) : 0, why: 'stand_up' }; },          // 있는 신호만
        down: (F, k) => ({ s: Math.max(F.ovOK ? ramp(F.drop, ...A(k, 0.08, 0.20)) : 0, F.depth == null ? 0 : ramp(F.depth, ...A(k, 0.04, 0.10))), why: 'lower' }) } }, // TUNE
      upper: { label: '상체로 세어요', score: {
        up:   (F) => all(['stand_up', F.ovOK ? ramp(F.drop, 0.06, 0.03) : 0]),
        down: (F, k) => all(['lower', F.ovOK ? ramp(F.drop, ...A(k, 0.08, 0.20)) : 0], ['stay_put', ramp(Math.abs((F.ovScale ?? 9) - 1), 0.15, 0.08)]) } } }, // TUNE
    fallback: 'upper', praise: '다리가 튼튼해졌어요 💪', badge: '튼튼 다리 🐴',
    safety: '반만 앉아요 · 무릎은 발끝 방향 · 등은 곧게' },

  // jumping_jack은 설정 jumpMode로 정해진다: 'step'(기본, 조용히 한 발씩) | 'jump'
  jumping_jack: (mode) => {
    const step = mode !== 'jump';
    const open2 = [...arms(1.35, -1.35), ['leftUpperLeg', Z, 0.35], ['rightUpperLeg', Z, -0.35]];
    return { id: 'jumping_jack', name: step ? '팔 벌려 콩콩' : '팔 벌려 뛰기', short: step ? '팔 벌려 콩콩' : '팔 벌려 뛰기', emoji: '⭐', theme: 'yellow', diff: 2,
      legs: 'prefer', kind: 'cycle', reps: { single: 8, course: 8 }, unitMs: step ? 600 : 550, minGapMs: 350, watchCycles: { single: 2, course: 1 },
      text: step ? { main: '팔은 머리 위로,\n발은 한쪽씩 옆으로 콩!', sub: '다시 차렷으로 모아요', why: '심장이 두근두근, 온몸이 따뜻해져요' }
                 : { main: '팔은 머리 위로,\n발은 옆으로 콩!', sub: '사뿐사뿐 착지', why: '심장이 두근두근, 온몸이 따뜻해져요' },
      keys: step ? { closed: { spec: KP.DOWN, label: '차렷' },
                     openL: { spec: [...arms(1.35, -1.35), ['leftUpperLeg', Z, 0.4]], label: '팔 위로 · ⬅ 발 옆으로' },
                     openR: { spec: [...arms(1.35, -1.35), ['rightUpperLeg', Z, -0.4]], label: '팔 위로 · 발 옆으로 ➡' } }
                 : { closed: { spec: KP.DOWN, label: '차렷' }, open: { spec: open2, label: '팔 위로 · 발 옆으로' } },
      ready: 'closed', readyLabel: '차렷!', readyScore: armsDown,
      cycle: step ? [['openL', 1], ['closed', 0.8], ['openR', 1], ['closed', 0.8]] : [['open', 1], ['closed', 1]],
      targetKeys: step ? ['openL', 'openR'] : ['open'],
      steps: [{ key: step ? 'openR' : 'open', score: 'open' }, { key: 'closed', score: 'closed' }],
      rep: { kind: 'cycle', rest: 'closed', peak: 'open' },
      variants: {
        full: { needLegs: true, score: {
          closed: (F) => all(['arms_down', ramp(F.maxElev, 60, 35)], ['feet_together', ramp(mx(F.legOutL, F.legOutR), 9, 4)]),
          open:   (F, k) => all(['arms_higher', ramp(F.minElev, ...A(k, 100, 130, 165))],
                                ['feet_apart', ramp(step ? mx(F.legOutL, F.legOutR) : mn(F.legOutL, F.legOutR), ...A(k, 6, 13))]) } },
        upper: { label: '다리가 안 보여서 팔만 세요', score: {
          closed: (F) => all(['arms_down', ramp(F.maxElev, 60, 35)]),
          open:   (F, k) => all(['arms_higher', ramp(F.minElev, ...A(k, 100, 130, 165))]) } } },
      fallback: 'upper', praise: '심장이 두근두근! 몸이 따뜻해졌어요 🔥', badge: step ? '콩콩왕 ⭐' : '점프왕 ⭐',
      safety: step ? '제자리에서 한 발씩 콩' : '제자리에서 작게, 사뿐사뿐' };
  },

  knee_up: { id: 'knee_up', name: '무릎 들어 문 열기', short: '문 열기', emoji: '🚪', theme: 'mint', diff: 2, legs: 'need', kind: 'alt',
    reps: { single: 8, course: 8 }, unitMs: 600, minGapMs: 350, watchCycles: { single: 2, course: 1 },
    text: { main: '허리에 손!\n무릎을 들어 옆으로 문을 열어요', sub: '한 발씩 번갈아', why: '엉덩이 관절과 균형을 깨워요' },
    keys: { center: { spec: KP.HIP, label: '서기' },
            left:  { spec: [...KP.HIP, ['leftUpperLeg', Z, 1.1], ['leftLowerLeg', Z, -1.1]], label: '⬅ 왼쪽 무릎' },
            right: { spec: [...KP.HIP, ['rightUpperLeg', Z, -1.1], ['rightLowerLeg', Z, 1.1]], label: '오른쪽 무릎 ➡' } },
    ready: 'center', readyLabel: '손은 허리에!', readyScore: (R) => handsHip(R),
    cycle: [['left', 1], ['center', 0.8], ['right', 1], ['center', 0.8]], targetKeys: ['left', 'right'],
    steps: [{ key: 'left', score: 'left' }, { key: 'right', score: 'right' }],
    rep: { kind: 'alt', rest: 'center', sides: ['left', 'right'] },
    variants: { full: { needLegs: true, score: {   // 무릎을 앞으로 들어도 센다 (측정 +0.58 / 0.51)
      center: (F) => all(['feet_down', ramp(mx(F.kneeUpL, F.kneeUpR), 0.15, 0.06)]),
      left:   (F, k) => all(['knee_higher', Math.max(ramp((F.kneeUpL ?? -9) - Math.max(0, F.kneeUpR ?? 0), ...A(k, 0.15, 0.32)), ramp(F.footUpL, ...A(k, 0.12, 0.28)))]),
      right:  (F, k) => all(['knee_higher', Math.max(ramp((F.kneeUpR ?? -9) - Math.max(0, F.kneeUpL ?? 0), ...A(k, 0.15, 0.32)), ramp(F.footUpR, ...A(k, 0.12, 0.28)))]) } } },
    fallback: 'move:sky_punch', praise: '달리기 준비 끝! 🏃', badge: '문 열기 달인 🚪', safety: '흔들리면 발을 바로 내려요' },

  leg_side: { id: 'leg_side', name: '다리 옆으로 들기', short: '다리 옆으로', emoji: '🦵', theme: 'mint', diff: 3, legs: 'need', kind: 'alt',
    reps: { single: 4, course: 4 }, unitMs: 800, minGapMs: 500, watchCycles: { single: 1, course: 1 },
    text: { main: '두 팔 옆으로,\n다리를 옆으로 쭉 들어요', sub: '반대 다리는 그대로', why: '엉덩이 옆 근육과 균형을 키워요' },
    keys: { center: { spec: KP.T, label: '팔 옆으로' },
            left:  { spec: [...KP.T, ['leftUpperLeg', Z, 0.5]], label: '⬅ 왼다리 옆으로' },
            right: { spec: [...KP.T, ['rightUpperLeg', Z, -0.5]], label: '오른다리 옆으로 ➡' } },
    ready: 'center', readyLabel: '두 팔을 옆으로!', readyScore: armsT,
    cycle: [['left', 1], ['center', 0.75], ['right', 1], ['center', 0.75]], targetKeys: ['left', 'right'],
    steps: [{ key: 'left', score: 'left' }, { key: 'right', score: 'right' }],
    rep: { kind: 'alt', rest: 'center', sides: ['left', 'right'] },
    variants: { full: { needLegs: true, score: {
      center: (F) => all(['feet_down', ramp(mx(F.legOutL, F.legOutR), 9, 4)]),
      left:   (F, k) => all(['leg_higher', ramp(F.legOutL, ...A(k, 8, 16))], ['foot_up', ramp(F.footUpL, 0.03, 0.10)], ['other_still', ramp(F.legOutR, 12, 6)]),
      right:  (F, k) => all(['leg_higher', ramp(F.legOutR, ...A(k, 8, 16))], ['foot_up', ramp(F.footUpR, 0.03, 0.10)], ['other_still', ramp(F.legOutL, 12, 6)]) } } },
    fallback: 'skip', praise: '균형 최고! 🦵', badge: '균형 다리 🦵', safety: '높이 차지 말고 살짝만' },

  tree: { id: 'tree', name: '나무 자세', short: '나무 자세', emoji: '🌳', theme: 'blue', diff: 3, legs: 'need', kind: 'hold',
    reps: { single: 3, course: 3 /* 쪽마다 */ }, unitMs: 1000, countMs: 700, minGapMs: 0, watchCycles: { single: 1, course: 1 },
    text: { main: '손을 머리 위로 모으고,\n한 발을 다리 안쪽에 대요', sub: '무릎 말고 종아리나 허벅지에', why: '균형 감각을 키워요' },
    keys: { stand: { spec: KP.DOWN, label: '차렷' }, arms: { spec: KP.HANDS_UP, label: '손 위로 모아요' },
            right: { spec: [...KP.HANDS_UP, ['rightUpperLeg', Z, -1.0], ['rightLowerLeg', Z, 2.4]], label: '오른발 들기 ➡' },
            left:  { spec: [...KP.HANDS_UP, ['leftUpperLeg', Z, 1.0], ['leftLowerLeg', Z, -2.4]], label: '⬅ 왼발 들기' } },
    ready: 'stand', readyLabel: '차렷!', readyScore: armsDown,
    cycle: [['arms', 0.8], ['right', 2.4], ['stand', 0.6], ['arms', 0.6], ['left', 2.4], ['stand', 0.6]], targetKeys: ['right', 'left'],
    steps: [{ key: 'arms', score: 'arms' }, { key: 'right', score: 'either' }],
    rep: { kind: 'hold', rest: 'stand', sides: ['right', 'left'], perSide: 3 },
    variants: {
      full: { needLegs: true, score: {
        stand:  (F) => all(['feet_down', ramp(mx(F.footUpL, F.footUpR), 0.08, 0.04)]),
        arms:   (F) => all(['hands_together', Math.min(ramp(mn(F.upL, F.upR), 0.1, 0.45), ramp(F.gap, 0.9, 0.5))]),
        right:  (F, k) => all(['foot_up', ramp(F.footUpR, ...A(k, 0.10, 0.30))]),
        left:   (F, k) => all(['foot_up', ramp(F.footUpL, ...A(k, 0.10, 0.30))]),
        either: (F, k) => all(['foot_up', ramp(mx(F.footUpL, F.footUpR), ...A(k, 0.10, 0.30))]) } },
      upper: { label: '기지개 버티기', keysOverride: { up: { spec: KP.HANDS_UP, label: '기지개 쭉' } }, cycleOverride: [['up', 2.4], ['stand', 0.8]], targetKeys: ['up'],
        rep: { kind: 'hold', rest: 'stand', sides: ['up'], perSide: 3 },
        score: { stand: (F) => all(['arms_down', ramp(F.maxElev, 60, 35)]), up: (F) => all(['arms_higher', ramp(F.minElev, 135, 160)]) } } },
    fallback: 'upper', praise: '흔들흔들 안 넘어졌어요! 🌳', badge: '균형왕 🌳', safety: '흔들리면 바로 발을 내려요' },
};
export const CATALOG_ORDER = ['neck', 'arm_push', 'sky_punch', 'breathe', 'side_bend', 'squat', 'jumping_jack', 'knee_up', 'leg_side', 'tree'];
export const COURSE_DEFAULT = ['neck', 'arm_push', 'side_bend', 'squat', 'jumping_jack', 'breathe'];
export function getMove(id, settings) { const m = MOVES[id]; return typeof m === 'function' ? m((settings || {}).jumpMode) : m; }
export const NUM = ['하나', '둘', '셋', '넷'];
export const countWord = (i) => (i % 4 === 0 ? NUM[Math.floor(i / 4) % 4] : NUM[i % 4]);   // i는 0부터 → 하나 둘 셋 넷 둘 둘 셋 넷

// 고르기 화면 대기 동작·칭찬 동작: Coach(move, 1, 'loop')로 돌림 (cycle 단위가 ms)
const kpKeys = () => Object.fromEntries(Object.entries(KP).map(([k, spec]) => [k, { spec, label: '' }]));
export const IDLE_MOVE = { id: 'idle', keys: kpKeys(), cycle: IDLE_LOOP, targetKeys: [], ready: 'DOWN', rep: null, unitMs: 1 };
export const PRAISE_MOVE = { id: 'praise', keys: kpKeys(), cycle: [['UP', 450], ['CHEER', 450]], targetKeys: [], ready: 'UP', rep: null, unitMs: 1 };

// ── 힌트 (why → 한국어). 연습 2.5 s, 따라 하기 4 s 뒤에 보여 줌, 소리로 읽지 않음 (SPEC §3.8) ──
export const HINTS = {
  head_more: '귀를 어깨 쪽으로 갸우뚱~', head_center: '바르게 서요', stand_straight: '바르게 서요',
  bend_elbows: '손끝을 어깨에 콕!', hands_up: '손끝을 어깨에 콕!', arms_out: '팔을 옆으로 쭉 펴요 ↔️', arms_level: '팔을 옆으로 쭉 펴요 ↔️',
  arm_higher: '팔을 더 높이 쭉! ⬆️', arms_higher: '팔을 더 높이 쭉! ⬆️', arms_down: '팔을 내려요', other_down: '팔을 내려요',
  lean_more: '옆으로 더 기울여요 🌙', arm_over: '반대 팔을 머리 위로!', lower: '조금 더 앉아요 (의자에 앉듯이) 🪑', stand_up: '끝까지 쭉 일어나요',
  stay_put: '제자리에서 해요', feet_apart: '발도 옆으로 콩! 👣', feet_together: '발을 다시 모아요', knee_higher: '무릎을 배꼽 높이까지!',
  feet_down: '두 발로 서요', leg_higher: '다리를 옆으로 조금 더!', foot_up: '발을 바닥에서 떼요', other_still: '반대 다리는 그대로!',
  hands_together: '손을 머리 위로 모아요', other_side: '이번엔 반대쪽! 👉', face_front: '정면을 봐 주세요', too_fast: '천천히~ 숨을 크게 🌬️',
};
// too_fast는 표에 숨쉬기 문구만 있어서, 다른 동작에는 일반 문구를 쓴다
export function hintText(why, move) {
  if (!why) return '';
  if (why === 'too_fast' && !(move && move.breath)) return '천천히, 선생님과 같이 해요 🙂';
  return HINTS[why] || '';
}

// ── 변형(variant)·대체 ──
// resolveVariant: 변형의 keys/cycle/targetKeys/rep/score를 합친 동작 객체 (나무 자세 상체 버전 등). steps는 그 변형에 있는 것만
export function resolveVariant(move, vname = 'full') {
  const name = move.variants[vname] ? vname : 'full', v = move.variants[name];
  const keys = { ...move.keys, ...(v.keysOverride || {}) };
  const targetKeys = v.targetKeys || move.targetKeys;
  let steps = (move.steps || []).filter((st) => keys[st.key] && v.score[st.score]);
  if (!steps.length && (move.steps || []).length) steps = targetKeys.filter((k) => v.score[k]).map((k) => ({ key: k, score: k }));
  return { ...move, variant: name, variantLabel: v.label || null, needLegs: !!v.needLegs, keys,
    cycle: v.cycleOverride || move.cycle, targetKeys, rep: v.rep || move.rep, score: v.score, steps };
}
// fallback 문자열 → { type:'variant', name } | { type:'move', id } | { type:'skip' } | null
export function parseFallback(move) {
  const f = move && move.fallback;
  if (!f) return null;
  if (f === 'skip') return { type: 'skip' };
  if (f.startsWith('move:')) return { type: 'move', id: f.slice(5) };
  return move.variants[f] ? { type: 'variant', name: f } : null;
}
// 다리 판단 (SPEC §5.1): 다리 동작이 아니면 full, '항상 상체'면 대체, 다리가 보이면 full, 아니면 대체
export function legsDecision(move, legsOK, legsMode = 'auto') {
  const full = { type: 'variant', name: 'full' };
  if (!move || move.legs === 'none') return full;
  if (legsMode !== 'upper' && legsOK) return full;
  return parseFallback(move) || full;
}

// ── 설정 (localStorage, 모든 읽기/쓰기 try/catch, 기본값과 합친 뒤 범위 제한) ──
export const LS_PE_SETTINGS = 'fas_pe_settings_v1';
export const LS_PE_STATS = 'fas_pe_stats_v1';
export const LS_PE_DEBUG = 'fas_pe_debug';
export const SENS_K = { easy: 0.8, normal: 1, strict: 1.15 };      // 너그럽게 (어린 학생) / 보통 / 엄격하게
export const TEMPO_CHOICES = [1.25, 1, 0.85];                        // 느리게 / 보통 / 빠르게 (시간 배율)
export const PE_DEFAULTS = Object.freeze({
  sensitivity: 'normal', tempo: 1, practice: true, practiceInCourse: false, holdMs: 400, slipMs: 400,
  jumpMode: 'step', legsMode: 'auto', autoStartSec: 20, resultTimeoutSec: 40, moveTimeLimitSec: 40, noProgressSec: 12,
  sfx: true, voice: true, beatTick: true, volume: 70, enabled: {}, course: {}, reps: {}, devFast: false,
});
const store = (s) => { if (s) return s; try { return globalThis.localStorage || null; } catch (e) { return null; } };
function readJSON(key, s) { try { const st = store(s); const v = st && st.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function writeJSON(key, val, s) { try { const st = store(s); if (!st) return false; st.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
function removeKey(key, s) { try { const st = store(s); if (st) st.removeItem(key); } catch (e) { /* 무시 */ } }
const toBool = (v, d) => (typeof v === 'boolean' ? v : v === 'true' || v === 1 || v === '1' ? true : v === 'false' || v === 0 || v === '0' ? false : d);
const toInt = (v, lo, hi, d) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.round(Math.max(lo, Math.min(hi, n))) : d; };
export const repsRange = (id) => (id === 'tree' ? [1, 5] : [2, 16]);     // 나무 자세는 쪽마다
// 횟수 reps: 숫자 하나면 모든 동작(QA용), 객체면 동작별. 동작별 값은 한 동작·코스 모두에 쓰고, 기본(한 동작) 횟수와 같으면 저장하지 않는다
// (그래야 설정 창에서 그냥 저장해도 코스는 짧은 기본 횟수를 유지)
export function normalizePESettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = PE_DEFAULTS, s = {};
  s.sensitivity = SENS_K[r.sensitivity] != null ? r.sensitivity : d.sensitivity;
  const tp = Number(r.tempo);
  s.tempo = Number.isFinite(tp) ? TEMPO_CHOICES.reduce((a, b) => (Math.abs(b - tp) < Math.abs(a - tp) ? b : a)) : d.tempo;
  for (const f of ['practice', 'practiceInCourse', 'sfx', 'voice', 'beatTick', 'devFast']) s[f] = toBool(r[f], d[f]);
  s.holdMs = toInt(r.holdMs, 200, 1000, d.holdMs);
  s.slipMs = toInt(r.slipMs, 0, 1000, d.slipMs);
  s.jumpMode = r.jumpMode === 'jump' ? 'jump' : 'step';
  s.legsMode = r.legsMode === 'upper' ? 'upper' : 'auto';
  s.autoStartSec = toInt(r.autoStartSec, 0, 60, d.autoStartSec);
  s.resultTimeoutSec = toInt(r.resultTimeoutSec, 0, 120, d.resultTimeoutSec);
  s.moveTimeLimitSec = toInt(r.moveTimeLimitSec, 15, 90, d.moveTimeLimitSec);
  s.noProgressSec = toInt(r.noProgressSec, 6, 40, d.noProgressSec);
  s.volume = toInt(r.volume, 0, 100, d.volume);
  const en = r.enabled && typeof r.enabled === 'object' ? r.enabled : {}, co = r.course && typeof r.course === 'object' ? r.course : {};
  s.enabled = Object.fromEntries(CATALOG_ORDER.map((id) => [id, toBool(en[id], true)]));
  s.course = Object.fromEntries(CATALOG_ORDER.map((id) => [id, toBool(co[id], COURSE_DEFAULT.includes(id))]));
  if (typeof r.reps === 'number' || (typeof r.reps === 'string' && r.reps.trim() !== '' && Number.isFinite(Number(r.reps)))) s.reps = toInt(r.reps, 1, 16, 3);
  else {
    s.reps = {};
    const rp = r.reps && typeof r.reps === 'object' ? r.reps : {};
    for (const id of CATALOG_ORDER) {
      if (rp[id] == null || rp[id] === '') continue;
      const [lo, hi] = repsRange(id), n = toInt(rp[id], lo, hi, null);
      if (n != null && n !== getMove(id, s).reps.single) s.reps[id] = n;
    }
  }
  return s;
}
export function loadPESettings(st) { return normalizePESettings(readJSON(LS_PE_SETTINGS, st)); }
export function savePESettings(s, st) { const clean = normalizePESettings(s); writeJSON(LS_PE_SETTINGS, clean, st); return clean; }
export function resetPESettings(st) { removeKey(LS_PE_SETTINGS, st); return normalizePESettings({}); }
export function isPEDebug(st) { try { const x = store(st); return !!x && x.getItem(LS_PE_DEBUG) === '1'; } catch (e) { return false; } }

export const enabledMoves = (s) => CATALOG_ORDER.filter((id) => !s || !s.enabled || s.enabled[id] !== false);
// 코스 순서 = 목록 순서에서 고른 것, 숨쉬기는 항상 마지막
export function courseMoves(s) {
  const st = s || normalizePESettings({});
  const ids = CATALOG_ORDER.filter((id) => st.enabled[id] !== false && st.course[id]);
  return [...ids.filter((id) => id !== 'breathe'), ...ids.filter((id) => id === 'breathe')];
}
export function repsFor(move, s, inCourse) {
  if (s && typeof s.reps === 'number') return s.reps;
  const v = s && s.reps && s.reps[move.id];
  return v != null ? v : move.reps[inCourse ? 'course' : 'single'];
}
// 링 칸 수: 버티기는 (쪽마다 횟수 × 쪽 수)
export const targetFor = (mv, reps) => (mv.rep && mv.rep.kind === 'hold' ? reps * mv.rep.sides.length : reps);

// ── 통계 (영상·개인정보 없이 집계만) ──
const blankStat = () => ({ started: 0, completed: 0, partial: 0, skipped: 0, assist: 0, manual: 0, upper: 0, sub: 0, stars: 0, rated: 0, totalReps: 0, totalMs: 0 });
export function loadPEStats(st) { const v = readJSON(LS_PE_STATS, st); return v && typeof v === 'object' ? v : {}; }
function editStats(fn, st) { const s = loadPEStats(st); fn(s); writeJSON(LS_PE_STATS, s, st); return s; }
const statOf = (s, id) => (s[id] = { ...blankStat(), ...(s[id] || {}) });
export function recordPEStart(id, st) { return editStats((s) => { statOf(s, id).started++; }, st); }
// outcome: 'completed' | 'partial' | 'skipped' | 'assist', variant: 'full' | 'upper' | 'sub:<id>' | 'skip' | 'assist'
export function recordPEResult(id, { outcome = 'completed', variant = 'full', stars = null, reps = 0, ms = 0, manual = 0 } = {}, st) {
  return editStats((s) => {
    const x = statOf(s, id);
    if (x[outcome] != null && ['completed', 'partial', 'skipped', 'assist'].includes(outcome)) x[outcome]++;
    if (variant === 'upper') x.upper++; else if (typeof variant === 'string' && variant.startsWith('sub:')) x.sub++;
    if (typeof stars === 'number' && stars > 0) { x.stars += stars; x.rated++; }
    x.manual += manual || 0; x.totalReps += reps || 0; x.totalMs += ms || 0;
  }, st);
}
export function recordPESession({ course = false } = {}, st) {
  return editStats((s) => { s.sessions = (s.sessions || 0) + 1; if (course) s.courses = (s.courses || 0) + 1; }, st);
}
export function resetPEStats(st) { removeKey(LS_PE_STATS, st); }
// 운영자 표: 시작 / 완료 / 평균 별 / 상체·대체 % / 평균 시간(초)
export function summarizePEStats(x) {
  const s = { ...blankStat(), ...(x || {}) }, fin = s.completed + s.partial;
  return { started: s.started, completed: s.completed, avgStars: s.rated ? s.stars / s.rated : null,
    altPct: s.started ? Math.round(((s.upper + s.sub) / s.started) * 100) : null, avgSec: fin ? s.totalMs / fin / 1000 : null };
}
