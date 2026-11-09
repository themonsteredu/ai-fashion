// Camera zoom is a stream constraint, so preview and pose detection see the same frame.
export function getTrackZoom(track) {
  if (track?.readyState !== 'live' || typeof track.applyConstraints !== 'function') return null;

  const range = track.getCapabilities?.()?.zoom;
  const value = track.getSettings?.()?.zoom;
  if (!Number.isFinite(range?.min) || !Number.isFinite(range?.max) || range.min >= range.max || !Number.isFinite(value)) {
    return null;
  }

  const { min, max, step } = range;
  return { min, max, step: Number.isFinite(step) && step > 0 ? step : (max - min) / 100, value };
}

export async function applyTrackZoom(track, value) {
  const zoom = getTrackZoom(track);
  if (!zoom || !Number.isFinite(value)) return null;

  const next = Math.min(zoom.max, Math.max(zoom.min, value));
  if (next === zoom.value) return zoom;

  const { zoom: previousZoom, advanced = [], ...constraints } = track.getConstraints?.() ?? {};
  const otherAdvanced = advanced
    .map(({ zoom: previousZoom, ...constraint }) => constraint)
    .filter(constraint => Object.keys(constraint).length > 0);
  await track.applyConstraints({ ...constraints, advanced: [...otherAdvanced, { zoom: next }] });
  return getTrackZoom(track);
}

export function canRequestTrackZoom(track, mediaDevices = globalThis.navigator?.mediaDevices) {
  return track?.readyState === 'live'
    && Boolean(track.getSettings?.()?.deviceId && mediaDevices?.getSupportedConstraints?.()?.zoom)
    && typeof mediaDevices?.getUserMedia === 'function';
}

// Request a separate stream only from the explicit zoom button. The caller owns the swap.
export async function requestTrackZoomStream(track, mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!canRequestTrackZoom(track, mediaDevices)) return null;

  const settings = track.getSettings();
  const video = { deviceId: { exact: settings.deviceId }, zoom: true };
  for (const key of ['width', 'height', 'aspectRatio', 'frameRate']) {
    if (Number.isFinite(settings[key]) && settings[key] > 0) video[key] = { ideal: settings[key] };
  }
  return mediaDevices.getUserMedia({ video, audio: false });
}
