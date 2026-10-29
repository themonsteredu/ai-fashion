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
test('only connected anatomical joints can share a triangle',()=>{
 const {prep,bones}=fixture(),mesh=buildMesh(prep,bones),cell=prep.h/120;
 let joined=0;
 for(let t=0;t<mesh.index.length;t+=3){
  const vertices=mesh.index.slice(t,t+3),owners=[...new Set(vertices.map(v=>mesh.skinIdx[v*4]))];
  if(owners.length===1)continue;
  assert.equal(owners.length,2);
  const [a,b]=owners.map(i=>bones[i]);
  const child=a.parent===b.name?a:b.parent===a.name?b:null;
  assert(child,'Unrelated body parts must stay separate');
  for(const v of vertices) assert(Math.hypot(mesh.pos[v*3]-child.head[0],mesh.pos[v*3+1]-child.head[1])<cell*3);
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
  for(let k=1;k<4;k++)if(weights[k]>0){
   const a=bones[ids[0]],b=bones[ids[k]];
   assert(a.parent===b.name||b.parent===a.name);
   assert(!((/Arm|hand/.test(a.name)) !== (/Arm|hand/.test(b.name))));
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
