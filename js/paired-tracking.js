// Identity association is independent of detection order and rendering.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function center(points){
  if(!points||points.length<33)return null;
  const torso=[11,12,23,24].map(i=>points[i]);
  if(torso.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||(p.visibility??1)<.5))return null;
  return {x:torso.reduce((s,p)=>s+p.x,0)/4,y:torso.reduce((s,p)=>s+p.y,0)/4};
}
export class PairAssociator{
  constructor(){this.reset();}
  reset(){this.slots=[null,null];this.generation=0;}
  update(result,now){
    const detections=(result.landmarks||[]).map((image,index)=>({image,world:result.worldLandmarks?.[index],center:center(image)})).filter(d=>d.center&&d.world?.length>=33).slice(0,2);
    this.slots=this.slots.map(s=>s&&now-s.seen<1800?s:null);
    // Overlapping torsos are ambiguous: hold identities instead of swapping them.
    if(detections.length===2&&distance(detections[0].center,detections[1].center)<.075)return [null,null];
    const matched=[null,null],used=new Set();
    const cost=(slot,d)=>{
      const elapsed=Math.min((now-slot.seen)/1000,.25);
      const prediction={x:slot.center.x+slot.vx*elapsed,y:slot.center.y+slot.vy*elapsed};
      return distance(prediction,d.center);
    };
    // Enumerate assignments with a missing-person penalty; a detection can be used once.
    let best=null,bestCost=Infinity;
    for(let a=-1;a<detections.length;a++)for(let b=-1;b<detections.length;b++){
      if(a>=0&&a===b)continue;
      let total=0,valid=true;
      for(const [slot,i] of [[this.slots[0],a],[this.slots[1],b]]){
        if(!slot){if(i>=0)valid=false;continue;}
        const c=i<0?.3:cost(slot,detections[i]);if(i>=0&&c>.28)valid=false;total+=c;
      }
      if(valid&&total<bestCost){best=[a,b];bestCost=total;}
    }
    if(best)best.forEach((index,slot)=>{if(index>=0){matched[slot]=detections[index];used.add(index);}});
    // New people are assigned in mirrored screen order: camera-right is screen-left.
    const remaining=detections.map((d,i)=>({...d,index:i})).filter(d=>!used.has(d.index)).sort((a,b)=>b.center.x-a.center.x);
    if(!this.slots[0]&&!this.slots[1]&&remaining.length===1){const person=remaining.shift();matched[person.center.x>=.5?0:1]=person;}
    else for(let i=0;i<2;i++)if(!this.slots[i]&&remaining.length){matched[i]=remaining.shift();}
    return matched.map((d,i)=>{
      if(!d)return null;
      const old=this.slots[i],dt=old?Math.max(.01,(now-old.seen)/1000):1;
      const slot={center:d.center,seen:now,vx:old?.vx*.5||0,vy:old?.vy*.5||0,generation:old?.generation||++this.generation};
      if(old){slot.vx+=Math.max(-1.5,Math.min(1.5,(d.center.x-old.center.x)/dt))*.5;slot.vy+=Math.max(-1.5,Math.min(1.5,(d.center.y-old.center.y)/dt))*.5;}
      this.slots[i]=slot;return {...d,generation:slot.generation};
    });
  }
}
export function distributeHands(people,result){
  const output=people.map(()=>({landmarks:[],worldLandmarks:[],handedness:[]})),candidates=[];
  (result?.landmarks||[]).forEach((hand,h)=>{people.forEach((person,p)=>{if(!person)return;for(const wrist of [15,16]){const point=person.image[wrist];if((point.visibility??1)<.5)continue;const d=distance(hand[0],point);if(d<.13)candidates.push({h,p,wrist,d});}});});
  candidates.sort((a,b)=>a.d-b.d);const hands=new Set(),wrists=new Set();
  for(const c of candidates){const key=`${c.p}:${c.wrist}`;if(hands.has(c.h)||wrists.has(key)||!result.worldLandmarks?.[c.h])continue;hands.add(c.h);wrists.add(key);output[c.p].landmarks.push(result.landmarks[c.h]);output[c.p].worldLandmarks.push(result.worldLandmarks[c.h]);output[c.p].handedness.push(result.handedness?.[c.h]||[]);}
  return output;
}
