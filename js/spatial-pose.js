import * as THREE from '../lib/three.module.min.js';

// Two observed axes retain yaw and forward lean, including a side-facing body.
export function bodyOrientation(across, up) {
  const x=across.clone().normalize(), y=up.clone().addScaledVector(x,-up.dot(x)).normalize();
  if(x.lengthSq()<.5 || y.lengthSq()<.5)return null;
  const z=x.clone().cross(y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}

// Use the longer vertical leg to keep a grounded avatar at the right height
// when it raises the other foot.
export function groundedHipDrop(legs, upperLength, lowerLength) {
  const heights=legs.filter(l=>l && l.visible).map(({upper,lower})=>
    -upper.clone().normalize().y*upperLength-lower.clone().normalize().y*lowerLength);
  if(!heights.length)return null;
  return THREE.MathUtils.clamp(Math.max(...heights)-upperLength-lowerLength,-upperLength-lowerLength+.08,0);
}

// World landmarks are hip-relative. Normalize the image heights by torso size
// so small changes in distance from a fixed camera do not read as jumps.
export function projectJumpFrame(hips, shoulders, feet, aspect) {
  if ([...hips, ...shoulders].some(point => !point) || feet.some(foot => !foot.ankle)) return null;
  const middle = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hip = middle(hips), shoulder = middle(shoulders);
  const scale = Math.hypot((hip.x - shoulder.x) * aspect, hip.y - shoulder.y);
  if (scale < 0.035) return null;
  const height = point => (point.y - 0.5) / scale;
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  return {
    hip: height(hip), scale,
    feet: feet.map(({ ankle, heel, toe }) => ({
      ankle: height(ankle),
      sole: heel && toe && distance(heel, toe) > scale * 0.025
        && distance(ankle, toe) < scale * 0.8 && distance(ankle, heel) < scale * 0.8
        ? Math.max(height(heel), height(toe)) : null,
    })),
  };
}

// Heights and thresholds are in torso lengths, independent of the avatar size.
const TAKEOFF_CLEARANCE = 0.085;
const LANDING_CLEARANCE = 0.035;
const MAX_AIRTIME_MS = 850;
const FOOT_OCCLUSION_MS = 100;
const REACQUIRE_MS = 350;

export class JumpHeightTracker {
  constructor() { this.reset(); }

  reset() {
    this.ground = null;
    this.previous = null;
    this.takeoffAt = null;
    this.height = 0;
  }

  update(pose, now) {
    const previous = this.previous;
    if (!pose) {
      if (!previous || now - previous.time > FOOT_OCCLUSION_MS) {
        this.takeoffAt = null;
        this.height = 0;
      }
      return this.height;
    }
    this.previous = { ...pose, time: now };
    const scaleChange = this.ground ? pose.scale / this.ground.scale : 1;
    if (!previous || now - previous.time > REACQUIRE_MS
        || (this.takeoffAt === null && (scaleChange < 0.76 || scaleChange > 1.32))) {
      this.setGround(pose);
      return 0;
    }

    const clearance = Math.min(...pose.feet.map((foot, i) => {
      const reference = this.ground.feet[i];
      const soleClearance = reference.sole !== null && foot.sole !== null ? reference.sole - foot.sole : Infinity;
      return Math.min(reference.ankle - foot.ankle, soleClearance);
    }));
    const hipRising = this.ground.hip - pose.hip > 0.055
      || (now - previous.time < 130 && previous.hip - pose.hip > 0.022);
    if (this.takeoffAt === null && clearance >= TAKEOFF_CLEARANCE && hipRising) this.takeoffAt = now;

    if (this.takeoffAt !== null && now - this.takeoffAt > MAX_AIRTIME_MS) {
      this.setGround(pose);
      return 0;
    }
    if (clearance <= LANDING_CLEARANCE) this.takeoffAt = null;
    if (this.takeoffAt !== null) {
      this.height = THREE.MathUtils.clamp(clearance - LANDING_CLEARANCE, 0, 0.8);
      return this.height;
    }

    // Follow the supporting foot gradually as a student repositions. Lifting a
    // single foot or rising onto the toes must not move its floor reference up.
    const blend = 1 - Math.exp(-Math.max(now - previous.time, 0) / 135);
    pose.feet.forEach((foot, i) => {
      const reference = this.ground.feet[i];
      if (reference.ankle - foot.ankle <= LANDING_CLEARANCE) {
        reference.ankle = THREE.MathUtils.lerp(reference.ankle, foot.ankle, blend);
      }
      if (foot.sole !== null && (reference.sole === null || reference.sole - foot.sole <= LANDING_CLEARANCE)) {
        reference.sole = THREE.MathUtils.lerp(reference.sole ?? foot.sole, foot.sole, blend);
      }
    });
    if (clearance <= LANDING_CLEARANCE) {
      this.ground.hip = THREE.MathUtils.lerp(this.ground.hip, pose.hip, blend);
      this.ground.scale = THREE.MathUtils.lerp(this.ground.scale, pose.scale, blend);
    }
    this.height = 0;
    return 0;
  }

  setGround(pose) {
    this.ground = { ...pose, feet: pose.feet.map(foot => ({ ...foot })) };
    this.takeoffAt = null;
    this.height = 0;
  }
}
