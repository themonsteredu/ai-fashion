import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMesh } from '../js/puppet-mesh.js';

// Arms hang alongside and touch the shirt/hips. Raising them used to connect
// moving wrists to stationary torso vertices with long textured triangles.
export function fixture() {
 const w=600,h=1000,alpha=new Uint8ClampedArray(w*h*4);
 const rects=[[190,150,410,600],[150,195,205,640],[395,195,450,640],[205,580,275,940],[325,580,395,940]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(rects.some(([x0,y0,x1,y1])=>x>=x0&&x<=x1&&y>=y0&&y<=y1))alpha[(y*w+x)*4+3]=255;
 const bones=[
  {name:'root',parent:null,head:[300,550],tail:[300,550],drive:'none',layer:1},
  {name:'spine',parent:'root',head:[300,550],tail:[300,170],drive:'delta',layer:1,region:[[190,200],[410,200],[410,580],[190,580]]},
 ];
 for(const side of ['L','R']) {
  const x=side==='L'?422:178;
  bones.push(
   {name:side+'upperArm',parent:'spine',head:[x,210],tail:[x,400],drive:'abs',layer:3,seedFrom:.18},
   {name:side+'lowerArm',parent:side+'upperArm',head:[x,400],tail:[x,595],drive:'abs',layer:3},
   {name:side+'hand',parent:side+'lowerArm',head:[x,595],tail:[x,640],drive:'follow',layer:3},
  );
 }
 return {prep:{w,h,canvas:{getContext:()=>({getImageData:()=>({data:alpha})})}},bones};
}
export function deformed(mesh,bones,angles){
 const poses=[];
 for(const b of bones){
  const parent=bones.findIndex(p=>p.name===b.parent),p=poses[parent];
  const a=(p?.a||0)+(angles[b.name]||0);
  const [dx,dy]=parent<0?b.head:[b.head[0]-bones[parent].head[0],b.head[1]-bones[parent].head[1]];
  poses.push({a,x:parent<0?dx:p.x+dx*Math.cos(p.a)-dy*Math.sin(p.a),y:parent<0?dy:p.y+dx*Math.sin(p.a)+dy*Math.cos(p.a)});
 }
 return Array.from({length:mesh.pos.length/3},(_,v)=>{
  let x=0,y=0;
  for(let k=0;k<4;k++){const b=mesh.skinIdx[v*4+k],weight=mesh.skinW[v*4+k];if(!weight)continue;
   const p=poses[b],dx=mesh.pos[v*3]-bones[b].head[0],dy=mesh.pos[v*3+1]-bones[b].head[1];
   x+=weight*(p.x+dx*Math.cos(p.a)-dy*Math.sin(p.a)); y+=weight*(p.y+dx*Math.sin(p.a)+dy*Math.cos(p.a));
  }return [x,y];
 });
}
export function longestEdge(mesh,points){let max=0;
 for(let t=0;t<mesh.index.length;t+=3)for(const [i,j] of [[0,1],[1,2],[2,0]]){
 const a=mesh.index[t+i],b=mesh.index[t+j];max=Math.max(max,Math.hypot(points[a][0]-points[b][0],points[a][1]-points[b][1]));
 }return max;
}
// Skin is continuous around a joint (so it bends instead of hinging like a wooden doll),
// but only inside that joint's zone; touching parts away from a joint stay separate.
test('only connected anatomical joints can share a triangle, and only near that joint',()=>{
 const {prep,bones}=fixture(),mesh=buildMesh(prep,bones);
 let joined=0;
 for(let t=0;t<mesh.index.length;t+=3){
  const vertices=mesh.index.slice(t,t+3),owners=[...new Set(vertices.map(v=>mesh.skinIdx[v*4]))];
  if(owners.length===1)continue;
  assert.equal(owners.length,2);
  const [a,b]=owners.map(i=>bones[i]);
  const child=a.parent===b.name?a:b.parent===a.name?b:null;
  assert(child,'Unrelated body parts must stay separate');
  for(const v of vertices) assert(mesh.jointZone(a.name,b.name,mesh.pos[v*3],mesh.pos[v*3+1])<=mesh.zoneFade,'Joined skin must stay near its joint');
  joined++;
 }
 assert(joined>0,'A real joint should share vertices');
 assert(mesh.armTouch>2,'Fixture must exercise the touching-arm path');
});
test('raising and folding attached arms cannot create wrist-to-hip ribbons',()=>{
 const {prep,bones}=fixture(),mesh=buildMesh(prep,bones);
 let max=0;
 for(const angle of [0,.5,1,1.5,2,2.5,3])for(const elbow of [-1.7,0,1.7]){
 const points=deformed(mesh,bones,{LupperArm:-angle,RupperArm:angle,LlowerArm:elbow,RlowerArm:-elbow});
 max=Math.max(max,longestEdge(mesh,points));
 assert(points.every(p=>p.every(Number.isFinite)));
 }
 // A rest cell edge is at most 11.8px. Some joint blending is allowed,
 // but the old shared mesh stretched small edges to hundreds of pixels.
 assert(max<prep.h/120*4,`Maximum deformed edge was ${max.toFixed(2)}px`);
});
test('every visible cell is retained and normalized weights stay within one limb',()=>{
 const {prep,bones}=fixture(),mesh=buildMesh(prep,bones);
 assert(mesh.index.length>1000);
 for(let v=0;v<mesh.pos.length/3;v++){
  const ids=mesh.skinIdx.slice(v*4,v*4+4),weights=mesh.skinW.slice(v*4,v*4+4);
  assert(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-7);
  // Every weighted bone is joined to another weighted bone by a parent/child link (one chain, e.g. head-spine-upperArm-lowerArm).
  const used=[...new Set([0,1,2,3].filter(k=>weights[k]>0).map(k=>ids[k]))].map(i=>bones[i]);
  for(const a of used){
   if(used.length===1)break;
   const linked=used.filter(b=>b!==a&&(a.parent===b.name||b.parent===a.name));
   assert(linked.length,`${a.name} blends with unrelated ${used.map(b=>b.name)}`);
   // An arm may blend into the body only at the shoulder, and only around that joint.
   for(const b of linked) if(/Arm|hand/.test(a.name)!==/Arm|hand/.test(b.name)){
    const pair=[a.name,b.name].sort().join('/');
    assert.match(pair,/^[LR]upperArm\/spine$/);
    assert(mesh.jointZone(a.name,b.name,mesh.pos[v*3],mesh.pos[v*3+1])<=mesh.zoneFade);
   }
  }
 }
});

// Shared source positions at the hip must use the very same vertex even when
// neighboring cells used to be assigned to opposite thighs or the torso.
test('pelvis shares continuous vertices across the torso and both thighs',()=>{
 const {prep,bones}=fixture();
 bones.push({name:'LupperLeg',parent:'root',head:[360,550],tail:[370,760],drive:'delta',layer:0},
 {name:'RupperLeg',parent:'root',head:[240,550],tail:[230,760],drive:'delta',layer:0});
 const mesh=buildMesh(prep,bones),seen=new Map();let tested=0;
 for(let v=0;v<mesh.pos.length/3;v++){
  const x=mesh.pos[v*3],y=mesh.pos[v*3+1],owner=mesh.skinIdx[v*4];
  if(x<210||x>390||y<500||y>630||/Arm|hand/.test(bones[owner].name))continue;
  const key=x+':'+y;assert(!seen.has(key),'Hip seam has duplicate independently moving vertices');seen.set(key,v);tested++;
 }
 assert(tested>100);
});

test('a skirt stays joined to the torso while upper-body pose moves',()=>{
 const {prep,bones}=fixture();
 bones.push({name:'lower',parent:'root',head:[300,550],tail:[300,940],drive:'none',layer:0});
 const mesh=buildMesh(prep,bones),seen=new Map();let tested=0;
 for(let v=0;v<mesh.pos.length/3;v++){
  const x=mesh.pos[v*3],y=mesh.pos[v*3+1],owner=mesh.skinIdx[v*4];
  if(x<210||x>390||y<500||y>630||/Arm|hand/.test(bones[owner].name))continue;
  const key=x+':'+y;
  assert(!seen.has(key),'Waist has duplicate independently moving vertices');
  seen.set(key,v);tested++;
 }
 assert(tested>100);
});

// The torso must follow the spine bone (leaning, swaying). Only the pelvis band blends into the thighs.
test('the torso follows the spine instead of being pinned to the hips',()=>{
 const {prep,bones}=fixture();
 bones.push({name:'LupperLeg',parent:'root',head:[360,550],tail:[370,760],drive:'delta',layer:0},
 {name:'RupperLeg',parent:'root',head:[240,550],tail:[230,760],drive:'delta',layer:0});
 const mesh=buildMesh(prep,bones),spine=bones.findIndex(b=>b.name==='spine');
 let torso=0;
 for(let v=0;v<mesh.pos.length/3;v++){
  for(let k=0;k<4;k++) if(mesh.skinW[v*4+k]>0) assert.notEqual(bones[mesh.skinIdx[v*4+k]].name,'root','No picture pixel may be pinned to the non-rotating root');
  const x=mesh.pos[v*3],y=mesh.pos[v*3+1];
  if(x>250&&x<350&&y>280&&y<450){torso++;assert.equal(mesh.skinIdx[v*4],spine);assert(mesh.skinW[v*4]>.99);}
 }
 assert(torso>100);
});

// A-pose picture: arms leave the body at the shoulder and there is a gap below the armpit.
export function aPoseFixture(){
 const w=600,h=1000,alpha=new Uint8ClampedArray(w*h*4);
 const capsule=(p,a,b,r)=>{const d=[b[0]-a[0],b[1]-a[1]],L=d[0]*d[0]+d[1]*d[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/L));return Math.hypot(p[0]-a[0]-d[0]*t,p[1]-a[1]-d[1]*t)<=r;};
 const arms=[[[390,195],[470,385],[545,560]],[[210,195],[130,385],[55,560]]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=[x,y];
  const body=(x>=205&&x<=395&&y>=150&&y<=600)||(Math.hypot((x-300)/62,(y-95)/75)<=1)||(x>=215&&x<=290&&y>=580&&y<=940)||(x>=310&&x<=385&&y>=580&&y<=940);
  const arm=arms.some(([s,e,wr])=>capsule(p,s,e,30)||capsule(p,e,wr,24));
  if(body||arm)alpha[(y*w+x)*4+3]=255;
 }
 const bones=[
  {name:'root',parent:null,head:[300,560],tail:[300,560],drive:'none',layer:1},
  {name:'spine',parent:'root',head:[300,560],tail:[300,165],drive:'delta',layer:1,region:[[215,200],[385,200],[395,580],[205,580]]},
 ];
 for(const [side,[s,e,wr]] of [['L',arms[0]],['R',arms[1]]]){
  bones.push(
   {name:side+'upperArm',parent:'spine',head:s,tail:e,drive:'abs',layer:3,seedFrom:.18},
   {name:side+'lowerArm',parent:side+'upperArm',head:e,tail:wr,drive:'abs',layer:3},
   {name:side+'hand',parent:side+'lowerArm',head:wr,tail:[wr[0]+(wr[0]-e[0])*.3,wr[1]+(wr[1]-e[1])*.3],drive:'follow',layer:3},
  );
 }
 bones.push({name:'LupperLeg',parent:'root',head:[345,560],tail:[348,760],drive:'delta',layer:0},
 {name:'RupperLeg',parent:'root',head:[255,560],tail:[252,760],drive:'delta',layer:0});
 return {prep:{w,h,canvas:{getContext:()=>({getImageData:()=>({data:alpha})})}},bones};
}
test('an A-pose arm is cut along the armhole and its shoulder skin stays joined',()=>{
 const {prep,bones}=aPoseFixture(),mesh=buildMesh(prep,bones),cell=prep.h/120;
 assert.equal(mesh.cuts.length,2,'Both armpits should be found');
 const armAt=(x,y)=>{let best=null;for(let v=0;v<mesh.pos.length/3;v++){const d=Math.hypot(mesh.pos[v*3]-x,mesh.pos[v*3+1]-y);if(!best||d<best.d)best={d,v};}return best.v;};
 // The whole sleeve (outer side of the upper arm near the shoulder) follows the arm, the body stays.
 for(const [arm,sleeve,chest] of [['LupperArm',[440,280],[330,300]],['RupperArm',[160,280],[270,300]]]){
  const a=bones.findIndex(b=>b.name===arm),v=armAt(...sleeve),c=armAt(...chest);
  const wArm=v2=>{let s=0;for(let k=0;k<4;k++)if(mesh.skinIdx[v2*4+k]===a)s+=mesh.skinW[v2*4+k];return s;};
  assert(wArm(v)>.99,`${arm} sleeve must follow the arm`);
  assert(wArm(c)<.01,`${arm} must not drag the chest`);
 }
 // Around each shoulder the skin is one piece: no duplicated vertices inside the shared armhole zone.
 for(const cut of mesh.cuts){
  const seen=new Set();let tested=0;
  for(let v=0;v<mesh.pos.length/3;v++){
   const x=mesh.pos[v*3],y=mesh.pos[v*3+1],n=bones[mesh.skinIdx[v*4]].name;
   if(!/^(spine|[LR]upperArm)$/.test(n)||mesh.jointZone('spine',cut.arm,x,y)>0.8)continue;
   const key=x+':'+y;assert(!seen.has(key),'Shoulder skin must not split into two pieces');seen.add(key);tested++;
  }
  assert(tested>10);
 }
 // Raising the arms bends the shoulder smoothly instead of tearing or stretching ribbons.
 let max=0;
 for(const angle of [0,.6,1.2,1.8,2.4])for(const elbow of [-1.2,0,1.2]){
  const points=deformed(mesh,bones,{LupperArm:-angle,RupperArm:angle,LlowerArm:elbow,RlowerArm:-elbow});
  max=Math.max(max,longestEdge(mesh,points));
 }
 assert(max<cell*4,`Maximum deformed edge was ${max.toFixed(2)}px`);
});

// A big head (or long hair) resting on the shoulders: the armhole search must not climb into it,
// and face/hair pixels must not follow the arms.
test('a big head touching the shoulders never follows the arms',()=>{
 const {prep,bones}=aPoseFixture(),alpha=prep.canvas.getContext().getImageData().data,w=prep.w,h=prep.h;
 const inHead=(x,y)=>Math.hypot((x-300)/115,(y-110)/105)<=1; // wide chibi head resting on the shoulder line
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(inHead(x,y))alpha[(y*w+x)*4+3]=255;
 const head={name:'head',parent:'spine',head:[300,215],tail:[300,10],drive:'delta',layer:2};
 bones.splice(2,0,head);
 const mesh=buildMesh(prep,bones);
 for(const cut of mesh.cuts) assert(!inHead(...cut.s),`armhole cut starts inside the head at ${cut.s.map(Math.round)}`);
 let face=0;
 for(let v=0;v<mesh.pos.length/3;v++){
  const x=mesh.pos[v*3],y=mesh.pos[v*3+1];
  if(Math.hypot((x-300)/95,(y-100)/85)>1)continue; // well inside the face
  face++;
  for(let k=0;k<4;k++)if(/Arm|hand/.test(bones[mesh.skinIdx[v*4+k]].name))assert(mesh.skinW[v*4+k]<.05,`face vertex ${Math.round(x)},${Math.round(y)} follows ${bones[mesh.skinIdx[v*4+k]].name}`);
 }
 assert(face>50);
});

// Spreading the legs: the inner thighs below the crotch follow only their own leg (no ledge where the pelvis band ends).
test('spreading the legs leaves no ledge on the inner thighs',()=>{
 const {prep,bones}=aPoseFixture(),mesh=buildMesh(prep,bones),cell=prep.h/120;
 let max=0;
 for(const spread of [.2,.35,.5]){
  const points=deformed(mesh,bones,{LupperLeg:-spread,RupperLeg:spread});
  for(let t=0;t<mesh.index.length;t+=3)for(const [i,j] of [[0,1],[1,2],[2,0]]){
   const a=mesh.index[t+i],b=mesh.index[t+j];
   if(mesh.pos[a*3+1]<560||mesh.pos[a*3+1]>760)continue;
   max=Math.max(max,Math.hypot(points[a][0]-points[b][0],points[a][1]-points[b][1]));
  }
 }
 assert(max<cell*3,`Maximum deformed edge around the hips was ${max.toFixed(2)}px`);
});

// The elbow blends only near the elbow, so a deep bend does not thin the whole upper arm.
test('the forearm pulls on the upper arm only right around the elbow',()=>{
 const {prep,bones}=aPoseFixture(),mesh=buildMesh(prep,bones),cell=prep.h/120;
 for(const side of ['L','R']){
  const up=bones.find(b=>b.name===side+'upperArm'),lo=bones.findIndex(b=>b.name===side+'lowerArm');
  const d=[up.tail[0]-up.head[0],up.tail[1]-up.head[1]],L2=d[0]*d[0]+d[1]*d[1];
  for(let v=0;v<mesh.pos.length/3;v++){
   const x=mesh.pos[v*3],y=mesh.pos[v*3+1],t=((x-up.head[0])*d[0]+(y-up.head[1])*d[1])/L2;
   if(t<0.1||(1-t)*Math.sqrt(L2)<cell*6.5||Math.hypot(x-up.head[0]-d[0]*t,y-up.head[1]-d[1]*t)>25)continue;
   for(let k=0;k<4;k++)if(mesh.skinIdx[v*4+k]===lo)assert(mesh.skinW[v*4+k]<.01,`${side} upper arm at t=${t.toFixed(2)} follows the forearm`);
  }
 }
});
