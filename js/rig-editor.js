// Local joint correction; never sends the image to a paid API.
export const JOINTS = {
  NOSE: ['얼굴', .5, .14],
  R_SH: ['왼쪽 어깨', .36, .25], L_SH: ['오른쪽 어깨', .64, .25],
  R_EL: ['왼쪽 팔꿈치', .26, .39], L_EL: ['오른쪽 팔꿈치', .74, .39],
  R_WR: ['왼쪽 손목', .18, .52], L_WR: ['오른쪽 손목', .82, .52],
  R_HIP: ['왼쪽 골반', .43, .52], L_HIP: ['오른쪽 골반', .57, .52],
  R_KNEE: ['왼쪽 무릎', .41, .72], L_KNEE: ['오른쪽 무릎', .59, .72],
  R_ANK: ['왼쪽 발목', .39, .92], L_ANK: ['오른쪽 발목', .61, .92],
};
const LINKS = [['R_SH','L_SH'],['R_SH','R_EL'],['R_EL','R_WR'],['L_SH','L_EL'],['L_EL','L_WR'],['R_SH','R_HIP'],['L_SH','L_HIP'],['R_HIP','L_HIP'],['R_HIP','R_KNEE'],['R_KNEE','R_ANK'],['L_HIP','L_KNEE'],['L_KNEE','L_ANK']];
export function seedJoints(found, w, h) {
  return Object.fromEntries(Object.entries(JOINTS).map(([key, [, x, y]]) => {
    const p = found?.joints?.[key];
    return [key, p?.every(Number.isFinite) && (found.vis?.[key] ?? 1) >= .5
      ? [Math.max(0, Math.min(w, p[0])), Math.max(0, Math.min(h, p[1]))] : [x*w, y*h]];
  }));
}
export function validJoints(joints, w, h) {
  if (!Object.keys(JOINTS).every(k => joints[k]?.length === 2 && joints[k].every(Number.isFinite)
      && joints[k][0] >= 0 && joints[k][0] <= w && joints[k][1] >= 0 && joints[k][1] <= h)) return false;
  return LINKS.every(([a,b]) => Math.hypot(joints[a][0]-joints[b][0], joints[a][1]-joints[b][1]) > Math.min(w,h)*.015);
}
export function correctJoints(prep, found) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(94vw,650px);max-height:94dvh;padding:20px;border:0;border-radius:16px;color:#172333;background:#fff;overflow:auto';
    dialog.setAttribute('aria-label', '아바타 관절 맞추기');
    dialog.innerHTML = `<h2 style="margin:0 0 8px;font-size:22px">아바타 관절 맞추기</h2><p style="margin:0 0 12px;line-height:1.5;word-break:keep-all">관절을 확실히 찾지 못했어요. 점을 어깨·팔꿈치·손목·골반·무릎·발목에 맞춰 주세요. 일부 점은 추정 위치예요. 왼쪽·오른쪽은 화면 기준입니다.</p><div data-stage style="position:relative;margin:auto;max-width:100%;touch-action:none;background:#e5e7eb"><canvas style="width:100%;height:100%;display:block"></canvas></div><p data-status role="status" style="min-height:24px;margin:10px 0">점을 누르면 부위 이름이 나와요. 드래그하거나 방향키로 옮겨 주세요.</p><div style="display:flex;gap:12px;justify-content:flex-end"><button data-cancel type="button">취소</button><button data-apply type="button">관절 적용하고 움직이기</button></div>`;
    const stage = dialog.querySelector('[data-stage]'), canvas = dialog.querySelector('canvas');
    const status = dialog.querySelector('[data-status]');
    canvas.width = prep.w; canvas.height = prep.h;
    const height = Math.min(innerHeight*.5, 480), width = Math.min(innerWidth*.78, 560, height*prep.w/prep.h);
    stage.style.width = `${width}px`; stage.style.aspectRatio = `${prep.w}/${prep.h}`;
    const joints = seedJoints(found, prep.w, prep.h), buttons = {};
    const draw = () => {
      const g = canvas.getContext('2d'); g.clearRect(0,0,prep.w,prep.h); g.drawImage(prep.canvas,0,0);
      g.strokeStyle = '#1559b7'; g.lineWidth = Math.max(3,prep.h/250);
      for (const [a,b] of LINKS) {g.beginPath();g.moveTo(...joints[a]);g.lineTo(...joints[b]);g.stroke();}
      for(const [key,b] of Object.entries(buttons)) {b.style.left=`${joints[key][0]/prep.w*100}%`;b.style.top=`${joints[key][1]/prep.h*100}%`;}
    };
    for(const [key,[label]] of Object.entries(JOINTS)) {
      const button = document.createElement('button'); button.type='button'; button.setAttribute('aria-label',label); button.title=label;
      button.style.cssText='position:absolute;width:28px;height:28px;border:3px solid white;border-radius:50%;background:#1559b7;transform:translate(-50%,-50%);padding:0;touch-action:none;cursor:grab';
      let dragging = false;
      const move = e => {const r=stage.getBoundingClientRect();joints[key]=[Math.max(0,Math.min(prep.w,(e.clientX-r.left)/r.width*prep.w)),Math.max(0,Math.min(prep.h,(e.clientY-r.top)/r.height*prep.h))];draw();};
      button.onpointerdown=e=>{e.preventDefault();dragging=true;button.focus();button.setPointerCapture(e.pointerId);status.textContent=label;};
      button.onpointermove=e=>{if(dragging)move(e);};
      button.onpointerup=e=>{if(dragging)move(e);dragging=false;}; button.onpointercancel=()=>{dragging=false;};
      button.onfocus=()=>{status.textContent=label;};
      button.onkeydown=e=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();joints[key]=[Math.max(0,Math.min(prep.w,joints[key][0]+d[0]*prep.w*.005)),Math.max(0,Math.min(prep.h,joints[key][1]+d[1]*prep.h*.005))];draw();};
      buttons[key]=button;stage.append(button);
    }
    const done = value => {dialog.remove();resolve(value);};
    dialog.querySelector('[data-cancel]').onclick=()=>done(null);
    dialog.oncancel=e=>{e.preventDefault();done(null);};
    dialog.querySelector('[data-apply]').onclick=()=>{
      if(!validJoints(joints,prep.w,prep.h)){status.textContent='관절점이 겹쳐 있어요. 각 부위에 맞게 점을 떨어뜨려 주세요.';return;}
      done({joints,vis:Object.fromEntries(Object.keys(joints).map(k=>[k,1]))});
    };
    document.body.append(dialog);draw();dialog.showModal();
  });
}
