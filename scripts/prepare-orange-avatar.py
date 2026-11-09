"""Blender 4.3 + VRM Add-on 4.10: normalize the generated rig for the web.
blender -b --python scripts/prepare-orange-avatar.py -- INPUT.glb OUTPUT.vrm SOURCE.blend
The source GLB is recorded in docs/orange-avatar-3d.md. No API calls here.
"""
import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector,Matrix
source,out,blend=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module='VRM_Addon_for_Blender-release')
bpy.ops.import_scene.gltf(filepath=source)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
for o in list(bpy.context.scene.objects):
 if o!=arm and o not in meshes:bpy.data.objects.remove(o,do_unlink=True)
for o in [arm,*meshes]:o.animation_data_clear()
bpy.context.view_layer.objects.active=arm
bpy.ops.object.select_all(action='DESELECT')
for o in [arm,*meshes]:o.select_set(True)
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
# The generator produces one continuous garment/body surface. Auto-rigging assigns
# the orange vest sides to the arms; correct that using the original UV colour
# and torso region BEFORE baking the T-pose so no distorted rest geometry remains.
import numpy as np
image=bpy.data.images.get('texture_pbr_20250901')
pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
pixels=pixels.reshape(image.size[1],image.size[0],4)
corrected=0
spines=[('Hips',.84),('Spine02',.925),('Spine01',1.008),('Spine',1.094)]
for obj in meshes:
 orange=set();uv=obj.data.uv_layers.active.data
 for loop in obj.data.loops:
  u,v=uv[loop.index].uv
  r,g,b,_=pixels[int(v*(image.size[1]-1))%image.size[1],int(u*(image.size[0]-1))%image.size[0]]
  if r>.22 and r>g*1.38 and g>b*1.22:orange.add(loop.vertex_index)
 for v in obj.data.vertices:
  pos=obj.matrix_world@v.co;x,z=abs(pos.x),pos.z
  if not (.76<z<1.14 and x<.27):continue
  if v.index not in orange and not (x<.125 and z<1.08):continue
  strength=max(0,min(1,(1.14-z)/.055))
  old={obj.vertex_groups[g.group].name:g.weight for g in v.groups}
  target={}
  for (a,za),(b,zb) in zip(spines,spines[1:]):
   if za<=z<=zb:
    t=(z-za)/(zb-za);target={a:1-t,b:t};break
  if not target:target={spines[0][0] if z<spines[0][1] else spines[-1][0]:1}
  for name in set(old)|set(target):
   value=old.get(name,0)*(1-strength)+target.get(name,0)*strength
   vg=obj.vertex_groups.get(name)
   if vg:
    if value>.00001:vg.add([v.index],value,'REPLACE')
    else:vg.remove([v.index])
  corrected+=1
 # Sleeve/upper-arm surfaces must rotate with the humerus, rather than being
 # stretched between the chest and elbow by the automatic weights.
 for v in obj.data.vertices:
  pos=obj.matrix_world@v.co
  if v.index in orange or not (.86<pos.z<1.16 and abs(pos.x)>.14):continue
  side='Left' if pos.x>0 else 'Right'
  a=arm.matrix_world@arm.data.bones[side+'Arm'].head_local
  e=arm.matrix_world@arm.data.bones[side+'ForeArm'].head_local
  axis=e-a;length=axis.length;axis.normalize();t=(pos-a).dot(axis)/length
  radial=(pos-a-axis*((pos-a).dot(axis))).length
  if not (.03<t<1.18 and radial<.095):continue
  shoulder=max(0,min(.45,(.30-t)*1.4))
  lower=max(0,min(1,(t-.82)/.35))
  target={side+'Shoulder':shoulder,side+'Arm':(1-shoulder)*(1-lower),side+'ForeArm':(1-shoulder)*lower}
  strength=max(0,min(1,(abs(pos.x)-.14)/.035))
  old={obj.vertex_groups[g.group].name:g.weight for g in v.groups}
  for name in set(old)|set(target):
   value=old.get(name,0)*(1-strength)+target.get(name,0)*strength
   vg=obj.vertex_groups.get(name)
   if vg:
    if value>.00001:vg.add([v.index],value,'REPLACE')
    else:vg.remove([v.index])
# Smooth the corrected seam over real topology, joining UV-duplicate positions.
# Otherwise a dark underside vertex can retain an arm weight beside a torso vertex.
for obj in meshes:
 verts=obj.data.vertices;groups=obj.vertex_groups
 keys={};vkeys=[]
 for v in verts:
  key=tuple(round(c,5) for c in v.co);vkeys.append(key);keys.setdefault(key,[]).append(v.index)
 neighbors={k:set() for k in keys}
 for e in obj.data.edges:
  a,b=(vkeys[i] for i in e.vertices)
  if a!=b:neighbors[a].add(b);neighbors[b].add(a)
 weights={k:{} for k in keys}
 for k,ids in keys.items():
  for i in ids:
   for g in verts[i].groups:weights[k][g.group]=weights[k].get(g.group,0)+g.weight/len(ids)
 for _ in range(16):
  nxt=dict(weights)
  for k,ns in neighbors.items():
   if not ns or not (.78<k[2]<1.16 and abs(k[0])<.32):continue
   avg={}
   for n in ns:
    for g,w in weights[n].items():avg[g]=avg.get(g,0)+w/len(ns)
   nxt[k]={g:.35*weights[k].get(g,0)+.65*avg.get(g,0) for g in set(weights[k])|set(avg)}
  weights=nxt
 for k,ids in keys.items():
  if not (.78<k[2]<1.16 and abs(k[0])<.32):continue
  ws=sorted(weights[k].items(),key=lambda p:-p[1])[:4];total=sum(w for _,w in ws)
  for i in ids:
   for g in list(verts[i].groups):groups[g.group].remove([i])
  for g,w in ws:groups[g].add(ids,w/total,'REPLACE')

print('VEST_WEIGHTS_CORRECTED',corrected)
del pixels

# Correct the imported FBX-style display tail lengths without changing joint pivots.
bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='EDIT')
for b in arm.data.edit_bones:
 length=min((c.head-b.head).length for c in b.children) if b.children else .04
 b.length=max(.015,length)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
foot_rot={s:arm.pose.bones[s+'Foot'].matrix.to_quaternion() for s in ('Left','Right')}
def aim(name,next_name,goal):
 pb=arm.pose.bones[name]
 v=arm.pose.bones[next_name].head-pb.head
 q=v.normalized().rotation_difference(Vector(goal))
 p=pb.head.copy();pb.matrix=Matrix.Translation(p)@q.to_matrix().to_4x4()@Matrix.Translation(-p)@pb.matrix
 bpy.context.view_layer.update()
for side,sign in [('Left',1),('Right',-1)]:
 aim(side+'Arm',side+'ForeArm',(sign,0,0))
 aim(side+'ForeArm',side+'Hand',(sign,0,0))
 # Keep hands straight with the forearm. No invented finger joints.
 hand=arm.pose.bones[side+'Hand'];r=arm.pose.bones[side+'ForeArm'].matrix.to_quaternion()
 hand.matrix=Matrix.LocRotScale(hand.head.copy(),r,Vector((1,1,1)))
 bpy.context.view_layer.update()
 aim(side+'UpLeg',side+'Leg',(0,0,-1))
 aim(side+'Leg',side+'Foot',(0,0,-1))
 foot=arm.pose.bones[side+'Foot'];foot.matrix=Matrix.LocRotScale(foot.head.copy(),foot_rot[side],Vector((1,1,1)))
 bpy.context.view_layer.update()
# Bake the A→T change into the mesh and rest skeleton, leaving web-compatible LBS.
for obj in meshes:
 bpy.context.view_layer.objects.active=obj
 for mod in list(obj.modifiers):
  if mod.type=='ARMATURE':bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.armature_apply(selected=False);bpy.ops.object.mode_set(mode='OBJECT')
for obj in meshes:
 mod=obj.modifiers.new('Humanoid skin','ARMATURE');mod.object=arm;mod.use_deform_preserve_volume=False
 for p in obj.data.polygons:p.use_smooth=True
 bpy.context.view_layer.objects.active=obj
 bpy.ops.object.vertex_group_limit_total(limit=4)
 bpy.ops.object.vertex_group_normalize_all(lock_active=False)
# Put the soles on the ground; retain the generated child proportions.
bpy.context.view_layer.update()
zmin=min((o.matrix_world@v.co).z for o in meshes for v in o.data.vertices)
arm.location.z-=zmin
bpy.context.view_layer.update()
# VRM 1.0 uses +Y-up/+Z-front after Blender's coordinate conversion.
ext=arm.data.vrm_addon_extension;ext.spec_version='1.0'
h=ext.vrm1.humanoid.human_bones
mapping={'hips':'Hips','spine':'Spine02','chest':'Spine01','upper_chest':'Spine','neck':'neck','head':'Head'}
for s in ('left','right'):
 S=s.capitalize()
 for key,name in [('shoulder','Shoulder'),('upper_arm','Arm'),('lower_arm','ForeArm'),('hand','Hand'),('upper_leg','UpLeg'),('lower_leg','Leg'),('foot','Foot'),('toes','ToeBase')]:mapping[s+'_'+key]=S+name
for name,bone in mapping.items():getattr(h,name).node.bone_name=bone
meta=ext.vrm1.meta;meta.vrm_name='Orange Boy';meta.version='1.0';meta.authors.add().value='MOAKIT'
meta.references.add().value='https://github.com/themonsteredu/ai-fashion'
meta.avatar_permission='onlyAuthor';meta.commercial_usage='corporation';meta.credit_notation='unnecessary';meta.modification='allowModification'
# Reduce texture bandwidth, retaining the generated UVs and surface detail.
texture_dir=Path(blend).parent/'textures';texture_dir.mkdir(parents=True,exist_ok=True)
for im in list(bpy.data.images):
 if not im.size[0]:continue
 size=2048 if im.name=='texture_pbr_20250901' else 1024
 if max(im.size)>size:im.scale(size,size)
 im.file_format='JPEG';im.filepath_raw=str(texture_dir/(im.name+'.jpg'));im.save();im.pack()
for obj in meshes:
 for mat in obj.data.materials:
  if not mat or not mat.use_nodes:continue
  for n in mat.node_tree.nodes:
   if n.type=='BSDF_PRINCIPLED':
    n.inputs['Specular IOR Level'].default_value=.25
    n.inputs['Metallic'].default_value=0
# Keep an editable source; no cameras/lights in the shipped avatar.
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(Path(blend).resolve()),compress=True)
result=bpy.ops.export_scene.vrm(filepath=str(Path(out).resolve()),armature_object_name=arm.name,ignore_warning=True,export_all_influences=False)
if result!={'FINISHED'}:raise RuntimeError(str(result))
print('EXPORT_OK',out,'bytes',Path(out).stat().st_size,'bones',mapping)
