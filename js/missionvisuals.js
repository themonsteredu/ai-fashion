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
// 귀여운 통통 캐릭터(스티커) 실루엣. 큰 머리 + 원피스 + 통통한 팔/손.
// arms: 어깨→손 팔 path들과 손(작은 원). extra: 하트·브이 표시 등.
// L 어깨(38,56), R 어깨(62,56). 손은 hand(x,y)로 통통하게.
const hand = (x, y, r = 7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`;
const arm = (sx, sy, hx, hy) =>
  `<path d="M${sx} ${sy} L${hx} ${hy}" stroke="currentColor" stroke-width="12" stroke-linecap="round" fill="none"/>${hand(hx, hy)}`;
// 팔꿈치가 굽은 팔: 어깨→팔꿈치→손
const bentArm = (sx, sy, ex, ey, hx, hy, r = 7) =>
  `<path d="M${sx} ${sy} L${ex} ${ey} L${hx} ${hy}" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>${hand(hx, hy, r)}`;
const armL = (hx, hy) => arm(40, 56, hx, hy);
const armR = (hx, hy) => arm(60, 56, hx, hy);

// ── 얼굴 표정 (머리 중심 50,29 / 반지름 16 / 흰색으로 대비) ──
const W = '#fff';
function face(id = 'happy') {
  const dot = (x, y = 26) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${W}"/>`;
  const up = (x) => `<path d="M${x - 3.2} 27 Q${x} 23.4 ${x + 3.2} 27" stroke="${W}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`; // ^ 웃는 눈
  const smile = `<path d="M44.5 33 Q50 37.6 55.5 33" stroke="${W}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`;
  const smileBig = `<path d="M43 32 Q50 40 57 32" stroke="${W}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  const blush = `<circle cx="39.5" cy="33" r="2.6" fill="${W}" opacity="0.5"/><circle cx="60.5" cy="33" r="2.6" fill="${W}" opacity="0.5"/>`;
  switch (id) {
    case 'grin':     return up(44) + up(56) + smileBig;
    case 'surprise': return dot(44) + dot(56) + `<ellipse cx="50" cy="35" rx="3.2" ry="4" fill="${W}"/>`;
    case 'wink':     return `<path d="M41 26 Q44 23.8 47 26" stroke="${W}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` + dot(56) + smile;
    case 'shy':      return up(44) + up(56) + blush + `<path d="M46 34 Q50 36.6 54 34" stroke="${W}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    case 'cool':     return `<rect x="38.5" y="23.5" width="9" height="5" rx="2.2" fill="${W}"/><rect x="52.5" y="23.5" width="9" height="5" rx="2.2" fill="${W}"/><path d="M47.5 25.8 L52.5 25.8" stroke="${W}" stroke-width="1.6"/>` + smile;
    case 'tongue':   return up(44) + up(56) + `<path d="M45 33 Q50 36 55 33" stroke="${W}" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="52" cy="35.6" rx="2.2" ry="3" fill="${W}"/>`;
    case 'think':    return dot(45, 25) + dot(57, 25) + `<path d="M46 34 L54 34" stroke="${W}" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'happy':
    default:         return dot(44) + dot(56) + smile;
  }
}

// ── 다리 모양 ──
const shoe = (x, y = 113) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="4" fill="currentColor"/>`;
const legLine = (x1, y1, x2, y2, x3, y3) => x3 === undefined
  ? `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="currentColor" stroke-width="9" stroke-linecap="round" fill="none"/>`
  : `<path d="M${x1} ${y1} L${x2} ${y2} L${x3} ${y3}" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const LEGS = {
  stand: legLine(45, 92, 43, 110) + legLine(55, 92, 57, 110) + shoe(42) + shoe(58),
  wide:  legLine(45, 92, 33, 110) + legLine(55, 92, 67, 110) + shoe(32) + shoe(68),
  one:   legLine(45, 92, 44, 110) + shoe(43) + legLine(55, 92, 64, 100, 53, 103) + `<ellipse cx="51" cy="104" rx="6" ry="4" fill="currentColor"/>`,
  squat: legLine(45, 93, 37, 101, 40, 112) + legLine(55, 93, 63, 101, 60, 112) + shoe(39, 114) + shoe(61, 114),
};

function CH(arms, extra = '', rot = 0, opts = {}) {
  const g = rot ? ` transform="rotate(${rot} 50 62)"` : '';
  const legs = LEGS[opts.legs] || LEGS.stand;
  return `<svg viewBox="0 0 100 122" fill="none"><g${g}>
    <!-- 다리 -->
    ${legs}
    <!-- 원피스 (A라인) -->
    <path d="M37 50 Q50 45 63 50 L72 92 Q50 100 28 92 Z" fill="currentColor"/>
    <!-- 머리카락(뒤) + 머리 -->
    <path d="M31 30 Q31 8 50 8 Q69 8 69 30 Q69 46 61 50 L39 50 Q31 46 31 30Z" fill="currentColor" opacity="0.55"/>
    <circle cx="50" cy="29" r="16" fill="currentColor"/>
    ${face(opts.face)}
    <!-- 팔 -->
    ${arms}${extra}
  </g></svg>`;
}
export const SILHOUETTES = {
  armsUp:   CH(armL(24, 16) + armR(76, 16)),
  leftUp:   CH(armL(23, 14) + armR(74, 66)),
  rightUp:  CH(armL(26, 66) + armR(77, 14)),
  armsOut:  CH(armL(14, 52) + armR(86, 52)),
  diagUp:   CH(armL(20, 26) + armR(80, 26)),
  heart:    CH(armL(38, 24) + armR(62, 24),
              '<path d="M50 9 C47 3 39 3 39 10 C39 16 50 22 50 22 C50 22 61 16 61 10 C61 3 53 3 50 9Z" fill="currentColor" stroke="#fff" stroke-width="2.5"/>', 0, { face: 'shy' }),
  vsign:    CH(armL(30, 22) + armR(70, 22),
              '<path d="M25 20 L21 7 M31 20 L35 8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M69 20 L65 8 M75 20 L79 7" stroke="#fff" stroke-width="3" stroke-linecap="round"/>', 0, { face: 'grin' }),
  thumbsUp: CH(armL(30, 74) + armR(66, 42),
              '<path d="M66 40 L66 26" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><circle cx="66" cy="24" r="4" fill="currentColor" stroke="#fff" stroke-width="1.5"/>', 0, { face: 'grin' }),
  pointL:   CH(armL(12, 52) + armR(70, 68)),
  pointR:   CH(armL(30, 68) + armR(88, 52)),
  lean:     CH(armL(30, 60) + armR(70, 60), '', -14),
  wave:     CH(armR(76, 16) + armL(30, 62),
              '<path d="M82 12 Q86 16 82 20 M84 18 Q88 22 84 26" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>', 0, { face: 'wink' }),
  cheer:    CH(armL(22, 20) + armR(78, 20), '', 0, { face: 'grin' }),
  hero:     CH(armR(78, 14) + armL(34, 60), '', 0, { face: 'cool' }),
  neutral:  CH(armL(30, 74) + armR(70, 74)),
  // 웃음 포인트 포즈
  muscle:   CH(bentArm(40, 56, 22, 52, 34, 28) + bentArm(60, 56, 78, 52, 66, 28), '', 0, { face: 'grin' }),
  disco:    CH(armR(84, 16) + armL(20, 90),
              '<path d="M84 15 L90 7" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>', 0, { face: 'cool' }),
  trex:     CH(bentArm(40, 56, 35, 66, 47, 70, 5) + bentArm(60, 56, 65, 66, 53, 70, 5), '', 0, { face: 'tongue' }),
  selfhug:  CH(arm(40, 56, 61, 48) + arm(60, 56, 39, 48), '', 0, { face: 'shy' }),
  dab:      CH(armR(85, 22) + bentArm(40, 56, 54, 42, 76, 28), '', 0, { face: 'cool' }),
  robot:    CH(bentArm(40, 56, 26, 56, 42, 64, 6) + bentArm(60, 56, 74, 56, 58, 64, 6), '', 0, { face: 'surprise' }),
  surprise: CH(bentArm(40, 56, 28, 44, 39, 30) + bentArm(60, 56, 72, 44, 61, 30), '', 0, { face: 'surprise' }),
  think:    CH(bentArm(60, 56, 74, 54, 53, 35) + armL(30, 72), '', -8, { face: 'think' }),
  // 다리 쓰는 포즈
  wideStand: CH(armL(16, 54) + armR(84, 54), '', 0, { face: 'grin', legs: 'wide' }),
  oneLeg:    CH(armL(16, 50) + armR(84, 50), '', 0, { face: 'happy', legs: 'one' }),
  squat:     CH(armL(20, 62) + armR(80, 62), '', 0, { face: 'grin', legs: 'squat' }),
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
  // 웃음 포인트 포즈 시범
  muscle:  [['leftUpperArm',[0,0,1],0.9],['leftLowerArm',[0,0,1],1.0],['rightUpperArm',[0,0,1],-0.9],['rightLowerArm',[0,0,1],-1.0]],
  disco:   [['rightUpperArm',[0,0,1],-1.2],['leftUpperArm',[0,0,1],-0.55]],
  trex:    [['leftUpperArm',[0,0,1],-0.75],['leftLowerArm',[0,1,0],-1.95],['rightUpperArm',[0,0,1],0.75],['rightLowerArm',[0,1,0],1.95]],
  selfhug: [['leftUpperArm',[0,0,1],0.3],['leftLowerArm',[0,1,0],-2.1],['rightUpperArm',[0,0,1],-0.3],['rightLowerArm',[0,1,0],2.1]],
  dab:     [['rightUpperArm',[0,0,1],-1.05],['leftUpperArm',[0,0,1],-0.5],['leftLowerArm',[0,1,0],-1.3]],
  // 다리 쓰는 포즈 시범
  wide_stand: [['leftUpperLeg',[0,0,1],0.22],['rightUpperLeg',[0,0,1],-0.22],OUT_L,OUT_R],
  one_leg:    [['rightUpperLeg',[0,0,1],-0.5],['rightLowerLeg',[1,0,0],0.9],['leftUpperArm',[0,0,1],0.9],['rightUpperArm',[0,0,1],-0.9]],
  squat:      [['leftUpperLeg',[0,0,1],0.36],['rightUpperLeg',[0,0,1],-0.36],['leftLowerLeg',[1,0,0],1.25],['rightLowerLeg',[1,0,0],1.25],['spine',[1,0,0],0.22]],
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
  hands_face: { theme: 'peach', sil: 'surprise', diff: 2, main: '부끄부끄~ 🙈', tip: '두 손을 볼 옆에 살짝', ok: '수줍수줍 🙈' },
  chin_rest: { theme: 'lavender', sil: 'think', diff: 2, main: '음~ 갸우뚱 궁금이 🤔', tip: '한 손으로 턱을 괴고 갸웃', ok: '골똘히 생각 중! 🤔' },
  surprise:  { theme: 'coral', sil: 'surprise', diff: 2, main: '헉! 깜짝 놀랐어요! 😱', tip: '두 손을 볼에 대고 놀란 척', ok: '깜짝이야! 😱' },
  thumbsup_left: { theme: 'mint', sil: 'thumbsUp', diff: 3, main: '왼손 엄지척!', tip: '엄지를 위로', ok: '최고예요 👍' },
  thumbsup_right:{ theme: 'mint', sil: 'thumbsUp', diff: 3, main: '오른손 엄지척!', tip: '엄지를 위로', ok: '최고예요 👍' },
  robot: { theme: 'blue', sil: 'robot', diff: 2, main: '삐빅- 나는 로봇! 🤖', tip: '팔꿈치를 90도로 앞으로', ok: '삐빅- 로봇 완성! 🤖' },
  muscle: { theme: 'coral', sil: 'muscle', diff: 2, main: '두 팔 접어 알통 뽐내기! 💪', tip: '두 주먹을 머리 옆으로', ok: '힘 꽉! 최고예요 💪' },
  disco:  { theme: 'lavender', sil: 'disco', diff: 2, main: '토요일 밤 디스코! 🕺', tip: '한 손 하늘, 한 손 아래로', ok: '존 트라볼타처럼! 🕺' },
  trex:   { theme: 'mint', sil: 'trex', diff: 1, main: '티라노 공룡이 됐어요! 🦖', tip: '팔은 작게 앞으로 오므려요', ok: '어흥~ 공룡! 🦖' },
  selfhug:{ theme: 'pink', sil: 'selfhug', diff: 1, main: '나를 꼬옥 안아줘요! 🤗', tip: '두 손을 반대쪽 어깨에', ok: '포근포근 🤗' },
  dab:    { theme: 'sky', sil: 'dab', diff: 2, main: '댑! 한쪽으로 쭉! 🙆', tip: '두 팔 같은 쪽, 얼굴은 팔에 쏙', ok: '요즘 최고 유행! 🙆' },
  wide_stand: { theme: 'mint', sil: 'wideStand', diff: 1, main: '두 발을 넓게 벌려요!', tip: '어깨보다 넓게 쫙', ok: '튼튼하게 섰어요! 💪' },
  one_leg:    { theme: 'sky', sil: 'oneLeg', diff: 2, main: '한 발 들어 홍학처럼! 🦩', tip: '한 발을 살짝 들어 균형', ok: '균형 최고! 🦩' },
  squat:      { theme: 'coral', sil: 'squat', diff: 2, main: '무릎 굽혀 살짝 앉아요!', tip: '엉덩이를 살짝 내려요', ok: '스쿼트 성공! 💪' },
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
