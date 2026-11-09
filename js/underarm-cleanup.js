// The bundled picture has white sleeve pixels beside the orange vest. When
// the arm is raised, some of those pixels belong to the stationary torso and
// form a long, pointed flap. The mask only applies to that exact bundled image.
export const SAMPLE_UNDERARM_CLEANUP = 'orange-vest-sample-v1';

const REGIONS = [
  // Image-left is the puppet's right arm; the channels are independent.
  { channel: 0, left: 322 / 1024, right: 389 / 1024 },
  { channel: 1, left: 632 / 1024, right: 699 / 1024 },
];
const TOP = 410 / 1536, BOTTOM = 570 / 1536;

export function sampleUnderarmMask(pixels, width, height, toCanvas) {
  const mask = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < mask.length; i += 4) mask[i] = 255;
  for (const region of REGIONS) {
    const from = toCanvas(region.left, TOP), to = toCanvas(region.right, BOTTOM);
    const x0 = Math.max(0, Math.floor(Math.min(from[0], to[0])));
    const x1 = Math.min(width, Math.ceil(Math.max(from[0], to[0])));
    const y0 = Math.max(0, Math.floor(Math.min(from[1], to[1])));
    const y1 = Math.min(height, Math.ceil(Math.max(from[1], to[1])));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      // Keep the vest itself, including its orange shadows.
      const vest = r > g * 1.55 && g > b * 1.4 && r - g > 35 && g - b > 20;
      if (!vest && pixels[i + 3] > 0) mask[i + region.channel] = 255;
    }
  }
  return mask;
}

// Angles are relative to the spine in the picture's world coordinates.
// A lowered or resting arm keeps the entire original image visible.
export function underarmFade(side, angle) {
  const lift = (side === 'L' ? 1 : -1) * angle;
  const t = Math.max(0, Math.min(1, (lift - 0.08) / 0.52));
  return t * t * (3 - 2 * t);
}
