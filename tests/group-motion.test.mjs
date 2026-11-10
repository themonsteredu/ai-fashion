import './gltf-node-images.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import * as THREE from '../lib/three.module.min.js';
import {createKidRig} from '../js/kid-rig.js';
import {bodyOrientation,groundedHipDrop} from '../js/spatial-pose.js';
import {chooseMime,fileExtension,canCombine,clipSignature,makeRecording} from '../js/group-recording.js';

registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../lib/three.module.min.js',import.meta.url).href:specifier,context);}});
const {GLTFLoader}=await import('../lib/three/addons/loaders/GLTFLoader.js');
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
for(const sex of ['boy','girl'])test(`${sex}: arm motion cannot pull the head, and fingers/legs remain finite`,async()=>{
  const data=await readFile(new URL(`../assets/kids/${sex}.glb`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
  const rig=createKidRig(gltf.scene),raw=n=>rig.humanoid.getRawBoneNode(n);
  const before=raw('head').getWorldPosition(V(0,0,0));
  const wristBefore=raw('leftHand').getWorldPosition(V(0,0,0));
  rig.demo(Math.PI/2,'arms');
  assert.ok(raw('head').getWorldPosition(V(0,0,0)).distanceTo(before)<1e-5,'arm must not deform head');
  assert.ok(raw('leftHand').getWorldPosition(V(0,0,0)).distanceTo(wristBefore)>.4,'hand must really move');
  for(const side of ['left','right'])for(const finger of ['Thumb','Index','Middle','Ring','Little'])
    for(const joint of finger==='Thumb'?['Metacarpal','Proximal','Distal']:['Proximal','Intermediate','Distal'])assert.ok(raw(side+finger+joint));
  rig.demo(Math.PI/2,'sit');
  assert.ok(raw('head').getWorldPosition(V(0,0,0)).y<before.y-.2);
  rig.scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(gltf.scene,true),size=bounds.getSize(V(0,0,0));
  assert.ok(size.y>1 && size.y<2.5 && size.x<2.5 && size.z<2.5,JSON.stringify(size));
  assert.ok([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite));
  rig.reset();assert.ok(raw('head').getWorldPosition(V(0,0,0)).distanceTo(before)<1e-5);rig.dispose();
});
test('side orientation preserves a full quarter turn and torso lean',()=>{
  const q=bodyOrientation(V(0,0,-1),V(0,1,0));
  assert.ok(V(1,0,0).applyQuaternion(q).distanceTo(V(0,0,-1))<1e-6);
  assert.ok(V(0,1,0).applyQuaternion(q).distanceTo(V(0,1,0))<1e-6);
  assert.equal(bodyOrientation(V(1,0,0),V(1,0,0)),null);
});

for(const sex of ['boy','girl'])test(`${sex}: skin stays on the face and fingers articulate independently`,async()=>{
  const bytes=await readFile(new URL(`../assets/kids/${sex}.glb`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const rig=createKidRig(gltf.scene),heads=[],index=[],little=[];
  const position=(m,i)=>m.localToWorld(m.getVertexPosition(i,new THREE.Vector3()));
  gltf.scene.traverse(m=>{if(!m.isSkinnedMesh)return;
    const a=m.geometry.attributes;
    for(let i=0;i<a.position.count;i++){
      const p=position(m,i);if(p.y>1.16 && i%4===0)heads.push({m,i,p});
      const weight={Index:0,Little:0};
      for(let j=0;j<4;j++){const name=m.skeleton.bones[a.skinIndex.getComponent(i,j)]?.name;
        for(const f of ['Index','Little'])if(name===`left${f}Distal`)weight[f]+=a.skinWeight.getComponent(i,j);
      }
      if(weight.Index>.7)index.push({m,i,p});if(weight.Little>.7)little.push({m,i,p});
    }
  });
  assert.ok(heads.length>100 && index.length>8 && little.length>8,'must include actual weighted face and finger geometry');
  rig.demo(Math.PI/2,'arms');
  assert.ok(Math.max(...heads.map(v=>position(v.m,v.i).distanceTo(v.p)))<.006,'raising arms must not pull the face mesh');
  rig.reset();rig.humanoid.getNormalizedBoneNode('leftIndexIntermediate').rotation.z=-.9;rig.update();
  const displacement=list=>list.reduce((s,v)=>s+position(v.m,v.i).distanceTo(v.p),0)/list.length;
  assert.ok(displacement(index)>.006,'index fingertip must bend');
  assert.ok(displacement(little)<.003,'index motion must not drag the little finger');
  rig.dispose();
});
test('sitting lowers the hips, while one raised knee leaves the supporting foot grounded',()=>{
  const stand={visible:true,upper:V(0,-1,0),lower:V(0,-1,0)},sit={visible:true,upper:V(0,0,1),lower:V(0,-1,0)};
  assert.ok(Math.abs(groundedHipDrop([stand,sit],.35,.3))<1e-6);
  assert.ok(Math.abs(groundedHipDrop([sit,sit],.35,.3)+.35)<1e-6);
  assert.equal(groundedHipDrop([{...sit,visible:false}],.35,.3),null);
});
test('four nonempty clips and their revision order define a valid combined result',()=>{
  const clips=Array.from({length:4},(_,i)=>({blob:new Blob(['video']),revision:String(i)}));
  assert.ok(canCombine(clips));assert.equal(canCombine(clips.slice(1)),false);
  assert.equal(canCombine([...clips.slice(1),{blob:new Blob()}]),false);
  const sig=clipSignature(clips);assert.notEqual(sig,clipSignature([...clips].reverse()));
  clips[0].revision='new';assert.notEqual(sig,clipSignature(clips));
});
test('recorder chooses an actual supported container and releases capture tracks',async()=>{
  let stopped=0;const canvas={captureStream:()=>({getTracks:()=>[{stop(){stopped++;}}]})};
  class Recorder{
    static isTypeSupported(t){return t==='video/webm;codecs=vp8';}
    constructor(stream,o){this.mimeType=o.mimeType;this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['frames'])});this.onstop();}
  }
  assert.equal(fileExtension(chooseMime(Recorder)),'webm');
  assert.equal(fileExtension('video/mp4;codecs=avc1.42E01E'),'mp4');
  const recording=makeRecording(canvas,Recorder);recording.stop();const blob=await recording.done;
  assert.ok(blob.size>0);assert.equal(blob.type,'video/webm;codecs=vp8');assert.equal(stopped,1);
  assert.throws(()=>chooseMime({isTypeSupported:()=>false}));
});
