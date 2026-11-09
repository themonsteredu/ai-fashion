// Actual default model, VRM normalization and WebGL skinning. No webcam dependency.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'test-results');
await mkdir(out,{recursive:true});
const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!path.startsWith(root+'/'))throw Error();
 res.setHeader('content-type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/js/main.js',async route=>{
  let s=await readFile(resolve(root,'js/main.js'),'utf8');
  s=s.replace("import * as Motion from './motion.js';",`import * as RealMotion from './motion.js'; const Motion={...RealMotion,initTrackers:async()=>{}};`);
  s=s.replace('CamBG.init().catch','Promise.resolve().catch');
  s=s.replace('if (document.hidden) return;','if (window.__freeze || document.hidden) return;');
  await route.fulfill({body:s,contentType:'text/javascript'});
 });
 await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#loading').waitFor({state:'hidden',timeout:60000});
 const initial=await page.evaluate(async()=>{
  window.__freeze=true;
  const A=await import('/js/avatar.js'),P=await import('/js/puppet.js'),T=await import('/lib/three.module.min.js');
  const v=A.state.vrm;v.scene.updateMatrixWorld(true);
  const required=['hips','spine','chest','neck','head','leftShoulder','rightShoulder','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot'];
  const bones=Object.fromEntries(required.map(n=>[n,!!v.humanoid.getNormalizedBoneNode(n)]));
  let vertices=0,skinMeshes=0,maxWeightError=0;
  v.scene.traverse(o=>{if(!o.isSkinnedMesh)return;skinMeshes++;vertices+=o.geometry.attributes.position.count;
   const w=o.geometry.attributes.skinWeight;
   for(let i=0;i<w.count;i++)maxWeightError=Math.max(maxWeightError,Math.abs(1-w.getX(i)-w.getY(i)-w.getZ(i)-w.getW(i)));
  });
  const b=new T.Box3().setFromObject(v.scene);
  return {isDefault3d:A.state.isDefault3d,picture:P.isActive(),visible:v.scene.visible,bones,vertices,skinMeshes,maxWeightError,depth:b.max.z-b.min.z};
 });
 assert.equal(initial.isDefault3d,true);assert.equal(initial.picture,false);assert.equal(initial.visible,true);
 assert(Object.values(initial.bones).every(Boolean),JSON.stringify(initial.bones));
 assert(initial.skinMeshes>0&&initial.vertices>1000);assert(initial.depth>.12);assert(initial.maxWeightError<.002);
 await page.screenshot({path:resolve(out,'3d-home-1366x768.png')});
 const poses=[['neutral',[]],['arms-side',[['leftUpperArm',[0,0,1],0],['rightUpperArm',[0,0,1],0]]],
 ['arms-overhead',[['leftUpperArm',[0,0,1],1.45],['rightUpperArm',[0,0,1],-1.45]]],
 ['elbows-bent',[['leftUpperArm',[0,0,1],.2],['rightUpperArm',[0,0,1],-.2],['leftLowerArm',[0,1,0],-1.4],['rightLowerArm',[0,1,0],1.4]]],
 ['squat',[['leftUpperLeg',[1,0,0],-.65],['rightUpperLeg',[1,0,0],-.65],['leftLowerLeg',[1,0,0],1.2],['rightLowerLeg',[1,0,0],1.2]]]];
 const reports=[];
 for(const [name,spec] of poses){
  const report=await page.evaluate(async({spec})=>{
   const A=await import('/js/avatar.js'),T=await import('/lib/three.module.min.js');
   const v=A.state.vrm;A.setFraming('preview');
   A.state.camera.clearViewOffset();A.state.camera.position.set(0,1,3.7);A.state.camera.lookAt(0,1,0);A.state.camera.updateProjectionMatrix();
   for(let f=0;f<100;f++){A.applyDemoPose(spec,1/60,{root:{x:0,y:0},plant:true});v.update(1/60);v.scene.updateMatrixWorld(true);}
   let finite=true,maxEdge=0;const min=new T.Vector3(Infinity,Infinity,Infinity),max=new T.Vector3(-Infinity,-Infinity,-Infinity);
   v.scene.traverse(o=>{if(!o.isSkinnedMesh)return;o.skeleton.update();const p=o.geometry.attributes.position,verts=[];
    for(let i=0;i<p.count;i++){const x=o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld);finite&&=[x.x,x.y,x.z].every(Number.isFinite);verts.push(x);min.min(x);max.max(x);}
    const ix=o.geometry.index;for(let i=0;i<(ix?.count||p.count);i+=3){const a=verts[ix?ix.getX(i):i],b=verts[ix?ix.getX(i+1):i+1],c=verts[ix?ix.getX(i+2):i+2];maxEdge=Math.max(maxEdge,a.distanceTo(b),b.distanceTo(c),c.distanceTo(a));}
   });
   const wp=n=>v.humanoid.getRawBoneNode(n).getWorldPosition(new T.Vector3()).toArray();
   A.state.renderer.render(A.state.scene,A.state.camera);
   return {finite,maxEdge,min:min.toArray(),max:max.toArray(),head:wp('head'),leftHand:wp('leftHand'),rightHand:wp('rightHand'),leftFoot:wp('leftFoot'),rightFoot:wp('rightFoot')};
  },{spec});
  assert(report.finite);assert(report.maxEdge<.25,JSON.stringify({name,report}));
  if(name==='arms-overhead'){assert(report.leftHand[1]>report.head[1]);assert(report.rightHand[1]>report.head[1]);}
  reports.push({name,...report});await page.screenshot({path:resolve(out,`3d-${name}.png`)});
 }
 await page.evaluate(async()=>{const A=await import('/js/avatar.js');for(let i=0;i<100;i++){A.applyDemoPose([],1/60,{root:{x:0,y:0},plant:true});A.state.vrm.update(1/60);}A.state.vrm.scene.rotation.y=.9;A.state.renderer.render(A.state.scene,A.state.camera);});
 await page.screenshot({path:resolve(out,'3d-three-quarter.png')});
 assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'avatar-3d.json'),JSON.stringify({initial,reports,errors},null,2));
 console.log(JSON.stringify({initial,reports,errors}));
}finally{await browser.close();server.close();}
