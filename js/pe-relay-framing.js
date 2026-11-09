// 이미지 랜드마크는 실제 카메라 영상의 0–1 좌표다. 미리보기의 여백과 좌우 반전은 관계없다.
const NOSE = 0;
const SHOULDERS = [11, 12];
const ARMS = [13, 14, 15, 16];
const HIPS = [23, 24];
const KNEES = [25, 26];
const ANKLES = [27, 28];
const MIN_VISIBILITY = 0.5;
const EDGE = 0.025;

const messages = {
  searching: '카메라 가운데에 한 명만 서요.',
  head: '머리 위에 여유가 있도록 카메라를 맞춰요.',
  center: '화면 가운데로 와요.',
  torso: '어깨와 허리가 화면 안에 들어오게 해요.',
  feet: '무릎과 두 발이 보이도록 조금 뒤로 가요.',
  arms: '두 팔과 손이 화면 안에 들어오게 해요.',
  distance: '몸이 작게 보여요. 화면 안에 들어오는 범위에서 조금 가까이 와요.',
  ready: '전신이 들어왔어요.',
};

const result = (state, message = messages[state]) => ({ state, message });

function visible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && (point.visibility ?? 1) >= MIN_VISIBILITY;
}

function inside(point, top = EDGE, bottom = 1 - EDGE) {
  return visible(point) && point.x >= EDGE && point.x <= 1 - EDGE && point.y >= top && point.y <= bottom;
}

export function evaluateRelayFraming(overlay, { upperBodyOnly = false } = {}) {
  if (!overlay?.some(visible)) return result('searching');

  const nose = overlay[NOSE];
  // 코와 발목 바깥에 머리와 발이 들어갈 공간도 남겨 둔다.
  if (!inside(nose, 0.10)) return result('head');
  if (![...SHOULDERS, ...HIPS].every((id) => inside(overlay[id]))) return result('torso');
  const centerX = (overlay[SHOULDERS[0]].x + overlay[SHOULDERS[1]].x) / 2;
  if (centerX < 0.25 || centerX > 0.75) return result('center');
  if (!upperBodyOnly && (!KNEES.every((id) => inside(overlay[id]))
    || !ANKLES.every((id) => inside(overlay[id], EDGE, 0.92)))) return result('feet');
  if (!ARMS.every((id) => inside(overlay[id]))) return result('arms');

  const bottom = upperBodyOnly ? HIPS : ANKLES;
  const height = Math.max(...bottom.map((id) => overlay[id].y)) - nose.y;
  if (height < (upperBodyOnly ? 0.28 : 0.50)) return result('distance');
  return result('ready', upperBodyOnly ? '상체가 들어왔어요.' : messages.ready);
}
