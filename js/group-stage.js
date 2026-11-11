import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as Motion from './motion.js?v=pair8';
import {createPairedMotion} from './paired-motion.js';
import {createScenery} from './group-scenery.js?v=blue5';
import {createKidRig} from './kid-rig.js';
export async function createStage({mount,video,onStatus,onFrame,people=1}){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f5f3ed');
  const camera=new THREE.PerspectiveCamera(34,4/3,.05,30),target=new THREE.Vector3(0,.85,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  renderer.setSize(960,720,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label','내 움직임을 따라 하는 아바타');mount.replaceChildren(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfffaf3,0xd6c0a3,1.65));
  const key=new THREE.DirectionalLight(0xfff1df,2.2);key.position.set(-3,5,4);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-2,right:2,top:3,bottom:-2,near:.5,far:12});key.shadow.bias=-.00015;key.shadow.normalBias=.008;scene.add(key);
  const fill=new THREE.DirectionalLight(0xe8efff,.8);fill.position.set(3,2,1);scene.add(fill);
  const disposeScenery=createScenery(scene);
  let rig=null,secondRig=null,paired=null,source='idle',trackersReady=false,previous=0,frame,disposed=false;
  let viewAngle=0;
  function view(angle=viewAngle){viewAngle=angle;const distance=Math.max(3.15,(people===2?1.95:1.05)/(Math.tan(THREE.MathUtils.degToRad(17))*camera.aspect));camera.position.set(Math.sin(angle)*distance,1,Math.cos(angle)*distance);camera.lookAt(target);}
  const resize=new ResizeObserver(()=>{const w=mount.clientWidth,h=mount.clientHeight;if(!w||!h)return;const scale=Math.min(1.5,1280/Math.max(w,h));renderer.setSize(Math.round(w*scale),Math.round(h*scale),false);camera.aspect=w/h;camera.updateProjectionMatrix();view();});resize.observe(mount);
  function state(){return {avatarReady:!!rig,source,status:paired?paired.state().status:Motion.getStatus(),detectedCount:paired?paired.state().detectedCount:(Motion.isTracking()?1:0),people,cameraActive:!!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')};}
  async function avatar(name){
    const gltf=await new GLTFLoader().loadAsync(`./assets/kids/${name==='girl'?'girl':'boy'}.glb?v=3`);
    gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=!/eye|iris|pupil|sparkle|brow|smile|lip|patch|stitch/.test(o.name);o.receiveShadow=true;}});
    const next=createKidRig(gltf.scene);if(rig){scene.remove(rig.scene);rig.dispose();}rig=next;scene.add(rig.scene);Motion.setAvatar(rig,rig.measures);
  }
  function tick(now){
    if(disposed)return;frame=requestAnimationFrame(tick);const dt=Math.min((now-previous)/1000||1/60,.1);previous=now;
    if(rig){
      if(source==='demo')rig.demo(now/1000,'arms');
      if(source==='camera')try{if(paired)paired.update(now,dt);else{Motion.detect(now);Motion.applyToVRM(rig,dt);rig.update();}}catch{paired?.stop();Motion.stopCamera();source='idle';onStatus('카메라를 다시 켜 주세요.');}
    }
    renderer.render(scene,camera);onFrame(state(),renderer.domElement);
  }
  view();frame=requestAnimationFrame(tick);
  try{await avatar(people===2?'girl':'boy');if(people===2){const gltf=await new GLTFLoader().loadAsync('./assets/kids/girl.glb?v=3');gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});secondRig=createKidRig(gltf.scene);scene.add(secondRig.scene);rig.scene.position.x=-.75;secondRig.scene.position.x=.75;paired=createPairedMotion([rig,secondRig],onStatus);}}catch(e){cancelAnimationFrame(frame);resize.disconnect();paired?.dispose();rig?.dispose();secondRig?.dispose();disposeScenery();renderer.dispose();mount.replaceChildren();throw e;}
  return {
    state,view,avatar,canvas:renderer.domElement,
    async camera(){if(paired){source='idle';await paired.start(video);source='camera';return null;}Motion.stopCamera();source='idle';rig.reset();if(!trackersReady){await Motion.initTrackers(onStatus,{face:false});trackersReady=true;}try{await Motion.startCamera(video);source='camera';return Motion.getCameraZoom();}catch(e){Motion.stopCamera();throw e;}},
    demo(){Motion.stopCamera();source=source==='demo'?'idle':'demo';rig.reset();},
    reset(){rig?.reset();secondRig?.reset();paired?.reset();Motion.resetForNextStudent();},
    zoom:value=>Motion.setCameraZoom(value),
    stop(){paired?.stop();Motion.stopCamera();source='idle';},
    dispose(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();Motion.stopCamera();paired?.dispose();rig?.dispose();secondRig?.dispose();renderer.dispose();disposeScenery();mount.replaceChildren();},
  };
}
