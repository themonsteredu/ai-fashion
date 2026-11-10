import {SHARED_PUBLIC_KEY,SHARED_API_URL} from './shared-api.js';
const URL=SHARED_API_URL.replace(/ai-fashion-api$/,'fashion-rooms');
export async function roomRequest(action,data={},token='',fetchImpl=globalThis.fetch){
  let response;
  try{response=await fetchImpl(URL,{method:'POST',headers:{apikey:SHARED_PUBLIC_KEY,'Content-Type':'application/json',...(token?{'x-fashion-session':token}:{})},body:JSON.stringify({...data,action}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});}
  catch{throw new Error('인터넷 연결을 확인해 주세요. 저장하지 못한 녹화는 이 기기에 남아 있어요.');}
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||'요청을 처리하지 못했어요.'),{status:response.status});
  return result;
}
export function readSession(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
export function writeSession(key,value){try{value?sessionStorage.setItem(key,JSON.stringify(value)):sessionStorage.removeItem(key);}catch{/* active in memory */}}
export const GROUP_SESSION='fashion.group.session.v2',TEACHER_SESSION='fashion.teacher.session.v1';
export const draftKey=membership=>`draft:${membership.room.id}:${membership.group}`;
export async function uploadRecording(draft,token,onPrepared=()=>{},fetchImpl=globalThis.fetch){
  if(!draft.upload){
    draft.upload=await roomRequest('upload',{title:draft.title,mime:draft.blob.type,bytes:draft.blob.size,duration:draft.duration},token,fetchImpl);
    await onPrepared();
  }
  if(!draft.uploaded){
    const response=await fetchImpl(draft.upload.uploadUrl,{method:'PUT',headers:{'Content-Type':draft.blob.type.split(';')[0],'x-upsert':'false'},body:draft.blob,signal:AbortSignal.timeout(120000)});
    if(!response.ok){
      // A prior successful PUT may have lost its response. Complete checks the
      // actual object before treating this retry as saved.
      try{await roomRequest('complete',{id:draft.upload.id},token,fetchImpl);return;}
      catch{draft.upload=null;await onPrepared();throw new Error('업로드를 마치지 못했어요. 다시 저장을 눌러 주세요.');}
    }
    draft.uploaded=true;await onPrepared();
  }
  await roomRequest('complete',{id:draft.upload.id},token,fetchImpl);
}
