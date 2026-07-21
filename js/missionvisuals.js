// 미션 포즈 시각 자료 (판정 로직과 분리): 포즈별 테마색·문구·난이도·실루엣·아바타 시범포즈
// 판정은 poses.js 그대로 유지. 여기는 "예쁘게 보여주는" 데이터만 담는다.

// ── 포즈별 테마 팔레트 (파스텔) ──
export const THEMES = {
  yellow:   { bg1: '#fff6d8', bg2: '#ffe7b0', accent: '#e8991f', ink: '#7a5410' },
  pink:     { bg1: '#ffe7f0', bg2: '#ffcfe0', accent: '#e05b93', ink: '#8a2a54' },
  mint:     { bg1: '#dff6ec', bg2: '#c2ecd8', accent: '#2fae76', ink: '#1d6b48' },
  sky:      { bg1: '#e2f1fb', bg2: '#c7e5f7', accent: '#3b93cf', ink: '#1d5980' },
  blue:     { bg1: '#e6ecfb', bg2: '#cfd9f5', accent: '#5566cc', ink: '#2e3a80' },
  coral:    { bg1: '#ffe9e2', bg2: '#ffd0c2', accent: '#e8734a', ink: '#8a3a20' },
  lavender: { bg1: '#efe9fb', bg2: '#ddd0f2', accent: '#8a6fd0', ink: '#4b3a86' },
  peach:    { bg1: '#ffeede', bg2: '#ffd9be', accent: '#e0913f', ink: '#8a5417' },
};

// ── 실루엣 라인 아이콘 (SVG, currentColor로 테마색 적용) ──
// 간단한 스틱-피겨. 포즈 형태를 한눈에 보여주는 보조 아이콘.
const F = (parts) =>
  `<svg viewBox="0 0 100 120" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="50" cy="20" r="12" fill="currentColor" stroke="none"/>${parts}</svg>`;
export const SILHOUETTES = {
  armsUp:   F('<path d="M50 32 V78"/><path d="M50 40 L28 12"/><path d="M50 40 L72 12"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  leftUp:   F('<path d="M50 32 V78"/><path d="M50 42 L26 14"/><path d="M50 42 L74 60"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  rightUp:  F('<path d="M50 32 V78"/><path d="M50 42 L74 14"/><path d="M50 42 L26 60"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  armsOut:  F('<path d="M50 32 V78"/><path d="M50 44 L18 44"/><path d="M50 44 L82 44"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  diagUp:   F('<path d="M50 32 V78"/><path d="M50 42 L22 20"/><path d="M50 42 L78 20"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  heart:    F('<path d="M50 34 V80"/><path d="M50 44 C36 30 20 34 30 16 C40 4 50 22 50 22 C50 22 60 4 70 16 C80 34 64 30 50 44Z" fill="currentColor" stroke="none"/><path d="M50 44 L34 34"/><path d="M50 44 L66 34"/><path d="M50 80 L38 108"/><path d="M50 80 L62 108"/>'),
  vsign:    F('<path d="M50 32 V78"/><path d="M50 42 L30 22"/><path d="M50 42 L70 22"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/><circle cx="26" cy="18" r="4" fill="currentColor" stroke="none"/><circle cx="74" cy="18" r="4" fill="currentColor" stroke="none"/>'),
  thumbsUp: F('<path d="M50 32 V78"/><path d="M50 44 L34 34 L34 20"/><path d="M50 44 L70 52"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  pointL:   F('<path d="M50 32 V78"/><path d="M50 44 L14 44"/><path d="M50 44 L70 58"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  pointR:   F('<path d="M50 32 V78"/><path d="M50 44 L86 44"/><path d="M50 44 L30 58"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  lean:     F('<g transform="rotate(-14 50 60)"><path d="M50 32 V78"/><path d="M50 44 L30 60"/><path d="M50 44 L70 60"/><path d="M50 78 L40 108"/><path d="M50 78 L60 108"/></g>'),
  wave:     F('<path d="M50 32 V78"/><path d="M50 42 L74 18"/><path d="M50 44 L30 58"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  cheer:    F('<path d="M50 32 V78"/><path d="M50 42 L28 20"/><path d="M50 42 L72 20"/><path d="M50 78 L36 106"/><path d="M50 78 L64 106"/>'),
  hero:     F('<path d="M50 32 V78"/><path d="M50 42 L72 14"/><path d="M50 44 L32 56"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
  neutral:  F('<path d="M50 32 V78"/><path d="M50 44 L34 70"/><path d="M50 44 L66 70"/><path d="M50 78 L38 108"/><path d="M50 78 L62 108"/>'),
};

// ── 아바타 시범 포즈 (팔/몸통 본 회전) ──
// 각 항목: [본이름, [axisX,axisY,axisZ], 각도(rad)]. 명시 안 된 팔은 자연스러운 차렷.
// 좌우 부호: 왼팔은 +Z로 올라가고, 오른팔은 -Z로 올라감(거울 아님, 아바타 기준).
const UP_L = ['leftUpperArm', [0, 0, 1], 1.45];
const UP_R = ['rightUpperArm', [0, 0, 1], -1.45];
const OUT_L = ['leftUpperArm', [0, 0, 1], 0.05];   // T포즈(수평)
const OUT_R = ['rightUpperArm', [0, 0, 1], -0.05];
const DIAG_L = ['leftUpperArm', [0, 0, 1], 0.8];
const DIAG_R = ['rightUpperArm', [0, 0, 1], -0.8];
const DOWN_L = ['leftUpperArm', [0, 0, 1], -1.15];
const DOWN_R = ['rightUpperArm', [0, 0, 1], 1.15];
// 팔꿈치 굽힘(손이 얼굴/머리 쪽으로)
const BEND_L = ['leftLowerArm', [0, 1, 0], -1.5];
const BEND_R = ['rightLowerArm', [0, 1, 0], 1.5];

export const DEMO = {
  both_up:   [UP_L, UP_R],
  raise_both:[UP_L, UP_R],
  cheer:     [['leftUpperArm', [0,0,1], 1.3], ['rightUpperArm', [0,0,1], -1.3]],
  left_up:   [UP_L, DOWN_R],
  right_up:  [UP_R, DOWN_L],
  point_up:  [UP_R, DOWN_L],
  wave_left: [['leftUpperArm', [0,0,1], 1.25], ['leftLowerArm', [0,0,1], 0.4], DOWN_R],
  wave_right:[['rightUpperArm', [0,0,1], -1.25], ['rightLowerArm', [0,0,1], -0.4], DOWN_L],
  wave_both: [['leftUpperArm', [0,0,1], 1.25], ['rightUpperArm', [0,0,1], -1.25]],
  both_side: [OUT_L, OUT_R],
  airplane:  [OUT_L, OUT_R],
  left_side: [OUT_L, DOWN_R],
  right_side:[OUT_R, DOWN_L],
  both_diag_up:  [DIAG_L, DIAG_R],
  both_diag_down:[['leftUpperArm',[0,0,1],-0.7], ['rightUpperArm',[0,0,1],0.7]],
  lup_rside: [UP_L, OUT_R],
  rup_lside: [UP_R, OUT_L],
  point_left:  [OUT_L, DOWN_R],
  point_right: [OUT_R, DOWN_L],
  hands_hip: [['leftUpperArm',[0,0,1],-0.7],['leftLowerArm',[0,1,0],-1.6],['rightUpperArm',[0,0,1],0.7],['rightLowerArm',[0,1,0],1.6]],
  attention: [DOWN_L, DOWN_R],
  superhero: [UP_R, ['leftUpperArm',[0,0,1],-0.7],['leftLowerArm',[0,1,0],-1.6]],
  overhead_heart: [['leftUpperArm',[0,0,1],1.25],BEND_L,['rightUpperArm',[0,0,1],-1.25],BEND_R],
  v_left:  [['leftUpperArm',[0,0,1],1.0],['leftLowerArm',[0,0,1],1.1], DOWN_R],
  v_right: [['rightUpperArm',[0,0,1],-1.0],['rightLowerArm',[0,0,1],-1.1], DOWN_L],
  v_both:  [['leftUpperArm',[0,0,1],1.0],['leftLowerArm',[0,0,1],1.1],['rightUpperArm',[0,0,1],-1.0],['rightLowerArm',[0,0,1],-1.1]],
  hands_face: [['leftUpperArm',[0,0,1],0.4],['leftLowerArm',[0,1,0],-1.9],['rightUpperArm',[0,0,1],-0.4],['rightLowerArm',[0,1,0],1.9]],
  chin_rest: [['rightUpperArm',[0,0,1],-0.3],['rightLowerArm',[0,1,0],1.9], DOWN_L],
  surprise:  [['leftUpperArm',[0,0,1],0.5],['leftLowerArm',[0,1,0],-1.8],['rightUpperArm',[0,0,1],-0.5],['rightLowerArm',[0,1,0],1.8]],
  thumbsup_left: [['leftUpperArm',[0,0,1],-0.5],['leftLowerArm',[0,1,0],-1.7], DOWN_R],
  thumbsup_right:[['rightUpperArm',[0,0,1],0.5],['rightLowerArm',[0,1,0],1.7], DOWN_L],
  robot: [['leftUpperArm',[0,0,1],-0.6],['leftLowerArm',[0,1,0],-1.7],['rightUpperArm',[0,0,1],0.6],['rightLowerArm',[0,1,0],1.7]],
  lean_left:  [['spine',[0,0,1],0.28], OUT_L, DOWN_R],
  lean_right: [['spine',[0,0,1],-0.28], OUT_R, DOWN_L],
  sway: [['spine',[0,0,1],0.2],['leftUpperArm',[0,0,1],1.0],['rightUpperArm',[0,0,1],-1.0]],
  knee_left: [DOWN_L, DOWN_R],
  knee_right:[DOWN_L, DOWN_R],
};

// ── 포즈별 시각 메타 (테마색·실루엣·문구·난이도) ──
// main/tip/successTip: 짧고 귀엽게. difficulty: 1~3 별.
export const VISUALS = {
  both_up:   { theme: 'yellow', sil: 'armsUp',  diff: 1, main: '양팔을 위로 번쩍 올려요!', tip: '어깨보다 높게 쭉 올려요', ok: '팔을 1초만 유지해요' },
  raise_both:{ theme: 'yellow', sil: 'armsUp',  diff: 1, main: '양팔을 아래에서 위로!', tip: '천천히 위로 올려요', ok: '끝까지 쭉 올려요' },
  cheer:     { theme: 'coral',  sil: 'cheer',   diff: 1, main: '양손 위로! 응원해요!', tip: '두 손을 머리 위로', ok: '신나게 흔들 준비!' },
  left_up:   { theme: 'sky',    sil: 'leftUp',  diff: 1, main: '왼손을 번쩍 들어요!', tip: '왼손만 위로', ok: '오른손은 내려요' },
  right_up:  { theme: 'sky',    sil: 'rightUp', diff: 1, main: '오른손을 번쩍 들어요!', tip: '오른손만 위로', ok: '왼손은 내려요' },
  point_up:  { theme: 'lavender', sil: 'leftUp', diff: 1, main: '하늘을 가리켜요!', tip: '한 손을 위로 쭉', ok: '팔을 곧게 펴요' },
  both_side: { theme: 'mint',   sil: 'armsOut', diff: 1, main: '양팔을 옆으로 쫙!', tip: '어깨 높이로 펴요', ok: '팔을 곧게 펴요' },
  airplane:  { theme: 'sky',    sil: 'armsOut', diff: 1, main: '비행기처럼 팔을 쫙!', tip: '두 팔을 크게 벌려요', ok: '슝~ 날아가는 느낌!' },
  left_side: { theme: 'mint',   sil: 'armsOut', diff: 2, main: '왼팔을 옆으로!', tip: '어깨 높이로 옆에', ok: '오른팔은 내려요' },
  right_side:{ theme: 'mint',   sil: 'armsOut', diff: 2, main: '오른팔을 옆으로!', tip: '어깨 높이로 옆에', ok: '왼팔은 내려요' },
  both_diag_up: { theme: 'peach', sil: 'diagUp', diff: 1, main: '두 팔을 브이로 위로!', tip: '위로 벌려 V자', ok: '활짝 펴요' },
  both_diag_down:{ theme: 'peach', sil: 'neutral', diff: 2, main: '두 팔을 아래로 벌려요!', tip: '아래로 V 거꾸로', ok: '팔을 벌려요' },
  lup_rside: { theme: 'lavender', sil: 'leftUp', diff: 2, main: '왼손 위, 오른팔 옆!', tip: '왼손 하늘, 오른팔 옆', ok: '두 팔 모두 쭉' },
  rup_lside: { theme: 'lavender', sil: 'rightUp', diff: 2, main: '오른손 위, 왼팔 옆!', tip: '오른손 하늘, 왼팔 옆', ok: '두 팔 모두 쭉' },
  point_left:  { theme: 'mint', sil: 'pointL', diff: 2, main: '왼쪽을 가리켜요!', tip: '왼쪽으로 팔을 쭉', ok: '손끝까지 곧게' },
  point_right: { theme: 'mint', sil: 'pointR', diff: 2, main: '오른쪽을 가리켜요!', tip: '오른쪽으로 팔을 쭉', ok: '손끝까지 곧게' },
  hands_hip: { theme: 'coral',  sil: 'neutral', diff: 2, main: '양손을 허리에 콕!', tip: '두 손을 허리에', ok: '으쓱 자신있게!' },
  attention: { theme: 'blue',   sil: 'neutral', diff: 1, main: '두 팔을 아래로 차렷!', tip: '팔을 몸 옆에 붙여요', ok: '바르게 서요' },
  superhero: { theme: 'blue',   sil: 'hero',    diff: 2, main: '한 손 위로! 슈퍼히어로!', tip: '한 손 하늘, 한 손 허리', ok: '멋지게 포즈!' },
  overhead_heart: { theme: 'pink', sil: 'heart', diff: 3, main: '머리 위로 하트를 그려요!', tip: '두 팔을 머리 위로 동그랗게', ok: '손끝을 모아요 💕' },
  v_left:  { theme: 'pink', sil: 'vsign', diff: 3, main: '왼손으로 브이!', tip: '얼굴 옆에 브이', ok: '손가락 두 개 쫙' },
  v_right: { theme: 'pink', sil: 'vsign', diff: 3, main: '오른손으로 브이!', tip: '얼굴 옆에 브이', ok: '손가락 두 개 쫙' },
  v_both:  { theme: 'pink', sil: 'vsign', diff: 3, main: '양손으로 브이!', tip: '두 손 모두 브이', ok: '활짝 웃어요 ✌️' },
  hands_face: { theme: 'peach', sil: 'neutral', diff: 2, main: '양손을 얼굴 옆에!', tip: '두 손을 볼 옆에', ok: '귀엽게 포즈!' },
  chin_rest: { theme: 'lavender', sil: 'neutral', diff: 3, main: '한 손으로 턱을 괴어요!', tip: '손을 턱 아래에', ok: '생각하는 포즈!' },
  surprise:  { theme: 'coral', sil: 'neutral', diff: 2, main: '양손을 볼에! 깜짝!', tip: '두 손을 볼에 대고', ok: '놀란 표정으로!' },
  thumbsup_left: { theme: 'mint', sil: 'thumbsUp', diff: 3, main: '왼손 엄지척!', tip: '엄지를 위로', ok: '최고예요 👍' },
  thumbsup_right:{ theme: 'mint', sil: 'thumbsUp', diff: 3, main: '오른손 엄지척!', tip: '엄지를 위로', ok: '최고예요 👍' },
  robot: { theme: 'blue', sil: 'neutral', diff: 2, main: '팔을 접어 로봇처럼!', tip: '팔꿈치를 90도로', ok: '삐빅- 로봇!' },
  lean_left:  { theme: 'lavender', sil: 'lean', diff: 2, main: '몸을 왼쪽으로 기울여요!', tip: '상체를 왼쪽으로', ok: '살짝만 기울여요' },
  lean_right: { theme: 'lavender', sil: 'lean', diff: 2, main: '몸을 오른쪽으로 기울여요!', tip: '상체를 오른쪽으로', ok: '살짝만 기울여요' },
  sway: { theme: 'peach', sil: 'wave', diff: 2, main: '몸을 좌우로 흔들어요!', tip: '상체를 왔다갔다', ok: '리듬을 타요 🎵' },
  wave_left:  { theme: 'yellow', sil: 'wave', diff: 1, main: '왼손을 흔들어요!', tip: '왼손 들고 흔들흔들', ok: '안녕~ 👋' },
  wave_right: { theme: 'yellow', sil: 'wave', diff: 1, main: '오른손을 흔들어요!', tip: '오른손 들고 흔들흔들', ok: '안녕~ 👋' },
  wave_both:  { theme: 'yellow', sil: 'wave', diff: 1, main: '양손을 흔들어요!', tip: '두 손 들고 흔들흔들', ok: '반가워요 🙌' },
  knee_left:  { theme: 'blue', sil: 'neutral', diff: 3, main: '왼쪽 무릎을 굽혀요!', tip: '왼발을 살짝 들어요', ok: '천천히 굽혀요' },
  knee_right: { theme: 'blue', sil: 'neutral', diff: 3, main: '오른쪽 무릎을 굽혀요!', tip: '오른발을 살짝 들어요', ok: '천천히 굽혀요' },
};

export function visualFor(poseId) {
  return VISUALS[poseId] || { theme: 'pink', sil: 'neutral', diff: 2, main: '포즈를 따라 해요!', tip: '', ok: '' };
}
export function demoFor(poseId) {
  return DEMO[poseId] || [];
}
export function themeOf(name) { return THEMES[name] || THEMES.pink; }
