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

test('two authored girl rigs calibrate and move independently without copying poses',async()=>{
  const bytes=await readFile(new URL('../assets/kids/girl.glb',import.meta.url));
  const rigs=[];for(let i=0;i<2;i++){const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');rigs.push(createKidRig(gltf.scene));}
  const drivers=rigs.map(rig=>{const driver=Motion.createMotionSession();driver.setAvatar(rig,rig.measures);return driver;});
  const front=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
  const set=(i,x,y,z=0)=>front[i]={x,y,z,visibility:1};
  set(0,0,-.70,-.10);set(2,.035,-.72,-.08);set(5,-.035,-.72,-.08);set(7,.075,-.70);set(8,-.075,-.70);
  for(const [s,sh,el,wr,h,k,a] of [[1,11,13,15,23,25,27],[-1,12,14,16,24,26,28]]){
    set(sh,s*.20,-.48);set(el,s*.25,-.23);set(wr,s*.25,0);set(h,s*.09,0);set(k,s*.09,.31);set(a,s*.09,.63);
  }
  const observation=world=>({world,image:world.map(p=>({...p,x:.5+p.x*.4,y:.5+p.y*.4}))});
  let now=performance.now();
  const run=(a,b,count=80)=>{for(let i=0;i<count;i++){now+=1000/30;[a,b].forEach((pose,n)=>{drivers[n].feedPose(pose?observation(pose):null,now);drivers[n].applyToVRM(rigs[n],1/30);rigs[n].update();});}};
  try{
    run(front,front);assert.deepEqual(drivers.map(d=>d.getStatus()),['ok','ok']);
    const raised=front.map(p=>({...p}));raised[13].y=-.75;raised[15].y=-1;
    const arm=rig=>rig.humanoid.getNormalizedBoneNode('rightUpperArm').quaternion.clone();
    const rightBefore=arm(rigs[1]);run(raised,front);
    assert.ok(arm(rigs[0]).angleTo(arm(rigs[1]))>.7,'one person raises an arm, other does not');
    assert.ok(rightBefore.angleTo(arm(rigs[1]))<.05,'second person remains stable');
    run(null,raised);assert.deepEqual(drivers.map(d=>d.isTracking()),[false,true]);
    assert.ok(arm(rigs[0]).angleTo(arm(rigs[1]))>.7,'missing first person must not borrow second person');
    drivers[0].resetForNextStudent();assert.equal(drivers[1].getStatus(),'ok','calibration is per person');
    for(const rig of rigs)rig.scene.traverse(o=>{if(o.isBone)assert.ok(o.matrixWorld.elements.every(Number.isFinite));});
  }finally{rigs.forEach(r=>r.dispose());}
});
