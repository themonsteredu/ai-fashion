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

test('confirmation requires a continuous, visible pose for half a second', () => {
  const hold = new MovementHold();
  assert.equal(hold.update(true, 30), false);
  assert.equal(hold.update(true, 270), false);
  assert.equal(hold.update(null, 290), false);
  assert.equal(hold.update(true, 310), false);
  assert.equal(hold.update(true, 530), false);
  assert.equal(hold.update(true, 819), true);
  assert.equal(hold.update(true, 1210), false);
});
