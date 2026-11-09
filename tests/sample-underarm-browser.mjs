// Exercises the bundled picture, real skinning, and its raised-sleeve correction in WebGL.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const mime = { '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
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
  await page.goto(`http://127.0.0.1:${server.address().port}/?avatar=picture`);
  const result = await page.evaluate(async () => {
    const [A, P, { DEMO }] = await Promise.all([
      import('/js/avatar.js'), import('/js/puppet.js'), import('/js/missionvisuals.js'),
    ]);
    await A.initStage(document.querySelector('#stage'));
    await A.loadAvatar();
    await P.activateDefault();
    A.setFraming('preview');
    A.state.camera.position.set(0, 1.25, 3.1);
    A.state.camera.lookAt(0, 1.25, 0);
    A.state.camera.updateProjectionMatrix();
    const draw = () => A.state.renderer.render(A.state.scene, A.state.camera);
    draw();
    let picture;
    A.state.scene.traverse(o => { if (o.isSkinnedMesh && o.renderOrder === 10) picture = o; });
    if (!picture || !Array.isArray(picture.material)) throw Error('Sample cleanup material missing');
    const body = picture.material[0].userData.underarmCleanup;
    if (!body) throw Error('Sample cleanup uniforms missing');
    const sides = ['L', 'R'];
    const sleeves = sides.map(side => A.state.scene.getObjectByName(`sample-raised-sleeve-${side}`));
    if (sleeves.some(sleeve => !sleeve?.isMesh)) throw Error('Raised sleeve meshes missing');
    const opacity = () => sleeves.map(sleeve => sleeve.visible ? sleeve.material.opacity : 0);
    const bodyLift = () => [body.leftLift.value, body.rightLift.value];
    const step = spec => {
      A.applyDemoPose(P.flattenDemo(spec), 1 / 60);
      A.state.vrm.update(1 / 60);
      P.update(1 / 60, true);
    };
    const settle = spec => {
      for (let frame = 0; frame < 100; frame++) step(spec);
      draw();
    };
    const gl = A.state.renderer.getContext();
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
    const read = () => {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const png = () => A.state.renderer.domElement.toDataURL('image/png');
    const diff = (after, before) => {
      const changed = { left: 0, right: 0 };
      for (let i = 0; i < after.length; i += 4) {
        const difference = Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1])
          + Math.abs(after[i + 2] - before[i + 2]) + Math.abs(after[i + 3] - before[i + 3]);
        if (difference > 4) changed[i / 4 % width < width / 2 ? 'left' : 'right']++;
      }
      return changed;
    };
    const images = { 'rest': png() };
    const rest = { sleeves: opacity(), body: bodyLift() };
    const overhead = [];
    for (const id of ['left_up', 'right_up', 'both_up']) {
      settle(DEMO[id]);
      images[`${id}-after`] = png();
      const after = read();
      const active = opacity();
      const visible = sleeves.map(sleeve => sleeve.visible);
      sleeves.forEach(sleeve => { sleeve.visible = false; });
      draw();
      images[`${id}-before`] = png();
      const changed = diff(after, read());
      sleeves.forEach((sleeve, index) => { sleeve.visible = visible[index]; });
      const joints = P.jointWorld();
      const raised = sides.map(side => {
        const upper = joints[`${side}upperArm`], lower = joints[`${side}lowerArm`];
        return lower.y - upper.y > .75 * Math.hypot(lower.x - upper.x, lower.y - upper.y);
      });
      overhead.push({ id, active, raised, changed });
    }
    // Keep the earlier regression for stray sleeve pixels on the torso.
    settle(DEMO.both_diag_up);
    const lifted = bodyLift();
    const cleaned = read();
    body.leftLift.value = body.rightLift.value = 0;
    draw();
    const bodyChanged = diff(cleaned, read());

    settle(DEMO.both_side);
    images.side = png();
    const side = opacity();
    const transition = [];
    let middle = Infinity;
    for (let frame = 0; frame < 100; frame++) {
      step(DEMO.left_up);
      const weight = Math.max(...opacity());
      transition.push(weight);
      const distance = Math.abs(weight - .5);
      if (distance < middle) {
        middle = distance;
        draw();
        images.transition = png();
      }
    }
    settle(DEMO.attention);
    const lowered = opacity();
    images.lowered = png();
    P.deactivate();
    return { rest, overhead, lifted, bodyChanged, side, transition, lowered, mode: P.getMode(), images };
  });
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  for (const [name, data] of Object.entries(result.images)) {
    await writeFile(resolve(root, 'test-results', `sample-underarm-${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  delete result.images;
  assert.deepEqual(result.rest, { sleeves: [0, 0], body: [0, 0] });
  for (const { id, active, raised, changed } of result.overhead) {
    const expectedCount = id === 'both_up' ? 2 : 1;
    assert.equal(raised.filter(Boolean).length, expectedCount, `${id} should actually raise its arm overhead`);
    assert.deepEqual(active.map(weight => weight > .9), raised, `${id} sleeve correction on the wrong arm`);
    assert(active.every((weight, index) => raised[index] || weight < .01), `${id} changed the lowered sleeve`);
    const minimumVisiblePixels = 20;
    assert.equal(changed.right > minimumVisiblePixels, raised[0], `${id} right-side pixels: ${changed.right}`);
    assert.equal(changed.left > minimumVisiblePixels, raised[1], `${id} left-side pixels: ${changed.left}`);
  }
  assert.notDeepEqual(result.overhead[0].raised, result.overhead[1].raised);
  assert(result.lifted.every(v => v > .9), JSON.stringify(result));
  assert(result.bodyChanged.left + result.bodyChanged.right > 20, JSON.stringify(result));
  assert(result.side.every(weight => weight < .01), JSON.stringify(result));
  assert(result.transition.some(weight => weight > .05 && weight < .9), 'Sleeve should fade in as the arm rises');
  assert(result.lowered.every(weight => weight < .01), JSON.stringify(result));
  assert.equal(result.mode, null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
