import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRelayFraming } from '../js/pe-relay-framing.js';

function person({ offset = 0, scale = 1 } = {}) {
  const frame = Array(33).fill(null);
  const points = {
    0: [0.5, 0.18],
    11: [0.58, 0.31], 12: [0.42, 0.31],
    13: [0.64, 0.41], 14: [0.36, 0.41],
    15: [0.69, 0.50], 16: [0.31, 0.50],
    23: [0.55, 0.54], 24: [0.45, 0.54],
    25: [0.56, 0.71], 26: [0.44, 0.71],
    27: [0.57, 0.87], 28: [0.43, 0.87],
  };
  for (const [id, [x, y]] of Object.entries(points)) {
    frame[id] = { x: 0.5 + (x - 0.5) * scale + offset, y: 0.5 + (y - 0.5) * scale, visibility: 0.95 };
  }
  return frame;
}

test('framing is ready for a centered full body and searches when tracking is missing', () => {
  assert.equal(evaluateRelayFraming(null).state, 'searching');
  assert.equal(evaluateRelayFraming([]).state, 'searching');
  assert.deepEqual(evaluateRelayFraming(person()), { state: 'ready', message: '전신이 들어왔어요.' });
});

test('framing leaves room for the head and feet and checks both arms', () => {
  const head = person();
  head[0].y = 0.09;
  assert.equal(evaluateRelayFraming(head).state, 'head');
  const feet = person();
  feet[27].y = 0.94;
  assert.equal(evaluateRelayFraming(feet).state, 'feet');
  const arms = person();
  arms[16].x = 0.01;
  assert.equal(evaluateRelayFraming(arms).state, 'arms');
  arms[16].x = 0.31;
  arms[16].visibility = 0.2;
  assert.equal(evaluateRelayFraming(arms).state, 'arms');
});

test('framing detects off-center and distant people in camera coordinates', () => {
  assert.equal(evaluateRelayFraming(person({ offset: 0.26 })).state, 'center');
  assert.equal(evaluateRelayFraming(person({ offset: -0.26 })).state, 'center');
  assert.equal(evaluateRelayFraming(person({ scale: 0.50 })).state, 'distance');
});

test('upper body framing allows legs to be outside the shot and still requires hips', () => {
  const frame = person();
  for (let i = 25; i <= 28; i++) frame[i] = null;
  assert.equal(evaluateRelayFraming(frame).state, 'feet');
  const upper = { upperBodyOnly: true };
  assert.deepEqual(evaluateRelayFraming(frame, upper), { state: 'ready', message: '상체가 들어왔어요.' });
  frame[23] = null;
  assert.equal(evaluateRelayFraming(frame, upper).state, 'torso');
});
