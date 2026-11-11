import * as THREE from 'three';

// The approved blue/apricot studio is part of the live and recorded scene.
export function createScenery(scene){
  const group=new THREE.Group(),resources=[];
  const material=color=>{const m=new THREE.MeshStandardMaterial({color,roughness:.9});resources.push(m);return m;};
  const mesh=(geometry,mat,x,y,z)=>{resources.push(geometry);const obj=new THREE.Mesh(geometry,mat);obj.position.set(x,y,z);obj.receiveShadow=true;group.add(obj);return obj;};
  scene.background=new THREE.Color('#2397df');
  const ground=mesh(new THREE.PlaneGeometry(40,40),material('#f8e8d6'),0,.015,0);ground.rotation.x=-Math.PI/2;
  mesh(new THREE.PlaneGeometry(18,12),material('#168ed7'),0,5,-1.6);
  mesh(new THREE.BoxGeometry(.85,8,.12),material('#ffbb79'),-1.9,3.8,-1.45);
  const rim=new THREE.DirectionalLight(0xffe6c9,.55);rim.position.set(1,3,-1);group.add(rim);
  scene.add(group);
  return ()=>{scene.remove(group);scene.background=null;for(const resource of resources)resource.dispose();};
}
