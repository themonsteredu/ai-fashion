import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as Motion from './motion.js';
import {createScenery} from './group-scenery.js';
import {createKidRig} from './kid-rig.js';
export async function createStage({mount,video,onStatus,onFrame}){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f5f3ed');
  const camera=new THREE.PerspectiveCamera(34,4/3,.05,30),target=new THREE.Vector3(0,.85,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  renderer.setSize(960,720,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label','내 움직임을 따라 하는 아바타');mount.replaceChildren(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfffaf2,0xcbd3db,2));
  const key=new THREE.DirectionalLight(0xfff3e6,2.4);key.position.set(-3,5,4);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-2,right:2,top:3,bottom:-2,near:.5,far:12});key.shadow.bias=-.00015;key.shadow.normalBias=.008;scene.add(key);
  const fill=new THREE.DirectionalLight(0xe8efff,.8);fill.position.set(3,2,1);scene.add(fill);
  const disposeScenery=createScenery(scene);
  let rig=null,source='idle',trackersReady=false,previous=0,frame,disposed=false;
  function view(angle=0){camera.position.set(Math.sin(angle)*3.25,1,Math.cos(angle)*3.25);camera.lookAt(target);}
  function state(){return {avatarReady:!!rig,source,status:Motion.getStatus(),cameraActive:!!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')};}
  async function avatar(name){
    const gltf=await new GLTFLoader().loadAsync(`./assets/kids/${name==='girl'?'girl':'boy'}.glb?v=3`);
    gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=!/eye|iris|pupil|sparkle|brow|smile|lip|patch|stitch/.test(o.name);o.receiveShadow=true;}});
    const next=createKidRig(gltf.scene);if(rig){scene.remove(rig.scene);rig.dispose();}rig=next;scene.add(rig.scene);Motion.setAvatar(rig,rig.measures);
  }
  function tick(now){
    if(disposed)return;frame=requestAnimationFrame(tick);const dt=Math.min((now-previous)/1000||1/60,.1);previous=now;
    if(rig){
      if(source==='demo')rig.demo(now/1000,'arms');
      if(source==='camera')try{Motion.detect(now);Motion.applyToVRM(rig,dt);rig.update();}catch{Motion.stopCamera();source='idle';onStatus('카메라를 다시 켜 주세요.');}
    }
    renderer.render(scene,camera);onFrame(state(),renderer.domElement);
  }
  view();frame=requestAnimationFrame(tick);
  try{await avatar('boy');}catch(e){cancelAnimationFrame(frame);disposeScenery();renderer.dispose();mount.replaceChildren();throw e;}
  return {
    state,view,avatar,canvas:renderer.domElement,
    async camera(){Motion.stopCamera();source='idle';rig.reset();if(!trackersReady){await Motion.initTrackers(onStatus,{face:false});trackersReady=true;}try{await Motion.startCamera(video);source='camera';return Motion.getCameraZoom();}catch(e){Motion.stopCamera();throw e;}},
    demo(){Motion.stopCamera();source=source==='demo'?'idle':'demo';rig.reset();},
    reset(){rig?.reset();Motion.resetForNextStudent();},
    zoom:value=>Motion.setCameraZoom(value),
    stop(){Motion.stopCamera();source='idle';},
    dispose(){disposed=true;cancelAnimationFrame(frame);Motion.stopCamera();rig?.dispose();renderer.dispose();disposeScenery();mount.replaceChildren();},
  };
}
