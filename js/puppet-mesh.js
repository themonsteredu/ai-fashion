// 그림 메시: 관절 주변은 한 장의 피부처럼 이어서 부드럽게 접고(어깨·팔꿈치·손목·목·무릎·발목),
// 관절에서 먼 곳에서 그냥 맞닿아 있을 뿐인 부분(옆구리에 붙인 팔, 엉덩이에 닿은 손)은 떼어 둔다.
// 그래야 팔을 들어도 셔츠가 리본처럼 늘어나지 않으면서, 관절이 목각 인형처럼 꺾이지 않는다.
const GRID_ROWS = 120;
const lerp2 = (a,b,t) => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const sub2 = (a,b) => [a[0]-b[0],a[1]-b[1]];
const len2 = v => Math.hypot(...v);

function segDist(p, b) {
  const d = sub2(b.tail, b.head), L = d[0] * d[0] + d[1] * d[1];
  const t = L ? Math.max(0, Math.min(1, ((p[0] - b.head[0]) * d[0] + (p[1] - b.head[1]) * d[1]) / L)) : 0;
  return len2(sub2(p, lerp2(b.head, b.tail, t)));
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
export function buildMesh(prep, bones) {
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

  // 팔다리 굵기(반폭): 뼈 중간 몇 곳에서 양옆으로 그림 끝까지 재고, 좁은 쪽을 쓴다
  // (몸에 붙은 팔은 몸통 쪽으로 끝없이 이어지므로 바깥쪽 끝까지만 믿는다)
  const limbRadius = (b) => {
    const d = sub2(b.tail, b.head), L = len2(d);
    if (L < 1e-6) return 0;
    const n = [-d[1] / L, d[0] / L], found = [];
    for (const t of [0.35, 0.5, 0.65]) {
      const c = lerp2(b.head, b.tail, t);
      const reach = (sign) => {
        let r = 0;
        for (let s = cell * 0.5; s <= L; s += cell * 0.5) {
          if (!solid(Math.floor((c[0] + n[0] * s * sign) / cell), Math.floor((c[1] + n[1] * s * sign) / cell))) break;
          r = s;
        }
        return r;
      };
      if (solid(Math.floor(c[0] / cell), Math.floor(c[1] / cell))) found.push(Math.min(reach(1), reach(-1)));
    }
    if (!found.length) return 0;
    found.sort((a, b) => a - b);
    return found[found.length >> 1] + cell * 0.75;
  };

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

  // 칸의 주인 뼈 (그림 안쪽 거리로 닿지 않는 떨어진 조각은 가장 가까운 뼈 선분)
  const owners = Array.from({length: N}, (_,k) => {
    if (nearestOfCell[k] >= 0) return nearestOfCell[k];
    const p = [(k%cols+.5)*cell, (Math.floor(k/cols)+.5)*cell];
    let owner=0, distance=Infinity;
    for(let i=0;i<bones.length;i++) {
      if(bones[i].name==='root' && bones[i].drive==='none') continue;
      const d=segDist(p,bones[i]); if(d<distance){distance=d;owner=i;}
    }
    return owner;
  });

  const smooth = t => { t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); };
  const BLEND = Math.max(4, 0.06 * rows); // 관절에서 두 뼈가 섞이는 폭(칸, 그림 안쪽 거리) — 넓을수록 부드럽게 접힘
  const index = new Map(bones.map((b,i) => [b.name,i]));
  const parentOf = bones.map(b => (b.parent != null && index.has(b.parent) ? index.get(b.parent) : -1));
  const isRoot = i => bones[i].name === 'root';
  // 팔꿈치는 조금 좁게 섞는다 (넓으면 팔을 많이 굽힐 때 위팔이 국수처럼 가늘어짐)
  const ELBOW_BLEND = Math.min(BLEND, Math.max(3, 0.042 * rows));
  const blendFor = (a, b) => {
    const c = parentOf[a] === b ? a : parentOf[b] === a ? b : -1;
    return c >= 0 && /^[LR]lowerArm$/.test(bones[c].name) ? ELBOW_BLEND : BLEND;
  };
  const descends = (i, ancestor) => { for (let p = i; p >= 0; p = parentOf[p]) if (p === ancestor) return true; return false; };

  // ── 관절 영역: 자식 뼈의 굵기(그림에서 잰 반폭)만큼 관절 둘레를 한 장으로 잇는다 ──
  // 자식 뼈 방향으로는 반폭 정도까지만(옆구리에 붙은 팔이 몸통에 끌려가지 않게),
  // 가로 방향으로는 넉넉히(어깨처럼 넓은 단면 전체가 이어지게).
  const halfWidth = ci => {
    const b = bones[ci], d = sub2(b.tail, b.head), L = len2(d);
    if (L < 1e-6) return cell * 1.5;
    const u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
    const samples = [];
    for (const t of [0.15, 0.25, 0.35, 0.45]) {
      const c = lerp2(b.head, b.tail, t);
      const reach = sign => {
        let r = -1;
        for (let s = 0; s <= L; s += cell * 0.5) {
          const cx = Math.floor((c[0] + n[0] * s * sign) / cell), cy = Math.floor((c[1] + n[1] * s * sign) / cell);
          if (!solid(cx, cy) || !descends(owners[cy * cols + cx], ci)) break;
          r = s;
        }
        return r;
      };
      const a = reach(1), z = reach(-1);
      if (a >= 0 && z >= 0) samples.push((a + z) / 2 + cell * 0.5);
    }
    if (!samples.length) return cell * 1.5;
    return Math.max(cell, Math.max(...samples));
  };
  // ── 어깨: 그림에서 겨드랑이를 찾아 "어깨 끝 ↔ 겨드랑이" 선으로 팔과 몸통을 가른다 ──
  // 종이인형을 가위로 오리듯이, 소매는 통째로 팔에 붙고 조끼·셔츠 몸판은 몸통에 남는다.
  // 팔이 옆구리에 붙어 있어 겨드랑이 틈이 없으면 선을 만들지 않는다(아래 일반 관절 처리).
  const spineBone = index.has('spine') ? index.get('spine') : -1;
  const unit = v => { const l = len2(v) || 1; return [v[0] / l, v[1] / l]; };
  const free = p => !solid(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
  const cuts = new Map(); // 위팔 번호 → { s:어깨 끝, a:겨드랑이, c, n(팔 쪽), len, share, band }
  const headBone = index.has('head') ? index.get('head') : -1;
  const cellOf = p => Math.floor(p[1] / cell) * cols + Math.floor(p[0] / cell);
  // 머리(얼굴·머리카락) 쪽 칸인지: 그림 안쪽 거리로 몸통보다 머리에 가까움
  const headish = k => headBone >= 0 && spineBone >= 0 && dist[headBone][k] < dist[spineBone][k] + 2;
  // 겨드랑이 찾기: 팔 방향과 엉덩이 방향 사이로 선을 그어, 그림 밖(틈)이 가장 가까이 나오는 곳
  const findArmpit = side => {
    const ai = index.get(side + 'upperArm');
    if (ai == null || spineBone < 0 || parentOf[ai] !== spineBone) return null;
    const E = bones[ai].tail;
    let J = bones[ai].head;
    const armLen = len2(sub2(E, J));
    const hip = index.has(side + 'upperLeg') ? bones[index.get(side + 'upperLeg')].head : bones[spineBone].head;
    const toArm = unit(sub2(E, J)), toHip = unit(sub2(hip, J));
    const wedge = Math.acos(Math.max(-1, Math.min(1, toArm[0] * toHip[0] + toArm[1] * toHip[1])));
    // 팔이 아래쪽(차렷·A자)으로 내려온 그림에서만 — 팔을 든 그림이나 옆구리에 딱 붙은 팔은 일반 관절 처리
    if (armLen < cell * 4 || wedge < 0.25 || toArm[1] < 0.2) return null;
    // 어깨점이 그림 가장자리(또는 살짝 밖)에 찍혔으면 가까운 그림 안쪽 칸에서 찾기 시작
    const inner = (cx, cy) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!solid(cx + dx, cy + dy)) return false; return true; };
    const jx = Math.floor(J[0] / cell), jy = Math.floor(J[1] / cell);
    if (!inner(jx, jy)) {
      let bestD = Infinity, at = null;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (!inner(jx + dx, jy + dy) || dx * dx + dy * dy >= bestD) continue;
        bestD = dx * dx + dy * dy; at = [(jx + dx + .5) * cell, (jy + dy + .5) * cell];
      }
      if (!at) return null;
      J = at;
    }
    const a0 = Math.atan2(toHip[1], toHip[0]);
    let da = Math.atan2(toArm[1], toArm[0]) - a0;
    while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    let armpit = null, best = Infinity;
    for (let k = 2; k <= 10; k++) {
      const ang = a0 + da * k / 12, dir = [Math.cos(ang), Math.sin(ang)];
      for (let t = cell; t <= armLen * 1.25 + cell * 2; t += cell * 0.5) {
        if (!free([J[0] + dir[0] * t, J[1] + dir[1] * t])) continue;
        if (t < best) { best = t; armpit = [J[0] + dir[0] * (t - cell * 0.5), J[1] + dir[1] * (t - cell * 0.5)]; }
        break;
      }
    }
    return armpit ? { ai, J, E, armpit, best, ok: best <= armLen * 1.1 } : null;
  };
  const found = { L: findArmpit('L'), R: findArmpit('R') };
  for (const side of ['L', 'R']) {
    // 한쪽만 아슬아슬하게 못 찾으면(좌우가 거의 같은 그림) 다른 쪽 판단을 따른다
    const f = found[side], other = found[side === 'L' ? 'R' : 'L'];
    if (!f || !(f.ok || (other && other.ok))) continue;
    const { ai, J, E, armpit, best } = f;
    // 어깨 끝: 겨드랑이 → 어깨 관절 방향으로 계속 가서 그림이 끝나는 곳.
    // 머리·머리카락으로 이어져 버리면(큰 머리, 어깨까지 오는 긴 머리) 선을 만들지 않는다 — 얼굴이 팔에 끌려가지 않게
    const up = unit(sub2(J, armpit));
    let top = J, intoHead = false;
    for (let t = cell * 0.5; t <= best * 1.5 + cell; t += cell * 0.5) {
      const p = [J[0] + up[0] * t, J[1] + up[1] * t];
      if (free(p)) break;
      if (headish(cellOf(p))) { intoHead = true; break; }
      top = p;
    }
    if (intoHead) continue;
    const len = len2(sub2(armpit, top));
    if (len < cell * 2) continue;
    const c = unit(sub2(armpit, top));
    let n = [-c[1], c[0]];
    if ((E[0] - top[0]) * n[0] + (E[1] - top[1]) * n[1] < 0) n = [-n[0], -n[1]];
    // 한 장으로 잇는 건 어깨 관절 둘레까지만(어깨 끝 → 관절 → 팔 반폭만큼 아래).
    // 그 아래로 소매가 조끼 옆에 그냥 닿아 있던 부분은 팔을 들면 자연스럽게 떨어진다.
    const hw = Math.max(cell, limbRadius(bones[ai]));
    const share = Math.min(len, len2(sub2(J, top)) + hw * 0.5);
    const cut = { arm: ai, s: top, a: armpit, c, n, len, share, band: Math.max(cell * 1.5, hw * 0.6) };
    cuts.set(ai, cut);
    // 선 근처 칸의 주인을 선의 어느 쪽인지로 다시 정한다 (팔 쪽 → 위팔, 몸통 쪽 → 몸통)
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      if (!solid(cx, cy)) continue;
      const k = cy * cols + cx, o = owners[k];
      if (o !== ai && o !== spineBone) continue;
      const q = sub2([(cx + .5) * cell, (cy + .5) * cell], top);
      const along = q[0] * c[0] + q[1] * c[1], sd = q[0] * n[0] + q[1] * n[1];
      if (along < -len * 0.25 || along > len * 1.1 || Math.abs(sd) > len) continue;
      owners[k] = sd > 0 ? ai : spineBone;
    }
  }
  const cutOf = (i, j) => (i === spineBone ? cuts.get(j) : j === spineBone ? cuts.get(i) : undefined);
  // 겨드랑이 선 기준 좌표: out = 이어 붙인 부분(어깨 끝~관절 조금 아래)에서 벗어난 길이, sd = 선에서 팔 쪽 거리
  const cutCoords = (cut, px, py) => {
    const q = [px - cut.s[0], py - cut.s[1]];
    const along = q[0] * cut.c[0] + q[1] * cut.c[1];
    return { out: Math.max(0, -along, along - cut.share), sd: q[0] * cut.n[0] + q[1] * cut.n[1] };
  };
  // ≤ 1 이면 한 장으로 잇는다
  const cutZone = (cut, px, py) => { const { out, sd } = cutCoords(cut, px, py); return Math.hypot(out / (cell * 0.75), sd / (cut.band + cell * 0.5)); };
  // 섞임 정도: 이어 붙인 부분 밖으로 짧게 줄어든다 (그 아래 소매·조끼가 닿아 있던 곳은 떨어진다)
  const cutMix = (cut, px, py) => {
    const { out, sd } = cutCoords(cut, px, py);
    return (1 - smooth(out / (cell * 5))) * (1 - smooth((Math.abs(sd) - cut.band) / cut.band));
  };
  const cutSide = (cut, px, py) => (px - cut.s[0]) * cut.n[0] + (py - cut.s[1]) * cut.n[1];

  const joints = [], jointByPair = new Map();
  for (let ci = 0; ci < bones.length; ci++) {
    const pi = parentOf[ci];
    // 골반(root 아래 몸통·허벅지)은 아래 '골반' 처리에서 따로 잇는다
    if (pi < 0 || isRoot(pi) || isRoot(ci)) continue;
    const dir = sub2(bones[ci].tail, bones[ci].head), L = len2(dir);
    if (L < 1e-6) continue;
    const hw = halfWidth(ci);
    const along = Math.max(cell * 1.5, Math.min(hw * 0.9 + cell * 0.5, L * 0.5));
    const across = Math.max(along, hw * 2.5 + cell);
    const joint = { parent: pi, child: ci, at: bones[ci].head, u: [dir[0] / L, dir[1] / L], along, across };
    joints.push(joint);
    jointByPair.set(Math.min(pi, ci) + '-' + Math.max(pi, ci), joint);
  }
  // 관절 영역 안 ≤ 1, 바깥으로 갈수록 커짐 (부모-자식이 아니면 Infinity)
  const zone = (i, j, px, py) => {
    const cut = cutOf(i, j);
    if (cut) {
      const r = cutZone(cut, px, py);
      if (r <= 1) return r;
      const m = cutMix(cut, px, py);
      return m > 0 ? 1 + (1 - m) * (ZONE_FADE - 1) * 0.999 : Infinity;
    }
    const jt = jointByPair.get(Math.min(i, j) + '-' + Math.max(i, j));
    if (!jt) return Infinity;
    const dx = px - jt.at[0], dy = py - jt.at[1];
    return Math.hypot((dx * jt.u[0] + dy * jt.u[1]) / jt.along, (dy * jt.u[0] - dx * jt.u[1]) / jt.across);
  };
  // 영역 경계(1)에서 이만큼(ZONE_FADE)까지 두 뼈의 섞임을 서서히 줄여, 떼어 둔 쪽이 갑자기 찢어지지 않게
  const ZONE_FADE = 2.8;
  const mixOf = r => (r <= 1 ? 1 : 1 - smooth((r - 1) / (ZONE_FADE - 1)));
  // 겨드랑이 선은 이어 붙인 부분 바로 아래에서 빨리 떼어 낸다(소매가 조끼 옆에 닿아 있던 곳이 늘어나지 않게)


  // ── 골반: 몸통 아래쪽과 두 허벅지를 한 장으로 (다리를 벌려도 바지가 이어지게) ──
  const hipRoot = index.has('root') ? index.get('root') : -1;
  const leftThigh = index.has('LupperLeg') ? index.get('LupperLeg') : -1;
  const rightThigh = index.has('RupperLeg') ? index.get('RupperLeg') : -1;
  const lowerBody = index.has('lower') ? index.get('lower') : -1;
  const pelvis = leftThigh >= 0 && rightThigh >= 0 && hipRoot >= 0 && spineBone >= 0;
  const upperOnly = !pelvis && lowerBody >= 0 && spineBone >= 0 && hipRoot >= 0;
  const hipY = pelvis ? (bones[leftThigh].head[1] + bones[rightThigh].head[1]) / 2 : 0;
  const thighLength = pelvis ? Math.min(len2(sub2(bones[leftThigh].tail, bones[leftThigh].head)), len2(sub2(bones[rightThigh].tail, bones[rightThigh].head))) : 0;
  // 골반 영역은 엉덩이 선 조금 위(허리)부터 허벅지 절반까지 — 그 위 몸통은 척추를 따라 기울어진다
  const pelvisTop = hipY - thighLength * 0.35, pelvisBottom = hipY + thighLength * 0.5;
  // 가랑이 꼭짓점: 두 엉덩이 관절 사이에서 엉덩이 선 아래로 처음 비는 칸
  const crotchY = (() => {
    if (!pelvis) return Infinity;
    const lx = bones[leftThigh].head[0], rx = bones[rightThigh].head[0];
    const x0 = Math.ceil(Math.min(lx, rx) / cell), x1 = Math.floor(Math.max(lx, rx) / cell);
    for (let cy = Math.max(0, Math.floor(hipY / cell)); cy < rows; cy++) for (let cx = x0; cx < x1; cx++) if (!solid(cx, cy)) return cy * cell;
    return Infinity;
  })();
  const waistY = upperOnly ? bones[hipRoot].head[1] : 0;
  const waistSpan = h * .1;
  // 상반신 모드: 엉덩이 선 아래(치마·다리)는 척추가 아니라 아랫몸 소속 — 넓게 퍼진 치마 옆자락이 몸통과 함께 돌아 찢어지지 않게
  if (upperOnly) for (let k = 0; k < N; k++) if (owners[k] === spineBone && (Math.floor(k / cols) + .5) * cell > waistY) owners[k] = lowerBody;
  const trunk = /^(root|spine|[LR]upperLeg)$/, waistParts = /^(root|spine|lower)$/;

  const vIndex = new Map();
  const pos = [], uv = [], skinIdx = [], skinW = [];
  const vertexOf = (vx, vy, owner) => {
    const px = Math.min(w, vx * cell), py = Math.min(h, vy * cell);
    const atPelvis = pelvis && trunk.test(bones[owner].name) && py >= pelvisTop && py <= pelvisBottom;
    const atWaist = upperOnly && waistParts.test(bones[owner].name) && Math.abs(py - waistY) <= waistSpan;
    // 이 꼭짓점을 둘러싼 칸들의 주인 뼈 중, 관절 영역 안에서 부모-자식으로 이어진 것끼리 한 무리 → 같은 정점
    let group = [owner], seam;
    if (atPelvis) seam = 'pelvis';
    else if (atWaist) seam = 'waist';
    else {
      const around = [];
      for (let cy = vy - 1; cy <= vy; cy++) for (let cx = vx - 1; cx <= vx; cx++) {
        if (!solid(cx, cy)) continue;
        const o = owners[cy * cols + cx];
        if (!around.includes(o)) around.push(o);
      }
      for (let grew = true; grew;) {
        grew = false;
        for (const o of around) {
          if (group.includes(o) || !group.some(g => zone(g, o, px, py) <= 1)) continue;
          group.push(o); grew = true;
        }
      }
      group.sort((a, b) => a - b);
      seam = group.join('.');
    }
    const key = `${seam}:${vy * (cols + 1) + vx}`;
    if (vIndex.has(key)) return vIndex.get(key);

    const idx = pos.length / 3;
    pos.push(px, py, 0); uv.push(px / w, 1 - py / h);
    if (atPelvis) {
      // 엉덩이 선 위는 척추(몸통 기울기), 아래로 갈수록 좌우 허벅지로
      const legWeight = thighLength > 1e-6 ? smooth((py - hipY) / (thighLength * .5)) : (py >= hipY ? 1 : 0);
      // 좌우 허벅지 나누기: 그림 안쪽 거리로 — 가랑이 위는 반반으로 이어지고,
      // 가랑이 아래 안쪽 허벅지는 자기 다리만 따라간다 (허벅지 안쪽에 턱이 생기지 않게)
      let dL = Infinity, dR = Infinity;
      for (let cy = vy - 1; cy <= vy; cy++) for (let cx = vx - 1; cx <= vx; cx++) {
        if (!solid(cx, cy)) continue;
        const k = cy * cols + cx;
        if (dist[leftThigh][k] < dL) dL = dist[leftThigh][k];
        if (dist[rightThigh][k] < dR) dR = dist[rightThigh][k];
      }
      const span = Math.abs(bones[leftThigh].head[0] - bones[rightThigh].head[0]) / cell || 1;
      // 가랑이 꼭짓점 바로 위부터는 정점마다 한쪽 허벅지만 (무릎을 들 때 가랑이 틈이 벌어지지 않게)
      const leftWeight = !(Number.isFinite(dL) && Number.isFinite(dR)) ? (dL < dR ? 1 : 0)
        : py >= crotchY - cell * 2 ? (dL < dR ? 1 : dL > dR ? 0 : 0.5)
        : smooth(0.5 + (dR - dL) / (2 * span * Math.max(1e-3, 1 - legWeight)));
      // 척추는 엉덩이 가운데를 축으로 돈다: 축 아래(바지 윗부분)까지 척추를 따르면 옆으로 기울일 때
      // 반대쪽으로 휘어 엉덩이가 S자로 들어가 보인다 → 엉덩이 선으로 내려올수록 돌지 않는 root 로 넘긴다
      const spineShare = smooth((hipY - py) / Math.max(1e-6, hipY - pelvisTop));
      skinIdx.push(spineBone, leftThigh, rightThigh, hipRoot);
      skinW.push((1 - legWeight) * spineShare, legWeight * leftWeight, legWeight * (1 - leftWeight), (1 - legWeight) * (1 - spineShare));
    } else if (atWaist) {
      const upperWeight = smooth((waistY - py) / waistSpan);
      skinIdx.push(hipRoot, spineBone, 0, 0); skinW.push(1 - upperWeight, upperWeight, 0, 0);
    } else {
      // 그림 안쪽 거리로 가장 가까운 뼈(무리 안에서) + 관절 근처에서만 이웃 뼈와 섞기
      const cand = new Float32Array(bones.length).fill(Infinity);
      for (let cy = vy - 1; cy <= vy; cy++) for (let cx = vx - 1; cx <= vx; cx++) {
        if (!solid(cx, cy)) continue;
        const k = cy * cols + cx;
        for (let bi = 0; bi < bones.length; bi++) if (dist[bi][k] < cand[bi]) cand[bi] = dist[bi][k];
      }
      // 얼굴·머리카락 쪽 정점은 팔을 따라가지 않는다 (큰 머리·긴 머리 그림에서 얼굴이 끌려가지 않게)
      const nearHead = headBone >= 0 && spineBone >= 0 && cand[headBone] < cand[spineBone] + 4;
      const isArm = bi => /^[LR](upperArm|lowerArm|hand)$/.test(bones[bi].name);
      // base 뼈와 관절로 이어진 이웃 중 가장 가까운 뼈와 섞기 (관절 영역 안에서만).
      // 겨드랑이 선이 있는 어깨 쌍은 아래 선 기준 처리가 맡는다.
      const partnerOf = (base, skip) => {
        let pb = 0, pw = 0;
        if (base < 0 || !Number.isFinite(cand[base])) return [pb, pw];
        for (let bi = 0; bi < bones.length; bi++) {
          if (bi === base || bi === skip || !Number.isFinite(cand[bi]) || cutOf(base, bi)) continue;
          if (nearHead && isArm(bi) !== isArm(base)) continue;
          // 겨드랑이 선이 없는 어깨에서, 관절보다 목 쪽(뒤)이면서 머리에 가까운 정점(어깨에 얹힌 큰 머리의 턱)은 팔을 따라가지 않는다
          const ua = /^[LR]upperArm$/.test(bones[bi].name) ? bi : /^[LR]upperArm$/.test(bones[base].name) ? base : -1;
          if (ua >= 0 && (ua === bi ? base : bi) === spineBone && !cuts.has(ua) && headBone >= 0 && cand[headBone] < cand[spineBone] + 6) {
            const d = sub2(bones[ua].tail, bones[ua].head);
            if ((px - bones[ua].head[0]) * d[0] + (py - bones[ua].head[1]) * d[1] < 0) continue;
          }
          const mix = mixOf(zone(base, bi, px, py));
          if (mix <= 0) continue;
          // 두 뼈까지의 거리가 같으면 반반, BLEND 칸 차이 나면 0 (양쪽 정점이 같은 값이 되도록 대칭)
          const share = mix * Math.max(0, Math.min(1, 0.5 * (1 - (cand[bi] - cand[base]) / blendFor(base, bi))));
          if (share > pw) { pw = share; pb = bi; }
        }
        return [pb, pw];
      };
      let b1 = owner;
      for (const g of group) if (cand[g] < cand[b1]) b1 = g;
      // 겨드랑이 선이 있는 어깨: 선에서 팔 쪽으로 갈수록 팔을 따라감 (호스처럼 부드럽게 접힘)
      let shoulder = null;
      for (const cut of cuts.values()) {
        if (!group.includes(cut.arm) && !group.includes(spineBone)) continue;
        const mix = cutMix(cut, px, py);
        if (mix > 0) { shoulder = { cut, mix }; break; }
      }
      if (shoulder) {
        const { cut, mix } = shoulder;
        // 섞이는 폭은 거의 팔 쪽에 둔다 (몸통 쪽까지 많이 섞으면 조끼 겨드랑이 선이 부풀고 파임)
        const profile = smooth((cutSide(cut, px, py) + 0.6 * cut.band) / (2 * cut.band));
        const hasArm = group.includes(cut.arm), hasBody = !group.every(g => g === cut.arm);
        const own = hasArm && !hasBody ? 1 : hasBody && !hasArm ? 0 : profile;
        const wArm = nearHead ? 0 : mix * profile + (1 - mix) * own;
        // 몸통 몫은 몸통·목(머리)끼리의 섞임을, 팔 몫은 위팔·아래팔(팔꿈치)의 섞임을 그대로 지킨다
        let body = spineBone;
        for (const g of group) if (g !== cut.arm && cand[g] < cand[body]) body = g;
        const [bp, bw] = partnerOf(body, cut.arm), [ap, aw] = partnerOf(cut.arm, spineBone);
        skinIdx.push(body, bp, cut.arm, ap);
        skinW.push((1 - wArm) * (1 - bw), (1 - wArm) * bw, wArm * (1 - aw), wArm * aw);
      } else {
        const [b2, w2] = partnerOf(b1, -1);
        skinIdx.push(b1, b2, 0, 0); skinW.push(1 - w2, w2, 0, 0);
      }
    }
    vIndex.set(key, idx);
    return idx;
  };

  // 삼각형 (그리는 순서: 다리 → 몸통 → 머리 → 팔)
  const tris = [[], [], [], []];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!solid(cx, cy)) continue;
      const nb = owners[cy * cols + cx];
      const a = vertexOf(cx, cy, nb), b = vertexOf(cx + 1, cy, nb), c = vertexOf(cx + 1, cy + 1, nb), d = vertexOf(cx, cy + 1, nb);
      const layer = nb >= 0 ? bones[nb].layer : 1;
      tris[layer].push(a, d, b, b, d, c);
    }
  }
  // cuts·jointZone: 겨드랑이 선과 관절 영역 (점검·테스트용). jointZone ≤ 1 이면 한 장으로 이어지는 곳,
  // ≤ zoneFade 이면 두 뼈가 섞일 수 있는 곳.
  return { pos, uv, skinIdx, skinW, index: [].concat(...tris), armTouch,
    cuts: [...cuts.values()].map(c => ({ arm: bones[c.arm].name, s: c.s, a: c.a, share: c.share, band: c.band })),
    jointZone: (a, b, x, y) => (index.has(a) && index.has(b) ? zone(index.get(a), index.get(b), x, y) : Infinity),
    zoneFade: ZONE_FADE };
}
