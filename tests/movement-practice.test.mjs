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

test('confirmation begins exactly two seconds after the first matching frame', () => {
  const hold = new MovementHold();
  for (let elapsed = 0; elapsed < 2000; elapsed += 250) {
    assert.equal(hold.update(true, 100 + elapsed), false);
  }
  assert.equal(hold.update(true, 2099), false);
  assert.equal(hold.update(true, 2100), true);
});

test('a mismatched pose, a missing joint or a camera frame gap restarts the full hold', () => {
  for (const interruption of ['mismatch', 'missing', 'gap']) {
    const hold = new MovementHold();
    for (let time = 0; time <= 1750; time += 250) {
      assert.equal(hold.update(true, time), false);
    }
    if (interruption !== 'gap') {
      assert.equal(hold.update(interruption === 'missing' ? null : false, 1900), false);
    }
    const resumed = interruption === 'gap' ? 2200 : 1950;
    for (let elapsed = 0; elapsed < 2000; elapsed += 250) {
      assert.equal(hold.update(true, resumed + elapsed), false, interruption);
    }
    assert.equal(hold.update(true, resumed + 2000), true, interruption);
  }
});
