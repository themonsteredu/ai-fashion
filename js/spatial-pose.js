import * as THREE from '../lib/three.module.min.js';

// Two observed axes retain yaw and forward lean, including a side-facing body.
export function bodyOrientation(across, up) {
  const x=across.clone().normalize(), y=up.clone().addScaledVector(x,-up.dot(x)).normalize();
  if(x.lengthSq()<.5 || y.lengthSq()<.5)return null;
  const z=x.clone().cross(y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}

// Estimate the hip drop from both articulated legs. One raised knee must not
// lower the standing leg through the floor. This does not infer jump height.
export function groundedHipDrop(legs, upperLength, lowerLength) {
  const heights=legs.filter(l=>l && l.visible).map(({upper,lower})=>
    -upper.clone().normalize().y*upperLength-lower.clone().normalize().y*lowerLength);
  if(!heights.length)return null;
  return THREE.MathUtils.clamp(Math.max(...heights)-upperLength-lowerLength,-upperLength-lowerLength+.08,0);
}
