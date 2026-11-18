import assert from 'node:assert/strict';
import test from 'node:test';
import { MOVEMENT_GROUPS, MOVEMENTS, matchesMovement, MovementHold } from '../js/movement-practice.js';
import { movementPose } from './fixtures/movement-poses.mjs';

test('all nine reference movements have their own guide and accept a matching pose', () => {
  assert.deepEqual(MOVEMENT_GROUPS.map(group => group.poses.length), [2, 4, 3]);
  assert.equal(new Set(MOVEMENTS.map(pose => pose.id)).size, 9);
  for (const pose of MOVEMENTS) {
    const { image, world } = movementPose(pose.id);
    assert.equal(matchesMovement(pose.id, image, world, 1.5), true, pose.id);
  }
});

test('standing is distinct from crouching, leaning and lifting a knee', () => {
  const { image, world } = movementPose('stand');
  for (const id of ['crouch', 'lean', 'raise-leg', 'above-head', 'bend', 'stretch']) {
    assert.equal(matchesMovement(id, image, world, 1.5), false, id);
  }
  image[27].visibility = .2;
  assert.equal(matchesMovement('stand', image, world, 1.5), null);
  assert.equal(matchesMovement('raise-leg', image, world, 1.5), null);
});

test('waist height includes the belt above the hip bones and tolerates small differences between hands', () => {
  const { image, world } = movementPose('waist');
  image[15].y = .46;
  image[16].y = .48;
  assert.equal(matchesMovement('waist', image, world, 1.5), true);
  const relaxed = movementPose('stand');
  assert.equal(matchesMovement('waist', relaxed.image, relaxed.world, 1.5), false);
});

test('straight legs in the camera view compensate for moderate depth error, while raised arms do not count as standing at rest', () => {
  const { image, world } = movementPose('stand');
  for (const knee of [25, 26]) world[knee].z -= .055;
  assert.equal(matchesMovement('stand', image, world, 1.5), true);
  assert.equal(matchesMovement('crouch', image, world, 1.5), false);
  const overhead = movementPose('above-head');
  assert.equal(matchesMovement('stand', overhead.image, overhead.world, 1.5), false);
});

test('confirmation begins exactly two seconds after the first matching frame', () => {
  const hold = new MovementHold();
  for (let elapsed = 0; elapsed < 2000; elapsed += 250) {
    assert.equal(hold.update(true, 100 + elapsed), false);
  }
  assert.equal(hold.update(true, 2099), false);
  assert.equal(hold.update(true, 2100), true);
});

test('a brief loss pauses the countdown and excludes the uncertain interval', () => {
  for (const reading of [false, null]) {
    const hold = new MovementHold();
    for (let time = 0; time <= 1600; time += 400) assert.equal(hold.update(true, time), false);
    assert.equal(hold.update(reading, 2000), false);
    assert.equal(hold.secondsLeft, 1);
    assert.equal(hold.update(true, 2400), false);
    assert.equal(hold.update(true, 2799), false);
    assert.equal(hold.update(true, 2800), true);
  }
});

test('holding the pose at a low frame rate still advances after two seconds', () => {
  const hold = new MovementHold();
  for (const time of [0, 400, 850, 1350, 1750, 1999]) assert.equal(hold.update(true, time), false);
  assert.equal(hold.update(true, 2000), true);
});

test('sustained incorrect or missing poses and a frozen camera require a fresh two seconds', () => {
  for (const interruption of [false, null, 'freeze']) {
    const hold = new MovementHold();
    for (let time = 0; time <= 1500; time += 250) assert.equal(hold.update(true, time), false);
    if (interruption !== 'freeze') {
      for (let time = 1600; time <= 2300; time += 100) assert.equal(hold.update(interruption, time), false);
      assert.equal(hold.secondsLeft, null);
    }
    for (let time = 2500; time < 4500; time += 250) assert.equal(hold.update(true, time), false);
    assert.equal(hold.update(true, 4500), true);
  }
});
