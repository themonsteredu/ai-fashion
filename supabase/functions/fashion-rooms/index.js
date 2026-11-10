import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createRoomHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL');
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||keys.default;
const publicKey=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default;
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
async function data(query){const {data,error}=await query;if(error)throw error;return data;}
const scoped=(query,s)=>query.eq('room_id',s.roomId).eq('group_no',s.group);
const repo={
  rate:(key,limit,seconds)=>data(db.rpc('fashion_take_limit',{p_key:key,p_limit:limit,p_seconds:seconds})),
  checkPin:pin=>data(db.rpc('fashion_check_teacher',{p_pin:pin})),
  roomByCode:code=>data(db.from('fashion_rooms').select('*').eq('code',code).maybeSingle()),
  room:id=>data(db.from('fashion_rooms').select('*').eq('id',id).maybeSingle()),
  rooms:()=>data(db.from('fashion_rooms').select('*').order('created_at',{ascending:false}).limit(50)),
  async createRoom(title){
    for(let i=0;i<10;i++){
      const code=String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);
      const {data:room,error}=await db.from('fashion_rooms').insert({code,title}).select().single();
      if(!error)return room;if(error.code!=='23505')throw error;
    }throw new Error('code_collision');
  },
  setRoomActive:(id,active)=>data(db.from('fashion_rooms').update({active}).eq('id',id).select().single()),
  clips:s=>data(scoped(db.from('fashion_clips').select('*'),s).eq('ready',true).order('created_at',{ascending:false}).limit(100)),
  clip:(s,id)=>data(scoped(db.from('fashion_clips').select('*'),s).eq('id',id).maybeSingle()),
  newClip:clip=>data(db.from('fashion_clips').insert(clip)),
  completeClip:id=>data(db.from('fashion_clips').update({ready:true}).eq('id',id)),
};
const bucket=db.storage.from('fashion-group-clips');
const storage={
  async sign(path){return (await data(bucket.createSignedUrl(path,600))).signedUrl;},
  async uploadUrl(path){return (await data(bucket.createSignedUploadUrl(path))).signedUrl;},
  async info(path){const i=path.lastIndexOf('/'),name=path.slice(i+1);return (await data(bucket.list(path.slice(0,i),{search:name,limit:10}))).find(f=>f.name===name)?.metadata;},
};
Deno.serve(createRoomHandler({repo,storage,secret,publicKey}));
