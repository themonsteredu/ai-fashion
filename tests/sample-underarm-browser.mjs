// Exercises the bundled picture, real skinning, and the per-arm cleanup in WebGL.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const mime = { '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(`<style>body{margin:0;background:#f4f1ed}</style><div id="stage"></div><script type="importmap">{"imports":{"three":"/lib/three.module.min.js","three/addons/":"/lib/three/addons/","@pixiv/three-vrm":"/lib/three-vrm.module.min.js"}}</script>`);
      return;
    }
    const path = resolve(root, '.' + pathname);
    if (!path.startsWith(root + '/')) throw Error('invalid path');
    res.setHeader('content-type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const A = await import('/js/avatar.js'), P = await import('/js/puppet.js');
    await A.initStage(document.querySelector('#stage'));
    await A.loadAvatar();
    await P.activateDefault();
    A.setFraming('preview');
    A.state.camera.position.set(0, 1.25, 2.65);
    A.state.camera.lookAt(0, 1.25, 0);
    A.state.camera.updateProjectionMatrix();
    const draw = () => A.state.renderer.render(A.state.scene, A.state.camera);
    draw();
    let picture;
    A.state.scene.traverse(o => { if (o.isSkinnedMesh && o.renderOrder === 10) picture = o; });
    if (!picture || !Array.isArray(picture.material)) throw Error('Sample cleanup material missing');
    const u = picture.material[0].userData.underarmCleanup;
    if (!u) throw Error('Sample cleanup uniforms missing');
    const rest = [u.leftLift.value, u.rightLift.value];
    for (let i = 0; i < 100; i++) {
      A.applyDemoPose([['leftUpperArm', [0, 0, 1], .8], ['rightUpperArm', [0, 0, 1], -.8]], 1 / 60);
      A.state.vrm.update(1 / 60); P.update(1 / 60, true);
    }
    draw();
    const lifted = [u.leftLift.value, u.rightLift.value];
    const gl = A.state.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const read = () => { const p = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    const corrected = read();
    const correctedPng = A.state.renderer.domElement.toDataURL('image/png');
    u.leftLift.value = u.rightLift.value = 0; draw();
    const uncorrected = read();
    const uncorrectedPng = A.state.renderer.domElement.toDataURL('image/png');
    let changed = 0;
    for (let i = 0; i < corrected.length; i += 4) if (corrected[i] !== uncorrected[i] || corrected[i + 1] !== uncorrected[i + 1] || corrected[i + 2] !== uncorrected[i + 2] || corrected[i + 3] !== uncorrected[i + 3]) changed++;
    const oneAtATime = [];
    for (const [left, right] of [[.8, 1.18], [-1.18, -.8]]) {
      for (let i = 0; i < 100; i++) {
        A.applyDemoPose([['leftUpperArm', [0, 0, 1], left], ['rightUpperArm', [0, 0, 1], right]], 1 / 60);
        A.state.vrm.update(1 / 60); P.update(1 / 60, true);
      }
      oneAtATime.push([u.leftLift.value, u.rightLift.value]);
    }
    P.deactivate();
    return { rest, lifted, oneAtATime, changed, mode: P.getMode(), correctedPng, uncorrectedPng };
  });
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  for (const [name, data] of [['sample-underarm-after.png', result.correctedPng], ['sample-underarm-before.png', result.uncorrectedPng]]) {
    await writeFile(resolve(root, 'test-results', name), Buffer.from(data.split(',')[1], 'base64'));
  }
  delete result.correctedPng; delete result.uncorrectedPng;
  assert.deepEqual(result.rest, [0, 0]);
  assert(result.lifted.every(v => v > .9), JSON.stringify(result));
  assert(result.oneAtATime.every(pair => Math.max(...pair) > .9 && Math.min(...pair) < .05), JSON.stringify(result));
  assert.notEqual(result.oneAtATime[0][0] > .9, result.oneAtATime[1][0] > .9, JSON.stringify(result));
  assert(result.changed > 20, JSON.stringify(result));
  assert.equal(result.mode, null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
