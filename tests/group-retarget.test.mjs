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
test('full tracker-to-authored-rig path retains side turn and lowers the seated pelvis',async()=>{
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}}});
  globalThis.location={search:''};
  try{
    const bytes=await readFile(new URL('../assets/kids/boy.glb',import.meta.url));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const rig=createKidRig(gltf.scene);Motion.setAvatar(rig,rig.measures);
    await Motion.initTrackers();
    const video={videoWidth:1280,videoHeight:960,readyState:4,currentTime:0,play:async()=>{}};
    await Motion.startCamera(video);
    const front=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
    const set=(i,x,y,z=0)=>front[i]={x,y,z,visibility:1};
    set(0,0,-.70,-.10);set(2,.035,-.72,-.08);set(5,-.035,-.72,-.08);set(7,.075,-.70);set(8,-.075,-.70);
    for(const [s,sh,el,wr,h,k,a] of [[1,11,13,15,23,25,27],[-1,12,14,16,24,26,28]]){
      set(sh,s*.20,-.48);set(el,s*.25,-.23);set(wr,s*.25,0);set(h,s*.09,0);set(k,s*.09,.31);set(a,s*.09,.63);
    }
    let clock=performance.now();
    const run=(world,frames=80)=>{for(let i=0;i<frames;i++){
      // Image projections deliberately collapse in a side view; 3D limb lengths must remain stable.
      globalThis.testPoseFrame={worldLandmarks:[world],landmarks:[world.map(p=>({...p,x:.5+p.x*.4,y:.5+p.y*.4}))]};
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
