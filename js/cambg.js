// 웹캠 배경 처리: 인물-배경 분리(MediaPipe ImageSegmenter)로
// 내 배경을 흐리게 하거나 아바타 배경으로 교체
import { FilesetResolver, ImageSegmenter } from '../lib/mediapipe/vision_bundle.mjs';

let segmenter = null;
let ready = false;
let mode = 'off'; // 'off' | 'blur' | 'replace'
let lastTs = 0;
let maskReady = false;

// 성능: 세그멘테이션은 렌더링과 분리해 ~15fps로만 실행
const SEG_INTERVAL_MS = 66;
let lastSegMs = 0;
let segFps = 0, segCount = 0, segWindowStart = 0;

const maskCanvas = document.createElement('canvas');
const maskSmooth = document.createElement('canvas'); // 프레임 간 마스크 블렌딩(흔들림 방지)
const personCanvas = document.createElement('canvas');

export function getSegFps() { return segFps; }

export function isReady() { return ready; }
export function getMode() { return mode; }
export function setMode(m) { mode = m; }

export async function init() {
  const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');
  async function make(delegate) {
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/selfie_segmenter.tflite', delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  }
  try {
    segmenter = await make('GPU');
  } catch (e) {
    console.warn('배경 분리 GPU 실패 → CPU', e);
    segmenter = await make('CPU');
  }
  ready = true;
}

// 인물 마스크 갱신 → personCanvas에 인물만 남김 (15fps 간격으로만 실행)
export function process(video, now) {
  if (mode === 'off' || !segmenter || !video || video.readyState < 2 || !video.videoWidth) {
    maskReady = false;
    return;
  }
  if (now - lastSegMs < SEG_INTERVAL_MS) return; // 이전 마스크 재사용
  lastSegMs = now;
  segCount++;
  if (now - segWindowStart > 1000) {
    segFps = segCount * 1000 / (now - segWindowStart || 1);
    segCount = 0;
    segWindowStart = now;
  }

  let ts = Math.round(now);
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;

  let result;
  try {
    result = segmenter.segmentForVideo(video, ts);
  } catch (e) {
    return;
  }
  const mask = result.categoryMask;
  if (!mask) return;

  const mw = mask.width, mh = mask.height;
  const data = mask.getAsUint8Array();
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas.width = mw;
    maskCanvas.height = mh;
  }
  const mctx = maskCanvas.getContext('2d');
  const img = mctx.createImageData(mw, mh);
  const px = img.data;
  for (let i = 0; i < mw * mh; i++) {
    const person = data[i] > 0 ? 255 : 0;
    const o = i * 4;
    px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = person;
  }
  mctx.putImageData(img, 0, 0);
  mask.close();

  // 시간 스무딩: 이전 프레임 마스크와 블렌딩 (경계 흔들림 방지)
  if (maskSmooth.width !== mw || maskSmooth.height !== mh) {
    maskSmooth.width = mw;
    maskSmooth.height = mh;
    maskSmooth.getContext('2d').drawImage(maskCanvas, 0, 0);
  } else {
    const sctx = maskSmooth.getContext('2d');
    sctx.globalAlpha = 0.55;
    sctx.drawImage(maskCanvas, 0, 0);
    sctx.globalAlpha = 1;
  }

  // 인물만 남긴 캔버스 (표시용 절반 해상도면 충분)
  const pw = Math.max(2, Math.round(video.videoWidth / 2));
  const ph = Math.max(2, Math.round(video.videoHeight / 2));
  if (personCanvas.width !== pw || personCanvas.height !== ph) {
    personCanvas.width = pw;
    personCanvas.height = ph;
  }
  const pctx = personCanvas.getContext('2d');
  pctx.clearRect(0, 0, pw, ph);
  pctx.drawImage(video, 0, 0, pw, ph);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.filter = 'blur(1.5px)'; // 경계 feathering
  pctx.drawImage(maskSmooth, 0, 0, pw, ph);
  pctx.filter = 'none';
  pctx.globalCompositeOperation = 'source-over';
  maskReady = true;
}

// 대상 캔버스에 합성해 그리기 (cover 방식)
// bgPaint: 배경을 그려 주는 함수 (ctx, w, h) — 'replace' 모드에서 사용
export function draw(ctx, w, h, video, bgPaint) {
  ctx.clearRect(0, 0, w, h); // 여백은 투명 → 뒤의 흐린 배경(#cam-bg)이 비침
  if (mode === 'replace') {
    bgPaint(ctx, w, h);
    if (maskReady) drawContain(ctx, personCanvas, personCanvas.width, personCanvas.height, w, h);
    return;
  }
  if (mode === 'blur') {
    // 배경은 CSS(#cam-bg)로 이미 흐리게 깔려 있음 → 여기선 선명한 사람만 얹는다
    if (maskReady) { drawContain(ctx, personCanvas, personCanvas.width, personCanvas.height, w, h); return; }
    ctx.filter = 'blur(16px)';
    drawContain(ctx, video, video.videoWidth, video.videoHeight, w, h);
    ctx.filter = 'none';
    return;
  }
  // off (보통 캔버스 미사용) — 안전용: 전신이 다 보이게 contain
  drawContain(ctx, video, video.videoWidth, video.videoHeight, w, h);
}

// 전체 프레임이 다 보이도록(잘림 없이) 대상 안에 맞춰 그림 (여백은 투명)
function drawContain(ctx, src, sw, sh, dw, dh) {
  if (!sw || !sh) return;
  const scale = Math.min(dw / sw, dh / sh);
  const w = sw * scale, h = sh * scale;
  ctx.drawImage(src, 0, 0, sw, sh, (dw - w) / 2, (dh - h) / 2, w, h);
}
