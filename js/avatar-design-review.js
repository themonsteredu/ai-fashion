import * as THREE from '../lib/three.module.min.js';
import {GLTFLoader} from '../lib/three/addons/loaders/GLTFLoader.js';
import {createKidRig} from './kid-rig.js';
const $=id=>document.getElementById(id),stage=$('stage'),scene=new THREE.Scene();
scene.background=new THREE.Color('#fffefa');
const camera=new THREE.PerspectiveCamera(32,1,.01,50);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;stage.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0xadc2c1,2.2));
for(const [x,y,z,power] of [[-3,5,4,2.4],[3,2,2,.7]]){const l=new THREE.DirectionalLight(0xffffff,power);l.position.set(x,y,z);scene.add(l);}
let rig=null,model=null,request=0,kind='boy',config,rotating=false,angle=0;
const target=new THREE.Vector3(0,.72,0);
function view(){const zoom=+$('zoom').value,aspect=stage.clientWidth/stage.clientHeight;camera.aspect=aspect;camera.updateProjectionMatrix();const distance=Math.max(2.9,.55/(Math.tan(16*Math.PI/180)*aspect))/zoom;const a=+$('view').value;camera.position.set(Math.sin(a)*distance,.77+(zoom-1)*.19,Math.cos(a)*distance);camera.lookAt(0,.72+(zoom-1)*.22,0);}
new ResizeObserver(()=>{renderer.setSize(stage.clientWidth,stage.clientHeight,false);view();}).observe(stage);
function dispose(obj){obj.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of [].concat(o.material)){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}}});}
async function select(next){
kind=next;const token=++request;
document.querySelectorAll('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));
$('reference').src='./assets/kids/approved/'+kind+'-front.png';$('reference').alt=(kind==='boy'?'남학생':'여학생')+' 전신 기준 디자인';
$('download').hidden=true;if(model){scene.remove(model);dispose(model);model=null;rig=null;}
const entry=config?.[kind];if(!entry?.model){$('status').textContent='3D 모델 준비 중';return;}
$('status').textContent='실제 3D 모델을 불러오고 있어요.';
try{const gltf=await new GLTFLoader().loadAsync(entry.model);if(token!==request){dispose(gltf.scene);return;}rig=entry.rigged?createKidRig(gltf.scene):null;model=rig?rig.scene:gltf.scene;
$('pose').disabled=!rig;
const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),scale=1.45/size.y;
model.scale.multiplyScalar(scale);model.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);const wrapper=new THREE.Group();wrapper.add(model);model=wrapper;scene.add(model);
$('status').textContent=entry.status||'외형 확인용 · 관절 연결 전';$('download').href=entry.model;$('download').hidden=false;view();
}catch(e){$('status').textContent='모델을 불러오지 못했어요. 새로고침해 주세요.';console.error(e);}}
document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>select(b.dataset.kind));
$('pose').onchange=()=>{rig?.reset();};$('view').onchange=view;$('zoom').oninput=view;$('rotate').onclick=()=>{rotating=!rotating;$('rotate').setAttribute('aria-pressed',String(rotating));$('rotate').textContent=rotating?'회전 멈추기':'천천히 돌려 보기';};
let last=0;renderer.setAnimationLoop(t=>{if(rig&&$('pose').value!=='still')rig.demo(t/1000,$('pose').value);if(model&&rotating)model.rotation.y+=(t-last)*.0003;last=t;renderer.render(scene,camera);});
try{config=await (await fetch('./assets/kids/approved/models.json',{cache:'no-store'})).json();await select(kind);}catch(e){$('status').textContent='모델 정보를 불러오지 못했어요.';}

