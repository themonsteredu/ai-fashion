"""Replace a fused generated hand with the validated five-finger donor mesh.
Only geometry beyond the wrists is replaced. Bridge rings keep the wrist closed.
"""
import bpy,bmesh,json,sys,os,math
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
girl,boy,points,output,outpoints=sys.argv[sys.argv.index('--')+1:]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def load(path):
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=path);new=set(bpy.data.objects)-before
    rig=next(o for o in new if o.type=='ARMATURE');mesh=next(o for o in new if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
    for o in new:
        if o not in [rig,mesh]:bpy.data.objects.remove(o,do_unlink=True)
    for o in [rig,mesh]:
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    rig.animation_data_clear();return rig,mesh
gr,gm=load(girl);br,bm=load(boy);cfg=json.load(open(points));bvh=BVHTree.FromObject(bm,bpy.context.evaluated_depsgraph_get())
def centre(x,z):
    front=bvh.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))[0];back=bvh.ray_cast(Vector((x,2,z)),Vector((0,-1,0)))[0]
    if front is None or back is None:raise RuntimeError('Donor landmark misses hand')
    return (front+back)/2
allpoints={};seams=[]
for side,cap,sign in [('left','Left',1),('right','Right',-1)]:
    bw=br.matrix_world@br.data.bones[cap+'Hand'].head_local;be=br.matrix_world@br.data.bones[cap+'ForeArm'].head_local
    gw=gr.matrix_world@gr.data.bones[cap+'Hand'].head_local;ge=gr.matrix_world@gr.data.bones[cap+'ForeArm'].head_local
    direction=(gw-ge).normalized();q=(bw-be).normalized().rotation_difference(direction);scale=.95
    transform=lambda v:gw+q@((v-bw)*scale)
    allpoints[side]={'fingers':{}}
    for finger,ps in cfg[side]['fingers'].items():
        hand=cfg[side]
        allpoints[side]['fingers'][finger]=[list(transform(centre(hand['center'][0]+(px/hand['pixels']-.5)*hand['scale'],hand['center'][1]+(.5-py/hand['pixels'])*hand['scale']))) for px,py in ps]
    donor=bm.copy();donor.data=bm.data.copy();bpy.context.collection.objects.link(donor);donor.parent=None;donor.matrix_world=Matrix.Identity(4)
    for mod in list(donor.modifiers):donor.modifiers.remove(mod)
    edit=bmesh.new();edit.from_mesh(donor.data);bmesh.ops.remove_doubles(edit,verts=list(edit.verts),dist=.000002)
    discard=[v for v in edit.verts if sign*v.co.x<.25 or not .55<v.co.z<.88]
    bmesh.ops.delete(edit,geom=discard,context='VERTS')
    for v in edit.verts:v.co=transform(v.co)
    cut_d=gw+direction*.004
    bmesh.ops.bisect_plane(edit,geom=list(edit.verts)+list(edit.edges)+list(edit.faces),dist=.000001,plane_co=cut_d,plane_no=direction,clear_inner=True,clear_outer=False)
    edit.to_mesh(donor.data);edit.free()
    edit=bmesh.new();edit.from_mesh(gm.data);bmesh.ops.remove_doubles(edit,verts=list(edit.verts),dist=.000002)
    cut_g=gw-direction*.014
    region=[v for v in edit.verts if sign*v.co.x>.24 and .55<v.co.z<.90]
    edges=[e for e in edit.edges if any(v in region for v in e.verts)]
    faces=[f for f in edit.faces if any(v in region for v in f.verts)]
    result=bmesh.ops.bisect_plane(edit,geom=region+edges+faces,dist=.000001,plane_co=cut_g,plane_no=direction)
    discard=[v for v in edit.verts if sign*v.co.x>.24 and .55<v.co.z<.90 and (v.co-cut_g).dot(direction)>.000001]
    bmesh.ops.delete(edit,geom=discard,context='VERTS');edit.to_mesh(gm.data);edit.free()
    bpy.ops.object.select_all(action='DESELECT');gm.select_set(True);donor.select_set(True);bpy.context.view_layer.objects.active=gm;bpy.ops.object.join()
    edit=bmesh.new();edit.from_mesh(gm.data)
    loops=[]
    for plane in [cut_g,cut_d]:
        vertices=set(v for e in edit.edges if e.is_boundary and all(abs((v.co-plane).dot(direction))<.00002 for v in e.verts) for v in e.verts)
        if len(vertices)<8:raise RuntimeError('Wrist ring missing: '+str((side,len(vertices))))
        ref=direction.cross(Vector((0,1,0))).normalized();other=direction.cross(ref).normalized()
        loops.append(sorted(vertices,key=lambda v:math.atan2((v.co-plane).dot(other),(v.co-plane).dot(ref))))
    a,b=loops;uv=edit.loops.layers.uv.active;sample=next(iter(a[0].link_loops))[uv].uv.copy() if uv else None
    material=a[0].link_faces[0].material_index;deform=edit.verts.layers.deform.active
    # A zero-area UV patch produces a dark wrist stripe after mip filtering.
    # Match the local skin color with a plain material on the narrow bridge.
    skin=bpy.data.materials.new('Matched wrist skin '+side);skin.use_nodes=True
    source_material=gm.data.materials[material]
    tex=next((n.image for n in source_material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image),None)
    samples=[]
    if tex and uv:
        width,height=tex.size
        for v in a[::max(1,len(a)//12)]:
            loop=next(iter(v.link_loops));u=loop[uv].uv
            offset=4*(int(u.y*height)%height*width+int(u.x*width)%width)
            samples.append(list(tex.pixels[offset:offset+3]))
    rgb=[sum(c[i] for c in samples)/len(samples) for i in range(3)] if samples else [.88,.69,.55]
    linear=lambda c:c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
    shader=skin.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=tuple(linear(c) for c in rgb)+(1,);shader.inputs['Roughness'].default_value=.8
    gm.data.materials.append(skin);material=len(gm.data.materials)-1
    # Walk the two rings by normalized arc order; unequal tessellation is allowed.
    i=j=0
    while i<len(a) or j<len(b):
        if (i+1)/len(a) <= (j+1)/len(b) and i<len(a):
            verts=[a[i%len(a)],a[(i+1)%len(a)],b[j%len(b)]];i+=1
        else:
            verts=[a[i%len(a)],b[(j+1)%len(b)],b[j%len(b)]];j+=1
        try:face=edit.faces.new(verts)
        except ValueError:continue
        face.material_index=material
        face.smooth=True
        if uv:
            for loop in face.loops:loop[uv].uv=sample
    bmesh.ops.recalc_face_normals(edit,faces=list(edit.faces));edit.to_mesh(gm.data);edit.free()
    seams.append({'side':side,'rings':[len(a),len(b)]})
bpy.data.objects.remove(bm,do_unlink=True);bpy.data.objects.remove(br,do_unlink=True)
for o in list(bpy.data.objects):
    if o not in [gr,gm]:bpy.data.objects.remove(o,do_unlink=True)
json.dump(allpoints,open(outpoints,'w'),indent=2)
bpy.ops.object.select_all(action='DESELECT');gr.select_set(True);gm.select_set(True);bpy.context.view_layer.objects.active=gr
bpy.ops.export_scene.gltf(filepath=output,export_format='GLB',use_selection=True,export_animations=False)
print('WRIST_BRIDGES '+json.dumps(seams));print('SAVED '+output)

