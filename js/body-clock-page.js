import { BodyClockTracker, CLOCK_COLORS, CLOCK_PRACTICE_HOURS, paintClock } from './body-clock.js?v=1';

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
let stream = null;
let landmarkerPromise = null;
let preferCpu = false;
let frameRequest = 0;
let run = 0;
let starting = false;
let active = false;
let lastVideoTime = -1;
let lastTimestamp = 0;

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

function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('../lib/mediapipe/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');
      const options = {
        baseOptions: { modelAssetPath: './models/pose_landmarker_lite.task' },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: .5,
        minPosePresenceConfidence: .5,
        minTrackingConfidence: .55,
      };
      if (preferCpu) return PoseLandmarker.createFromOptions(fileset, options);
      try {
        return await PoseLandmarker.createFromOptions(fileset, {
          ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        return PoseLandmarker.createFromOptions(fileset, options);
      }
    })().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
}

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

function tick(now, landmarker, session) {
  if (session !== run || !active) return;
  try {
    if (video.readyState >= 2 && video.videoWidth && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      lastTimestamp = Math.max(lastTimestamp + 1, Math.round(now));
      const { landmarks } = landmarker.detectForVideo(video, lastTimestamp);
      const result = tracker.update(landmarks?.[0], video.videoWidth / video.videoHeight, now);
      drawArms(result);
      renderReading(result);
      setText('clock-camera-status', !result ? '어깨부터 손까지 보이게 두 팔을 펴 보세요.'
        : !result.minuteAtTwelve ? '한 팔을 위로 뻗어 긴 바늘을 12에 맞춰요.'
          : result.hour ? '다른 시각도 팔로 만들어 보세요.' : '그 자세를 잠깐 유지해 보세요.');
    }
  } catch {
    stopCamera('움직임을 읽지 못했어요. 카메라를 다시 켜 주세요.');
    preferCpu = true;
    landmarker.close();
    landmarkerPromise = null;
    return;
  }
  frameRequest = requestAnimationFrame((time) => tick(time, landmarker, session));
}

function stopCamera(message = '카메라를 다시 켜면 계속 연습할 수 있어요.') {
  run++;
  cancelAnimationFrame(frameRequest);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  video.hidden = overlay.hidden = true;
  standby.hidden = false;
  starting = active = false;
  lastVideoTime = -1;
  tracker.reset();
  setText('clock-camera-toggle', '카메라 켜기');
  setText('clock-camera-status', message);
  renderReading(null);
}

async function startCamera() {
  starting = true;
  const session = ++run;
  setText('clock-camera-toggle', '취소');
  setText('clock-camera-status', '카메라와 움직임 인식을 준비하고 있어요.');
  try {
    const candidate = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
      audio: false,
    });
    if (session !== run) {
      candidate.getTracks().forEach(track => track.stop());
      return;
    }
    stream = candidate;
    const camera = stream.getVideoTracks()[0];
    camera.addEventListener('ended', () => {
      if (session === run) stopCamera('카메라 연결이 끊겼어요. 다시 켜 주세요.');
    }, { once: true });
    video.srcObject = stream;
    await video.play();
    if (session !== run) return;
    const landmarker = await loadLandmarker();
    if (session !== run) return;
    starting = false;
    active = true;
    video.hidden = overlay.hidden = false;
    standby.hidden = true;
    setText('clock-camera-toggle', '카메라 끄기');
    renderReading(null);
    frameRequest = requestAnimationFrame(now => tick(now, landmarker, session));
  } catch (error) {
    if (session !== run) return;
    const message = error.name === 'NotAllowedError' || error.name === 'SecurityError'
      ? '브라우저에서 카메라 사용을 허용한 뒤 다시 켜 주세요.'
      : '카메라 또는 움직임 인식을 열 수 없어요. 카메라 연결을 확인해 주세요.';
    stopCamera(message);
  }
}

toggle.addEventListener('click', () => {
  if (active || starting) stopCamera();
  else void startCamera();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (active || starting)) stopCamera();
});
window.addEventListener('pagehide', () => {
  if (active || starting) stopCamera();
});
