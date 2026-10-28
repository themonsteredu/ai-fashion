import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPose, previewDescription, cameraErrorMessage } from '../js/auto-motion.js';

test('automatic preview changes arm and torso angles without webcam input', () => {
  const first = new Map(previewPose(0).map(([name, , angle]) => [name, angle]));
  const later = new Map(previewPose(1.5).map(([name, , angle]) => [name, angle]));
  assert.notEqual(first.get('leftUpperArm'), later.get('leftUpperArm'));
  assert.notEqual(first.get('rightUpperArm'), later.get('rightUpperArm'));
  assert.notEqual(first.get('spine'), later.get('spine')); // whole-body fallback visibly sways too
  for (const time of [0, 1, 5, 30, NaN]) for (const [, axis, angle] of previewPose(time)) {
    assert.deepEqual(axis, [0, 0, 1]);
    assert(Number.isFinite(angle) && Math.abs(angle) <= 1.3);
  }
});

test('preview explains the actual movement available for each image rig', () => {
  assert.match(previewDescription('standee'), /몸 전체/);
  assert.match(previewDescription('upper'), /팔과 몸통/);
  assert.match(previewDescription('full'), /팔과 다리/);
  assert.match(previewDescription(null), /카메라 연결 없이/);
});

test('camera failures describe permission, missing device, and busy device differently', () => {
  assert.match(cameraErrorMessage('NotAllowedError'), /권한/);
  assert.match(cameraErrorMessage('NotFoundError'), /카메라를 찾지 못했어요/);
  assert.match(cameraErrorMessage('NotReadableError'), /다른 앱/);
  assert.match(cameraErrorMessage('other'), /자동 동작/);
});
