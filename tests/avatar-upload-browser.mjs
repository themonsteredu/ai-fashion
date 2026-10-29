// Browser regression for local upload, upper-body rigs and explicit AI preparation.
// The fake image service returns a local fixture and never sends a paid request.
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const out=resolve(root,'test-results');await mkdir(out,{recursive:true});
const fixture=process.env.AVATAR_FIXTURE || resolve(root,'character.png');
const fixtureBytes=await readFile(fixture);
const inputFixture=process.env.UPLOAD_FIXTURE || fixture;
const expectInitialStandee=process.env.EXPECT_SOURCE_STANDEE === '1';
const mimes={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const path=resolve(root,'.'+pathname.replace(/\/$/,'/index.html'));
 if(!path.startsWith(root+'/'))throw Error('path');
 res.setHeader('Content-Type',mimes[extname(path)]||'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let generateRequests=0;
 await page.route('**/functions/v1/ai-fashion-api**',async route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  if(action==='status')return route.fulfill({json:{configured:true,registered:true}});
  if(action==='generate'){assert.match(route.request().postData(),/name=\"purpose\"[\s\S]*?prepare/);generateRequests++;return route.fulfill({json:{data:[{b64_json:fixtureBytes.toString('base64')}]}});}
  return route.fulfill({status:400,json:{error:{code:'invalid'}}});
 });
 await page.route('**/js/main.js',async route=>{
  let source=await readFile(resolve(root,'js/main.js'),'utf8');
  source=source.replace("import * as Motion from './motion.js';",`import * as RealMotion from './motion.js';
  const Motion={...RealMotion,initTrackers:async()=>{},startCamera:async()=>{},detect:()=>{}};`);
  source=source.replace('CamBG.init().catch','Promise.resolve().catch');
  return route.fulfill({body:source,contentType:'text/javascript'});
 });
 // Avoid external font requests in the restricted test environment.
 if(process.env.FONT_DIR)await page.route('https://cdn.jsdelivr.net/**',async route=>{
  const filename=new URL(route.request().url()).pathname.split('/').pop();
  return route.fulfill({body:await readFile(resolve(process.env.FONT_DIR,filename)),contentType:'font/woff'});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>document.querySelector('#loading').classList.contains('hidden'),{timeout:60000});
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.click('#btn-upload-direct')]);
 await chooser.setFiles(inputFixture);
 // If the detector genuinely cannot place arms, no silent fabricated joints.
 await page.waitForFunction(()=>document.body.classList.contains('preview-on')||document.querySelector('dialog[aria-label="아바타 관절 맞추기"]')?.open,{timeout:60000});
 const correction=page.locator('dialog[aria-label="아바타 관절 맞추기"]');
 if(await correction.isVisible())await correction.locator('[data-apply]').click();
 await page.waitForFunction(()=>document.body.classList.contains('preview-on'),{timeout:60000});
 const info=await page.evaluate(async()=>{const p=await import('/js/puppet.js'),a=await import('/js/avatar.js');let caps=0;a.state.scene.traverse(o=>{if(o.isMesh&&o.renderOrder===9)caps++;});return {mode:p.getMode(),joints:p.jointWorld(),caps};});
 if (expectInitialStandee) {
   assert.equal(info.mode,'standee','overlapping sleeves must preserve their source before preparation');
   assert.equal(info.caps,0);
 } else {
   assert.notEqual(info.mode,'standee','prepared fixture should have independently moving arms');
   assert(info.joints?.Lhand && info.joints?.Rhand);
   assert.equal(info.caps,0,'joints bend as one continuous skin; no separate patch meshes are pasted behind them');
   await page.waitForTimeout(1000);
   const later=await page.evaluate(async()=>{const p=await import('/js/puppet.js');return p.jointWorld();});
   assert(Math.hypot(later.Lhand.x-info.joints.Lhand.x,later.Lhand.y-info.joints.Lhand.y)>.003,'automatic preview must visibly move an arm');
 }
 assert.equal(generateRequests,0,'direct upload must not make a paid request');
 await page.screenshot({path:resolve(out,'avatar-upload-preview.png')});
 await page.click('#btn-home-3');
 await page.click('#btn-saved-avatars');
 const button=page.locator('.saved-avatar-actions button').filter({hasText:'AI 자세 보완'}).first();
 await button.waitFor({state:'visible'});
 await page.setViewportSize({width:390,height:844});
 const box=await button.boundingBox();
 assert(box && box.x >= 0 && box.x + box.width <= 390, 'AI preparation control must fit a mobile viewport');
 await page.screenshot({path:resolve(out,'avatar-library-mobile.png')});
 await page.setViewportSize({width:1366,height:768});
 assert.match(await page.locator('#avatar-library .realify-description').innerText(),/API 사용료/);
 assert.equal(generateRequests,0);
 await button.click();
 await page.waitForFunction(()=>!document.querySelector('#realify-apply').disabled,{timeout:60000});
 assert.equal(generateRequests,1,'AI preparation only occurs after clicking its explicit button');
 await page.click('#realify-apply');
 await page.waitForFunction(()=>document.body.classList.contains('preview-on')||document.querySelector('dialog[aria-label="아바타 관절 맞추기"]')?.open,{timeout:60000});
 if(await correction.isVisible())await correction.locator('[data-apply]').click();
 await page.waitForFunction(()=>document.body.classList.contains('preview-on'),{timeout:60000});
 assert.equal(generateRequests,1,'applying the result must not regenerate it');
 const preparedMode=await page.evaluate(async()=> (await import('/js/puppet.js')).getMode());
 assert.notEqual(preparedMode,'standee','prepared result must move its arms');
 const start=await page.evaluate(async()=> (await import('/js/puppet.js')).jointWorld());
 await page.waitForTimeout(900);
 const end=await page.evaluate(async()=> (await import('/js/puppet.js')).jointWorld());
 assert(Math.hypot(end.Lhand.x-start.Lhand.x,end.Lhand.y-start.Lhand.y)>.003,'prepared avatar must move its arm');
 await page.screenshot({path:resolve(out,'avatar-after-preparation.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({mode:info.mode,preparedMode,requestsAfterPrepare:generateRequests,pageErrors:errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
