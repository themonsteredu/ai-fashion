// Pixel mesh partitioning: each limb owns its seam vertices.
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
  const vIndex = new Map();
  const region = bi => {
    const name = bones[bi].name;
    const limb = name.match(/^([LR])(upperArm|lowerArm|hand|upperLeg|lowerLeg|foot)$/);
    return limb ? limb[1] + (/Arm|hand/.test(limb[2]) ? 'arm' : 'leg') : 'body';
  };
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
  const pos = [], uv = [], skinIdx = [], skinW = [];
  const BLEND = Math.max(2, 0.03 * rows); // 관절 주변 섞이는 폭(칸)
  // Only blend at the actual joint, never along distant touching edges.
  const jointFor = (i,j) => bones[i].parent===bones[j].name ? bones[i].head
    : bones[j].parent===bones[i].name ? bones[j].head : null;
  const hipRoot = bones.findIndex(b => b.name === 'root');
  const leftThigh = bones.findIndex(b => b.name === 'LupperLeg');
  const rightThigh = bones.findIndex(b => b.name === 'RupperLeg');
  const pelvis = leftThigh >= 0 && rightThigh >= 0 && hipRoot >= 0;
  const hipY = pelvis ? (bones[leftThigh].head[1] + bones[rightThigh].head[1]) / 2 : 0;
  const thighLength = pelvis ? Math.min(len2(sub2(bones[leftThigh].tail,bones[leftThigh].head)),len2(sub2(bones[rightThigh].tail,bones[rightThigh].head))) : 0;
  const blendEnd = hipY + thighLength * .5;
  const smooth = t => { t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); };
  const vertexOf = (vx, vy, owner) => {
    const group=region(owner);
    // A continuous skin across the pelvis keeps the trousers joined when thighs rotate.
    // Arms still have isolated seams so wrists cannot drag the shirt into ribbons.
    const py0=Math.min(h,vy*cell);
    const atPelvis=pelvis && /^(root|spine|[LR]upperLeg)$/.test(bones[owner].name) && py0<=blendEnd;
    const key=`${atPelvis?'pelvis':owner}:${vy*(cols+1)+vx}`;
    if(vIndex.has(key)) return vIndex.get(key);
    const px=Math.min(w,vx*cell), py=Math.min(h,vy*cell);
    const cand=new Float32Array(bones.length).fill(Infinity);
    for(let cy=vy-1;cy<=vy;cy++) for(let cx=vx-1;cx<=vx;cx++) {
      if(!solid(cx,cy)) continue;
      const k=cy*cols+cx;
      if(region(owners[k])!==group) continue;
      for(let bi=0;bi<bones.length;bi++) if(region(bi)===group && dist[bi][k]<cand[bi]) cand[bi]=dist[bi][k];
    }
    const b1=owner, d1=cand[owner];
    let b2=b1,d2=Infinity;
    for(let bi=0;bi<bones.length;bi++) {
      if(bi===b1 || region(bi)!==group) continue;
      const joint=jointFor(b1,bi);
      if(!joint) continue;
      // Bound the blend radius to the shorter segment, for short forearms too.
      const radius=Math.min(cell*BLEND*2,
        Math.max(cell,Math.min(len2(sub2(bones[b1].tail,bones[b1].head)),len2(sub2(bones[bi].tail,bones[bi].head))))*.35);
      if(Math.hypot(px-joint[0],py-joint[1])>radius) continue;
      if(cand[bi]<d2){b2=bi;d2=cand[bi];}
    }
    let w2=0;
    if(Number.isFinite(d2) && Number.isFinite(d1) && d2-d1<BLEND) w2=.5*(1-Math.max(0,d2-d1)/BLEND);
    const idx=pos.length/3;
    pos.push(px,py,0); uv.push(px/w,1-py/h);
    if(atPelvis) {
      const legWeight=smooth((py-hipY)/(thighLength*.5));
      const leftX=bones[leftThigh].head[0], rightX=bones[rightThigh].head[0];
      const leftWeight=smooth((px-rightX)/(leftX-rightX || 1));
      skinIdx.push(hipRoot,leftThigh,rightThigh,0);
      skinW.push(1-legWeight,legWeight*leftWeight,legWeight*(1-leftWeight),0);
    } else { skinIdx.push(b1,b2,0,0); skinW.push(1-w2,w2,0,0); }
    vIndex.set(key,idx);
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
  return { pos, uv, skinIdx, skinW, index: [].concat(...tris), armTouch };
}

