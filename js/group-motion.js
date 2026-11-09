import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as Motion from './motion.js';
import { createKidRig } from './kid-rig.js';
import { makeRecording, openGroupStore, combineClips, canCombine, clipSignature, fileExtension } from './group-recording.js';

const $=id=>document.getElementById(id), clips=Array(4).fill(null), clipUrls=Array(4).fill(null);
let selected=0, rig=null, db=null, busy=false, source='idle', trackersReady=false;
let session=null, recordStart=0, countdownToken=0, mergeController=null, combined=null, combinedUrl=null;
let frame=0, previousTime=0, lastStatus='', recordingMeta=null;
const scene=new THREE.Scene();scene.background=new THREE.Color('#f5f3ed');
const camera=new THREE.PerspectiveCamera(34,4/3,.05,30);
const target=new THREE.Vector3(0,.91,0);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setSize(960,720,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label','움직임을 따라 하는 전신 3D 아바타');
$('avatar-stage').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0xaab8b1,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.3);key.position.set(3,5,4);scene.add(key);
const floor=new THREE.Mesh(new THREE.CircleGeometry(1.3,64),new THREE.MeshBasicMaterial({color:0xe6e5dc}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
const recordCanvas=document.createElement('canvas');recordCanvas.width=960;recordCanvas.height=768;
const recordCtx=recordCanvas.getContext('2d');
function notice(text){$('notice').textContent=text;}
function view(){const a=Number($('view').value);camera.position.set(Math.sin(a)*3.7,1.05,Math.cos(a)*3.7);camera.lookAt(target);}
function safeName(s){return (s||'우리모둠').replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,40);}
function revision(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;}
async function persist(key,value){if(!db)return false;try{await db.put(key,value);return true;}catch(e){notice('기기 저장 공간이 부족해요. 페이지를 닫기 전에 영상을 내려받아 주세요.');return false;}}
function settings(){return {name:$('group-name').value,theme:$('theme').value,avatar:$('avatar').value,duration:$('duration').value};}
function fullBodyVisible(){const p=Motion.getPoseOverlay();return !!p && [0,11,12,23,24,27,28].every(i=>p[i] && p[i].visibility>.5 && p[i].x>.015 && p[i].x<.985 && p[i].y>.015 && p[i].y<.985);}
function ready(){return !!rig && (source==='demo' || (source==='camera' && Motion.getStatus()==='ok' && fullBodyVisible()));}
function controls(){
  for(const el of document.querySelectorAll('.setup input,.setup select,#camera-start,#demo,#avatar,#view,#demo-mode,#zoom'))el.disabled=busy;
  $('calibrate').disabled=busy || source!=='camera';$('record').disabled=busy || !ready();
  $('combine').disabled=busy || !canCombine(clips);$('stop').hidden=!session && !$('countdown').textContent;
  $('cancel-combine').hidden=!mergeController;
  for(const b of document.querySelectorAll('#clips button'))b.disabled=busy;
  $('student-title').textContent=`${selected+1}번 학생 차례`;
  $('record').textContent=source==='demo'?'시범 동작 녹화':clips[selected]?'이 학생 다시 녹화':'내 동작 녹화';
}
function renderSlots(){
  $('clips').replaceChildren();
  clips.forEach((clip,i)=>{
    if(clipUrls[i])URL.revokeObjectURL(clipUrls[i]);clipUrls[i]=null;
    const article=document.createElement('article');article.className='clip'+(selected===i?' selected':'');
    const choose=document.createElement('button');choose.className='slot-select';choose.textContent=`${i+1}번 학생${clip?' · 완료':''}`;choose.setAttribute('aria-pressed',String(selected===i));
    choose.onclick=()=>{if(busy)return;selected=i;rig?.reset();if(source==='camera')Motion.resetForNextStudent();renderSlots();};article.append(choose);
    if(clip){
      const v=document.createElement('video');v.controls=true;v.playsInline=true;v.preload='metadata';v.src=clipUrls[i]=URL.createObjectURL(clip.blob);article.append(v);
      const p=document.createElement('p');p.textContent=`${clip.theme} · ${clip.duration.toFixed(1)}초${clip.source==='demo'?' · 시범 동작':''}`;article.append(p);
      const save=document.createElement('button');save.textContent='영상 저장';save.onclick=()=>saveVideo(clip.blob,`${safeName(clip.group)}_${i+1}번`);article.append(save);
    }else{const p=document.createElement('p');p.className='empty';p.textContent='녹화하면 여기에 보여요';article.append(p);}
    $('clips').append(article);
  });controls();
}
async function saveVideo(blob,name){
  const file=new File([blob],`${name}.${fileExtension(blob.type)}`,{type:blob.type});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:name});return;}catch(e){if(e.name==='AbortError')return;}}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function showCombined(){
  if(combinedUrl)URL.revokeObjectURL(combinedUrl);combinedUrl=null;$('result').hidden=!combined;
  $('combined-video').removeAttribute('src');
  if(combined)$('combined-video').src=combinedUrl=URL.createObjectURL(combined.blob);
}
async function loadAvatar(){
  busy=true;controls();notice('3D 아바타를 불러오고 있어요.');
  try{
    const gltf=await new GLTFLoader().loadAsync(`./assets/kids/${$('avatar').value}.glb`);
    const next=createKidRig(gltf.scene);if(rig){scene.remove(rig.scene);rig.dispose();}rig=next;scene.add(rig.scene);
    Motion.setAvatar(rig,rig.measures);notice('아바타 준비 완료. 카메라를 켜거나 시범 동작을 볼 수 있어요.');
  }catch(e){notice(`아바타를 불러오지 못했어요. 새로고침해 주세요. ${e.message}`);}
  finally{busy=false;controls();}
}
function render(now){
  frame=requestAnimationFrame(render);const dt=Math.min((now-previousTime)/1000||1/60,.1);previousTime=now;
  if(rig){
    if(source==='demo')rig.demo(now/1000,$('demo-mode').value);
    else if(source==='camera'){
      try{Motion.detect(now);Motion.applyToVRM(rig,dt);rig.update();}
      catch(e){Motion.stopCamera();source='idle';notice(`동작 인식이 중단됐어요. 카메라를 다시 켜 주세요. ${e.message}`);session?.stop();}
    }
  }
  renderer.render(scene,camera);
  if(session){
    recordCtx.fillStyle='#f5f3ed';recordCtx.fillRect(0,0,960,768);recordCtx.drawImage(renderer.domElement,0,0,960,720);
    recordCtx.fillStyle='#163e33';recordCtx.font='bold 24px sans-serif';
    recordCtx.fillText(`${recordingMeta.group} · ${recordingMeta.index+1}번 · ${recordingMeta.theme}${recordingMeta.source==='demo'?' · 시범 동작':''}`,24,751,912);
    const seconds=(now-recordStart)/1000;
    $('record-help').textContent=`녹화 중 · ${seconds.toFixed(1)} / ${recordingMeta.limit}초`;
    if(seconds>=recordingMeta.limit)session.stop();
  }
  const status=source==='demo'?'시범 동작 재생 중 · 카메라 추적 영상이 아니에요.':source==='idle'?'카메라를 켜고 머리부터 발끝까지 화면 안에 서 주세요.':Motion.getStatus()==='calibrating'?`정면을 보고 편하게 서 주세요 · 체형 맞추는 중 ${Math.round(Motion.getCalibProgress()*100)}%`:Motion.getStatus()==='noperson'?'몸을 찾고 있어요. 밝은 곳에서 카메라를 향해 서 주세요.':!fullBodyVisible()?'머리와 양쪽 발끝이 모두 보이도록 조금 뒤로 이동해 주세요.':'준비 완료 · 내 동작을 따라 해요. 가려진 손과 관절은 인식이 어려울 수 있어요.';
  if(status!==lastStatus){$('tracking').textContent=status;lastStatus=status;}controls();
}
$('camera-start').onclick=async()=>{
  if(busy)return;busy=true;controls();
  try{
    Motion.stopCamera();source='idle';rig?.reset();
    if(!trackersReady){await Motion.initTrackers(notice,{face:false});trackersReady=true;}
    await Motion.startCamera($('camera'));source='camera';$('camera-hint').hidden=true;$('camera-start').textContent='카메라 다시 켜기';
    const z=Motion.getCameraZoom();$('zoom-label').hidden=!z;
    if(z){Object.assign($('zoom'),{min:z.min,max:z.max,step:z.step||.1,value:z.value});}
    notice('전신이 보이는 거리에서 정면을 보고 서 주세요.');
  }catch(e){Motion.stopCamera();source='idle';$('camera-hint').hidden=false;notice(e.name==='NotAllowedError'?'카메라 사용을 허용해 주세요. 브라우저 주소 옆 카메라 설정에서 바꿀 수 있어요.':`카메라를 켜지 못했어요. ${e.message}`);}
  finally{busy=false;controls();}
};
$('demo').onclick=()=>{if(busy)return;Motion.stopCamera();source=source==='demo'?'idle':'demo';rig?.reset();$('camera-hint').hidden=false;$('camera-hint').textContent=source==='demo'?'시범 동작 · 실제 카메라는 꺼져 있어요.':'머리부터 발끝까지 보이도록 서 주세요.';$('zoom-label').hidden=true;controls();};
$('calibrate').onclick=()=>{rig?.reset();Motion.resetForNextStudent();};
$('zoom').onchange=async()=>{try{await Motion.setCameraZoom(Number($('zoom').value));}catch{notice('이 카메라에서는 줌을 바꿀 수 없어요.');}};
$('view').onchange=view;
$('avatar').onchange=async()=>{await loadAvatar();await persist('settings',settings());};
for(const id of ['group-name','theme','duration'])$(id).onchange=()=>persist('settings',settings());
$('record').onclick=async()=>{
  if(busy || !ready())return;busy=true;const token=++countdownToken;controls();
  try{
    for(let n=3;n>0;n--){if(token!==countdownToken)return;$('countdown').textContent=String(n);$('countdown').hidden=false;controls();await new Promise(ok=>setTimeout(ok,1000));}
    if(token!==countdownToken)return;
    $('countdown').textContent='';$('countdown').hidden=true;
    if(!ready())throw new Error('전신 인식이 끊겼어요. 머리와 발끝을 화면에 맞추고 다시 시작해 주세요.');
    recordingMeta={index:selected,group:$('group-name').value||'우리 모둠',theme:$('theme').value,source,limit:Number($('duration').value)};
    recordCtx.drawImage(renderer.domElement,0,0,960,720);
    session=makeRecording(recordCanvas);recordStart=performance.now();controls();
    const blob=await session.done,duration=(performance.now()-recordStart)/1000;
    if(duration<.5)throw new Error('너무 짧은 영상이에요. 다시 녹화해 주세요.');
    const clip={...recordingMeta,blob,duration,revision:revision()},i=recordingMeta.index;
    clips[i]=clip;combined=null;showCombined();const saved=await persist(`clip-${i}`,clip);
    await persist('combined',null);if(selected<3)selected++;
    if(source==='camera'){rig.reset();Motion.resetForNextStudent();}
    notice(`${i+1}번 영상 완료.${saved?' 이 기기에 보관했어요.':' 페이지를 닫기 전에 영상 저장을 눌러 주세요.'}`);renderSlots();
  }catch(e){notice(e.message);}
  finally{session=null;$('countdown').textContent='';$('countdown').hidden=true;busy=false;$('record-help').textContent='3초 뒤 시작해요. 카메라 얼굴 영상과 소리는 저장하지 않아요.';controls();}
};
$('stop').onclick=()=>{countdownToken++;$('countdown').textContent='';$('countdown').hidden=true;session?.stop();};
$('combine').onclick=async()=>{
  if(busy || !canCombine(clips))return;busy=true;mergeController=new AbortController();controls();
  const signature=clipSignature(clips),canvas=document.createElement('canvas');canvas.width=960;canvas.height=768;
  try{
    const blob=await combineClips(clips,canvas,{signal:mergeController.signal,onProgress:i=>notice(`${i}번 영상 이어 붙이는 중… 화면을 켜 둬 주세요.`)});
    combined={blob,signature,group:$('group-name').value||'우리 모둠'};const saved=await persist('combined',combined);showCombined();
    notice(`네 학생의 영상이 순서대로 완성됐어요.${saved?'':' 페이지를 닫기 전에 전체 영상 저장을 눌러 주세요.'}`);
  }catch(e){notice(e.name==='AbortError'?'이어 붙이기를 중단했어요. 학생별 영상은 그대로 있어요.':`이어 붙이기를 완료하지 못했어요. ${e.message}`);}
  finally{busy=false;mergeController=null;controls();}
};
$('cancel-combine').onclick=()=>mergeController?.abort();
$('save-combined').onclick=()=>combined && saveVideo(combined.blob,`${safeName(combined.group)}_전체`);
document.addEventListener('visibilitychange',()=>{if(document.hidden){countdownToken++;session?.stop();mergeController?.abort();}});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
document.querySelector('header a').addEventListener('click',e=>{if(busy){e.preventDefault();notice('녹화나 이어 붙이기를 마친 뒤 이동해 주세요.');}});
window.addEventListener('pagehide',()=>{Motion.stopCamera();session?.stop();mergeController?.abort();});
async function boot(){
  busy=true;view();renderSlots();frame=requestAnimationFrame(render);
  try{
    db=await openGroupStore();const s=await db.get('settings');
    if(s){$('group-name').value=s.name||'우리 모둠';for(const id of ['theme','avatar','duration'])if([...$(id).options].some(o=>o.value===s[id]))$(id).value=s[id];}
    const stored=await Promise.all(clips.map((_,i)=>db.get(`clip-${i}`)));
    stored.forEach((c,i)=>{if(c?.blob?.size)clips[i]=c;});
    const merged=await db.get('combined');if(merged?.blob?.size && merged.signature===clipSignature(clips))combined=merged;
    const next=clips.findIndex(c=>!c);selected=next<0?0:next;showCombined();renderSlots();
  }catch{notice('자동 보관을 사용할 수 없어요. 녹화 후 영상 저장을 눌러 주세요.');}
  await loadAvatar();
}
boot();
