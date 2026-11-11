import {roomRequest,readSession,writeSession,TEACHER_SESSION} from './group-room-api.js';
import * as RealifyUI from './realify-ui.js';
const $=id=>document.getElementById(id);let teacher=readSession(TEACHER_SESSION),requestId=0,selectedRoom=null,selectedGroup=0,galleryLoading=false,gallerySignature='',lastGalleryRefresh=0;
function status(message){$('teacher-status').textContent=message;}
function screen(){const open=!!teacher?.token;$('teacher-login').hidden=open;$('teacher-panel').hidden=!open;$('teacher-logout').hidden=!open;}
function lock(){teacher=null;writeSession(TEACHER_SESSION,null);$('teacher-rooms').replaceChildren();$('teacher-clips-list').replaceChildren();$('teacher-clips').close();screen();}
RealifyUI.init({requestSettingsAccess:()=>Promise.resolve(!!teacher?.token)});
$('teacher-pin').oninput=()=>{$('teacher-pin').value=$('teacher-pin').value.replace(/\D/g,'').slice(0,4);};
$('teacher-login-form').onsubmit=async e=>{e.preventDefault();$('login-submit').disabled=true;try{teacher=await roomRequest('login',{pin:$('teacher-pin').value});$('teacher-pin').value='';writeSession(TEACHER_SESSION,teacher);screen();await rooms();}catch(e){status(e.message);}finally{$('teacher-pin').value='';$('login-submit').disabled=false;}};
$('teacher-logout').onclick=()=>{lock();status('교사용 설정을 잠갔어요.');};
$('create-room-form').onsubmit=async e=>{e.preventDefault();$('create-room-submit').disabled=true;try{const {room}=await roomRequest('create',{title:$('room-title').value.trim()},teacher.token);$('room-title').value='';await rooms();status(`수업방을 만들었어요. 수업코드 ${room.code}를 학생들에게 알려 주세요.`);}catch(e){status(e.message);if(e.status===401)lock();}finally{$('create-room-submit').disabled=false;}};
async function rooms(){
  if(!teacher)return;$('rooms-refresh').disabled=true;
  try{
    const result=await roomRequest('rooms',{},teacher.token);$('teacher-rooms').replaceChildren();
    for(const room of result.rooms){
      const row=document.createElement('article');row.className='room-row';const title=document.createElement('h3');title.textContent=room.title;
      const code=document.createElement('p');code.className='code';code.textContent=room.code;
      const info=document.createElement('small');info.textContent=`${room.active?'입장 가능':'수업 종료'} · ${new Date(room.created_at).toLocaleDateString('ko-KR')}`;
      const actions=document.createElement('div');actions.className='actions';
      const copy=document.createElement('button');copy.textContent='수업코드 복사';copy.onclick=async()=>{try{await navigator.clipboard.writeText(room.code);status(`${room.code} 복사 완료`);}catch{status(`수업코드 ${room.code}`);}};
      const state=document.createElement('button');state.textContent=room.active?'수업방 종료':'수업방 다시 열기';state.onclick=async()=>{state.disabled=true;try{await roomRequest('room-state',{roomId:room.id,active:!room.active},teacher.token);await rooms();status(room.active?'수업방을 종료했어요. 저장된 녹화는 교사용 화면에서 확인할 수 있어요.':'수업방을 다시 열었어요.');}catch(e){status(e.message);}finally{state.disabled=false;}};
      const all=document.createElement('button');all.className='primary';all.textContent='학생 작품 전체 보기';all.onclick=()=>showClips(room,0);actions.append(all,copy,state);const groups=document.createElement('div');groups.className='groups';groups.setAttribute('aria-label',`${room.title} 모둠 녹화`);
      for(let n=1;n<=6;n++){const b=document.createElement('button');b.textContent=`${n}모둠 작품`;b.onclick=()=>showClips(room,n);groups.append(b);}
      row.append(title,code,info,actions,groups);$('teacher-rooms').append(row);
    }status(result.rooms.length?'수업코드를 안내하고 모둠별 녹화를 확인하세요.':'수업방을 먼저 만들어 주세요.');
  }catch(e){status(e.message);if(e.status===401)lock();}finally{$('rooms-refresh').disabled=false;}
}
async function showClips(room,group){
  selectedRoom=room;selectedGroup=group;gallerySignature='';lastGalleryRefresh=0;requestId++;galleryLoading=false;
  $('teacher-clips-title').textContent=`${room.title} · ${group?`${group}모둠 작품`:'전체 작품'}`;
  $('teacher-clips-list').replaceChildren();$('teacher-gallery-nav').replaceChildren();
  for(let n=0;n<=6;n++){const button=document.createElement('button');button.textContent=n?`${n}모둠`:'전체';button.setAttribute('aria-pressed',String(n===group));button.onclick=()=>showClips(room,n);$('teacher-gallery-nav').append(button);}
  if(!$('teacher-clips').open)$('teacher-clips').showModal();
  await refreshGallery();
}
async function refreshGallery(quiet=false){
  if(!teacher||!selectedRoom||galleryLoading)return;
  const id=requestId,token=teacher.token;galleryLoading=true;$('teacher-clips-refresh').disabled=true;
  if(!quiet)$('teacher-clips-status').textContent='작품을 불러오고 있어요.';
  try{
    const groups=selectedGroup?[selectedGroup]:[1,2,3,4,5,6];
    const results=await Promise.allSettled(groups.map(async group=>{const result=await roomRequest('clips',{roomId:selectedRoom.id,group},token);return result.clips.map(clip=>({...clip,group}));}));
    if(id!==requestId)return;
    const failed=results.filter(result=>result.status==='rejected');
    if(failed.length===results.length)throw failed[0].reason;
    const clips=results.flatMap(result=>result.status==='fulfilled'?result.value:[]).sort((a,b)=>a.group-b.group||new Date(b.created_at)-new Date(a.created_at));
    const signature=clips.map(clip=>clip.id).join(',');
    const playing=Array.from($('teacher-clips-list').querySelectorAll('video')).some(video=>!video.paused);
    // Do not interrupt playback when another student saves a new work.
    if(quiet&&playing)return;
    if(signature!==gallerySignature||!quiet||Date.now()-lastGalleryRefresh>300000){
      $('teacher-clips-list').replaceChildren();
      for(const clip of clips){
        const article=document.createElement('article');article.className='clip';
        const title=document.createElement('h3');title.textContent=`${clip.group}모둠 · ${clip.title}`;
        const video=document.createElement('video');video.src=clip.url;video.controls=true;video.playsInline=true;video.preload='metadata';
        const info=document.createElement('p');info.textContent=`${Number(clip.duration).toFixed(1)}초 · ${new Date(clip.created_at).toLocaleString('ko-KR')}`;
        article.append(title,video,info);$('teacher-clips-list').append(article);
      }
      gallerySignature=signature;lastGalleryRefresh=Date.now();
    }
    $('teacher-clips-status').textContent=(clips.length?`저장된 작품 ${clips.length}개 · 20초마다 자동 확인`:'아직 저장된 작품이 없어요. 학생이 저장하기를 누르면 여기에 표시돼요.')+(failed.length?' · 일부 모둠을 불러오지 못했어요. 새로고침해 주세요.':'');
  }catch(e){if(id===requestId){$('teacher-clips-status').textContent=e.message;if(e.status===401)lock();}}
  finally{if(id===requestId){galleryLoading=false;$('teacher-clips-refresh').disabled=false;}}
}
$('teacher-clips-refresh').onclick=()=>refreshGallery();
setInterval(()=>{if(!document.hidden&&$('teacher-clips').open)void refreshGallery(true);},20000);
$('teacher-clips-close').onclick=()=>$('teacher-clips').close();
$('teacher-clips').onclose=()=>{requestId++;selectedRoom=null;galleryLoading=false;for(const v of $('teacher-clips').querySelectorAll('video'))v.pause();};
$('rooms-refresh').onclick=rooms;screen();if(teacher)void rooms();
