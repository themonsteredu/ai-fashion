// 그림(PNG·JPG) 아바타: 평면 그림을 관절대로 나눠 종이인형처럼 움직인다.
//
// 동작 원리
//  - 3D 아바타(VRM)는 그대로 불러오되 화면에서는 숨긴다. 웹캠 동작 인식·미션 시범 포즈는
//    지금처럼 그 3D 아바타를 움직이고(motion.js / applyDemoPose 변경 없음),
//    여기서는 매 프레임 그 3D 뼈대의 "화면상 방향"을 읽어 그림의 팔·다리·몸통·머리에 옮긴다.
//  - 그림의 관절 위치는 MediaPipe 포즈 인식(IMAGE 모드)으로 자동으로 찾는다.
//    기본 캐릭터(character.png)는 미리 찾아 둔 관절 파일(character.rig.json)을 쓴다.
//  - 관절을 못 찾은 그림은 "등신대" 방식(그림 전체가 한 덩어리로 옆걸음·앉기·기울이기)으로 움직인다.
import * as THREE from 'three';
import * as Avatar from './avatar.js';

const MAX_SIDE = 2048;     // 그림 긴 변 최대 픽셀 (큰 사진은 줄여서 사용)
const GRID_ROWS = 120;     // 메시 세로 격자 수
const MIN_IMAGE_PX = 200;  // 너무 작은 그림은 거절
const CROP_MARGIN = 0.02;  // 잘라낼 때 남길 여백 비율

// 사용자에게 보여 줄 오류 문구 (main.js 의 alert 에서 그대로 사용)
const MESSAGES = {
  decode: '그림 파일을 열 수 없어요. PNG 또는 JPG 그림인지 확인해 주세요.\n(아이폰 HEIC 사진은 JPG로 바꿔서 가져와 주세요)',
  small: '그림이 너무 작아요. 더 큰 그림(가로·세로 200픽셀 이상)을 선택해 주세요.',
  empty: '그림에 보이는 부분이 없어요. 다른 그림을 선택해 주세요.',
};
export class ImageAvatarError extends Error {
  constructor(reason, detail) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'ImageAvatarError';
    this.reason = reason;
    this.userMessage = MESSAGES[reason] || MESSAGES.decode;
  }
}

// 이미지 파일인지 확인 (확장자·MIME·파일 앞부분 바이트)
export async function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  if (/\.(png|jpe?g|webp)$/i.test(file.name || '')) return true;
  try {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;           // PNG
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                              // JPEG
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;           // WEBP
  } catch (e) { /* 읽기 실패 → 그림 아님으로 처리 */ }
  return false;
}

// ── 1. 그림 준비: 디코딩 → 크기 조정 → 단색 배경 지우기 → 보이는 부분만 잘라내기 ──
async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) {
    try { return await createImageBitmap(blob); }
    catch (e2) { throw new ImageAvatarError('decode', e2 && e2.message); }
  }
}

// 배경이 투명하지 않은 그림(흰 배경 등): 가장자리와 이어진 비슷한 색을 투명하게
function removeFlatBackground(data, w, h) {
  const px = data.data;
  // 가장자리 픽셀 색의 중앙값
  const border = [];
  const pushPx = (x, y) => { const i = (y * w + x) * 4; border.push([px[i], px[i + 1], px[i + 2]]); };
  for (let x = 0; x < w; x += 2) { pushPx(x, 0); pushPx(x, h - 1); }
  for (let y = 0; y < h; y += 2) { pushPx(0, y); pushPx(w - 1, y); }
  const med = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1]);
  const TOL = 15; // 엄격하게: 흰 신발·밝은 옷이 배경과 함께 지워지지 않도록
  const near = (i) => Math.abs(px[i] - med[0]) + Math.abs(px[i + 1] - med[1]) + Math.abs(px[i + 2] - med[2]) <= TOL * 1.6;
  const okBorder = border.filter((p) => Math.abs(p[0] - med[0]) + Math.abs(p[1] - med[1]) + Math.abs(p[2] - med[2]) <= TOL * 1.6).length;
  if (okBorder / border.length < 0.85) return false; // 배경이 단색이 아님 → 그대로 사용(네모 카드처럼 보임)

  const bg = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => { const k = y * w + x; if (!bg[k] && near(k * 4)) { bg[k] = 1; stack.push(k); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(); const x = k % w, y = (k / w) | 0;
    if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1);
  }
  for (let k = 0; k < w * h; k++) {
    if (bg[k]) { px[k * 4 + 3] = 0; continue; }
    // 배경과 맞닿은 테두리 1픽셀은 반투명으로 부드럽게
    const x = k % w, y = (k / w) | 0;
    if ((x > 0 && bg[k - 1]) || (x < w - 1 && bg[k + 1]) || (y > 0 && bg[k - w]) || (y < h - 1 && bg[k + w])) {
      px[k * 4 + 3] = Math.min(px[k * 4 + 3], 150);
    }
  }
  return true;
}

// 가장 큰 덩어리(인물)와 그 근처 덩어리만 남기고 나머지는 투명하게
function removeDebris(a, w, h) {
  const CS = Math.max(4, Math.round(h / GRID_ROWS));
  const gw = Math.ceil(w / CS), gh = Math.ceil(h / CS);
  const occ = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a[(y * w + x) * 4 + 3] > 16) occ[((y / CS) | 0) * gw + ((x / CS) | 0)] = 1;
  }
  const lab = new Int32Array(gw * gh).fill(-1), comps = [];
  for (let st0 = 0; st0 < gw * gh; st0++) {
    if (!occ[st0] || lab[st0] >= 0) continue;
    const c = { n: 0, x0: gw, y0: gh, x1: -1, y1: -1 }, st = [st0]; lab[st0] = comps.length;
    while (st.length) {
      const k = st.pop(), x = k % gw, y = (k / gw) | 0; c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nk = ny * gw + nx;
        if (occ[nk] && lab[nk] < 0) { lab[nk] = comps.length; st.push(nk); }
      }
    }
    comps.push(c);
  }
  if (comps.length < 2) return;
  const main = comps.reduce((p, q) => (q.n > p.n ? q : p));
  const M = 2; // 인물 상자 바깥 여유(칸)
  const keep = comps.map((c) => c === main || (c.n >= main.n * 0.15) ||
    (c.x1 >= main.x0 - M && c.x0 <= main.x1 + M && c.y1 >= main.y0 - M && c.y0 <= main.y1 + M));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lab[((y / CS) | 0) * gw + ((x / CS) | 0)];
    if (l >= 0 && !keep[l]) a[(y * w + x) * 4 + 3] = 0;
  }
}

// 반환: { canvas, w, h, toCanvas(x01, y01) — 원본 그림 비율 좌표 → 준비된 캔버스 픽셀 }
async function prepareImage(blob) {
  const bmp = await decodeImage(blob);
  const W0 = bmp.width, H0 = bmp.height;
  if (Math.max(W0, H0) < MIN_IMAGE_PX) throw new ImageAvatarError('small');
  const s0 = Math.min(1, MAX_SIDE / Math.max(W0, H0));
  const w = Math.round(W0 * s0), h = Math.round(H0 * s0);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high'; // 큰 사진을 한 번에 줄일 때 계단 현상 방지
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const data = g.getImageData(0, 0, w, h);
  const a = data.data;

  // 투명 배경 여부
  let transparent = 0;
  let dirty = false;
  for (let i = 3; i < a.length; i += 4 * 7) if (a[i] < 250) transparent++;
  let cardLike = false;
  if (transparent / (a.length / (4 * 7)) < 0.01) {
    if (removeFlatBackground(data, w, h)) dirty = true;
    else cardLike = true;
  }

  // 떨어져 있는 작은 조각(서명·얼룩·그림자 등)은 지운다 — 발이 바닥에 안 닿거나 그림이 작아지는 것 방지
  if (!cardLike) { removeDebris(a, w, h); dirty = true; }
  if (dirty) g.putImageData(data, 0, 0);

  // 보이는 부분의 테두리 상자
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new ImageAvatarError('empty');
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * CROP_MARGIN);
  const cx0 = Math.max(0, x0 - m), cy0 = Math.max(0, y0 - m);
  const cx1 = Math.min(w - 1, x1 + m), cy1 = Math.min(h - 1, y1 + m);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  if (ch < MIN_IMAGE_PX * 0.75 && cw < MIN_IMAGE_PX * 0.75) throw new ImageAvatarError('small');
  const out = document.createElement('canvas'); out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(c, cx0, cy0, cw, ch, 0, 0, cw, ch);
  return {
    canvas: out, w: cw, h: ch,
    contentTop: y0 - cy0,           // 머리끝(보이는 부분의 맨 위)
    contentLeft: x0 - cx0, contentRight: x1 - cx0,
    contentBottom: y1 - cy0,        // 발끝(보이는 부분의 맨 아래) — 바닥에 맞춘다
    cardLike,
    toCanvas: (x01, y01) => [x01 * w - cx0, y01 * h - cy0],
    fromCanvas: (x, y) => [(x + cx0) / w, (y + cy0) / h],
  };
}

// ── 2. 관절 자동 찾기 (MediaPipe 포즈, IMAGE 모드) ──
const LM = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_INDEX: 19, R_INDEX: 20,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28, L_FOOT: 31, R_FOOT: 32,
};

async function detectJoints(prep) {
  const { FilesetResolver, PoseLandmarker } = await import('../lib/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');
  const pl = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: './models/pose_landmarker_full.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numPoses: 1,
  });
  try {
    // 투명 부분은 회색으로 채워 인식시킨다
    const c = document.createElement('canvas'); c.width = prep.w; c.height = prep.h;
    const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(prep.canvas, 0, 0);
    const res = pl.detect(c);
    const lm = res && res.landmarks && res.landmarks[0];
    if (!lm) return null;
    const joints = {}, vis = {};
    for (const [k, i] of Object.entries(LM)) {
      const p = lm[i];
      if (!p) continue;
      joints[k] = [p.x * prep.w, p.y * prep.h];
      vis[k] = p.visibility == null ? 1 : p.visibility;
    }
    // 그림의 오른쪽(화면 오른쪽)이 L_* 가 되도록 맞춘다 (3D 아바타의 left* 뼈가 화면 오른쪽에 있음).
    // 뒷모습·특이한 그림에서 좌우가 바뀌어 인식되면 팔이 몸을 가로지르는 것 방지
    const dx = (p, q) => (joints[p] && joints[q] ? joints[p][0] - joints[q][0] : 0);
    if (dx('L_SH', 'R_SH') + dx('L_HIP', 'R_HIP') < 0) {
      for (const key of Object.keys(LM)) {
        if (!key.startsWith('L_')) continue;
        const r = 'R_' + key.slice(2);
        if (!(key in joints) || !(r in joints)) continue;
        [joints[key], joints[r]] = [joints[r], joints[key]];
        [vis[key], vis[r]] = [vis[r], vis[key]];
      }
    }
    return { joints, vis };
  } finally {
    try { pl.close(); } catch (e) { /* 무시 */ }
  }
}

// 찾은 관절로 몸 전체/상반신/등신대 중 어떤 방식으로 움직일지 결정
function chooseMode(found, prep) {
  if (!found) return 'standee';
  const { joints: J, vis: V } = found;
  const ok = (keys, v) => keys.every((k) => J[k] && (V[k] == null || V[k] >= v));
  if (!ok(['L_SH', 'R_SH', 'L_HIP', 'R_HIP'], 0.6)) return 'standee';
  const shW = Math.hypot(J.L_SH[0] - J.R_SH[0], J.L_SH[1] - J.R_SH[1]);
  const torso = ((J.L_HIP[1] + J.R_HIP[1]) - (J.L_SH[1] + J.R_SH[1])) / 2;
  if (shW < prep.h * 0.04 || torso < prep.h * 0.05) return 'standee'; // 엉뚱한 곳을 찾은 경우
  if (!ok(['L_EL', 'R_EL', 'L_WR', 'R_WR'], 0.5)) return 'standee';
  // 다리: 발목까지 그림 안에 있고 신뢰도가 높을 때만
  const inside = (k) => J[k][1] < prep.h * 0.999 && J[k][1] > 0;
  if (ok(['L_KNEE', 'R_KNEE', 'L_ANK', 'R_ANK'], 0.6) && inside('L_ANK') && inside('R_ANK')) return 'full';
  return 'upper';
}

// ── 3. 뼈대 정의 (그림 픽셀 좌표) ──
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const add2 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (v) => Math.hypot(v[0], v[1]);

// bones: [{ name, parent, head:[x,y], tail:[x,y], drive, vrm, layer }]
//  drive: 'abs' = 3D 아바타의 화면상 방향을 그대로, 'delta' = 처음 자세에서 바뀐 만큼만,
//         'follow' = 부모(아래팔·종아리)와 같이 회전
function buildBoneDefs(mode, J, prep) {
  if (mode === 'standee') {
    const bottom = [prep.w / 2, prep.contentBottom];
    const top = [prep.w / 2, prep.h * 0.1];
    return [{ name: 'root', parent: null, head: bottom, tail: top, drive: 'standee', layer: 1 }];
  }
  const hipC = lerp2(J.L_HIP, J.R_HIP, 0.5);
  const shC = lerp2(J.L_SH, J.R_SH, 0.5);
  const nose = J.NOSE || add2(shC, [0, -(hipC[1] - shC[1]) * 0.45]);
  const neck = lerp2(shC, nose, 0.3);
  const headTop = add2(nose, sub2(nose, neck), 1.2);
  // 몸통 영역(어깨~엉덩이 사각형, 아래쪽은 어깨너비의 90%까지 넓힘): 이 안의 그림은 팔이 아니라 몸통에 붙인다.
  // (팔을 들 때 조끼·셔츠 옆구리가 팔에 끌려 올라가는 것 방지)
  const shW = len2(sub2(J.L_SH, J.R_SH));
  const hipHalf = Math.max(len2(sub2(J.L_HIP, J.R_HIP)) / 2, shW * 0.45);
  const side = sub2(J.L_HIP, J.R_HIP); const sl = len2(side) || 1; const ux = [side[0] / sl, side[1] / sl];
  const inset = (p, q, t) => lerp2(p, q, t); // 어깨 꼭짓점을 몸 안쪽으로 살짝
  const torso = [inset(J.L_SH, shC, 0.03), inset(J.R_SH, shC, 0.03), add2(hipC, ux, -hipHalf), add2(hipC, ux, hipHalf)];
  const B = [
    { name: 'root', parent: null, head: hipC, tail: hipC, drive: 'none', layer: 1 },
    { name: 'spine', parent: 'root', head: hipC, tail: neck, drive: 'delta', vrm: ['hips', 'neck'], layer: 1, region: torso },
    { name: 'head', parent: 'spine', head: neck, tail: headTop, drive: 'delta', vrm: ['neck', 'head', 'headUp'], layer: 2 },
  ];
  for (const s of ['L', 'R']) {
    const vs = s === 'L' ? 'left' : 'right';
    const el = J[s + '_EL'], wr = J[s + '_WR'];
    const handEnd = J[s + '_INDEX'] && len2(sub2(J[s + '_INDEX'], wr)) > 2 ? add2(wr, sub2(J[s + '_INDEX'], wr), 1.2) : add2(wr, sub2(wr, el), 0.35);
    B.push(
      { name: s + 'upperArm', parent: 'spine', head: J[s + '_SH'], tail: el, drive: 'abs', vrm: [vs + 'UpperArm', vs + 'LowerArm'], layer: 3, seedFrom: 0.18 },
      { name: s + 'lowerArm', parent: s + 'upperArm', head: el, tail: wr, drive: 'abs', vrm: [vs + 'LowerArm', vs + 'Hand'], layer: 3 },
      { name: s + 'hand', parent: s + 'lowerArm', head: wr, tail: handEnd, drive: 'follow', layer: 3 },
    );
  }
  if (mode === 'full') {
    for (const s of ['L', 'R']) {
      const vs = s === 'L' ? 'left' : 'right';
      const kn = J[s + '_KNEE'], an = J[s + '_ANK'];
      const footEnd = J[s + '_FOOT'] && len2(sub2(J[s + '_FOOT'], an)) > 2 ? J[s + '_FOOT'] : add2(an, sub2(an, kn), 0.2);
      B.push(
        { name: s + 'upperLeg', parent: 'root', head: J[s + '_HIP'], tail: kn, drive: 'delta', vrm: [vs + 'UpperLeg', vs + 'LowerLeg'], layer: 0 },
        { name: s + 'lowerLeg', parent: s + 'upperLeg', head: kn, tail: an, drive: 'delta', vrm: [vs + 'LowerLeg', vs + 'Foot'], layer: 0 },
        { name: s + 'foot', parent: s + 'lowerLeg', head: an, tail: footEnd, drive: 'follow', layer: 0 },
      );
    }
  } else {
    // 상반신 모드: 다리는 몸통 아래 부분으로 함께 움직임(엉덩이 아래 영역은 root에 붙는다)
    B.push({ name: 'lower', parent: 'root', head: hipC, tail: [hipC[0], prep.contentBottom], drive: 'none', layer: 0 });
  }
  return B;
}

function insidePoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ── 4. 메시 + 가중치 (투명한 틈을 건너뛰지 않는 "그림 안쪽 거리"로 뼈를 정한다) ──
function buildMesh(prep, bones) {
  const { w, h } = prep;
  const cell = h / GRID_ROWS;
  const cols = Math.ceil(w / cell), rows = GRID_ROWS;
  const alpha = prep.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;

  // 칸별 최대 알파
  const cellA = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor(cy * cell), y1 = Math.min(h, Math.ceil((cy + 1) * cell));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * cell), x1 = Math.min(w, Math.ceil((cx + 1) * cell));
      let mx = 0;
      for (let y = y0; y < y1 && mx < 255; y += 2) {
        for (let x = x0; x < x1; x += 2) { const v = alpha[(y * w + x) * 4 + 3]; if (v > mx) mx = v; }
      }
      cellA[cy * cols + cx] = mx;
    }
  }
  const solid = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && cellA[cy * cols + cx] > 8;

  // 뼈별 "그림 안쪽 거리" (다익스트라 대신 칸 단위 거리의 BFS 근사 — 8방향, 대각 1.41)
  const N = cols * rows;
  const dist = bones.map((b) => {
    const d = new Float32Array(N).fill(Infinity);
    if (b.drive === 'none' && b.name === 'root') return d; // root는 영역을 갖지 않음
    const q = [];
    const segLen = Math.max(1, len2(sub2(b.tail, b.head)) / cell);
    const steps = Math.ceil(segLen * 2) + 1;
    if (b.region) {
      // 영역(다각형) 안의 칸은 모두 이 뼈 소속
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        if (insidePoly([(cx + 0.5) * cell, (cy + 0.5) * cell], b.region)) { const k = cy * cols + cx; d[k] = 0; q.push(k); }
      }
    }
    const from = b.seedFrom || 0;
    for (let i = Math.ceil(from * steps); i <= steps; i++) {
      const p = lerp2(b.head, b.tail, i / steps);
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const k = cy * cols + cx;
      if (d[k] > 0) { d[k] = 0; q.push(k); }
    }
    // 단순 다익스트라 (칸 수가 적어 배열 기반 버킷으로 충분)
    const buckets = [q];
    for (let bi = 0; bi < buckets.length; bi++) {
      const bucket = buckets[bi];
      if (!bucket) continue;
      for (let j = 0; j < bucket.length; j++) {
        const k = bucket[j];
        const dk = d[k];
        if (Math.floor(dk * 2) !== bi) continue;
        const x = k % cols, y = (k / cols) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (!solid(nx, ny)) continue;
            const nk = ny * cols + nx;
            const nd = dk + (dx && dy ? 1.41 : 1);
            if (nd < d[nk]) {
              d[nk] = nd;
              const nb = Math.floor(nd * 2);
              (buckets[nb] || (buckets[nb] = [])).push(nk);
            }
          }
        }
      }
    }
    return d;
  });

  // 칸마다 가장 가까운 뼈 (그리는 순서용)
  const nearestOfCell = new Int16Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    let best = -1, bd = Infinity;
    for (let bi = 0; bi < bones.length; bi++) if (dist[bi][k] < bd) { bd = dist[bi][k]; best = bi; }
    nearestOfCell[k] = best;
  }

  // 아래팔·손이 몸통·다리에 붙어 있는 칸 수 (붙어 있으면 움직일 때 찢어져 보임 → 등신대 방식으로)
  const isLow = (bi) => bi >= 0 && /^[LR](lowerArm|hand)$/.test(bones[bi].name);
  const isBody = (bi) => bi >= 0 && !/^[LR](upperArm|lowerArm|hand)$/.test(bones[bi].name);
  let armTouch = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const kk = cy * cols + cx;
    if (!solid(cx, cy) || !isLow(nearestOfCell[kk])) continue;
    let t = false;
    for (let dy = -1; dy <= 1 && !t; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (solid(cx + dx, cy + dy) && isBody(nearestOfCell[(cy + dy) * cols + cx + dx])) { t = true; break; }
    }
    if (t) armTouch++;
  }

  // 정점 (격자 꼭짓점) — 쓰는 칸 주변만 만든다
  const vIndex = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
  const pos = [], uv = [], skinIdx = [], skinW = [];
  const BLEND = Math.max(2, 0.03 * rows); // 관절 주변 섞이는 폭(칸)
  // 부모-자식(또는 형제)처럼 이어진 뼈끼리만 섞는다 (손과 바지처럼 닿아 있을 뿐인 부분이 늘어나지 않게)
  const related = (i, j) => {
    const a = bones[i], b = bones[j];
    return a.parent === b.name || b.parent === a.name || (a.parent && a.parent === b.parent && !/Arm|hand/.test(a.name + b.name));
  };
  const vertexOf = (vx, vy) => {
    const key = vy * (cols + 1) + vx;
    if (vIndex[key] >= 0) return vIndex[key];
    const px = Math.min(w, vx * cell), py = Math.min(h, vy * cell);
    // 이 꼭짓점을 둘러싼 칸들에서 뼈별 최소 거리
    const cand = new Float32Array(bones.length).fill(Infinity);
    for (let cy = vy - 1; cy <= vy; cy++) for (let cx = vx - 1; cx <= vx; cx++) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const k = cy * cols + cx;
      for (let bi = 0; bi < bones.length; bi++) if (dist[bi][k] < cand[bi]) cand[bi] = dist[bi][k];
    }
    let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
    for (let bi = 0; bi < bones.length; bi++) {
      const d = cand[bi];
      if (d < d1) { b2 = b1; d2 = d1; b1 = bi; d1 = d; } else if (d < d2) { b2 = bi; d2 = d; }
    }
    if (b1 < 0) { b1 = 0; d1 = 0; }
    let w1 = 1, w2 = 0;
    if (b2 >= 0 && isFinite(d2) && d2 - d1 < BLEND && related(b1, b2)) { w2 = 0.5 * (1 - (d2 - d1) / BLEND); w1 = 1 - w2; }
    const idx = pos.length / 3;
    pos.push(px, py, 0);
    uv.push(px / w, 1 - py / h);
    skinIdx.push(b1, Math.max(0, b2), 0, 0);
    skinW.push(w1, w2, 0, 0);
    vIndex[key] = idx;
    return idx;
  };

  // 삼각형 (그리는 순서: 다리 → 몸통 → 머리 → 팔)
  const tris = [[], [], [], []];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!solid(cx, cy)) continue;
      const a = vertexOf(cx, cy), b = vertexOf(cx + 1, cy), c = vertexOf(cx + 1, cy + 1), d = vertexOf(cx, cy + 1);
      const nb = nearestOfCell[cy * cols + cx];
      const layer = nb >= 0 ? bones[nb].layer : 1;
      tris[layer].push(a, d, b, b, d, c);
    }
  }
  return { pos, uv, skinIdx, skinW, index: [].concat(...tris), armTouch };
}

// ── 5. 조립 ──
let active = null;

export function isActive() { return !!active; }
export function getMode() { return active ? active.mode : null; }

// 그림 픽셀 → 월드 좌표: 발끝을 바닥(y=0)에, 그림 키를 3D 아바타 키와 같게
function toWorldFactory(prep, worldHeight, originX) {
  const MAX_W = 1.15; // 너무 넓은 그림(정사각형·가로 그림)은 폭 기준으로 줄인다 (미터)
  const s = Math.min(worldHeight / Math.max(1, prep.contentBottom - prep.contentTop), MAX_W / Math.max(1, prep.contentRight - prep.contentLeft));
  return { s, P: (p) => new THREE.Vector3((p[0] - originX) * s, (prep.contentBottom - p[1]) * s, 0) };
}

function vrmHeight(vrm) {
  const head = vrm.humanoid.getRawBoneNode('head');
  vrm.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  let hgt = box.max.y - Math.max(0, box.min.y);
  if (head) {
    const hy = head.getWorldPosition(new THREE.Vector3()).y;
    if (!(hgt > hy) || hgt > hy * 1.6) hgt = hy * 1.12; // 머리카락 장식 등으로 상자가 너무 크면 머리 높이 기준
  }
  return THREE.MathUtils.clamp(hgt || 1.5, 1.2, 1.9);
}

function build(prep, mode, J, vrm) {
  const bonesDef = buildBoneDefs(mode, J, prep);
  const worldH = vrmHeight(vrm);
  const originX = bonesDef[0].name === 'root' && mode !== 'standee' ? bonesDef[0].head[0] : prep.w / 2;
  const { s, P } = toWorldFactory(prep, worldH, originX);

  const mesh = buildMesh(prep, bonesDef);
  // 정점 좌표를 월드 단위로
  const pos = new Float32Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const v = P([mesh.pos[i], mesh.pos[i + 1]]);
    pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(mesh.skinIdx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(mesh.skinW, 4));
  geo.setIndex(mesh.index);

  // 뼈 (휴식 자세는 회전 없이 위치만)
  const bones = [], byName = {};
  for (const d of bonesDef) {
    const bone = new THREE.Bone();
    bone.name = d.name;
    const wpos = P(d.head);
    const parent = d.parent ? byName[d.parent] : null;
    if (parent) { bone.position.copy(wpos).sub(parent.userData.restWorld); parent.add(bone); }
    else bone.position.copy(wpos);
    bone.userData.restWorld = wpos;
    const dir = sub2(d.tail, d.head);
    bone.userData.restAngle = Math.atan2(-dir[1], dir[0]); // 그림 y축은 아래로 → 월드는 위로
    bone.userData.def = d;
    bones.push(bone); byName[d.name] = bone;
  }
  const skeleton = new THREE.Skeleton(bones);

  const tex = new THREE.CanvasTexture(prep.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;        // 테두리 검은 번짐 방지
  tex.anisotropy = Avatar.state.renderer ? Avatar.state.renderer.capabilities.getMaxAnisotropy() : 1;
  tex.needsUpdate = true;
  // 텍스처는 이미 알파가 곱해져 올라가므로(premultiplyAlpha) 셰이더에서 또 곱하지 않고 그대로 섞는다
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.01, premultipliedAlpha: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.frustumCulled = false;
  skinned.renderOrder = 10;
  skinned.add(bones[0]);
  skinned.updateMatrixWorld(true);
  skinned.bind(skeleton);

  // 눈 위치 (웹캠 크기 맞춤용) — 머리 뼈 기준 상대 위치로 저장
  let eyes = null;
  const headBone = byName.head || byName.root;
  const headRest = headBone.userData.restWorld;
  if (mode !== 'standee' && J && J.L_EYE && J.R_EYE) eyes = [P(J.L_EYE).sub(headRest), P(J.R_EYE).sub(headRest)];
  else {
    const top = P([prep.w / 2, prep.contentTop + (prep.contentBottom - prep.contentTop) * 0.11]).sub(headRest);
    eyes = [top.clone().setX(top.x + 0.035), top.clone().setX(top.x - 0.035)];
  }

  return { mesh: skinned, bones, byName, skeleton, tex, mat, geo, mode, eyes, headBone, scale: s, worldH, armTouch: mesh.armTouch };
}

// 3D 아바타(VRM)의 뼈 월드 위치
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function vrmPoint(vrm, name) {
  if (name === 'headUp') {
    const head = vrm.humanoid.getRawBoneNode('head');
    if (!head) return null;
    head.getWorldQuaternion(_q);
    return head.getWorldPosition(new THREE.Vector3()).add(_v.set(0, 0.15, 0).applyQuaternion(_q));
  }
  const n = vrm.humanoid.getRawBoneNode(name);
  return n ? n.getWorldPosition(new THREE.Vector3()) : null;
}
// 뼈 방향 (화면 평면 x,y) + 화면에 보이는 길이 비율(카메라 쪽으로 향하면 짧아짐)
function vrmDir(vrm, names) {
  const a = vrmPoint(vrm, names[names.length === 3 ? 1 : 0]);
  const b = vrmPoint(vrm, names[names.length === 3 ? 2 : 1]);
  if (!a || !b) return null;
  const d = b.sub(a);
  const full = d.length();
  const flat = Math.hypot(d.x, d.y);
  return { angle: Math.atan2(d.y, d.x), ratio: full > 1e-6 ? flat / full : 0 };
}

// 휴식 자세에서의 3D 아바타 기준값 (다리·몸통·머리는 "바뀐 만큼"만 옮기기 위해)
function captureVrmRest(vrm, bones) {
  vrm.humanoid.resetNormalizedPose();
  Avatar.applyNeutralArms(vrm);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const rest = {};
  for (const b of bones) {
    const d = b.userData.def;
    if (d.vrm) { const r = vrmDir(vrm, d.vrm); rest[d.name] = r ? r.angle : null; }
  }
  const hips = vrmPoint(vrm, 'hips');
  const fl = vrmPoint(vrm, 'leftFoot'), fr = vrmPoint(vrm, 'rightFoot');
  const legH = hips && fl && fr ? hips.y - Math.min(fl.y, fr.y) : 0;
  return { dirs: rest, hips: hips || new THREE.Vector3(0, 0.9, 0), legH };
}

function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

// ── 공개 함수 ──
// source: Blob/File. rig: { joints: {키: [x01, y01]} } (원본 그림 비율 좌표) — 없으면 자동 인식
export async function activate(source, { rig = null, onStatus = null } = {}) {
  const vrm = Avatar.state.vrm;
  if (!vrm) throw new ImageAvatarError('decode', '3D 기준 아바타 없음');
  onStatus && onStatus('그림을 준비하는 중…');
  const prep = await prepareImage(source);

  let found = null;
  if (rig && rig.joints) {
    const joints = {}, vis = {};
    for (const [k, v] of Object.entries(rig.joints)) { joints[k] = prep.toCanvas(v[0], v[1]); vis[k] = 1; }
    found = { joints, vis };
  } else if (!prep.cardLike) {
    onStatus && onStatus('그림에서 팔·다리 위치를 찾는 중…');
    try { found = await detectJoints(prep); } catch (e) { console.warn('관절 자동 인식 실패 → 등신대 방식', e); found = null; }
  }
  const mode = rig && rig.mode ? rig.mode : chooseMode(found, prep);

  deactivate();
  let finalMode = mode;
  let built = build(prep, finalMode, found && found.joints, vrm);
  // 자동 인식한 그림에서 팔이 몸에 붙어 있으면(움직일 때 찢어져 보임) 그림 전체가 함께 움직이는 방식으로
  if (!(rig && rig.joints) && finalMode !== 'standee' && built.armTouch > 2) {
    console.info(`팔이 몸에 붙어 있음(${built.armTouch}칸) → 등신대 방식`);
    built.geo.dispose(); built.mat.dispose(); built.tex.dispose(); built.skeleton.dispose();
    finalMode = 'standee';
    built = build(prep, finalMode, null, vrm);
    built.armsTouching = true;
  }
  built.vrmRest = captureVrmRest(vrm, built.bones);
  built.smooth = {};
  built.rel = {};
  built.squash = 1;
  built.root = new THREE.Vector3();
  built.joints = found ? found.joints : null;
  built.prep = prep;
  Avatar.state.scene.add(built.mesh);
  vrm.scene.visible = false; // 3D 아바타는 숨기고 움직임 계산에만 사용
  Avatar.setEyeProvider(() => {
    if (!active) return null;
    active.headBone.updateWorldMatrix(true, false);
    return active.eyes.map((e) => active.headBone.localToWorld(e.clone()));
  });
  active = built;
  console.info(`그림 아바타 준비됨: ${finalMode} 방식, ${built.bones.length}개 뼈, ${built.geo.attributes.position.count}개 정점`);
  return { mode: finalMode, armsTouching: !!built.armsTouching };
}

export function deactivate() {
  if (!active) return;
  Avatar.state.scene.remove(active.mesh);
  active.geo.dispose(); active.mat.dispose(); active.tex.dispose(); active.skeleton.dispose();
  active = null;
  Avatar.setEyeProvider(null);
  if (Avatar.state.vrm) Avatar.state.vrm.scene.visible = true;
}

// 관절 파일(character.rig.json) 만들기용: 그림에서 관절을 찾아 원본 비율 좌표로 돌려준다
export async function detectRig(blob) {
  const prep = await prepareImage(blob);
  const found = prep.cardLike ? null : await detectJoints(prep);
  const mode = chooseMode(found, prep);
  const joints = {};
  if (found) for (const [k, v] of Object.entries(found.joints)) {
    const [x, y] = prep.fromCanvas(v[0], v[1]);
    joints[k] = [+x.toFixed(4), +y.toFixed(4)];
  }
  return { version: 1, bytes: blob.size, mode, joints, visibility: found ? found.vis : {} };
}

// 폴더의 기본 그림(character.png / .jpg)이 있으면 사용
export async function activateDefault(onStatus) {
  for (const name of ['character.png', 'character.jpg', 'character.webp']) {
    let res;
    try { res = await fetch('./' + name, { cache: 'no-cache' }); } catch (e) { continue; }
    if (!res.ok) continue;
    const blob = await res.blob();
    if (!blob.size || /text\/html/.test(blob.type)) continue;
    let rig = null;
    try {
      const r = await fetch('./' + name.replace(/\.\w+$/, '.rig.json'), { cache: 'no-cache' });
      if (r.ok) rig = await r.json();
    } catch (e) { rig = null; }
    // 그림을 바꿨는데 예전 관절 파일이 남아 있으면 무시하고 자동으로 다시 찾는다
    if (rig && rig.bytes && rig.bytes !== blob.size) {
      console.warn(`${name.replace(/\.\w+$/, '.rig.json')} 은 다른 그림의 관절 파일 → 자동 인식으로 전환`);
      rig = null;
    }
    return activate(blob, { rig, onStatus });
  }
  return null;
}

// 미션 시범 포즈: 3D 아바타는 아래팔을 카메라 쪽(Y축)으로 굽히는 경우가 많은데, 그림은 화면 평면만
// 표현할 수 있다. 그림 아바타일 때는 그 굽힘을 화면 안에서 몸 쪽으로 굽히는 회전(Z축)으로 바꿔서 시범을 보인다.
// (3D 아바타는 숨겨져 있으므로 보이는 변화는 그림뿐이다)
export function flattenDemo(spec) {
  if (!active || !spec) return spec;
  const upZ = (side) => {
    const u = spec.find(([b, ax]) => b === side + 'UpperArm' && ax[2]);
    return u ? u[2] : (side === 'left' ? -1 : 1); // 위팔 지정 없음 = 차렷(아래)
  };
  return spec.map(([b, ax, ang]) => (/LowerArm$/.test(b) && ax[1] && !ax[0] && !ax[2])
    ? [b, [0, 0, 1], Math.sign(upZ(b.startsWith('left') ? 'left' : 'right')) * Math.abs(ang)]
    : [b, ax, ang]);
}

// 3D 아바타가 앉은 정도(엉덩이~발 높이가 줄어든 비율) → 그림 다리를 세로로 줄일 배율
function crouchSquash(vrm, A) {
  const hips = vrmPoint(vrm, 'hips');
  const fl = vrmPoint(vrm, 'leftFoot'), fr = vrmPoint(vrm, 'rightFoot');
  if (!hips || !fl || !fr) return 1;
  const now = hips.y - Math.min(fl.y, fr.y);
  const rest = A.vrmRest.legH;
  if (!(rest > 0.1)) return 1;
  const c = THREE.MathUtils.clamp(1 - now / rest, 0, 0.7);
  const eff = Math.max(0, c - 0.08) / 0.92;        // 서 있을 때의 작은 흔들림은 무시
  return 1 - Math.min(0.55, eff * 1.1);
}

// 매 프레임 (3D 아바타 vrm.update 다음, 렌더 전에 호출)
//  live: 동작 인식 중(모션/미션 화면)이면 3D 아바타 자세를 따라가고, 아니면 그림 원래 자세로 돌아감
export function update(dt, live) {
  if (!active) return;
  const vrm = Avatar.state.vrm;
  if (!vrm) return;
  vrm.scene.updateMatrixWorld(true);
  const A = active;
  const k = live ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 8);
  const deltas = {};

  if (A.mode === 'standee') {
    const root = A.byName.root;
    let lean = 0;
    if (live) {
      // 몸통 기울기만큼 그림 전체를 발 기준으로 기울임
      const r = vrmDir(vrm, ['hips', 'neck']);
      if (r) lean = THREE.MathUtils.clamp(wrapAngle(r.angle - Math.PI / 2), -0.45, 0.45) * 0.8;
    }
    A.smooth.root = (A.smooth.root || 0) + (lean - (A.smooth.root || 0)) * k;
    root.rotation.z = A.smooth.root;
  } else {
    for (const bone of A.bones) {
      const d = bone.userData.def;
      if (d.drive === 'follow') {        // 손·발: 부모(아래팔·종아리)와 한 몸으로 (이미 부드럽게 처리된 값)
        A.smooth[d.name] = deltas[d.name] = deltas[d.parent] || 0;
        continue;
      }
      const parentNow = d.parent ? (deltas[d.parent] || 0) : 0;
      let desired = 0;
      if (live && d.vrm && (d.drive === 'abs' || d.drive === 'delta')) {
        const r = vrmDir(vrm, d.vrm);
        if (d.drive === 'abs') {
          // 팔: 3D 아바타 팔의 화면상 방향을 그대로.
          // 카메라 쪽을 향해 화면에서 짧게 보이면 방향을 믿을 수 없으므로, 부모 뼈 기준 각도를 유지한다.
          const hold = parentNow + (A.rel[d.name] || 0);
          if (r) {
            const target = wrapAngle(r.angle - bone.userData.restAngle);
            const trust = THREE.MathUtils.smoothstep(r.ratio, 0.12, 0.4);
            desired = hold + wrapAngle(target - hold) * trust;
          } else desired = hold;
        } else if (r) {
          const r0 = A.vrmRest.dirs[d.name];
          desired = r0 == null ? 0 : wrapAngle(r.angle - r0);
          if (d.name === 'spine' || d.name === 'head') desired = THREE.MathUtils.clamp(desired, -0.6, 0.6);
        }
      }
      // 부드럽게 (각도 최단 경로)
      const prev = A.smooth[d.name] == null ? 0 : A.smooth[d.name];
      const cur = prev + wrapAngle(desired - prev) * k;
      A.smooth[d.name] = cur;
      A.rel[d.name] = cur - parentNow;
      deltas[d.name] = cur;
    }
    // 월드 회전량 → 부모 기준 회전
    for (const bone of A.bones) {
      const d = bone.userData.def;
      const parentDelta = d.parent ? (deltas[d.parent] || 0) : 0;
      bone.rotation.z = (deltas[d.name] || 0) - parentDelta;
    }
  }

  // 옆걸음(좌우 이동)과 앉기
  let tx = 0, squash = 1;
  if (live) {
    const hips = vrmPoint(vrm, 'hips');
    if (hips) tx = THREE.MathUtils.clamp(hips.x - A.vrmRest.hips.x, -0.8, 0.8); // 그림 키 = 3D 키 → 이동량 그대로
    squash = crouchSquash(vrm, A);
  }
  A.root.x += (tx - A.root.x) * k;
  A.squash += (squash - A.squash) * k;
  const rootBone = A.byName.root;
  rootBone.position.copy(rootBone.userData.restWorld);
  rootBone.position.x += A.root.x;
  if (A.mode === 'standee') {
    rootBone.scale.y = A.squash;                  // 발 기준으로 그림 전체를 납작하게
  } else {
    // 앉으면 엉덩이를 내리고 다리를 그만큼 세로로 줄여, 발은 바닥에 붙어 있게
    const hipH = rootBone.userData.restWorld.y;
    rootBone.position.y = hipH * A.squash;
    for (const n of ['LupperLeg', 'RupperLeg', 'lower']) if (A.byName[n]) A.byName[n].scale.y = A.squash;
  }
}

