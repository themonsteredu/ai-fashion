import * as THREE from 'three';

// A quiet studio set: all scenery is rendered into the recorded avatar canvas.
export function createScenery(scene){
  const group=new THREE.Group(),resources=[];
  const material=(color,roughness=.85)=>{const m=new THREE.MeshStandardMaterial({color,roughness});resources.push(m);return m;};
  const mesh=(geometry,mat,x,y,z)=>{resources.push(geometry);const obj=new THREE.Mesh(geometry,mat);obj.position.set(x,y,z);obj.receiveShadow=true;group.add(obj);return obj;};
  const backdrop=document.createElement('canvas');backdrop.width=32;backdrop.height=512;
  const ctx=backdrop.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,512);
  gradient.addColorStop(0,'#e6eee8');gradient.addColorStop(.58,'#f5f1e7');gradient.addColorStop(1,'#e6ddd0');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,32,512);
  const texture=new THREE.CanvasTexture(backdrop);texture.colorSpace=THREE.SRGBColorSpace;resources.push(texture);
  scene.background=texture;scene.fog=new THREE.Fog('#eee9de',6,15);
  const ground=mesh(new THREE.PlaneGeometry(40,40),material('#e7ded0'),0,-.035,0);ground.rotation.x=-Math.PI/2;
  const platform=mesh(new THREE.CylinderGeometry(1.05,1.10,.055,64),material('#f8f5ed'),0,-.004,0);
  platform.castShadow=true;
  // Broad arch in the rear wall gives depth without distracting from the pose.
  const arch=new THREE.Shape();
  arch.moveTo(-1.12,0);arch.lineTo(-1.12,1.78);arch.absarc(0,1.78,1.12,Math.PI,0,true);arch.lineTo(1.12,0);arch.lineTo(.91,0);arch.lineTo(.91,1.78);arch.absarc(0,1.78,.91,0,Math.PI,false);arch.lineTo(-.91,0);arch.closePath();
  const archMesh=mesh(new THREE.ExtrudeGeometry(arch,{depth:.12,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.025,bevelThickness:.025,curveSegments:40}),material('#c8d9cb'),0,0,-1.12);
  archMesh.castShadow=true;
  const peach=material('#dcc4b0'),sage=material('#b2c7b8');
  for(const [x,h,mat] of [[-1.65,.65,peach],[1.62,1.05,sage]]){
    const pedestal=mesh(new THREE.CylinderGeometry(.24,.24,h,40),mat,x,h/2-.035,-.9);pedestal.castShadow=true;
    const orb=mesh(new THREE.SphereGeometry(.17,24,16),material('#f4ead9'),x,h+.14,-.9);orb.castShadow=true;
  }
  const rim=new THREE.DirectionalLight(0xffedd3,.7);rim.position.set(0,3,-2);group.add(rim);
  scene.add(group);
  return ()=>{scene.remove(group);scene.background=null;scene.fog=null;for(const resource of resources)resource.dispose();};
}
