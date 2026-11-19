import { MOVEMENT_GROUPS, MOVEMENTS, matchesMovement, MovementAttempt } from './movement-practice.js?v=4';
import { drawPoseOverlay } from './pose-overlay.js?v=1';
import { connectPoseCamera } from './pose-camera.js?v=1';

const $ = id => document.getElementById(id);
const video = $('move-video'), toggle = $('move-camera'), standby = $('move-standby');
const canvas = $('move-example'), ctx = canvas.getContext('2d'), artError = $('move-art-error');
const countdown = $('move-countdown');
const poseCanvas = $('move-pose');
const attempt = new MovementAttempt(), results = new Map(), buttons = new Map(), images = new Map();
let current = MOVEMENTS[0], active = false, finished = false;

function drawPose(points) {
  drawPoseOverlay(poseCanvas, video, [{ points }]);
}

function setText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}

function feedback(text, correct = false) {
  setText('move-feedback', text);
  $('move-feedback').dataset.correct = String(correct);
}

function resetFeedback(message = active ? '예시를 보고 따라 해요.' : '카메라를 켜고 따라 해 보세요.') {
  attempt.reset();
  countdown.hidden = true;
  if (finished) feedback('체험을 마쳤어요! 다시 해 보고 싶은 동작을 목록에서 골라요.', true);
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
  finished = false;
  buttons.get(pose.id).setAttribute('aria-pressed', 'true');
  setText('move-title', pose.title);
  setText('move-instruction', pose.hint);
  setText('move-next', '건너뛰기');
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
  if (finished) {
    results.clear();
    for (const mark of $('move-list').querySelectorAll('.move-done, .move-skipped')) mark.remove();
    updateProgress();
    select(MOVEMENTS[0]);
    return;
  }
  advanceMovement('skipped');
});

function updateProgress() {
  const skipped = [...results.values()].filter(result => result === 'skipped').length;
  const counts = `${results.size - skipped} / ${MOVEMENTS.length} 동작 완료`;
  setText('move-progress', skipped ? `${counts} · ${skipped}개 건너뜀` : counts);
}

function advanceMovement(result) {
  if (results.get(current.id) !== 'done') {
    results.set(current.id, result);
    const button = buttons.get(current.id);
    const mark = button.querySelector('span') || button.appendChild(document.createElement('span'));
    mark.className = 'move-' + result;
    mark.textContent = result === 'done' ? '완료' : '건너뜀';
    updateProgress();
  }
  if (results.size === MOVEMENTS.length) {
    finished = true;
    setText('move-next', '다시 시작하기');
    resetFeedback();
    return;
  }
  let index = MOVEMENTS.indexOf(current);
  do {
    index = (index + 1) % MOVEMENTS.length;
  } while (results.has(MOVEMENTS[index].id));
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
    if (finished) return;
    const match = matchesMovement(current.id, points, world, aspect);
    const result = attempt.update(match, now);
    if (result) {
      advanceMovement(result);
      return;
    }
    const remaining = attempt.hold.secondsLeft;
    countdown.hidden = remaining === null;
    if (remaining !== null) {
      setText('move-countdown', `${remaining}초`);
      feedback('좋아요! 그대로 있어요.');
    } else if (attempt.skipSecondsLeft <= 3) {
      feedback('자세가 잘 잡히지 않아 곧 다음 동작으로 넘어가요.');
    } else {
      feedback(match === null ? '필요한 몸 부위가 화면 안에 들어오도록 서 주세요.' : current.hint);
    }
  },
});
toggle.addEventListener('click', camera.toggle);
