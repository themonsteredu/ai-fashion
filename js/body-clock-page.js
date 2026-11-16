import { BodyClockTracker, CLOCK_COLORS, CLOCK_PRACTICE_HOURS, paintClock } from './body-clock.js?v=1';
import { connectPoseCamera } from './pose-camera.js?v=1';

const $ = (id) => document.getElementById(id);
const video = $('clock-video');
const overlay = $('clock-arms');
const dial = $('clock-dial');
const toggle = $('clock-camera-toggle');
const standby = $('clock-standby');
const tracker = new BodyClockTracker();
const choices = new Map();
let goal = 9;
let reading = null;
let active = false;

function setText(id, label) {
  const element = $(id);
  if (element.textContent !== label) element.textContent = label;
}

function refreshFeedback() {
  const correct = active && reading?.hour === goal;
  $('clock-feedback').dataset.correct = String(correct);
  setText('clock-feedback', correct ? `좋아요! ${goal}시를 만들었어요.`
    : active ? `${goal}시를 만들어 보세요.` : `카메라를 켜고 ${goal}시를 만들어 보세요.`);
}

function renderReading(next) {
  reading = next;
  paintClock(dial, active ? reading : { hourDegrees: goal * 30, minuteDegrees: 0 });
  setText('clock-time', !active ? `예시 ${goal}시` : reading?.hour ? `${reading.hour}시` : '시각 만들기');
  refreshFeedback();
}

for (const hour of CLOCK_PRACTICE_HOURS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.hour = String(hour);
  button.textContent = `${hour}시`;
  button.setAttribute('aria-pressed', String(goal === hour));
  choices.set(hour, button);
  $('clock-hours').append(button);
  button.addEventListener('click', () => {
    choices.get(goal).setAttribute('aria-pressed', 'false');
    goal = hour;
    button.setAttribute('aria-pressed', 'true');
    renderReading(reading);
  });
}
renderReading(null);

function drawArms(result) {
  if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
  if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!result) return;
  ctx.lineWidth = Math.max(5, overlay.width * .009);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [arm, color] of [[result.minuteArm, CLOCK_COLORS.minute], [result.hourArm, CLOCK_COLORS.hour]]) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    arm.joints.forEach(({ x, y }, i) => {
      const px = (1 - x) * overlay.width, py = y * overlay.height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}

const camera = connectPoseCamera({
  video,
  onState(state, message) {
    active = state === 'on';
    video.hidden = overlay.hidden = !active;
    standby.hidden = active;
    tracker.reset();
    setText('clock-camera-toggle', active ? '카메라 끄기' : state === 'starting' ? '취소' : '카메라 켜기');
    setText('clock-camera-status', message ?? '어깨부터 손까지 보이게 두 팔을 펴 보세요.');
    renderReading(null);
  },
  onPose(points, _world, aspect, now) {
    const result = tracker.update(points, aspect, now);
    drawArms(result);
    renderReading(result);
    setText('clock-camera-status', !result ? '어깨부터 손까지 보이게 두 팔을 펴 보세요.'
      : !result.minuteAtTwelve ? '한 팔을 위로 뻗어 긴 바늘을 12에 맞춰요.'
        : result.hour ? '다른 시각도 팔로 만들어 보세요.' : '그 자세를 잠깐 유지해 보세요.');
  },
});
toggle.addEventListener('click', camera.toggle);
