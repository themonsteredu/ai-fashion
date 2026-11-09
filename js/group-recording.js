export const MIME_TYPES = ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'];
export function chooseMime(Recorder = globalThis.MediaRecorder) {
  if (!Recorder) throw new Error('이 브라우저는 영상 저장을 지원하지 않아요. 최신 Safari 또는 Chrome으로 열어 주세요.');
  const mime = MIME_TYPES.find(type => Recorder.isTypeSupported(type));
  if (!mime) throw new Error('저장할 수 있는 영상 형식을 찾지 못했어요.');
  return mime;
}
export function fileExtension(mime) { return mime.startsWith('video/mp4') ? 'mp4' : 'webm'; }
export function clipSignature(clips) { return clips.map(c => c?.revision || '').join('|'); }
export function canCombine(clips) { return clips.length === 4 && clips.every(c => c?.blob?.size > 0); }
export function makeRecording(canvas, Recorder = globalThis.MediaRecorder) {
  if (!canvas.captureStream) throw new Error('이 브라우저에서는 화면 녹화를 지원하지 않아요.');
  const mime = chooseMime(Recorder), stream = canvas.captureStream(24), chunks=[];
  let recorder;
  try { recorder = new Recorder(stream, { mimeType:mime, videoBitsPerSecond:3500000 }); }
  catch(e) { stream.getTracks().forEach(t=>t.stop()); throw e; }
  const done = new Promise((resolve,reject)=>{
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
    recorder.onerror=e=>{stream.getTracks().forEach(t=>t.stop());reject(e.error || new Error('녹화 오류'));};
    recorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:recorder.mimeType || mime});
      if(blob.size)resolve(blob);else reject(new Error('영상이 비어 있어요. 다시 녹화해 주세요.'));
    };
  });
  try { recorder.start(200); } catch(e) { stream.getTracks().forEach(t=>t.stop()); throw e; }
  return {done, stop(){if(recorder.state!=='inactive')recorder.stop();}};
}

export function openGroupStore(indexedDB = globalThis.indexedDB) {
  return new Promise((resolve,reject)=>{
    if(!indexedDB){reject(new Error('이 기기에서는 자동 보관을 사용할 수 없어요.'));return;}
    const req=indexedDB.open('moakit-motion-group-v1',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('items');
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const db=req.result;
      function transaction(mode, action){return new Promise((ok,fail)=>{
        const tx=db.transaction('items',mode),store=tx.objectStore('items');let result;
        try {const r=action(store);r.onsuccess=()=>result=r.result;}catch(e){fail(e);return;}
        tx.oncomplete=()=>ok(result);tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error || new Error('저장 중단'));
      });}
      resolve({get:key=>transaction('readonly',s=>s.get(key)),put:(key,v)=>transaction('readwrite',s=>s.put(v,key)),remove:key=>transaction('readwrite',s=>s.delete(key))});
    };
  });
}

// Decode each clip into one canvas and encode a new stream. Concatenating Blob
// bytes produces invalid multi-video files and is deliberately not used here.
export async function combineClips(clips, canvas, {onProgress=()=>{}, signal}={}) {
  if(!canCombine(clips))throw new Error('네 명의 영상을 먼저 녹화해 주세요.');
  const ctx=canvas.getContext('2d'),v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.preload='auto';v.style.cssText='position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:.01';document.body.append(v);
  let session,raf=0,currentUrl;let failed;
  function draw(){if(v.readyState>=2){ctx.fillStyle='#f5f3ed';ctx.fillRect(0,0,canvas.width,canvas.height);const scale=Math.min(canvas.width/v.videoWidth,canvas.height/v.videoHeight);ctx.drawImage(v,(canvas.width-v.videoWidth*scale)/2,(canvas.height-v.videoHeight*scale)/2,v.videoWidth*scale,v.videoHeight*scale);}raf=requestAnimationFrame(draw);}
  try {
    for(let i=0;i<clips.length;i++){
      if(signal?.aborted)throw new DOMException('취소됨','AbortError');
      currentUrl=URL.createObjectURL(clips[i].blob);
      await new Promise((ok,fail)=>{
        const timer=setTimeout(()=>finish(new Error('영상을 읽는 시간이 초과됐어요.')),15000);
        const abort=()=>finish(new DOMException('취소됨','AbortError'));
        const finish=e=>{clearTimeout(timer);v.onloadeddata=null;v.onerror=null;signal?.removeEventListener('abort',abort);e?fail(e):ok();};
        v.onloadeddata=()=>finish();v.onerror=()=>finish(new Error('영상을 읽지 못했어요.'));signal?.addEventListener('abort',abort,{once:true});v.src=currentUrl;v.load();
      });
      onProgress(i+1);ctx.drawImage(v,0,0,canvas.width,canvas.height);
      if(!session){session=makeRecording(canvas);session.done.catch(e=>{failed=e;});draw();}
      await new Promise((ok,fail)=>{
        const timer=setTimeout(()=>finish(new Error('영상 재생이 중단됐어요.')),Math.max(15000,clips[i].duration*1000+12000));
        const abort=()=>finish(new DOMException('취소됨','AbortError'));
        const finish=e=>{clearTimeout(timer);v.onended=null;v.onerror=null;signal?.removeEventListener('abort',abort);e?fail(e):ok();};
        v.onended=()=>finish(failed);v.onerror=()=>finish(new Error('영상 재생 오류'));signal?.addEventListener('abort',abort,{once:true});v.play().catch(finish);
      });
      URL.revokeObjectURL(currentUrl);currentUrl=null;
    }
    session.stop();return await session.done;
  } finally {
    cancelAnimationFrame(raf);v.pause();v.removeAttribute('src');v.load();v.remove();if(currentUrl)URL.revokeObjectURL(currentUrl);session?.stop();
  }
}
