import * as THREE from '../lib/three.module.min.js';

// Convert the authored bone axes to the neutral, world-aligned axes expected by
// motion.js. Copying its quaternions directly to Blender bones twists the mesh.
export function createKidRig(model) {
  const scene = new THREE.Group();
  scene.add(model);
  model.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.pose(); o.frustumCulled = false; } });
  scene.updateMatrixWorld(true);
  const raw = new Map(), normalized = new Map(), rest = new Map(), order = [];
  model.traverse(b => { if (b.isBone) { raw.set(b.name, b); order.push(b); } });
  for (const name of ['hips','head','leftUpperArm','rightUpperArm','leftHand','rightHand','leftFoot','rightFoot']) {
    if (!raw.has(name)) throw new Error(`모델에 ${name} 관절이 없습니다.`);
  }
  for (const b of order) {
    const n = new THREE.Bone(); n.name = 'normalized_' + b.name;
    const parent = normalized.get(b.parent?.name) || scene;
    const wp = b.getWorldPosition(new THREE.Vector3());
    n.position.copy(wp).sub(parent.getWorldPosition(new THREE.Vector3()));
    parent.add(n); n.updateMatrixWorld(true); normalized.set(b.name, n);
    rest.set(b.name, { world: b.getWorldQuaternion(new THREE.Quaternion()), position: n.position.clone() });
  }
  const world = new THREE.Quaternion(), parent = new THREE.Quaternion(), pos = new THREE.Vector3();
  const humanoid = {
    getNormalizedBoneNode: name => normalized.get(name) || null,
    getRawBoneNode: name => raw.get(name) || null,
  };
  function update() {
    scene.updateMatrixWorld(true);
    for (const b of order) {
      const n = normalized.get(b.name);
      n.getWorldQuaternion(world).multiply(rest.get(b.name).world);
      b.parent.getWorldQuaternion(parent).invert();
      b.quaternion.copy(parent.multiply(world));
      if (b.name === 'hips') {
        n.getWorldPosition(pos); b.position.copy(b.parent.worldToLocal(pos));
      }
      b.updateMatrixWorld(true);
    }
  }
  function reset() {
    for (const [name, n] of normalized) { n.quaternion.identity(); n.position.copy(rest.get(name).position); }
    normalized.get('leftUpperArm').rotation.z = -1.18;
    normalized.get('rightUpperArm').rotation.z = 1.18;
    update();
  }
  const wp = name => raw.get(name).getWorldPosition(new THREE.Vector3());
  const dist = (a,b) => wp(a).distanceTo(wp(b));
  const measures = {
    hipsY: wp('hips').y, hipHalf: dist('leftUpperLeg','rightUpperLeg') / 2,
    torsoLen: dist('hips','neck'), upperLegLen: dist('leftUpperLeg','leftLowerLeg'),
    lowerLegLen: dist('leftLowerLeg','leftFoot'),
    legLen: dist('leftUpperLeg','leftLowerLeg') + dist('leftLowerLeg','leftFoot'),
    armLen: dist('leftUpperArm','leftLowerArm') + dist('leftLowerArm','leftHand'),
    shoulderW: dist('leftUpperArm','rightUpperArm'),
  };
  reset();
  return { scene, humanoid, update, reset, measures, meta: { metaVersion:'1', spatialRig:true },
    demo(seconds, mode='arms') {
      reset();
      const pulse = .5 - .5 * Math.cos(seconds * 2);
      for (const side of ['left','right']) {
        const sign = side === 'left' ? 1 : -1;
        normalized.get(side+'UpperArm').rotation.z = sign * (-1.18 + (mode==='arms' ? 2.35*pulse : 0));
        if (mode === 'sit') {
          normalized.get(side+'UpperLeg').rotation.x = -1.5*pulse;
          normalized.get(side+'LowerLeg').rotation.x = 1.5*pulse;
        }
        for (const finger of ['Index','Middle','Ring','Little']) for (const joint of ['Proximal','Intermediate','Distal']) {
          normalized.get(side+finger+joint).rotation.z = -sign * pulse * (joint==='Intermediate'?1.2:.8);
        }
      }
      const h = normalized.get('hips');
      if (mode==='sit') h.position.y -= .30*pulse;
      update();
    },
    dispose() {
      const geometries=new Set(), materials=new Set(), textures=new Set();
      model.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of [].concat(o.material))materials.add(m);}});
      for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    },
  };
}
