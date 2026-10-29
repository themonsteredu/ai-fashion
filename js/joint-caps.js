// Construct a small overlap around each arm joint using nearby sleeve pixels.
// The patch is behind the picture and follows the same bone as the limb, so
// it fills only gaps exposed while a joint rotates. It never calls an API.
import * as THREE from 'three';

function nearestOpaque(data, w, h, x, y, maxRadius) {
  x = Math.round(x); y = Math.round(y);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const xx=x+dx, yy=y+dy;
      if (xx<0 || yy<0 || xx>=w || yy>=h) continue;
      const p=(yy*w+xx)*4;
      if (data[p+3]>=220) return p;
    }
  }
  return -1;
}

export function createArmJointCaps(prep, definitions, byName, scale) {
  const targets=definitions.filter(b => /^[LR](upperArm|lowerArm)$/.test(b.name));
  if (!targets.length) return [];
  const {w,h}=prep;
  const source=prep.canvas.getContext('2d', {willReadFrequently:true}).getImageData(0,0,w,h).data;
  const result=[];
  for (const def of targets) {
    const bone=byName[def.name];
    const dx=def.tail[0]-def.head[0],dy=def.tail[1]-def.head[1], length=Math.hypot(dx,dy);
    if (!bone || length < h*.025) continue;
    const ux=dx/length,uy=dy/length, radius=Math.max(3,Math.round(Math.min(h*.022,length*.15)));
    const size=radius*2+1, canvas=document.createElement('canvas'); canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d'), image=ctx.createImageData(size,size);
    // Sample from inside this limb rather than the hole that becomes visible
    // after movement. Empty samples borrow the nearest opaque garment pixel.
    const sampleAlong=Math.min(length*.22,radius*1.5);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const ox=x-radius,oy=y-radius, distance=Math.hypot(ox,oy);
      if(distance>radius)continue;
      const sx=def.head[0]+ux*sampleAlong+ox*.55, sy=def.head[1]+uy*sampleAlong+oy*.55;
      const p=nearestOpaque(source,w,h,sx,sy,Math.min(8,radius));
      if(p<0)continue;
      const q=(y*size+x)*4, fade=Math.min(1,(radius-distance)/Math.max(1,radius*.16));
      image.data[q]=source[p];image.data[q+1]=source[p+1];image.data[q+2]=source[p+2];image.data[q+3]=Math.round(source[p+3]*fade);
    }
    ctx.putImageData(image,0,0);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.premultiplyAlpha=true;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.01,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
      blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor});
    const geometry=new THREE.PlaneGeometry(radius*2*scale,radius*2*scale);
    const patch=new THREE.Mesh(geometry,material);patch.renderOrder=9;
    bone.add(patch);result.push({patch,geometry,material,texture});
  }
  return result;
}

export function disposeJointCaps(caps) {
  for(const c of caps || []) {c.patch.removeFromParent();c.geometry.dispose();c.material.dispose();c.texture.dispose();}
}
