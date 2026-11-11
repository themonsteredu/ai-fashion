import {FilesetResolver,PoseLandmarker,HandLandmarker} from '../lib/mediapipe/vision_bundle.mjs';
import {createMotionSession} from './motion.js?v=pair8';
import {PairAssociator,distributeHands} from './paired-tracking.js';
export function createPairedMotion(rigs,onStatus){
  const drivers=rigs.map(rig=>{const driver=createMotionSession();driver.setAvatar(rig,rig.measures);return driver;});
  const identities=new PairAssociator(),generations=[0,0];
  let pose=null,hands=null,stream=null,video=null,lastVideo=-1,lastTime=-Infinity,lastTs=0,disposed=false,latest=[null,null];
  async function init(){
    if(pose)return;onStatus('두 명의 움직임을 준비하고 있어요.');
    const files=await FilesetResolver.forVisionTasks('./lib/mediapipe/wasm');
    for(const delegate of ['GPU','CPU']){
      let candidate=null;
      try{
        candidate=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'./models/pose_landmarker_lite.task',delegate},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.6});
        const handModel=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'./models/hand_landmarker.task',delegate},runningMode:'VIDEO',numHands:4,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
        if(disposed){handModel.close();throw Error('화면을 닫았어요.');}
        pose=candidate;hands=handModel;return;
      }catch(e){candidate?.close();if(delegate==='CPU'||disposed)throw e;}
    }
  }
  function reset(){identities.reset();generations.fill(0);latest=[null,null];lastVideo=-1;lastTime=-Infinity;drivers.forEach(d=>d.resetForNextStudent());}
  function stop(){stream?.getTracks().forEach(t=>t.stop());stream=null;if(video)video.srcObject=null;reset();drivers.forEach(d=>d.stopCamera());}
  function state(){const count=latest.filter(Boolean).length;return {detectedCount:count,status:!stream?'idle':count<2?'noperson':drivers.every(d=>d.getStatus()==='ok')?'ok':'calibrating'};}
  return {
    state,reset,stop,
    async start(element){stop();await init();video=element;let candidate=null;
      try{candidate=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});if(disposed)throw Error('화면을 닫았어요.');stream=candidate;video.srcObject=stream;await video.play();reset();}
      catch(e){candidate?.getTracks().forEach(t=>t.stop());stop();throw e;}
    },
    update(now,dt){
      if(stream&&video.readyState>=2&&video.currentTime!==lastVideo&&now-lastTime>=1000/24){
        lastVideo=video.currentTime;lastTime=now;lastTs=Math.max(lastTs+1,Math.round(now));
        latest=identities.update(pose.detectForVideo(video,lastTs),now);
        const handResult=latest.some(Boolean)?hands.detectForVideo(video,lastTs):null;
        const assigned=distributeHands(latest,handResult);
        latest.forEach((person,i)=>{
          if(person&&person.generation!==generations[i]){drivers[i].resetForNextStudent();generations[i]=person.generation;}
          drivers[i].feedPose(person?{...person,hands:assigned[i]}:null,now,{width:video.videoWidth,height:video.videoHeight});
        });
      }
      if(stream&&now-lastTime>600){latest=[null,null];drivers.forEach(driver=>driver.feedPose(null,now));}
      drivers.forEach((driver,i)=>{driver.applyToVRM(rigs[i],dt);rigs[i].update();});
    },
    dispose(){disposed=true;stop();pose?.close();hands?.close();pose=hands=null;},
  };
}
