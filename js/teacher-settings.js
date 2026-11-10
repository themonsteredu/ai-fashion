import {roomRequest,readSession,writeSession,TEACHER_SESSION} from './group-room-api.js';
import * as RealifyUI from './realify-ui.js';
const $=id=>document.getElementById(id);let teacher=readSession(TEACHER_SESSION),requestId=0;
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
      actions.append(copy,state);const groups=document.createElement('div');groups.className='groups';groups.setAttribute('aria-label',`${room.title} 모둠 녹화`);
      for(let n=1;n<=6;n++){const b=document.createElement('button');b.textContent=`${n}모둠`;b.onclick=()=>showClips(room,n);groups.append(b);}
      row.append(title,code,info,actions,groups);$('teacher-rooms').append(row);
    }status(result.rooms.length?'수업코드를 안내하고 모둠별 녹화를 확인하세요.':'수업방을 먼저 만들어 주세요.');
  }catch(e){status(e.message);if(e.status===401)lock();}finally{$('rooms-refresh').disabled=false;}
}
async function showClips(room,group){
  const id=++requestId;$('teacher-clips-title').textContent=`${room.title} · ${group}모둠`;$('teacher-clips-list').replaceChildren();$('teacher-clips-status').textContent='녹화를 불러오고 있어요.';$('teacher-clips').showModal();
  try{const {clips}=await roomRequest('clips',{roomId:room.id,group},teacher.token);if(id!==requestId)return;
    for(const clip of clips){const article=document.createElement('article');article.className='clip';const title=document.createElement('h3');title.textContent=clip.title;const video=document.createElement('video');video.src=clip.url;video.controls=true;video.playsInline=true;video.preload='metadata';const info=document.createElement('p');info.textContent=`${Number(clip.duration).toFixed(1)}초 · ${new Date(clip.created_at).toLocaleString('ko-KR')}`;article.append(title,video,info);$('teacher-clips-list').append(article);}
    $('teacher-clips-status').textContent=clips.length?`${clips.length}개의 녹화`:'아직 저장한 녹화가 없어요.';
  }catch(e){if(id===requestId)$('teacher-clips-status').textContent=e.message;}
}
$('teacher-clips-close').onclick=()=>$('teacher-clips').close();
$('teacher-clips').onclose=()=>{requestId++;for(const v of $('teacher-clips').querySelectorAll('video'))v.pause();};
$('rooms-refresh').onclick=rooms;screen();if(teacher)void rooms();
