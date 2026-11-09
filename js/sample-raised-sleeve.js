import * as THREE from 'three';

const textureUrl = new URL('../assets/sample-raised-sleeve.png', import.meta.url);
// The texture is a crop aligned to the original 1024×1536 sample at this pose.
const reference = { x: 583, y: 236, width: 144, height: 184, lift: 2.6 };

export async function loadSampleSleeveImage() {
  const image = new Image();
  image.src = textureUrl.href;
  try {
    await image.decode();
    return image;
  } catch (error) {
    console.warn('기본 그림의 소매 보정 이미지를 읽지 못했습니다.', error);
    return null;
  }
}

export function attachSampleSleeves(image, prep, toWorld, bones) {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const leftShoulder = bones.LupperArm.userData.restWorld;
  const normal = new THREE.Vector3(0, 0, 1);
  const corners = [
    [reference.x, reference.y],
    [reference.x + reference.width, reference.y],
    [reference.x, reference.y + reference.height],
    [reference.x + reference.width, reference.y + reference.height],
  ];
  const offsets = corners.map(([x, y]) => toWorld(prep.toCanvas(x / 1024, y / 1536))
    .sub(leftShoulder).applyAxisAngle(normal, -reference.lift));

  const overlays = ['L', 'R'].map(side => {
    // Flip the shoulder-local offsets so the same white fabric fits the other arm.
    const sign = side === 'L' ? 1 : -1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(
      offsets.flatMap(point => [sign * point.x, point.y, 0]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: 0, alphaTest: 0.01,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const overlay = new THREE.Mesh(geometry, material);
    overlay.name = `sample-raised-sleeve-${side}`;
    overlay.renderOrder = 11;
    overlay.visible = false;
    const bone = bones[`${side}upperArm`];
    bone.add(overlay);
    return { overlay, bone, sign };
  });

  return {
    update() {
      for (const { overlay, bone, sign } of overlays) {
        const lift = sign * Math.atan2(Math.sin(bone.rotation.z), Math.cos(bone.rotation.z));
        const fadeIn = THREE.MathUtils.smoothstep(lift, 1.72, 2.4);
        const fadeOut = THREE.MathUtils.smoothstep(lift, 2.94, Math.PI);
        overlay.material.opacity = fadeIn * (1 - fadeOut);
        overlay.visible = overlay.material.opacity > 0.01;
      }
    },
    dispose() {
      for (const { overlay } of overlays) {
        overlay.removeFromParent();
        overlay.geometry.dispose();
        overlay.material.dispose();
      }
      texture.dispose();
    },
  };
}
