import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleUnderarmMask, underarmFade } from '../js/underarm-cleanup.js';

test('only sleeve-coloured pixels in the sample underarms enter the mask', () => {
  const w = 1024, h = 1536, pixels = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, colour) => pixels.set(colour, (y * w + x) * 4);
  put(350, 460, [237, 225, 215, 255]); // right sleeve
  put(675, 460, [237, 225, 215, 255]); // left sleeve
  put(385, 460, [229, 97, 25, 255]);   // vest next to the sleeve
  put(385, 470, [140, 73, 34, 255]);   // dark orange vest shadow
  put(350, 350, [237, 225, 215, 255]); // shoulder, above the cleanup area
  put(500, 460, [237, 225, 215, 255]); // shirt in the middle of the body
  const mask = sampleUnderarmMask(pixels, w, h, (x, y) => [x * w, y * h]);
  const at = (x, y) => Array.from(mask.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
  assert.deepEqual(at(350, 460), [255, 0, 0]);
  assert.deepEqual(at(675, 460), [0, 255, 0]);
  for (const [x, y] of [[385, 460], [385, 470], [350, 350], [500, 460]]) {
    assert.deepEqual(at(x, y), [0, 0, 0]);
  }
});

test('each mask fades in only when its corresponding arm is lifted', () => {
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    assert.equal(underarmFade(side, 0), 0);
    assert.equal(underarmFade(side, -sign), 0);
    assert(underarmFade(side, sign * 0.3) > 0 && underarmFade(side, sign * 0.3) < 1);
    assert.equal(underarmFade(side, sign * 0.8), 1);
  }
});
