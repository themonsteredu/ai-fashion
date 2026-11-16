import test from 'node:test';
import assert from 'node:assert/strict';
import { BodyClockTracker, CLOCK_PRACTICE_HOURS } from '../js/body-clock.js';
import { bodyClockPose } from './fixtures/body-clock-pose.mjs';

const aspect = 16 / 9;

test('the four practice hours follow mirrored arm direction and settle after a short hold', () => {
  for (const hour of CLOCK_PRACTICE_HOURS) {
    const tracker = new BodyClockTracker();
    const points = bodyClockPose(hour, aspect);
    const first = tracker.update(points, aspect, 0);
    assert.equal(first.minuteAtTwelve, true);
    assert.equal(first.hour, null);
    assert.equal(tracker.update(points, aspect, 150).hour, null);
    const settled = tracker.update(points, aspect, 310);
    assert.equal(settled.hour, hour);
    assert.equal(settled.hourDegrees, hour * 30);
    assert.equal(settled.minuteDegrees, 0);
    if (hour === 3) assert.equal(settled.hourArm.side, 'right');
    if (hour === 9) assert.equal(settled.hourArm.side, 'left');
  }
});

test('swapping which arm points up can change from 9 to 3 without crossing arms', () => {
  const tracker = new BodyClockTracker();
  const nine = bodyClockPose(9, aspect);
  const three = bodyClockPose(3, aspect);
  tracker.update(nine, aspect, 0);
  tracker.update(nine, aspect, 150);
  assert.equal(tracker.update(nine, aspect, 310).hour, 9);
  assert.equal(tracker.update(three, aspect, 400).hour, null);
  tracker.update(three, aspect, 540);
  const settled = tracker.update(three, aspect, 710);
  assert.equal(settled.hour, 3);
  assert.equal(settled.minuteArm.side, 'left');
});

test('uncertain, cropped and bent arms clear the clock reading', () => {
  const tracker = new BodyClockTracker();
  const hidden = bodyClockPose(9, aspect);
  hidden[15].visibility = .2;
  const cropped = bodyClockPose(9, aspect);
  cropped[16].y = -.01;
  const bent = bodyClockPose(9, aspect);
  bent[13].y = .66;
  for (const pose of [null, hidden, cropped, bent]) {
    assert.equal(tracker.update(pose, aspect, 0), null);
  }
});

test('a nonvertical minute arm and a long camera pause cannot preserve a correct answer', () => {
  const tracker = new BodyClockTracker();
  const slanted = bodyClockPose(9, aspect, { minuteDegrees: 42 });
  assert.equal(tracker.update(slanted, aspect, 0).minuteAtTwelve, false);
  tracker.update(slanted, aspect, 170);
  assert.equal(tracker.update(slanted, aspect, 330).hour, null);
  const nine = bodyClockPose(9, aspect);
  tracker.update(nine, aspect, 380);
  tracker.update(nine, aspect, 540);
  assert.equal(tracker.update(nine, aspect, 750).hour, 9);
  assert.equal(tracker.update(nine, aspect, 1200).hour, null);
});
