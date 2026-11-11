import {makeRecording,openGroupStore,fileExtension,chooseMime} from './group-recording.js';
import {canStartRecording,prepareRecording} from './group-recording-start.js';
import {roomRequest,readSession,writeSession,GROUP_SESSION,draftKey,uploadRecording} from './group-room-api.js';
const $=id=>document.getElementById(id);
const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
let membership=null,stage=null,db=null,busy=false,session=null,countdownToken=0,pending=null,pendingUrl=null,uploading=false,loadingClips=false,stageError=false,preparing=false;
let frameState={avatarReady:false,source:'idle'},recordMode='both',saveAfterStop=false;
const canvas=document.createElement('canvas');canvas.width=960;canvas.height=768;const ctx=canvas.getContext('2d');
const timer=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function notice(message){text('notice',message);}
function controls(){
  const locked=busy||!!session||uploading;
  for(const id of ['camera-start','avatar','view','demo','capture-mode','format-avatar','format-both','zoom'])$(id).disabled=locked||(!stage&&id!=='capture-mode');
  $('calibrate').disabled=locked||frameState.source!=='camera';
  $('record').disabled=uploading||(!session&&(busy||!!pending||!stage));
  text('record',session?'녹화 끝내기':'녹화');
  $('save').disabled=uploading||(!session&&!pending)||preparing;
  text('save',uploading?'저장 중…':'저장하기');
  $('timer').hidden=!session;
  $('pause').disabled=!session||session.state==='inactive';
  text('pause',session?.state==='paused'?'이어찍기':'일시정지');
  $('stop').disabled=!preparing&&!session;text('stop',preparing?'녹화 취소':'녹화 끝내기');
  if(!busy&&!session)text('stop','녹화 끝내기');
  $('review').disabled=locked;$('leave').disabled=locked||uploading;
  $('retry-upload').disabled=uploading;$('discard-pending').disabled=uploading;
  if(!locked)text('record-help',pending?'저장하기를 눌러 주세요.':stageError?'이 브라우저에서 3D 화면을 열지 못했어요. 최신 Chrome·Safari로 다시 열어 주세요.':!stage?'아바타를 준비하고 있어요.':'녹화를 누른 뒤 촬영 위치로 이동하세요. 일시정지 후 이어 찍을 수 있어요.');
}
async function persistDraft(){if(db&&membership)await db.put(draftKey(membership),pending);}
function showPending(){
  if(pendingUrl)URL.revokeObjectURL(pendingUrl);pendingUrl=null;
  $('pending-video').pause();$('pending-video').removeAttribute('src');$('pending').hidden=!pending;
  if(pending)$('pending-video').src=pendingUrl=URL.createObjectURL(pending.blob);
  controls();
}
function paintFrame(src){
  const wash=ctx.createLinearGradient(0,0,0,canvas.height);wash.addColorStop(0,'#2397df');wash.addColorStop(1,'#f8e8d6');ctx.fillStyle=wash;ctx.fillRect(0,0,canvas.width,canvas.height);
  const width=recordMode==='both'?canvas.width/2:canvas.width;
  // Fit both views without cropping the avatar or student's feet.
  const fit=(image,iw,ih,x,w,mirror=false)=>{if(!iw||!ih)return;const scale=Math.min(w/iw,720/ih),dw=iw*scale,dh=ih*scale;ctx.save();if(mirror){ctx.translate(x+w,0);ctx.scale(-1,1);x=0;}ctx.drawImage(image,x+(w-dw)/2,(720-dh)/2,dw,dh);ctx.restore();};
  fit(src,src.width,src.height,0,width);
  if(recordMode==='both'){const v=$('camera');fit(v,v.videoWidth,v.videoHeight,width,width,true);}
  ctx.fillStyle='#faf8f2';ctx.fillRect(0,720,canvas.width,48);
  ctx.fillStyle='#527362';ctx.fillRect(24,735,4,18);
  ctx.fillStyle='#234638';ctx.font='bold 22px sans-serif';ctx.fillText(`${membership.group}모둠 · ${membership.room.title}`,40,751,canvas.width-180);
  ctx.fillStyle='#768578';ctx.font='14px sans-serif';ctx.textAlign='right';ctx.fillText('MOAKIT',canvas.width-24,750);ctx.textAlign='left';
}
function frame(state,src){
  frameState=state;
  $('camera-hint').hidden=state.source==='camera';
  text('camera-hint','카메라 사용을 허용해 주세요.');
  if(session){
    if(session.state==='recording')paintFrame(src);
    text('timer',timer(session.elapsedSeconds));
    text('record-help',session.state==='paused'?'일시정지 중 · 녹화 이어하기를 누르면 같은 영상에 이어서 담아요.':'녹화 중 · 끝내기를 누르면 우리 모둠에 저장해요.');
    if(session.elapsedSeconds>=60)session.stop();
    if(state.source==='idle'||(recordMode==='both'&&!state.cameraActive))session.stop();
  }
  text('tracking',state.source==='demo'?'시범 동작을 확인하고 있어요.':state.source==='idle'?'카메라를 켜고 움직여 보세요.':state.status==='calibrating'?'정면을 보고 잠시 서 주세요. 자세를 맞추고 있어요.':state.status==='noperson'?'카메라를 향해 서 주세요. 머리부터 발끝까지 보이면 좋아요.':'내 움직임을 따라 하고 있어요.');
  controls();
}
async function enter(next){
  busy=true;membership=next;writeSession(GROUP_SESSION,next);pending=null;stageError=false;
  document.body.classList.add('studio-mode');$('entry').hidden=true;$('studio').hidden=false;text('room-label',`${next.room.title} · ${next.group}모둠`);text('room-code-label',`수업코드 ${next.room.code}`);text('recordings-title',`${next.group}모둠 · 내 녹화 확인하기`);
  try{db??=await openGroupStore();pending=await db.get(draftKey(next))||null;showPending();}catch{notice('기기 자동 보관을 사용할 수 없어요. 녹화 후 저장 상태를 확인해 주세요.');}
  controls();
  try{const {createStage}=await import('./group-stage.js?v=blue5');stage=await createStage({mount:$('avatar-stage'),video:$('camera'),onStatus:notice,onFrame:frame});try{await stage.camera();notice('');}catch{notice('카메라 사용을 허용한 뒤 녹화를 눌러 주세요.');}}
  catch{stageError=true;$('avatar-stage').textContent='이 브라우저에서 3D 화면을 열 수 없어요.';notice('3D 화면을 열지 못했어요. 최신 Chrome·Safari에서 열어 주세요. 저장한 녹화는 확인할 수 있어요.');}
  busy=false;controls();
}
$('join-form').onsubmit=async e=>{
  e.preventDefault();$('join-submit').disabled=true;text('join-status','수업방에 입장하고 있어요.');
  try{const data=new FormData(e.currentTarget);const next=await roomRequest('join',{code:$('room-code').value.trim(),group:Number(data.get('group'))});text('join-status','');await enter(next);}
  catch(error){text('join-status',error.message);}finally{$('join-submit').disabled=false;}
};
$('room-code').oninput=()=>{$('room-code').value=$('room-code').value.replace(/\D/g,'').slice(0,6);};
$('leave').onclick=()=>{if(busy||session||uploading)return;stage?.dispose();stage=null;membership=null;pending=null;frameState={avatarReady:false,source:'idle'};writeSession(GROUP_SESSION,null);$('clips').replaceChildren();showPending();document.body.classList.remove('studio-mode');$('studio').hidden=true;$('entry').hidden=false;notice('');text('timer','0:00');};
async function stageAction(action){if(busy||session||!stage)return;busy=true;controls();try{await action();}catch(e){notice(e.name==='NotAllowedError'?'카메라 사용을 허용해 주세요.':e.message||'카메라를 다시 켜 주세요.');}finally{busy=false;controls();}}
$('camera-start').onclick=()=>stageAction(async()=>{const zoom=await stage.camera();$('zoom-label').hidden=!zoom;if(zoom)Object.assign($('zoom'),{min:zoom.min,max:zoom.max,step:zoom.step||.1,value:zoom.value});notice('카메라가 켜졌어요. 녹화를 누르고 촬영 위치로 이동하세요.');});
$('demo').onclick=()=>stageAction(()=>{stage.demo();$('capture-mode').value='avatar';$('zoom-label').hidden=true;});
$('avatar').onchange=()=>stageAction(()=>stage.avatar($('avatar').value));
for(const mode of ['avatar','both'])$('format-'+mode).onclick=()=>{$('capture-mode').value=mode;for(const option of ['avatar','both'])$('format-'+option).setAttribute('aria-pressed',String(option===mode));};
$('view').onchange=()=>stage?.view(Number($('view').value));
$('calibrate').onclick=()=>stage?.reset();
$('zoom').onchange=()=>stageAction(()=>stage.zoom(Number($('zoom').value)));
async function savePending(){
  if(!pending||!membership||uploading)return;
  const draft=pending;uploading=true;controls();text('clips-status','우리 모둠에 저장하고 있어요.');notice('우리 모둠에 저장하고 있어요.');
  try{
    await uploadRecording(draft,membership.token,async()=>{try{await persistDraft();}catch{/* upload can succeed without local storage */}});
    pending=null;try{await persistDraft();}catch{/* remote copy is already durable */}
    showPending();notice('저장했어요.');await loadClips();
  }catch(e){try{await persistDraft();}catch{/* keep in memory */}text('clips-status',e.message);notice('저장하지 못했어요. 저장하기를 다시 눌러 주세요.');showPending();}
  finally{uploading=false;controls();}
}
$('record').onclick=async()=>{
  if(session){session.stop();return;}
  if(busy||uploading||pending||!stage)return;
  if(!frameState.cameraActive){await stageAction(()=>stage.camera());if(!stage.state().cameraActive)return;}
  saveAfterStop=false;
  busy=true;preparing=true;const token=++countdownToken;controls();
  try{
    chooseMime();recordMode=$('capture-mode').value;
    if(recordMode==='both'&&!frameState.cameraActive)throw new Error('내 모습도 담으려면 카메라를 켜 주세요.');
    const prepared=await prepareRecording({getState:()=>stage.state(),isCanceled:()=>token!==countdownToken,onCountdown:n=>{$('countdown').hidden=false;text('countdown',n===null?'준비 중':String(n));text('record-help','촬영 위치로 이동해 주세요.');},onWaiting:()=>text('record-help','카메라를 향해 서 주세요. 몸이 인식되면 시작해요.')});
    if(!prepared||token!==countdownToken)return;
    $('countdown').hidden=true;canvas.width=recordMode==='both'?1920:960;paintFrame(stage.canvas);
    const capture=makeRecording(canvas);session=capture;preparing=false;controls();notice('녹화를 시작했어요.');
    const blob=await capture.done,duration=capture.elapsedSeconds;
    if(duration<.5)throw new Error('녹화가 너무 짧아요. 다시 찍어 주세요.');
    pending={blob,duration:Math.min(duration,61),title:`${membership.group}모둠 동작 · ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`,createdAt:Date.now()};
    try{await persistDraft();}catch{notice('기기 자동 보관에 실패했어요. 페이지를 닫기 전에 저장해 주세요.');}
    showPending();session=null;busy=false;controls();notice('');if(saveAfterStop)await savePending();
  }catch(e){notice(e.message);}
  finally{session=null;busy=false;preparing=false;$('countdown').hidden=true;text('countdown','');controls();}
};
$('save').onclick=()=>{if(session){saveAfterStop=true;session.stop();}else void savePending();};
$('pause').onclick=()=>{if(session?.state==='paused')session.resume();else session?.pause();controls();};
$('stop').onclick=()=>{if(session)session.stop();else{countdownToken++;notice('녹화를 취소했어요.');}};
async function loadClips(){
  if(!membership||loadingClips)return;loadingClips=true;$('refresh-clips').disabled=true;
  const current=membership;const list=$('clips');text('clips-status','녹화를 불러오고 있어요.');
  try{
    const result=await roomRequest('clips',{},current.token);if(membership!==current)return;
    list.replaceChildren();for(const clip of result.clips){
      const article=document.createElement('article');article.className='clip';const h=document.createElement('h3');h.textContent=clip.title;
      const v=document.createElement('video');v.controls=true;v.playsInline=true;v.preload='metadata';v.src=clip.url;
      const p=document.createElement('p');p.textContent=`${Number(clip.duration).toFixed(1)}초 · ${new Date(clip.created_at).toLocaleString('ko-KR')}`;
      const save=document.createElement('button');save.textContent='영상 저장';save.onclick=async()=>{save.disabled=true;try{const r=await fetch(clip.url);if(!r.ok)throw Error();await download(await r.blob(),clip.title);}catch{text('clips-status','새로고침 후 다시 저장해 주세요.');}finally{save.disabled=false;}};
      article.append(h,v,p,save);list.append(article);
    }text('clips-status',result.clips.length?`${current.group}모둠의 녹화 ${result.clips.length}개`:'아직 저장한 녹화가 없어요.');
  }catch(e){text('clips-status',e.message);}finally{loadingClips=false;$('refresh-clips').disabled=false;}
}
async function download(blob,name){const file=new File([blob],`${name.replace(/[^\p{L}\p{N}_-]/gu,'_')}.${fileExtension(blob.type)}`,{type:blob.type});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]});return;}catch(e){if(e.name==='AbortError')return;}}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('review').onclick=()=>{showPending();$('recordings').showModal();void loadClips();};
$('recordings-close').onclick=()=>$('recordings').close();
$('recordings').onclose=()=>{for(const v of $('recordings').querySelectorAll('video'))v.pause();};
$('refresh-clips').onclick=loadClips;$('retry-upload').onclick=savePending;
$('download-pending').onclick=()=>pending&&download(pending.blob,pending.title);
$('discard-pending').onclick=async()=>{if(uploading||!pending||!confirm('서버에 저장되지 않은 이 녹화를 지울까요?'))return;pending=null;try{await persistDraft();}catch{}showPending();text('clips-status','녹화를 지웠어요.');};
window.addEventListener('beforeunload',e=>{if(busy||session||uploading||pending){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{stage?.stop();session?.stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){countdownToken++;if(session?.state==='recording')session.pause();}});
const saved=readSession(GROUP_SESSION);
if(saved?.token){try{await roomRequest('clips',{},saved.token);await enter(saved);}catch{writeSession(GROUP_SESSION,null);text('join-status','수업코드와 모둠을 선택해 다시 입장해 주세요.');}}
