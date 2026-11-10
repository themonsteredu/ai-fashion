const enc = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const decode = text => Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const uuid = value => typeof value==='string' && /^[a-f0-9-]{36}$/.test(value);
const group = value => Number.isInteger(value) && value>=1 && value<=6;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export function createRoomHandler({repo,storage,secret,publicKey,now=()=>Date.now()}) {
  const key=crypto.subtle.importKey('raw',enc.encode(`fashion-rooms-v1:${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  async function token(data){
    const body=encode(enc.encode(JSON.stringify({...data,exp:now()+8*3600000,sid:crypto.randomUUID()})));
    return body+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key,enc.encode(body))));
  }
  async function auth(value){
    try{
      const [body,sig,...rest]=(value||'').split('.');
      if(rest.length || !body || !sig || value.length>2000)fail('다시 입장해 주세요.',401);
      if(!await crypto.subtle.verify('HMAC',await key,decode(sig),enc.encode(body)))fail('다시 입장해 주세요.',401);
      const claims=JSON.parse(new TextDecoder().decode(decode(body)));
      if(!Number.isFinite(claims.exp)||claims.exp<=now())fail('입장 시간이 만료됐어요. 다시 입장해 주세요.',401);
      if(claims.role!=='teacher' && !(claims.role==='group'&&uuid(claims.roomId)&&group(claims.group)))fail('다시 입장해 주세요.',401);
      return claims;
    }catch(e){fail(e.status?e.message:'다시 입장해 주세요.',401);}
  }
  return async req=>{
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type,x-fashion-session','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    try{
      if(req.method!=='POST')fail('지원하지 않는 요청이에요.',405);
      if(!publicKey || req.headers.get('apikey')!==publicKey)fail('접근할 수 없어요.',401);
      const raw=await req.text();if(raw.length>8192)fail('요청이 너무 커요.',413);
      let body;try{body=JSON.parse(raw);}catch{fail('요청 형식을 확인해 주세요.');}
      if(!body || typeof body!=='object')fail('요청 형식을 확인해 주세요.');
      const {action}=body;
      const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
      const ipHash=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(ip))));
      let result;
      if(action==='login'||action==='join'){
        if(!await repo.rate(`${action}:${ipHash}`,action==='login'?10:120,300))fail('잠시 후 다시 시도해 주세요.',429);
        if(action==='login'){
          if(typeof body.pin!=='string'||!/^\d{4}$/.test(body.pin)||!await repo.checkPin(body.pin))fail('비밀번호가 맞지 않아요.',401);
          result={token:await token({role:'teacher'})};
        }else{
          if(!/^\d{6}$/.test(body.code||'')||!group(body.group))fail('수업코드 6자리와 모둠을 선택해 주세요.');
          const room=await repo.roomByCode(body.code);if(!room?.active)fail('수업코드를 확인해 주세요. 종료된 수업방에는 입장할 수 없어요.',404);
          result={token:await token({role:'group',roomId:room.id,group:body.group}),room,group:body.group};
        }
      }else{
        const claims=await auth(req.headers.get('x-fashion-session'));
        if(!await repo.rate(`session:${claims.sid}`,240,60))fail('잠시 후 다시 시도해 주세요.',429);
        const teacher=claims.role==='teacher';
        if(['rooms','create','room-state'].includes(action)){
          if(!teacher)fail('교사용 메뉴예요.',403);
          if(action==='rooms')result={rooms:await repo.rooms()};
          if(action==='create'){
            const title=String(body.title||'').trim();if(!title||title.length>60)fail('수업 이름을 60자 안으로 적어 주세요.');
            if(!await repo.rate('create-room',60,3600))fail('수업방은 잠시 후 다시 개설해 주세요.',429);
            result={room:await repo.createRoom(title)};
          }
          if(action==='room-state'){
            if(!uuid(body.roomId)||typeof body.active!=='boolean')fail('수업방을 확인해 주세요.');
            result={room:await repo.setRoomActive(body.roomId,body.active)};
          }
        }else{
          const scope=teacher?{roomId:body.roomId,group:body.group}:{roomId:claims.roomId,group:claims.group};
          if(!uuid(scope.roomId)||!group(scope.group))fail('수업방과 모둠을 확인해 주세요.');
          const room=await repo.room(scope.roomId);if(!room || (!teacher&&!room.active))fail('종료된 수업방이에요. 선생님께 확인해 주세요.',403);
          if(action==='clips'){
            const clips=await repo.clips(scope);
            result={room,group:scope.group,clips:await Promise.all(clips.map(async c=>({id:c.id,title:c.title,duration:c.duration,mime:c.mime,created_at:c.created_at,url:await storage.sign(c.path)})))};
          }else if(action==='upload'){
            const title=String(body.title||'내 동작').trim();const mime=String(body.mime||'').split(';')[0];
            if(!title||title.length>60||!['video/mp4','video/webm'].includes(mime)||!Number.isInteger(body.bytes)||body.bytes<1||body.bytes>52428800||!Number.isFinite(body.duration)||body.duration<=0||body.duration>61)fail('영상은 60초, 50MB 이내로 저장해 주세요.');
            if(!await repo.rate(`uploads:${scope.roomId}:${scope.group}`,30,3600))fail('영상을 많이 저장했어요. 잠시 후 다시 시도해 주세요.',429);
            const id=crypto.randomUUID(),path=`${scope.roomId}/${scope.group}/${id}.${mime==='video/mp4'?'mp4':'webm'}`;
            await repo.newClip({id,room_id:scope.roomId,group_no:scope.group,title,mime,bytes:body.bytes,duration:body.duration,path});
            result={id,uploadUrl:await storage.uploadUrl(path)};
          }else if(action==='complete'){
            if(!uuid(body.id))fail('영상을 확인해 주세요.');
            const clip=await repo.clip(scope,body.id);if(!clip)fail('이 모둠의 영상이 아니에요.',403);
            const info=await storage.info(clip.path);
            if(!info||Number(info.size)!==Number(clip.bytes)||String(info.mimetype).split(';')[0]!==clip.mime)fail('영상 업로드가 끝나지 않았어요. 다시 저장해 주세요.');
            await repo.completeClip(clip.id);result={saved:true};
          }else fail('지원하지 않는 요청이에요.',404);
        }
      }
      return new Response(JSON.stringify(result),{headers});
    }catch(e){return new Response(JSON.stringify({error:e.status?e.message:'저장 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'}),{status:e.status||500,headers});}
  };
}
