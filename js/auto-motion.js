// Deterministic preview poses: this runs without a webcam or an AI request.
// Angles use the same mirrored coordinates as the existing mission demonstrations.
export function previewPose(seconds) {
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const liftLeft = (1 - Math.cos(time * 1.15)) / 2;
  const liftRight = (1 - Math.cos(time * 1.15 + 1.05)) / 2;
  const sway = Math.sin(time * 0.9);
  return [
    ['leftUpperArm', [0, 0, 1], -1.18 + 1.95 * liftLeft],
    ['rightUpperArm', [0, 0, 1], 1.18 - 1.95 * liftRight],
    ['leftLowerArm', [0, 0, 1], 0.30 * liftLeft],
    ['rightLowerArm', [0, 0, 1], -0.30 * liftRight],
    ['spine', [0, 0, 1], 0.20 * sway],
    ['head', [0, 0, 1], -0.06 * sway],
    ['leftUpperLeg', [0, 0, 1], 0.07 * sway],
    ['rightUpperLeg', [0, 0, 1], -0.07 * sway],
  ];
}

export function previewDescription(puppetMode) {
  if (puppetMode === 'standee') return '이 그림은 몸 전체가 함께 움직여요. 팔을 몸에서 살짝 뗀 전신 그림은 팔과 다리를 따로 움직이기 더 좋아요.';
  if (puppetMode === 'upper') return '이 그림은 팔과 몸통을 중심으로 움직여요. 전신 정면 그림을 사용하면 다리도 인식할 수 있어요.';
  if (puppetMode === 'full') return '그림의 팔과 다리 위치를 찾아 자동 동작을 보여 줘요. 움직임은 그림의 자세에 따라 달라질 수 있어요.';
  return '카메라 연결 없이 아바타의 자동 움직임을 볼 수 있어요.';
}

export function cameraErrorMessage(name) {
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return '카메라 권한이 꺼져 있어요. 브라우저에서 카메라 사용을 허용해 주세요.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '연결된 카메라를 찾지 못했어요. 웹캠을 연결하거나 자동 동작을 확인해 보세요.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '카메라가 다른 앱에서 사용 중이거나 열리지 않아요. 다른 앱을 닫고 다시 시도해 주세요.';
  return '카메라를 사용할 수 없어요. 웹캠 연결과 브라우저 권한을 확인하거나 자동 동작을 확인해 보세요.';
}
