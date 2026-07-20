// 배경 프리셋: 화면(CSS)과 사진·영상 캡처(canvas)에 같은 모습으로 그려진다
export const BACKGROUNDS = [
  {
    id: 'studio', name: '스튜디오',
    css: 'radial-gradient(120% 90% at 50% 0%, #f7f5f1 55%, #e9e5de 100%)',
    paint(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, 0, h * 0.1, w / 2, 0, h * 1.1);
      g.addColorStop(0, '#f7f5f1');
      g.addColorStop(1, '#e9e5de');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'runway', name: '런웨이',
    css: 'radial-gradient(70% 55% at 50% 12%, #4a4642 0%, #232120 55%, #121110 100%)',
    paint(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.12, h * 0.05, w / 2, h * 0.12, h * 0.9);
      g.addColorStop(0, '#4a4642');
      g.addColorStop(0.55, '#232120');
      g.addColorStop(1, '#121110');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // 바닥 스포트라이트
      const f = ctx.createRadialGradient(w / 2, h * 0.94, 1, w / 2, h * 0.94, w * 0.35);
      f.addColorStop(0, 'rgba(255,246,225,0.20)');
      f.addColorStop(1, 'rgba(255,246,225,0)');
      ctx.fillStyle = f;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'blush', name: '블러시',
    css: 'linear-gradient(165deg, #fdeef0 0%, #f7d7dc 55%, #efc3cc 100%)',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
      g.addColorStop(0, '#fdeef0');
      g.addColorStop(0.55, '#f7d7dc');
      g.addColorStop(1, '#efc3cc');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sky', name: '하늘',
    css: 'linear-gradient(180deg, #bfd9ef 0%, #e3eef8 60%, #f6fafc 100%)',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#bfd9ef');
      g.addColorStop(0.6, '#e3eef8');
      g.addColorStop(1, '#f6fafc');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'lilac', name: '라일락',
    css: 'linear-gradient(160deg, #ece7f6 0%, #d8cdec 60%, #c3b4e0 100%)',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
      g.addColorStop(0, '#ece7f6');
      g.addColorStop(0.6, '#d8cdec');
      g.addColorStop(1, '#c3b4e0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'neon', name: '네온 쇼',
    css: 'radial-gradient(60% 50% at 20% 20%, rgba(255,64,170,0.35), rgba(255,64,170,0) 70%), radial-gradient(60% 55% at 85% 75%, rgba(64,205,255,0.32), rgba(64,205,255,0) 70%), linear-gradient(180deg, #191b2e 0%, #10111f 100%)',
    paint(ctx, w, h) {
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, '#191b2e');
      base.addColorStop(1, '#10111f');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const p = ctx.createRadialGradient(w * 0.2, h * 0.2, 1, w * 0.2, h * 0.2, w * 0.5);
      p.addColorStop(0, 'rgba(255,64,170,0.35)');
      p.addColorStop(1, 'rgba(255,64,170,0)');
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, w, h);
      const c = ctx.createRadialGradient(w * 0.85, h * 0.75, 1, w * 0.85, h * 0.75, w * 0.5);
      c.addColorStop(0, 'rgba(64,205,255,0.32)');
      c.addColorStop(1, 'rgba(64,205,255,0)');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, w, h);
    },
  },
];

export function getBackground(id) {
  if (id === 'custom' && custom) return custom;
  return BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];
}

// ── 사용자 업로드 배경 (이미지/영상) ──
let custom = null; // {id, name, type, el, url, css, paint}

export function getCustom() { return custom; }

export async function setCustomBackground(file) {
  clearCustomBackground();
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');

  if (isVideo) {
    const el = document.createElement('video');
    el.src = url;
    el.autoplay = true;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;display:none;';
    const stage = document.getElementById('stage');
    document.body.insertBefore(el, stage);
    await el.play().catch(() => {});
    custom = {
      id: 'custom', name: '내 배경(영상)', type: 'video', el, url,
      css: '#101010',
      paint(ctx, w, h) { paintCover(ctx, el, el.videoWidth, el.videoHeight, w, h, '#101010'); },
    };
  } else {
    const el = new Image();
    el.src = url;
    await new Promise((res, rej) => { el.onload = res; el.onerror = rej; });
    custom = {
      id: 'custom', name: '내 배경(사진)', type: 'image', el, url,
      css: `#101010 url("${url}") center / cover no-repeat`,
      paint(ctx, w, h) { paintCover(ctx, el, el.naturalWidth, el.naturalHeight, w, h, '#101010'); },
    };
  }
  return custom;
}

export function clearCustomBackground() {
  if (!custom) return;
  if (custom.type === 'video') {
    custom.el.pause();
    custom.el.remove();
  }
  URL.revokeObjectURL(custom.url); // texture/메모리 정리
  custom = null;
}

// 영상 배경 표시 켜기/끄기 (선택된 배경이 영상일 때만 보이게)
export function setCustomVisible(on) {
  if (custom && custom.type === 'video') {
    custom.el.style.display = on ? 'block' : 'none';
    if (on) custom.el.play().catch(() => {});
    else custom.el.pause();
  }
}

function paintCover(ctx, src, sw, sh, dw, dh, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, dw, dh);
  if (!sw || !sh) return;
  const targetAspect = dw / dh;
  let cw = sh * targetAspect, ch = sh, cx = (sw - cw) / 2, cy = 0;
  if (cw > sw) {
    cw = sw; ch = sw / targetAspect;
    cx = 0; cy = (sh - ch) / 2;
  }
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, dw, dh);
}
