// Let a student press record near the device, then move into the camera frame.
// Framing advice must not lock the button or require both feet to be visible.
export function canStartRecording({ avatarReady, source, cameraActive }) {
  return !!avatarReady && (source === 'demo' || (source === 'camera' && cameraActive));
}

export async function prepareRecording({
  getState,
  isCanceled,
  onCountdown,
  onWaiting,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  for (let n = 3; n > 0; n--) {
    if (isCanceled()) return false;
    onCountdown(n);
    await wait(1000);
  }
  onCountdown(null);

  // Allow time to step back and finish calibration instead of silently failing
  // when tracking is absent at the exact end of the countdown.
  for (let elapsed = 0; elapsed <= 12000; elapsed += 200) {
    if (isCanceled()) return false;
    const state = getState();
    if (!canStartRecording(state)) throw new Error('카메라 연결이 끊겼어요. 카메라를 다시 켜 주세요.');
    if (state.source === 'demo' || state.status === 'ok') return true;
    if (elapsed === 12000) break;
    onWaiting(state.status);
    await wait(200);
  }
  throw new Error('몸을 인식하지 못했어요. 카메라를 향해 서서 아바타가 움직이는지 확인한 뒤 다시 녹화해 주세요.');
}
