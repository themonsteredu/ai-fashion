import './gltf-node-images.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import * as THREE from '../lib/three.module.min.js';
import {createKidRig} from '../js/kid-rig.js';

// This is a synthetic landmark integration test, not a real-camera accuracy test.
const visionStub='data:text/javascript,'+encodeURIComponent(`
export const FilesetResolver={forVisionTasks:async()=>({})};
export const PoseLandmarker={createFromOptions:async()=>({detectForVideo:()=>globalThis.testPoseFrame})};
export const HandLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:[],worldLandmarks:[]})})};
export const FaceLandmarker={createFromOptions:async()=>({detectForVideo:()=>({})})};`);
registerHooks({resolve(s,c,next){
  if(s.includes('mediapipe/vision_bundle'))return {url:visionStub,shortCircuit:true};
  return next(s==='three'?new URL('../lib/three.module.min.js',import.meta.url).href:s,c);
}});
const {GLTFLoader}=await import('../lib/three/addons/loaders/GLTFLoader.js');
const Motion=await import('../js/motion.js');

async function loadBoyRig() {
  const bytes = await readFile(new URL('../assets/kids/boy.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return createKidRig(gltf.scene);
}

function standingPose() {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const set = (index, x, y, z = 0) => Object.assign(points[index], { x, y, z });
  set(0, 0, -.70, -.10);
  set(2, .035, -.72, -.08);
  set(5, -.035, -.72, -.08);
  set(7, .075, -.70);
  set(8, -.075, -.70);
  for (const [side, sign] of [[0, 1], [1, -1]]) {
    set(11 + side, sign * .20, -.48);
    set(13 + side, sign * .25, -.23);
    set(15 + side, sign * .25, 0);
    set(23 + side, sign * .09, 0);
    set(25 + side, sign * .09, .31);
    set(27 + side, sign * .09, .63);
    set(29 + side, sign * .08, .67, .04);
    set(31 + side, sign * .11, .67, -.16);
  }
  return points;
}

function imagePose(world, { rise = 0, zoom = 1 } = {}) {
  return world.map(p => ({ ...p, x: .5 + p.x * .4 * zoom, y: .5 + p.y * .4 * zoom - rise }));
}

function startDriver(rig) {
  const driver = Motion.createMotionSession();
  driver.setAvatar(rig, rig.measures);
  const standing = standingPose();
  let time = 1000;
  function frame(world = standing, image = imagePose(world)) {
    time += 1000 / 30;
    driver.feedPose({ world, image }, time);
    driver.applyToVRM(rig, 1 / 30);
    rig.update();
  }
  for (let i = 0; i < 75; i++) frame();
  assert.equal(driver.getStatus(), 'ok');
  return { frame, standing };
}

test('full tracker-to-authored-rig path retains side turn and lowers the seated pelvis',async()=>{
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}}});
  globalThis.location={search:''};
  try{
    const rig=await loadBoyRig();Motion.setAvatar(rig,rig.measures);
    await Motion.initTrackers();
    const video={videoWidth:1280,videoHeight:960,readyState:4,currentTime:0,play:async()=>{}};
    await Motion.startCamera(video);
    const front=standingPose();
    let clock=performance.now();
    const run=(world,frames=80)=>{for(let i=0;i<frames;i++){
      // Image projections deliberately collapse in a side view; 3D limb lengths must remain stable.
      globalThis.testPoseFrame={worldLandmarks:[world],landmarks:[imagePose(world)]};
      video.currentTime+=1/30;clock+=1000/30;Motion.detect(clock);Motion.applyToVRM(rig,1/30);rig.update();
    }};
    run(front);assert.equal(Motion.getStatus(),'ok');
    const hips=rig.humanoid.getRawBoneNode('hips');const standing=hips.getWorldPosition(new THREE.Vector3());
    const side=front.map(p=>({...p,x:p.z,z:-p.x}));run(side);
    const q=rig.humanoid.getNormalizedBoneNode('hips').getWorldQuaternion(new THREE.Quaternion());
    assert.ok(Math.abs(new THREE.Vector3(1,0,0).applyQuaternion(q).z)>.9,'side-facing torso should rotate at least ~65 degrees');
    const seated=front.map(p=>({...p}));
    for(const [k,a] of [[25,27],[26,28]]){seated[k].y=0;seated[k].z=-.31;seated[a].y=.32;seated[a].z=-.31;}
    run(seated);
    assert.ok(hips.getWorldPosition(new THREE.Vector3()).y<standing.y-.2,'seated hips must drop');
    rig.scene.traverse(b=>{if(b.isBone)assert.ok(b.matrixWorld.elements.every(Number.isFinite));});
    Motion.stopCamera();rig.dispose();
  }finally{if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;delete globalThis.location;delete globalThis.testPoseFrame;}
});

test('successive short jumps lift both avatar feet and land back at the reference height', async () => {
  const rig = await loadBoyRig();
  try {
    const { frame, standing } = startDriver(rig);
    const height = name => rig.humanoid.getRawBoneNode(name).getWorldPosition(new THREE.Vector3()).y;
    const bones = ['hips', 'leftFoot', 'rightFoot'];
    const baseline = bones.map(height);
    for (let jump = 0; jump < 3; jump++) {
      const peak = [0, 0, 0];
      for (const rise of [.012, .033, .050, .058, .051, .034, .013, 0, 0, 0, 0, 0, 0]) {
        frame(standing, imagePose(standing, { rise }));
        bones.forEach((name, i) => { peak[i] = Math.max(peak[i], height(name) - baseline[i]); });
      }
      assert.ok(peak.every(value => value > .08), `jump ${jump + 1} must lift hips and both feet: ${peak}`);
      assert.ok(bones.every((name, i) => Math.abs(height(name) - baseline[i]) < .005));
    }
  } finally {
    rig.dispose();
  }
});

test('planted toes, a hidden ankle, and a change of camera distance do not launch the avatar', async () => {
  const rig = await loadBoyRig();
  try {
    const { frame, standing } = startDriver(rig);
    const hip = rig.humanoid.getRawBoneNode('hips');
    const height = () => hip.getWorldPosition(new THREE.Vector3()).y;
    const baseline = height();
    const plantedToes = imagePose(standing, { rise: .045 });
    const originalImage = imagePose(standing);
    for (const index of [31, 32]) plantedToes[index] = originalImage[index];
    const hiddenAnkle = imagePose(standing, { rise: .06 });
    hiddenAnkle[27].visibility = .1;
    const backedUp = imagePose(standing, { zoom: .86 });
    for (const image of [plantedToes, originalImage, hiddenAnkle, originalImage, backedUp]) {
      for (let i = 0; i < 5; i++) {
        frame(standing, image);
        assert.ok(Math.abs(height() - baseline) < .005);
      }
    }
  } finally {
    rig.dispose();
  }
});

test('a two-frame kick extends the leg, turns the toes, and keeps the support leg grounded', async () => {
  const rig = await loadBoyRig();
  try {
    const { frame, standing } = startDriver(rig);
    const rigFoot = side => rig.humanoid.getRawBoneNode(side + 'Foot').getWorldPosition(new THREE.Vector3());
    const before = rigFoot('right');
    const support = rigFoot('left');
    const kick = standing.map(point => ({ ...point }));
    Object.assign(kick[25], { y: .125, z: -.284 });
    Object.assign(kick[27], { y: .040, z: -.593 });
    Object.assign(kick[29], { y: .060, z: -.55 });
    Object.assign(kick[31], { y: .210, z: -.68 });
    frame(kick);
    frame(kick);
    assert.ok(rigFoot('right').z - before.z > .40, 'a short extension must survive smoothing');
    assert.ok(Math.abs(rigFoot('left').y - support.y) < .025);
    const foot = rig.humanoid.getNormalizedBoneNode('rightFoot');
    const toesY = () => new THREE.Vector3(0, 0, 1).applyQuaternion(foot.getWorldQuaternion(new THREE.Quaternion())).y;
    const toeAngle = toesY();
    assert.ok(toeAngle < -.2, 'the kicking foot must point down as observed');

    const partiallyHidden = imagePose(kick);
    partiallyHidden[27].visibility = .2;
    frame(kick, partiallyHidden);
    frame(kick, partiallyHidden);
    assert.ok(toesY() < -.2, 'a brief ankle occlusion must not snap the foot to flat');
  } finally {
    rig.dispose();
  }
});
