import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomHandler} from '../supabase/functions/fashion-rooms/handler.js';
import {makeRecording} from '../js/group-recording.js';
import {draftKey,uploadRecording} from '../js/group-room-api.js';
const ROOM='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
function fixture(){
  let clock=Date.now(),limit=true;const room={id:ROOM,code:'123456',title:'수업',active:true},clips=[];
  const repo={rate:async()=>limit,checkPin:async p=>p==='3035',roomByCode:async code=>code===room.code?room:null,room:async id=>id===ROOM?room:null,rooms:async()=>[room],createRoom:async title=>({...room,title}),setRoomActive:async(id,active)=>Object.assign(room,{active}),clips:async s=>clips.filter(c=>c.room_id===s.roomId&&c.group_no===s.group&&c.ready),clip:async(s,id)=>clips.find(c=>c.id===id&&c.room_id===s.roomId&&c.group_no===s.group),newClip:async c=>clips.push(c),completeClip:async id=>{clips.find(c=>c.id===id).ready=true;}};
  const storage={sign:async path=>`https://example.test/${path}`,uploadUrl:async path=>`https://example.test/upload/${path}`,info:async path=>{const c=clips.find(c=>c.path===path);return c?{size:c.bytes,mimetype:c.mime}:null;}};
  const handler=createRoomHandler({repo,storage,secret:'test-only-secret',publicKey:'public-test',now:()=>clock});
  const call=async(action,body={},token='')=>{const r=await handler(new Request('https://example.test',{method:'POST',headers:{apikey:'public-test','x-fashion-session':token},body:JSON.stringify({...body,action})}));return {status:r.status,...await r.json()};};
  return {call,room,clips,expire:()=>clock+=9*3600000,block:()=>limit=false};
}
test('teacher PIN gates creation; students cannot create or close rooms',async()=>{
  const f=fixture();assert.equal((await f.call('login',{pin:'0000'})).status,401);
  const teacher=await f.call('login',{pin:'3035'});assert.equal(teacher.status,200);
  assert.equal((await f.call('create',{title:'새 수업'},teacher.token)).room.title,'새 수업');
  const student=await f.call('join',{code:'123456',group:1});
  assert.equal((await f.call('create',{title:'공격'},student.token)).status,403);
  assert.equal((await f.call('room-state',{roomId:ROOM,active:false},student.token)).status,403);
  assert.equal((await f.call('rooms')).status,401);
});
test('a group token scopes list, upload and completion despite client group/room changes',async()=>{
  const f=fixture(),one=await f.call('join',{code:'123456',group:1}),two=await f.call('join',{code:'123456',group:2});
  const upload=await f.call('upload',{roomId:OTHER,group:6,title:'1모둠',bytes:10,mime:'video/webm',duration:2},one.token);
  assert.equal(upload.status,200);assert.equal(f.clips[0].group_no,1);assert.equal(f.clips[0].room_id,ROOM);
  assert.equal((await f.call('complete',{id:upload.id},two.token)).status,403);
  assert.equal((await f.call('complete',{id:upload.id},one.token)).status,200);
  assert.equal((await f.call('clips',{roomId:ROOM,group:1},two.token)).clips.length,0);
  assert.equal((await f.call('clips',{roomId:OTHER,group:6},one.token)).clips.length,1);
  const teacher=await f.call('login',{pin:'3035'});
  assert.equal((await f.call('clips',{roomId:ROOM,group:1},teacher.token)).clips.length,1);
});
test('bad codes, out-of-range groups, modified tokens, expired sessions and closed rooms are rejected',async()=>{
  const f=fixture();assert.equal((await f.call('join',{code:'000000',group:1})).status,404);
  for(const group of [0,7,'1',null])assert.equal((await f.call('join',{code:'123456',group})).status,400);
  const session=await f.call('join',{code:'123456',group:1});
  const [payload,signature]=session.token.split('.');const claims=JSON.parse(Buffer.from(payload,'base64url'));claims.group=2;
  assert.equal((await f.call('clips',{},Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+signature)).status,401);
  f.room.active=false;assert.equal((await f.call('clips',{},session.token)).status,403);
  assert.equal((await f.call('join',{code:'123456',group:1})).status,404);
  f.room.active=true;f.expire();assert.equal((await f.call('clips',{},session.token)).status,401);
});
test('rate and upload bounds fail before allocating storage',async()=>{
  const f=fixture(),s=await f.call('join',{code:'123456',group:1});
  for(const update of [{bytes:52428801},{duration:90},{mime:'text/html'}])assert.equal((await f.call('upload',{title:'test',bytes:10,duration:2,mime:'video/mp4',...update},s.token)).status,400);
  assert.equal(f.clips.length,0);f.block();assert.equal((await f.call('login',{pin:'3035'})).status,429);
});
test('pause/resume excludes idle time and produces one recording with cleanup',async()=>{
  let now=0,stopped=0;class Recorder{static isTypeSupported(t){return t==='video/webm';}constructor(s,o){this.mimeType=o.mimeType;this.state='inactive';}start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['one movie'])});this.onstop();}}
  const recording=makeRecording({captureStream:()=>({getTracks:()=>[{stop(){stopped++;}}]})},Recorder,()=>now);
  now=2000;recording.pause();now=12000;assert.equal(recording.elapsedSeconds,2);assert.equal(recording.state,'paused');
  recording.resume();now=15000;assert.equal(recording.elapsedSeconds,5);recording.pause();now=30000;recording.stop();
  assert.equal(recording.elapsedSeconds,5);assert.equal((await recording.done).size,9);assert.equal(stopped,1);
});
test('local drafts use both room and group and recover from a lost successful PUT response',async()=>{
  assert.notEqual(draftKey({room:{id:ROOM},group:1}),draftKey({room:{id:ROOM},group:2}));
  assert.notEqual(draftKey({room:{id:ROOM},group:1}),draftKey({room:{id:OTHER},group:1}));
  const draft={title:'test',duration:2,blob:new Blob(['clip'],{type:'video/webm'})};let calls=[];
  await uploadRecording(draft,'session',()=>{},async(url,options)=>{
    if(options.method==='PUT'){calls.push('PUT');return new Response('{}',{status:409});}
    const {action}=JSON.parse(options.body);calls.push(action);
    return Response.json(action==='upload'?{id:ROOM,uploadUrl:'https://example.test/file'}:{saved:true});
  });
  assert.deepEqual(calls,['upload','PUT','complete']);
});
