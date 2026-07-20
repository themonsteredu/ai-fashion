// 디버그 패널: D 키 또는 주소 뒤에 ?debug=1 로 켜고 끔
export const Debug = {
  enabled: false,
  opts: { camDots: true, miniRaw: true, miniFiltered: true, boneAxes: false },
  panel: null,
  stats: null,
  mini: null,
  camOverlay: null,
  onToggleAxes: null,

  init(onToggleAxes) {
    this.onToggleAxes = onToggleAxes;

    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:90;background:rgba(10,10,12,0.85);color:#9ef59e;' +
      'font:12px/1.5 Consolas,monospace;padding:12px 14px;border-radius:10px;display:none;max-width:340px;user-select:text;';
    panel.innerHTML = `
      <b style="color:#fff">DEBUG</b> <span style="opacity:.6">(D 키로 끄기)</span><br>
      <label><input type="checkbox" data-opt="camDots" checked> 카메라 랜드마크</label><br>
      <label><input type="checkbox" data-opt="miniRaw" checked> 미니뷰: 원본(빨강)</label><br>
      <label><input type="checkbox" data-opt="miniFiltered" checked> 미니뷰: 필터 후(초록) + 방향벡터</label><br>
      <label><input type="checkbox" data-opt="boneAxes"> VRM 본 축 표시</label>
      <pre id="debug-stats" style="margin:8px 0 0;white-space:pre-wrap;color:#cfe"></pre>
      <canvas id="debug-mini" width="220" height="280" style="background:rgba(255,255,255,0.06);border-radius:6px"></canvas>
    `;
    document.body.appendChild(panel);
    this.panel = panel;
    this.stats = panel.querySelector('#debug-stats');
    this.mini = panel.querySelector('#debug-mini');

    panel.addEventListener('change', (e) => {
      const opt = e.target && e.target.dataset && e.target.dataset.opt;
      if (!opt) return;
      this.opts[opt] = e.target.checked;
      if (opt === 'boneAxes' && this.onToggleAxes) this.onToggleAxes(e.target.checked);
    });

    const cov = document.createElement('canvas');
    cov.id = 'debug-cam-overlay';
    cov.style.cssText = 'position:fixed;z-index:89;pointer-events:none;display:none;transform:scaleX(-1);';
    document.body.appendChild(cov);
    this.camOverlay = cov;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') this.toggle();
    });
    if (new URLSearchParams(location.search).get('debug') === '1') this.toggle(true);
  },

  toggle(force) {
    this.enabled = force != null ? force : !this.enabled;
    this.panel.style.display = this.enabled ? 'block' : 'none';
    this.camOverlay.style.display = 'none';
    if (!this.enabled && this.onToggleAxes) this.onToggleAxes(false);
    else if (this.enabled && this.opts.boneAxes && this.onToggleAxes) this.onToggleAxes(true);
  },

  update(info, camEl) {
    if (!this.enabled) return;

    // 통계
    const v = (i) => info.vis ? (info.vis.get(i) || 0).toFixed(2) : '-';
    const L = info.LM;
    this.stats.textContent =
      `FPS ${info.fps.toFixed(1)} | 추론 ${info.inferMs.toFixed(1)}ms | VRM ${info.vrmVersion}\n` +
      `상태 ${info.status}` +
      (info.calib
        ? ` | scale ${info.calib.scale.toFixed(2)} floor ${info.calib.floorY.toFixed(2)}`
        : ` | 캘리브레이션 ${(info.calibProgress * 100).toFixed(0)}%`) + `\n` +
      `발 L:${info.feet.left.locked ? '고정' : '자유'}(vy ${info.feet.left.vy.toFixed(2)}) ` +
      `R:${info.feet.right.locked ? '고정' : '자유'}(vy ${info.feet.right.vy.toFixed(2)})\n` +
      `vis 어깨 ${v(L.L_SH)}/${v(L.R_SH)} 손목 ${v(L.L_WR)}/${v(L.R_WR)} 발목 ${v(L.L_ANK)}/${v(L.R_ANK)}\n` +
      (info.hands
        ? `손 L:${info.hands.left.state}(${info.hands.left.conf.toFixed(2)}) R:${info.hands.right.state}(${info.hands.right.conf.toFixed(2)})\n` +
          `제스처 ${info.gesture.heartState} blend ${info.gesture.heartBlend.toFixed(2)} | V L:${info.hands.left.v.toFixed(2)} R:${info.hands.right.v.toFixed(2)}\n` +
          (info.segFps != null ? `세그멘테이션 ${info.segFps.toFixed(1)}fps\n` : '')
        : '') +
      `filter torso(${info.filterParams.torso.minCutoff},${info.filterParams.torso.beta}) ` +
      `limb(${info.filterParams.limb.minCutoff},${info.filterParams.limb.beta}) ` +
      `ext(${info.filterParams.extremity.minCutoff},${info.filterParams.extremity.beta})`;

    // 웹캠 위 랜드마크 점
    if (this.opts.camDots && camEl && info.poseImg) {
      const r = camEl.getBoundingClientRect();
      const cov = this.camOverlay;
      cov.style.display = 'block';
      cov.style.left = r.left + 'px';
      cov.style.top = r.top + 'px';
      cov.width = Math.round(r.width);
      cov.height = Math.round(r.height);
      const ctx = cov.getContext('2d');
      ctx.clearRect(0, 0, cov.width, cov.height);
      ctx.fillStyle = '#ff5252';
      // object-fit:cover 보정 (세로 기준 맞춤, 가로 잘림)
      const va = 4 / 3, pa = r.width / r.height;
      const sc = pa < va ? r.height / 1 : r.height;
      const dispW = r.height * va;
      const offX = (r.width - dispW) / 2;
      for (const lm of info.poseImg) {
        ctx.beginPath();
        ctx.arc(offX + lm.x * dispW, lm.y * r.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // 손 21점 (왼손 파랑 / 오른손 노랑 — 아바타 기준 좌우)
      if (info.handsImg) {
        for (const [side, color] of [['left', '#54a8ff'], ['right', '#ffd54a']]) {
          const hand = info.handsImg[side];
          if (!hand) continue;
          ctx.fillStyle = color;
          for (const lm of hand) {
            ctx.beginPath();
            ctx.arc(offX + lm.x * dispW, lm.y * r.height, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else {
      this.camOverlay.style.display = 'none';
    }

    // 미니 스켈레톤 뷰 (정면 투영)
    const ctx = this.mini.getContext('2d');
    ctx.clearRect(0, 0, this.mini.width, this.mini.height);
    const toXY = (p) => [110 + p.x * 90, 140 - p.y * 90];
    const L2 = info.LM;
    const PAIRS = [
      [L2.L_SH, L2.R_SH], [L2.L_HIP, L2.R_HIP], [L2.L_SH, L2.L_HIP], [L2.R_SH, L2.R_HIP],
      [L2.L_SH, L2.L_EL], [L2.L_EL, L2.L_WR], [L2.R_SH, L2.R_EL], [L2.R_EL, L2.R_WR],
      [L2.L_HIP, L2.L_KNEE], [L2.L_KNEE, L2.L_ANK], [L2.R_HIP, L2.R_KNEE], [L2.R_KNEE, L2.R_ANK],
    ];
    const drawSet = (map, color, withLines) => {
      if (!map) return;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (withLines) {
        for (const [a, b] of PAIRS) {
          const pa = map.get(a), pb = map.get(b);
          if (!pa || !pb) continue;
          ctx.beginPath();
          ctx.moveTo(...toXY(pa));
          ctx.lineTo(...toXY(pb));
          ctx.stroke();
        }
      }
      for (const p of map.values()) {
        const [x, y] = toXY(p);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    };
    if (this.opts.miniRaw) drawSet(info.rawPose, 'rgba(255,80,80,0.8)', false);
    if (this.opts.miniFiltered) drawSet(info.filteredPose, 'rgba(120,255,120,0.9)', true);
  },
};
