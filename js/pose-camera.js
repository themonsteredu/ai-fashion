// A single on-device pose tracker for activities that only need body landmarks.
export function connectPoseCamera({ video, onState, onPose, height = 540 }) {
  let stream = null, detectorPromise = null, preferCpu = false;
  let session = 0, request = 0, state = 'off', lastFrame = -1, timestamp = 0;

  function change(next, message) {
    state = next;
    onState(next, message);
  }

  function detector() {
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const { FilesetResolver, PoseLandmarker } = await import('../lib/mediapipe/vision_bundle.mjs');
        const fileset = await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');
        const options = {
          baseOptions: { modelAssetPath: './models/pose_landmarker_lite.task' },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .55,
        };
        if (!preferCpu) {
          try {
            return await PoseLandmarker.createFromOptions(fileset, {
              ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' },
            });
          } catch {
            preferCpu = true;
          }
        }
        return PoseLandmarker.createFromOptions(fileset, options);
      })().catch((error) => {
        detectorPromise = null;
        throw error;
      });
    }
    return detectorPromise;
  }

  function stop(message = '카메라를 다시 켜면 계속 연습할 수 있어요.') {
    session++;
    cancelAnimationFrame(request);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    lastFrame = -1;
    change('off', message);
  }

  function tick(now, landmarker, run) {
    if (run !== session || state !== 'on') return;
    try {
      if (video.readyState >= 2 && video.videoHeight && video.currentTime !== lastFrame) {
        lastFrame = video.currentTime;
        timestamp = Math.max(timestamp + 1, Math.round(now));
        const { landmarks, worldLandmarks } = landmarker.detectForVideo(video, timestamp);
        onPose(landmarks?.[0], worldLandmarks?.[0], video.videoWidth / video.videoHeight, now);
      }
    } catch {
      stop('움직임을 읽지 못했어요. 카메라를 다시 켜 주세요.');
      preferCpu = true;
      detectorPromise = null;
      landmarker.close();
      return;
    }
    request = requestAnimationFrame(time => tick(time, landmarker, run));
  }

  async function start() {
    const run = ++session;
    change('starting', '카메라와 움직임 인식을 준비하고 있어요.');
    try {
      const candidate = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: height } },
        audio: false,
      });
      if (run !== session) {
        candidate.getTracks().forEach(track => track.stop());
        return;
      }
      stream = candidate;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (run === session) stop('카메라 연결이 끊겼어요. 다시 켜 주세요.');
      }, { once: true });
      video.srcObject = stream;
      await video.play();
      if (run !== session) return;
      const landmarker = await detector();
      if (run !== session) return;
      change('on');
      request = requestAnimationFrame(now => tick(now, landmarker, run));
    } catch (error) {
      if (run !== session) return;
      stop(error.name === 'NotAllowedError' || error.name === 'SecurityError'
        ? '브라우저에서 카메라 사용을 허용한 뒤 다시 켜 주세요.'
        : '카메라 또는 움직임 인식을 열 수 없어요. 카메라 연결을 확인해 주세요.');
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state !== 'off') stop();
  });
  window.addEventListener('pagehide', () => {
    if (state !== 'off') stop();
  });
  return { toggle: () => state === 'off' ? start() : stop() };
}
