import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3, Euler } from '../lib/three.module.min.js';
import { localArmQuaternion } from '../js/arm-retarget.js';

test('clavicle lift preserves the intended tracked arm direction and twist', () => {
  for (const side of [-1, 1]) for (const lift of [-1.18, 0, .7, 1.45]) {
    const torso = new Quaternion().setFromEuler(new Euler(.1, .2, .25));
    const shoulder = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), side * .3);
    const target = new Quaternion().setFromEuler(new Euler(.4, .15, side * lift));
    const local = localArmQuaternion(torso, shoulder, target);
    const actual = torso.clone().multiply(shoulder).multiply(local);
    assert(actual.angleTo(target) < 1e-7);
  }
});

test('models without a clavicle retain the ordinary torso-relative rotation', () => {
  const torso = new Quaternion().setFromEuler(new Euler(.2, 0, .3));
  const target = new Quaternion().setFromEuler(new Euler(0, .5, 1));
  const local = localArmQuaternion(torso, new Quaternion(), target);
  assert(torso.clone().multiply(local).angleTo(target) < 1e-7);
});
