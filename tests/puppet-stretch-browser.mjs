// Real WebGL skinning of a fixture whose arms touch its torso. No webcam/API calls.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'test-results');
await mkdir(out,{recursive:true});
const mime={'.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.json':'application/json'};
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('content-type','text/html');res.end(`<style>body{margin:0;background:#f4f1ed}</style><div id="stage"></div><script type="importmap">{"imports":{"three":"/lib/three.module.min.js","three/addons/":"/lib/three/addons/","@pixiv/three-vrm":"/lib/three-vrm.module.min.js"}}</script>`);return;}
 const path=resolve(root,'.'+pathname);if(!path.startsWith(root+'/'))throw Error();
 res.setHeader('content-type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:800,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(async()=>{
  const A=await import('/js/avatar.js'),P=await import('/js/puppet.js');
  await A.initStage(document.querySelector('#stage'));await A.loadAvatar();
  const c=document.createElement('canvas');c.width=600;c.height=1000;const g=c.getContext('2d');
  // Navy shirt, skin-colored arms pressed along its sides, shorts and legs.
  g.fillStyle='#c3997a';g.fillRect(205,580,70,360);g.fillRect(325,580,70,360);
  g.fillRect(150,195,55,445);g.fillRect(395,195,55,445);
  g.beginPath();g.ellipse(300,105,62,80,0,0,Math.PI*2);g.fill();
  g.fillStyle='#1d2c36';g.fillRect(190,150,220,410);g.fillRect(150,195,55,120);g.fillRect(395,195,55,120);
  g.fillStyle='#a5a7ac';g.fillRect(195,550,210,140);
  const blob=await new Promise(r=>c.toBlob(r));
  const J={NOSE:[300,110],R_SH:[178,210],R_EL:[178,400],R_WR:[178,595],L_SH:[422,210],L_EL:[422,400],L_WR:[422,595],R_HIP:[240,560],L_HIP:[360,560],R_KNEE:[240,750],L_KNEE:[360,750],R_ANK:[240,930],L_ANK:[360,930]};
  await P.activate(blob,{rig:{mode:'full',joints:Object.fromEntries(Object.entries(J).map(([k,[x,y]])=>[k,[x/600,y/1000]]))}});
  A.setFraming('preview');
 });
 const report=[];
 for(const [name,left,right,elbow] of [['raised',.9,-.9,0],['side',0,0,0],['folded',0,0,1.4]]){
  const result=await page.evaluate(async({left,right,elbow})=>{
   const A=await import('/js/avatar.js'),P=await import('/js/puppet.js'),T=await import('/lib/three.module.min.js');
   for(let i=0;i<100;i++){A.applyDemoPose([['leftUpperArm',[0,0,1],left],['rightUpperArm',[0,0,1],right],['leftLowerArm',[0,0,1],elbow],['rightLowerArm',[0,0,1],-elbow]],1/60);A.state.vrm.update(1/60);P.update(1/60,true);}
   A.state.renderer.render(A.state.scene,A.state.camera);
   let max=0,count=0;
   A.state.scene.traverse(o=>{if(!o.isSkinnedMesh||o.renderOrder!==10)return;o.skeleton.update();const ix=o.geometry.index;
    for(let i=0;i<ix.count;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){const p=o.getVertexPosition(ix.getX(i+a),new T.Vector3()),q=o.getVertexPosition(ix.getX(i+b),new T.Vector3());max=Math.max(max,p.distanceTo(q));count++;}
   });
   return {mode:P.getMode(),maxEdge:max,edges:count};
  },{left,right,elbow});
  await page.screenshot({path:resolve(out,`attached-arms-${name}.png`)});
  assert.equal(result.mode,'full');assert(result.edges>1000);assert(result.maxEdge<.09,JSON.stringify(result));report.push({name,...result});
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'attached-arms.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
