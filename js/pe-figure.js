// 체육 동작 배우기: 시범 스펙(Z축 각도만)으로 그리는 스티커 소년 그림 — 타일·단계 칩·박자 칸·결과·미니 코치가
// 그림 선생님이 실제로 하는 동작과 항상 같게 보인다. missionvisuals.js와 같은 스티커 화풍(굵고 둥근 팔다리, 큰 머리, 흰 얼굴),
// currentColor = 테마 색. 좌우: 스펙은 학생 자신의 쪽, 그림은 화면처럼 거울로 (학생 왼쪽 = 화면 왼쪽).
// 아이콘만 과장: 45°보다 높이 든 팔은 살짝 바깥으로 벌려 머리 뒤로 숨지 않게 한다.
export function peFigure(spec, opts = {}) {
  const v = Object.create(null);
  for (const [bone, axis, ang] of spec || []) if (axis[2]) v[bone] = ang;   // Z only (flat specs)
  const g = (k, d) => (v[k] == null ? d : v[k]);
  const NEUTRAL = 1.187;                                    // demoNeutralQuat drops the arm 68°
  const UA = 20, LA = 18, TH = 11, SH = 10;
  const splay = (a) => a - 0.38 * Math.min(1, Math.max(0, (a - 0.75) / 0.7));
  const legL = (() => { const u = g('leftUpperLeg', 0), u2 = u + g('leftLowerLeg', 0);
    const k = [45 - Math.sin(u) * TH, 92 + Math.cos(u) * TH]; return [[45, 92], k, [k[0] - Math.sin(u2) * SH, k[1] + Math.cos(u2) * SH]]; })();
  const legR = (() => { const u = -g('rightUpperLeg', 0), u2 = u - g('rightLowerLeg', 0);
    const k = [55 + Math.sin(u) * TH, 92 + Math.cos(u) * TH]; return [[55, 92], k, [k[0] + Math.sin(u2) * SH, k[1] + Math.cos(u2) * SH]]; })();
  const drop = 112 - Math.max(legL[2][1], legR[2][1]);       // plant the lowest foot (a squat lowers the body)
  const armL = (() => { const a = splay(g('leftUpperArm', -NEUTRAL)), a2 = a + g('leftLowerArm', 0);
    const e = [38 - Math.cos(a) * UA, 56 - Math.sin(a) * UA]; return [[38, 56], e, [e[0] - Math.cos(a2) * LA, e[1] - Math.sin(a2) * LA]]; })();
  const armR = (() => { const a = splay(-g('rightUpperArm', NEUTRAL)), a2 = a - g('rightLowerArm', 0);
    const e = [62 + Math.cos(a) * UA, 56 - Math.sin(a) * UA]; return [[62, 56], e, [e[0] + Math.cos(a2) * LA, e[1] - Math.sin(a2) * LA]]; })();
  const trunk = (g('spine', 0) + g('chest', 0)) * 180 / Math.PI;   // + = bend toward kid's right = screen-right = clockwise
  const headTilt = (g('neck', 0) + g('head', 0)) * 180 / Math.PI;
  const P = (pts, w) => `<path d="M${pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L')}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const shoe = (p, dir) => `<ellipse cx="${(p[0] + dir * 2).toFixed(1)}" cy="${(p[1] + 3).toFixed(1)}" rx="6.5" ry="3.8" fill="currentColor"/>`;
  const hand = (p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5.6" fill="currentColor"/>`;
  const W = '#fff';
  const face = `<circle cx="44.5" cy="29" r="2.3" fill="${W}"/><circle cx="55.5" cy="29" r="2.3" fill="${W}"/><path d="M45 34.5 Q50 38.8 55 34.5" stroke="${W}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  const hair = `<path d="M35.5 28 Q35.5 13 50 13 Q64.5 13 64.5 28 Q59 20.5 50 21.5 Q41 20.5 35.5 28Z" fill="${W}" opacity="0.3"/>`;
  return `<svg viewBox="-10 -6 120 128" fill="none" class="pe-fig"${opts.title ? ` role="img" aria-label="${opts.title}"` : ' aria-hidden="true"'}><g transform="translate(0 ${drop.toFixed(1)})">
    ${P(legL, 9)}${P(legR, 9)}${shoe(legL[2], -1)}${shoe(legR[2], 1)}
    <g transform="rotate(${trunk.toFixed(1)} 50 92)">
      <path d="M38 50 Q50 45 62 50 L63 93 Q50 97 37 93 Z" fill="currentColor"/>
      <path d="M45 50 L50 59 L55 50" stroke="${W}" stroke-width="2" opacity="0.5" fill="none"/>
      <g transform="rotate(${headTilt.toFixed(1)} 50 47)"><circle cx="50" cy="30" r="14.5" fill="currentColor"/>${hair}${face}</g>
      ${P(armL, 10)}${hand(armL[2])}${P(armR, 10)}${hand(armR[2])}
    </g></g></svg>`;
}

// 배지 메달 (결과 화면): 금색 테 + 초록 원판 + 흰 소년 그림
export function peMedal(spec, opts = {}) {
  const size = opts.size || 120;
  const fig = peFigure(spec).replace('<svg ', '<svg x="22" y="18" width="76" height="81" ');
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" class="pe-medal-svg" aria-hidden="true">
    <circle cx="60" cy="60" r="56" fill="#ffc83d"/><circle cx="60" cy="60" r="49" fill="#fff3c4"/><circle cx="60" cy="60" r="45" fill="#1f9d63"/>
    <g style="color:#fff">${fig}</g></svg>`;
}
