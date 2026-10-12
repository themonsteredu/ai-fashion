// 시연용 가상 카메라: 실제 사람 대신 3D 모델(sample_avatar.vrm)을 렌더링해 웹캠 스트림으로 공급한다.
// 앱 코드는 수정하지 않고, 녹화용 브라우저에서만 getUserMedia를 대체한다.
(() => {
  const W = 960, H = 720;
  const S = window.__standin = { mode: 'auto', script: null, t0: 0 };
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let ready = null;
  async function build() {
    const THREE = await import('/lib/three.module.min.js');
    const { GLTFLoader } = await import('/lib/three/addons/loaders/GLTFLoader.js');
    const { VRMLoaderPlugin, VRMUtils } = await import('/lib/three-vrm.module.min.js');
    const { POSE_DEFS } = await import('/js/poses.js');
    const { DEMO } = await import('/js/missionvisuals.js');
    const byName = Object.fromEntries(POSE_DEFS.map(p => [p.name, p.id]));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false); r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    // 교실 벽 느낌 배경
    const bg = document.createElement('canvas'); bg.width = 16; bg.height = 256; const g = bg.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#cfd6de'); gr.addColorStop(0.62, '#e4e7ea'); gr.addColorStop(0.63, '#b9ada0'); gr.addColorStop(1, '#a89a8b');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 256); scene.background = new THREE.CanvasTexture(bg); scene.background.colorSpace = THREE.SRGBColorSpace;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc6ba, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-1, 2.5, 3); scene.add(key);
    const cam = new THREE.PerspectiveCamera(34, W / H, 0.1, 20); cam.position.set(0, 0.86, 3.9); cam.lookAt(0, 0.82, 0);
    const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync('/sample_avatar.vrm');
    const vrm = gltf.userData.vrm; VRMUtils.rotateVRM0(vrm); scene.add(vrm.scene);
    vrm.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const h = vrm.humanoid;
    const BONES = ['leftUpperArm','leftLowerArm','rightUpperArm','rightLowerArm','spine','chest','neck','head','leftUpperLeg','leftLowerLeg','rightUpperLeg','rightLowerLeg'];
    const drop = THREE.MathUtils.degToRad(68);
    const neutral = n => n === 'leftUpperArm' ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), -drop)
      : n === 'rightUpperArm' ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), drop) : new THREE.Quaternion();
    let spec = [], wave = null, sway = 0;
    S.setPose = (id) => { spec = id ? (DEMO[id] || []) : []; wave = /wave|cheer/.test(id || '') ? id : null; sway = id === 'sway' ? 1 : 0; S.cur = id; };
    const stream = cv.captureStream(30);
    let last = performance.now();
    function frame() {
      requestAnimationFrame(frame);
      const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
      // 미션 화면이면 제시된 포즈를 약간 늦게 따라 한다 (학생처럼)
      if (S.mode === 'auto') {
        const title = document.querySelector('#mm-title');
        const root = document.querySelector('#mission-root');
        const card = document.querySelector('#mm-card');
        const onMission = root && !root.classList.contains('hidden') && title && card && card.style.display !== 'none';
        const phase = onMission ? card.dataset.phase : null;
        const id = onMission && (phase === 'playing' || phase === 'success') ? byName[title.textContent.trim()] : null;
        if (id !== S.target) { S.target = id; S.since = now; }
        const want = (S.target && now - S.since > (S.delay ?? 500)) ? S.target : null;
        if (want !== S.cur) S.setPose(want);
      } else if (S.script) {
        const t = (now - S.t0) / 1000; let id = null;
        for (const [at, pid] of S.script) if (t >= at) id = pid;
        if (id !== S.cur) S.setPose(id);
      }
      const tg = {};
      for (const [b, ax, a] of spec) tg[b] = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax), a);
      const tt = now / 1000;
      if (wave) {
        for (const side of ['left', 'right']) {
          if (!tg[side + 'UpperArm']) continue;
          const s = side === 'left' ? 1 : -1;
          tg[side + 'LowerArm'] = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), s * (0.35 + 0.35 * Math.sin(tt * 7)));
        }
      }
      if (sway) tg.spine = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), 0.22 * Math.sin(tt * 2.5));
      const k = 1 - Math.exp(-dt * 7);
      for (const n of BONES) { const node = h.getNormalizedBoneNode(n); if (node) node.quaternion.slerp(tg[n] || neutral(n), k); }
      vrm.update(dt); r.render(scene, cam);
    }
    frame();
    return stream;
  }
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.video) return orig(c);
    if (!ready) ready = build();
    const s = await ready;
    return new MediaStream(s.getVideoTracks().map(t => t.clone()));
  };
})();
