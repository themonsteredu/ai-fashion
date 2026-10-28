// Camera-free browser regression. Only the camera/tracker boundary is replaced.
// Actual app boot, VRM, picture skinning, mission UI, judge, and framing run unchanged.
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=resolve(import.meta.dirname,'..'), out=resolve(root,'test-results');
await mkdir(out,{recursive:true});
const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.vrm':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
try{
for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[768,1024],[390,844],[360,740]]){
 const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(process.env.FONT_DIR) await page.route('https://cdn.jsdelivr.net/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();await route.fulfill({body:await readFile(resolve(process.env.FONT_DIR,name)),contentType:'font/woff'});});
 await page.route('**/js/main.js',async route=>{
 let source=await readFile(resolve(root,'js/main.js'),'utf8');
 assert(source.includes("import * as Motion from './motion.js';"),'Tracker import changed; update test injection');
 source=source.replace("import * as Motion from './motion.js';",`import * as RealMotion from './motion.js';
 import { snapshot } from '../tests/fixtures/pose-snapshots.mjs';
 import { demoFor } from './missionvisuals.js';
 window.__inputPose='neutral';
 const Motion={...RealMotion,initTrackers:async()=>{},startCamera:async()=>{},detect:()=>{},
 getStatus:()=> 'ok',getPoseSnapshot:()=>snapshot(window.__inputPose),
 applyToVRM:(_vrm,dt)=>Avatar.applyDemoPose(Puppet.flattenDemo(demoFor(window.__inputPose)),dt)};`);
 // No segmentation/tracker work: this suite tests synthesized tracked output, not MediaPipe inference.
 source=source.replace("CamBG.init().catch", "Promise.resolve().catch");
 source=source.replace('if (document.hidden) return;', 'if (window.__freeze || document.hidden) return;');
 await route.fulfill({body:source,contentType:'text/javascript'});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>document.querySelector('#loading').classList.contains('hidden'),{timeout:60000});
 await page.evaluate(()=>{localStorage.setItem('fas_mission_enabled_v1',JSON.stringify({both_up:true,left_up:false,right_up:false}));localStorage.setItem('fas_mission_settings_v1',JSON.stringify({totalMissions:1,passCount:1}));});
 // Deterministic pool (all other definitions explicitly disabled).
 await page.evaluate(async()=>{const {POSE_DEFS}=await import('/js/poses.js');localStorage.setItem('fas_mission_enabled_v1',JSON.stringify(Object.fromEntries(POSE_DEFS.map(p=>[p.id,p.id==='both_up']))));});
 await page.click('#btn-mission');
 await page.waitForFunction(()=>document.querySelector('#mm-title')?.textContent.includes('양팔'));
 await page.evaluate(async()=>{await Promise.all([300,500,700,900].map(w=>document.fonts.load(`${w} 16px "S-Core Dream"`)));await document.fonts.ready;});
 await page.waitForTimeout(900);
 const bounds=await page.evaluate(async()=>{
 const A=await import('/js/avatar.js'),P=await import('/js/puppet.js'),T=await import('/lib/three.module.min.js');
 const joints=P.jointWorld();if(!joints)throw Error('Picture avatar not articulated');
 const points=Object.values(joints).map(p=>{const v=new T.Vector3(p.x,p.y,p.z).project(A.state.camera);return{x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};});
 const card=document.querySelector('.mm-mid').getBoundingClientRect();
 return {mode:P.getMode(),left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)),cardTop:card.top};
 });
 await page.screenshot({path:resolve(out,`mission-${width}x${height}.png`)});
 assert(bounds.left>=0 && bounds.right<=width && bounds.top>=0 && bounds.bottom<bounds.cardTop,JSON.stringify({width,height,bounds}));
 const poseBounds=await page.evaluate(async()=>{
 window.__freeze=true;
 const A=await import('/js/avatar.js'),P=await import('/js/puppet.js'),V=await import('/js/missionvisuals.js'),T=await import('/lib/three.module.min.js');
 const rows=[];
 for(const id of ['both_up','left_up','right_up','both_side','lean_left','lean_right']) {
 for(let i=0;i<90;i++){A.applyDemoPose(P.flattenDemo(V.demoFor(id)),1/60);A.state.vrm.update(1/60);P.update(1/60,true);}
 A.state.renderer.render(A.state.scene,A.state.camera);
 const points=[]; A.state.scene.traverse(o=>{if(o.isSkinnedMesh && o.visible && o.material?.transparent){o.skeleton.update(); for(let i=0;i<o.geometry.attributes.position.count;i++){const v=o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld).project(A.state.camera);points.push({x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2});}}});
 if(!points.length)throw Error('No picture skin vertices tested');
 rows.push({id,left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
 }const countdown=document.querySelector('#mm-countdown');
 const rect=()=>{const c=countdown.getBoundingClientRect();return {left:c.left,right:c.right,top:c.top,bottom:c.bottom};};
 const countdownRect=rect(); countdown.classList.add('go'); const goRect=rect(); countdown.classList.remove('go');
 return rows.map(b=>({...b,countdown:countdownRect,go:goRect}));
 });
 for(const b of poseBounds) { for(const c of [b.countdown,b.go]) assert(b.right<c.left||b.left>c.right||b.bottom<c.top||b.top>c.bottom,'Countdown overlaps '+JSON.stringify({width,height,b})); assert(b.left>=0&&b.right<=width&&b.top>=0&&b.bottom<bounds.cardTop,JSON.stringify({width,height,mesh:b,cardTop:bounds.cardTop})); }
 await page.evaluate(()=>window.__freeze=false);
 // A full mission: countdown, wrong pose, brief hold, slip, recovery, success, result.
 await page.waitForFunction(()=>document.querySelector('#mm-timer')?.textContent!=='준비' && !document.querySelector('#mm-timer')?.textContent.includes('준비'),{timeout:10000});
 await page.waitForTimeout(250);
 assert(!await page.locator('#mm-feedback').textContent().then(t=>t.includes('성공')));
 const before=await page.evaluate(async()=> (await import('/js/puppet.js')).jointWorld());
 await page.evaluate(()=>window.__inputPose='both_up');await page.waitForTimeout(260);
 await page.evaluate(()=>window.__inputPose='neutral');await page.waitForTimeout(150);
 await page.evaluate(()=>window.__inputPose='both_up');
 await page.waitForFunction(()=>document.querySelector('#mm-feedback')?.textContent.includes('성공'),{timeout:3000});
 const after=await page.evaluate(async()=> (await import('/js/puppet.js')).jointWorld());
 assert(Math.abs(after.Lhand.y-before.Lhand.y)>.05,'Picture arm must move');
 await page.waitForFunction(()=>document.querySelector('#mm-result')?.style.display!=='none',{timeout:5000});
 assert.match(await page.locator('#mm-result-score').textContent(), /1개 성공/);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fas_mission_stats_v1')).both_up.success),1);

 assert.deepEqual(errors,[]);
 results.push({width,height,bounds,poseBounds,mission:'success',pageErrors:errors});await page.close();
}
await writeFile(resolve(out,'avatar-regression.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
