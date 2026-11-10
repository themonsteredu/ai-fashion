"""Convert an inspected generated humanoid to the app's T-pose rig.
Finger landmarks are explicitly fitted to front orthographic mesh renders;
never infer that an auto-rig already includes articulated fingers.
Usage: blender -b --python tools/prepare-generated-avatar.py -- input.glb landmarks.json output.glb
"""
import bpy, json, sys, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
args=sys.argv[sys.argv.index('--')+1:]; source, landmark_file, destination=args
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
for o in list(bpy.data.objects):
    if o not in meshes+[rig]:bpy.data.objects.remove(o,do_unlink=True)
rig.animation_data_clear()
for o in meshes+[rig]:
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
mapping={'Hips':'hips','Spine02':'spine','Spine01':'chest','Spine':'upperChest','neck':'neck','Head':'head','head_end':'headEnd','headfront':'headFront'}
for old,new in [('Shoulder','Shoulder'),('Arm','UpperArm'),('ForeArm','LowerArm'),('Hand','Hand'),('UpLeg','UpperLeg'),('Leg','LowerLeg'),('Foot','Foot'),('ToeBase','Toes')]:
    for cap,side in [('Left','left'),('Right','right')]:mapping[cap+old]=side+new
for old,new in mapping.items():
    if old in rig.data.bones:rig.data.bones[old].name=new
for o in meshes:
    for old,new in mapping.items():
        if old in o.vertex_groups:o.vertex_groups[old].name=new
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for b in rig.data.edit_bones:
    children=list(b.children)
    if children:
        preferred=next((c for c in children if not any(s in c.name for s in ['Shoulder','UpperLeg','Front'])),children[0])
        b.tail=preferred.head if (preferred.head-b.head).length>.001 else b.head+Vector((0,0,.025))
    else:b.tail=b.head+Vector((0,0,.025))
bpy.ops.object.mode_set(mode='OBJECT')
config=json.load(open(landmark_file))
mesh=meshes[0];bvh=BVHTree.FromObject(mesh,bpy.context.evaluated_depsgraph_get())
inv=mesh.matrix_world.inverted()
def surface_center(x,z):
    a=inv@Vector((x,-2,z));d=(inv.to_3x3()@Vector((0,1,0))).normalized()
    front=bvh.ray_cast(a,d)[0];back=bvh.ray_cast(inv@Vector((x,2,z)),-d)[0]
    if front is None or back is None:raise ValueError('Finger landmark outside mesh: '+str((x,z)))
    return (mesh.matrix_world@((front+back)/2))
landmarks={}
for side,hand in config.items():
    landmarks[side]={}
    for finger,points in hand['fingers'].items():
        landmarks[side][finger]=[Vector(p) if len(p)==3 else surface_center(hand['center'][0]+(p[0]/hand['pixels']-.5)*hand['scale'],hand['center'][1]+(.5-p[1]/hand['pixels'])*hand['scale']) for p in points]
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
chains={}
for side,fingers in landmarks.items():
    for finger,points in fingers.items():
        joints=['Metacarpal','Proximal','Distal'] if finger=='Thumb' else ['Proximal','Intermediate','Distal']
        names=[side+finger+j for j in joints];chains[(side,finger)]=names
        for i,name in enumerate(names):
            bone=rig.data.edit_bones.new(name);bone.head=rig.matrix_world.inverted()@points[i];bone.tail=rig.matrix_world.inverted()@points[i+1]
            bone.parent=rig.data.edit_bones[names[i-1] if i else side+'Hand'];bone.use_connect=i>0
bpy.ops.object.mode_set(mode='OBJECT')
import bmesh
for obj in meshes:
    # Merge coincident UV seam vertices while retaining per-loop UV coordinates.
    edit=bmesh.new();edit.from_mesh(obj.data);bmesh.ops.remove_doubles(edit,verts=list(edit.verts),dist=.0003)
    bmesh.ops.dissolve_degenerate(edit,edges=list(edit.edges),dist=.00001)
    boundary=[e for e in edit.edges if e.is_boundary];print('BOUNDARY_EDGES '+str(len(boundary)))
    if boundary:bmesh.ops.holes_fill(edit,edges=boundary,sides=12)
    bmesh.ops.recalc_face_normals(edit,faces=list(edit.faces));edit.to_mesh(obj.data);edit.free()
    obj.data.validate(clean_customdata=True);obj.data.update(calc_edges=True);obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
    obj.vertex_groups.clear()
    for mod in list(obj.modifiers):
        if mod.type=='ARMATURE':obj.modifiers.remove(mod)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO',keep_transform=True)
counts={name:0 for names in chains.values() for name in names}
for obj in meshes:
    names={g.index:g.name for g in obj.vertex_groups}
    missing=[v for v in obj.data.vertices if not v.groups];valid=[v for v in obj.data.vertices if v.groups]
    print('BINDING_COVERAGE '+str((len(valid),len(missing))))
    if len(missing)>max(50,len(valid)*.05):raise ValueError('Automatic binding left too many vertices unweighted')
    if missing:
        from mathutils.kdtree import KDTree
        kd=KDTree(len(valid))
        for i,v in enumerate(valid):kd.insert(v.co,i)
        kd.balance()
        for v in missing:
            _,i,d=kd.find(v.co)
            for g in valid[i].groups:obj.vertex_groups[g.group].add([v.index],g.weight,'REPLACE')
    for v in obj.data.vertices:
        if not v.groups:raise ValueError('Unweighted vertex after skin binding')
        for g in v.groups:
            name=names[g.group]
            if name in counts and g.weight>.05:counts[name]+=1
for name,n in counts.items():
    if n<8:raise ValueError('Insufficient finger skin binding: '+name)

# Rotate the authored A-pose into the canonical T-pose expected by motion.js.
rest={b.name:b.matrix_local.copy() for b in rig.data.bones}
positions={b.name:rig.matrix_world@b.head_local for b in rig.data.bones}
def orient(name,delta):
    bpy.context.view_layer.update();pb=rig.pose.bones[name];head=pb.head.copy()
    rot=delta@rest[name].to_quaternion();pb.matrix=Matrix.LocRotScale(head,rot,Vector((1,1,1)));bpy.context.view_layer.update()
for side,sign in [('left',1),('right',-1)]:
    fingers=landmarks[side];w=positions[side+'Hand'];direction=(fingers['Middle'][0]-w).normalized()
    index=fingers['Index'][0]-w;little=fingers['Little'][0]-w
    normal=(little.cross(index) if side=='left' else index.cross(little)).normalized()
    # Palmar surface points toward the front (-Y) in the inspected source.
    if normal.y>0:normal=-normal
    for bone,child in [('UpperArm','LowerArm'),('LowerArm','Hand')]:
        armx=(positions[side+child]-positions[side+bone]).normalized()*sign
        armz=(-normal-armx*(-normal).dot(armx)).normalized();army=armz.cross(armx).normalized()
        delta=armx.rotation_difference(Vector((1,0,0))) if bone=='UpperArm' else Matrix((armx,army,armz)).transposed().to_quaternion().inverted()
        orient(side+bone,delta)
    x=direction*sign;z=-normal;y=z.cross(x).normalized();z=x.cross(y).normalized()
    basis=Matrix((x,y,z)).transposed().to_quaternion()
    orient(side+'Hand',basis.inverted())
# Freeze only this neutral-pose conversion into vertices, preserving every UV/material.
for obj in meshes:
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    for mod in list(obj.modifiers):
        if mod.type=='ARMATURE':bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.armature_apply(selected=False);bpy.ops.object.mode_set(mode='OBJECT')
for obj in meshes:
    obj.data.validate(clean_customdata=True);obj.data.update(calc_edges=True);obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
    mod=obj.modifiers.new('Armature','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=False
for image in bpy.data.images:
    if image.size[0]>2048 or image.size[1]>2048:
        ratio=2048/max(image.size);image.scale(round(image.size[0]*ratio),round(image.size[1]*ratio))
rig['avatar_design']='approved-kids-20261110';rig['finger_rig']='30 articulated joints; fitted from actual mesh renders'
bpy.ops.object.select_all(action='DESELECT')
for o in meshes+[rig]:o.select_set(True)
bpy.context.view_layer.objects.active=rig
os.makedirs(os.path.dirname(destination),exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(destination)[0]+'.blend')
bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=90,export_yup=True,export_extras=True)
print('FINGER_BINDINGS '+json.dumps(counts));print('EXPORTED '+destination)

