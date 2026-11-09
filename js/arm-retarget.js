import { Quaternion } from '../lib/three.module.min.js';

// The upper arm is below the clavicle. Subtract BOTH parent rotations so that
// raising the shoulder does not rotate the tracked arm a second time.
export function localArmQuaternion(torsoWorld, shoulderLocal, upperWorld) {
  return new Quaternion().copy(torsoWorld).multiply(shoulderLocal).invert().multiply(upperWorld);
}
