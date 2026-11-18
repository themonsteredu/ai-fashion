import { MOVEMENT_GROUPS, MOVEMENTS, matchesMovement, MovementHold } from './movement-practice.js?v=2';
import { connectPoseCamera } from './pose-camera.js?v=1';

const $ = id => document.getElementById(id);
const video = $('move-video'), toggle = $('move-camera'), standby = $('move-standby');
const canvas = $('move-example'), ctx = canvas.getContext('2d'), artError = $('move-art-error');
const countdown = $('move-countdown');
const poseCanvas = $('move-pose'), poseContext = poseCanvas.getContext('2d');
const poseConnections = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const poseJoints = [...new Set(poseConnections.flat())];
const hold = new MovementHold(), completed = new Set(), buttons = new Map(), images = new Map();
let current = MOVEMENTS[0], active = false;

function drawPose(points) {
  // Match the video's intrinsic size so object-fit and mirroring align both layers.
  const width = video.videoWidth || 960, height = video.videoHeight || 720;
  if (poseCanvas.width !== width) poseCanvas.width = width;
  if (poseCanvas.height !== height) poseCanvas.height = height;
  poseContext.clearRect(0, 0, width, height);
  if (!points) return;
  const usable = point => point && (point.visibility ?? 1) >= .55
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  const scale = width / 480;
  poseContext.lineCap = 'round';
  poseContext.setLineDash([6 * scale, 5 * scale]);
  for (const [a, b] of poseConnections) {
    if (!usable(points[a]) || !usable(points[b])) continue;
    poseContext.beginPath();
    poseContext.moveTo(points[a].x * width, points[a].y * height);
    poseContext.lineTo(points[b].x * width, points[b].y * height);
    poseContext.strokeStyle = 'rgba(10, 28, 35, .8)';
    poseContext.lineWidth = 5 * scale;
    poseContext.stroke();
    poseContext.strokeStyle = '#71f0ba';
    poseContext.lineWidth = 2.5 * scale;
    poseContext.stroke();
  }
  poseContext.setLineDash([]);
  for (const index of poseJoints) {
    if (!usable(points[index])) continue;
    poseContext.beginPath();
    poseContext.arc(points[index].x * width, points[index].y * height, 3.5 * scale, 0, Math.PI * 2);
    poseContext.fillStyle = '#71f0ba';
    poseContext.fill();
    poseContext.strokeStyle = '#173548';
    poseContext.lineWidth = 1.5 * scale;
    poseContext.stroke();
  }
}

function setText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}

function feedback(text, correct = false) {
  setText('move-feedback', text);
  $('move-feedback').dataset.correct = String(correct);
}

function resetFeedback(message = active ? '예시를 보고 따라 해요.' : '카메라를 켜고 따라 해 보세요.') {
  hold.reset();
  countdown.hidden = true;
  if (completed.size === MOVEMENTS.length) feedback('아홉 가지 움직임을 모두 완성했어요!', true);
  else feedback(message);
}

function exampleImage(art) {
  if (!images.has(art)) {
    const image = new Image();
    image.src = './assets/movement/' + art + '.webp';
    images.set(art, image.decode().then(() => image).catch(error => {
      images.delete(art);
      throw error;
    }));
  }
  return images.get(art);
}

async function drawExample(pose) {
  canvas.setAttribute('aria-label', pose.title + ' 예시');
  canvas.hidden = false;
  artError.hidden = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    const image = await exampleImage(pose.art);
    if (current !== pose) return;
    const [x, y, width, height] = pose.crop;
    const scale = Math.min((canvas.width - 20) / width, (canvas.height - 14) / height);
    const w = width * scale, h = height * scale;
    ctx.drawImage(image, x, y, width, height, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  } catch {
    if (current !== pose) return;
    canvas.hidden = true;
    artError.hidden = false;
  }
}

function select(pose) {
  buttons.get(current.id).setAttribute('aria-pressed', 'false');
  current = pose;
  buttons.get(pose.id).setAttribute('aria-pressed', 'true');
  setText('move-title', pose.title);
  setText('move-instruction', pose.hint);
  setText('move-next', completed.size === MOVEMENTS.length ? '다시 시작하기'
    : pose === MOVEMENTS.at(-1) ? '첫 동작으로' : '다음 동작');
  resetFeedback();
  void drawExample(pose);
}

for (const group of MOVEMENT_GROUPS) {
  const section = document.createElement('section');
  section.className = 'move-group';
  const heading = document.createElement('h2');
  heading.textContent = group.title;
  section.append(heading);
  for (const pose of group.poses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pose = pose.id;
    button.textContent = pose.title;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => select(pose));
    buttons.set(pose.id, button);
    section.append(button);
  }
  $('move-list').append(section);
}
select(current);
$('move-next').addEventListener('click', () => {
  if (completed.size === MOVEMENTS.length) {
    completed.clear();
    for (const mark of $('move-list').querySelectorAll('.move-done')) mark.remove();
    setText('move-progress', `0 / ${MOVEMENTS.length} 동작 완료`);
    select(MOVEMENTS[0]);
    return;
  }
  select(MOVEMENTS[(MOVEMENTS.indexOf(current) + 1) % MOVEMENTS.length]);
});

function finishMovement() {
  if (!completed.has(current.id)) {
    completed.add(current.id);
    const mark = document.createElement('span');
    mark.className = 'move-done';
    mark.textContent = '완료';
    buttons.get(current.id).append(mark);
    setText('move-progress', `${completed.size} / ${MOVEMENTS.length} 동작 완료`);
  }
  if (completed.size === MOVEMENTS.length) {
    setText('move-next', '다시 시작하기');
    resetFeedback();
    return;
  }
  let index = MOVEMENTS.indexOf(current);
  do {
    index = (index + 1) % MOVEMENTS.length;
  } while (completed.has(MOVEMENTS[index].id));
  select(MOVEMENTS[index]);
}

const camera = connectPoseCamera({
  video, height: 720,
  onState(state, message) {
    active = state === 'on';
    video.hidden = !active;
    poseCanvas.hidden = !active;
    if (!active) drawPose(null);
    standby.hidden = active;
    setText('move-camera', active ? '카메라 끄기' : state === 'starting' ? '취소' : '카메라 켜기');
    resetFeedback(message);
  },
  onPose(points, world, aspect, now) {
    drawPose(points);
    if (completed.size === MOVEMENTS.length) return;
    const match = matchesMovement(current.id, points, world, aspect);
    if (hold.update(match, now)) {
      finishMovement();
      return;
    }
    countdown.hidden = !match;
    if (match) setText('move-countdown', `${hold.secondsLeft}초`);
    feedback(match === null ? '필요한 몸 부위가 화면 안에 들어오도록 서 주세요.'
      : match ? '좋아요! 그대로 있어요.' : current.hint);
  },
});
toggle.addEventListener('click', camera.toggle);
