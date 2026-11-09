import bpy, bmesh, math, os, json, sys
from mathutils import Vector, Quaternion
from math import sin, cos, pi

OUT = os.environ.get('KIDS_AVATAR_OUT', os.path.dirname(os.path.abspath(__file__)))
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for b in bpy.data.materials: bpy.data.materials.remove(b)

def material(name, color, rough=.5, metallic=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metallic
    if 'Skin' in name: p.inputs['Subsurface Weight'].default_value=.055
    return m
skin=material('Skin warm peach',(.76,.49,.35),.62)
earmat=material('Skin inner ear',(.72,.33,.27),.72)
white=material('Warm ivory',(.91,.88,.79),.6)
eyewhite=material('Eye sclera',(.93,.91,.85),.38)
iris=material('Brown irises',(.16,.072,.034),.32)
pupil=material('Pupils',(.018,.009,.007),.3)
shine=material('Eye highlights',(1,1,1),.08)
mouthmat=material('Smile',(.21,.055,.025),.6)
lip=material('Skin lips',(.65,.30,.23),.66)
navy=material('Navy shorts',(.055,.091,.145),.87)
navyseam=material('Shorts seams',(.089,.139,.20),.9)
hairmats=[material('Hair '+str(i),c,.50) for i,c in enumerate([(.032,.019,.016),(.039,.023,.019),(.046,.027,.021),(.035,.021,.017)])]
yellow=material('Sunflower shirt',(.92,.62,.17),.85)
yellowedge=material('Sunflower seam',(.69,.40,.085),.9)
purple=material('Lavender shirt',(.48,.37,.68),.85)
purpleedge=material('Lavender seam',(.34,.25,.51),.9)
rubber=material('Shoe sole',(.74,.73,.68),.8)

def mesh(name,verts,faces,mat):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    for p in me.polygons:p.use_smooth=True
    return ob
def uvshape(name, center, scale, mat, seg=40,rings=24,shape=None):
    verts=[];faces=[]
    for j in range(rings+1):
        th=pi*j/rings
        for i in range(seg):
            ph=2*pi*i/seg
            v=Vector((sin(th)*cos(ph),sin(th)*sin(ph),cos(th)))
            if shape:v=shape(v)
            verts.append(tuple(center[k]+v[k]*scale[k] for k in range(3)))
    for j in range(rings):
        for i in range(seg):faces.append((j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i))
    return mesh(name,verts,faces,mat)
def ringmesh(name,sections,mat,axis='Z',segments=32,cap=True):
    verts=[];faces=[]
    for c,r1,r2 in sections:
        for i in range(segments):
            a=2*pi*i/segments
            off=(r1*cos(a),r2*sin(a),0) if axis=='Z' else (0,r1*cos(a),r2*sin(a))
            verts.append(tuple(c[j]+off[j] for j in range(3)))
    for j in range(len(sections)-1):
        for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
    if cap:faces.extend([tuple(range(segments-1,-1,-1)),tuple((len(sections)-1)*segments+i for i in range(segments))])
    return mesh(name,verts,faces,mat)
def tube(name,points,radius,mat):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=16;cu.bevel_resolution=3;cu.bevel_depth=radius
    sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
    for p,v in zip(sp.bezier_points,points):p.co=v;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    ob=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.convert(target='MESH');ob.select_set(False)
    return ob
def catmull(points,steps=8):
    ps=[Vector(points[0])]+[Vector(p) for p in points]+[Vector(points[-1])];out=[]
    for i in range(1,len(ps)-2):
        a,b,c,d=ps[i-1:i+3]
        for q in range(steps):
            t=q/steps;out.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
    out.append(Vector(points[-1]));return out
def lock(name,points,width,depth,mat):
    ps=catmull(points,7);vs=[];faces=[];n=12
    for i,p in enumerate(ps):
        t=i/(len(ps)-1);tan=(ps[min(i+1,len(ps)-1)]-ps[max(0,i-1)]).normalized()
        ref=Vector((0,-1,0));a=tan.cross(ref)
        if a.length<.01:a=tan.cross(Vector((1,0,0)))
        a.normalize();b=tan.cross(a).normalized();f=max(.012,(.85+.20*sin(pi*t))*(1-t**3))
        for j in range(n):vs.append(tuple(p+a*cos(j*2*pi/n)*width*f+b*sin(j*2*pi/n)*depth*f))
    for i in range(len(ps)-1):
        for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(ps)-1)*n+j for j in range(n))]);return mesh(name,vs,faces,mat)

# Facial details conform to the head surface instead of sitting on protruding
# spherical eyeballs. All details remain weighted only to the head bone.
def face_y(x,z):
    zz=(z-1.292)/.184
    fac=.92+.08*min(1,max(0,(zz+.8)/.9))
    return -.160*math.sqrt(max(.025,1-(x/(.192*fac))**2-zz**2))

def face_patch(name,cx,cz,rx,rz,depth,mat):
    vs=[];fc=[];segs=40;rows=8
    for j in range(rows+1):
        r=j/rows
        for i in range(segs):
            a=2*pi*i/segs;x=cx+rx*r*cos(a);z=cz+rz*r*sin(a)
            vs.append((x,face_y(x,z)-depth-.003*(1-r*r),z))
    for j in range(rows):
        for i in range(segs):fc.append((j*segs+i,j*segs+(i+1)%segs,(j+1)*segs+(i+1)%segs,(j+1)*segs+i))
    return mesh(name,vs,fc,mat)

def face_curve(name,xz,radius,mat,depth=.008):
    return tube(name,[(x,face_y(x,z)-depth,z) for x,z in xz],radius,mat)

def cheek_colour(ob):
    m=skin.copy();m.name='Soft peach face with cheek colour'
    node=m.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='Color'
    m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    ob.data.materials.clear();ob.data.materials.append(m)
    colors=ob.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for loop in ob.data.loops:
        x,y,z=ob.data.vertices[loop.vertex_index].co
        blush=.38*math.exp(-((abs(x)-.112)/.039)**2-((z-1.268)/.029)**2)*max(0,min(1,-y/.11))
        colors.data[loop.index].color=(.76+.04*blush,.49-.20*blush,.35-.08*blush,1)

def character(kind,offset):
    boy=kind=='boy';color=yellow if boy else purple;edge=yellowedge if boy else purpleedge
    armdata=bpy.data.armatures.new(kind+'_skeleton');rig=bpy.data.objects.new(kind+'_rig',armdata);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    defs={}
    def bone(n,h,t,parent=None):
        b=armdata.edit_bones.new(n);b.head=h;b.tail=t
        if parent:b.parent=armdata.edit_bones[parent]
        defs[n]=(Vector(h),Vector(t));return b
    bone('root',(0,0,0),(0,0,.12));bone('hips',(0,0,.68),(0,0,.78),'root');bone('spine',(0,0,.78),(0,0,.91),'hips');bone('chest',(0,0,.91),(0,0,1.065),'spine');bone('neck',(0,0,1.065),(0,0,1.14),'chest');bone('head',(0,0,1.14),(0,0,1.40),'neck')
    for s,sgn in [('left',1),('right',-1)]:
        bone(s+'Shoulder',(0,0,1.04),(sgn*.17,0,1.04),'chest');bone(s+'UpperArm',(sgn*.17,0,1.04),(sgn*.385,0,1.04),s+'Shoulder');bone(s+'LowerArm',(sgn*.385,0,1.04),(sgn*.58,0,1.04),s+'UpperArm');bone(s+'Hand',(sgn*.58,0,1.04),(sgn*.65,0,1.04),s+'LowerArm')
        for fname,y,l in [('Index',-.027,.078),('Middle',-.009,.086),('Ring',.012,.079),('Little',.031,.061)]:
            parent=s+'Hand';x=.647
            for j,factor in enumerate([.42,.33,.25]):
                nxt=x+l*factor;name=s+fname+['Proximal','Intermediate','Distal'][j];bone(name,(sgn*x,y,1.04),(sgn*nxt,y,1.04),parent);parent=name;x=nxt
        th=[(.602,-.025,1.035),(.621,-.048,1.026),(.644,-.063,1.020),(.661,-.068,1.017)]
        for j in range(3):bone(s+'Thumb'+['Metacarpal','Proximal','Distal'][j],(sgn*th[j][0],*th[j][1:]),(sgn*th[j+1][0],*th[j+1][1:]),s+'Hand' if j==0 else s+'Thumb'+['Metacarpal','Proximal'][j-1])
        bone(s+'UpperLeg',(sgn*.09,0,.68),(sgn*.09,-.012,.385),'hips');bone(s+'LowerLeg',(sgn*.09,-.012,.385),(sgn*.09,0,.105),s+'UpperLeg');bone(s+'Foot',(sgn*.09,0,.105),(sgn*.09,-.115,.05),s+'LowerLeg');bone(s+'Toes',(sgn*.09,-.115,.05),(sgn*.09,-.18,.05),s+'Foot')
    bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False);objects=[]
    def bind(ob,weights):
        names=list(defs) if callable(weights) else [weights]
        for n in names:ob.vertex_groups.new(name=n)
        for v in ob.data.vertices:
            ws=weights(v.co) if callable(weights) else {weights:1.0}
            for n,w in ws.items():
                if w>1e-6:ob.vertex_groups[n].add([v.index],w,'REPLACE')
        mod=ob.modifiers.new('Controlled skin weights','ARMATURE');mod.object=rig;ob.parent=rig;objects.append(ob);return ob
    def smoothmix(a,b,t):
        t=max(0,min(1,t));t=t*t*(3-2*t);return {a:1-t,b:t}
    def upperweights(v):
        z=v.z
        if z<.78:return {'hips':1}
        if z<.91:return smoothmix('hips','spine',(z-.78)/.13)
        return smoothmix('spine','chest',(z-.91)/.11)
    # torso and clothing use explicit zones, never head or hand influences
    bind(ringmesh(kind+'_shirt',[((0,0,z),rx,ry) for z,rx,ry in [(.715,.157,.091),(.725,.163,.095),(.75,.165,.097),(.78,.162,.098),(.84,.157,.097),(.90,.164,.098),(.96,.177,.094),(.99,.182,.090),(1.02,.172,.084),(1.05,.137,.071),(1.075,.105,.057),(1.09,.055,.045)]],color),upperweights)
    bind(ringmesh(kind+'_hem',[((0,0,z),.153,.089) for z in [.727,.737]],edge), 'hips')
    bind(ringmesh(kind+'_neck',[((0,0,z),r,r*.87) for z,r in [(1.075,.044),(1.15,.043),(1.17,.05)]],skin),'neck')
    bind(ringmesh(kind+'_collar',[((0,0,z),rx,ry) for z,rx,ry in [(1.085,.058,.047),(1.095,.057,.046),(1.101,.051,.041)]],white),'chest')
    bind(ringmesh(kind+'_waist',[((0,0,z),rx,ry) for z,rx,ry in [(.68,.149,.087),(.735,.149,.088),(.743,.146,.085)]],navy),'hips')
    for s,sgn in [('left',1),('right',-1)]:
        def aw(v,s=s):
            x=abs(v.x)
            if x<.35:return {s+'UpperArm':1}
            if x<.42:return smoothmix(s+'UpperArm',s+'LowerArm',(x-.35)/.07)
            if x<.555:return {s+'LowerArm':1}
            return smoothmix(s+'LowerArm',s+'Hand',(x-.555)/.055)
        sections=[((sgn*x,0,1.04),ry,rz) for x,ry,rz in [(.145,.055,.056),(.18,.058,.06),(.235,.055,.052),(.30,.048,.047),(.355,.043,.043),(.385,.041,.041),(.418,.043,.043),(.47,.040,.04),(.53,.032,.032),(.58,.027,.027),(.602,.027,.023)]]
        bind(ringmesh(kind+'_'+s+'_arm',sections,skin,'X'),aw)
        sleeve=ringmesh(kind+'_'+s+'_sleeve',[((sgn*x,0,z),ry,rz) for x,z,ry,rz in [(.12,1.030,.041,.042),(.14,1.033,.053,.052),(.165,1.036,.062,.061),(.19,1.038,.065,.064),(.22,1.04,.064,.061),(.25,1.04,.061,.057),(.275,1.04,.059,.054)]],color,'X')
        bind(sleeve,s+'UpperArm')
        bind(uvshape(kind+'_'+s+'_shoulder_cap',(sgn*.171,0,1.037),(.060,.063,.062),color,32,20),s+'UpperArm')
        bind(ringmesh(kind+'_'+s+'_sleeve_seam',[((sgn*x,0,1.04),.0595,.0545) for x in [.267,.275]],white,'X'),s+'UpperArm')
        bind(uvshape(kind+'_'+s+'_palm',(sgn*.623,0,1.04),(.050,.043,.020),skin),s+'Hand')
        for fname,y,l in [('Index',-.027,.078),('Middle',-.009,.086),('Ring',.012,.079),('Little',.031,.061)]:
            names=[s+fname+j for j in ['Proximal','Intermediate','Distal']];base=.647;cuts=[base,base+l*.42,base+l*.75,base+l]
            sec=[]
            for q in range(19):
                t=(q-2)/16;x=base+l*t;r=.0105*(1-.35*t)*max(.06,min(1,(1-t)*14));sec.append(((sgn*x,y,1.04),r,r*.9))
            def fw(v,names=names,cuts=cuts,s=s,base=base):
                x=abs(v.x)
                if x<base+.008:return smoothmix(s+'Hand',names[0],(x-base+.011)/.019)
                if x<cuts[1]-.009:return {names[0]:1}
                if x<cuts[1]+.009:return smoothmix(names[0],names[1],(x-cuts[1]+.009)/.018)
                if x<cuts[2]-.007:return {names[1]:1}
                return smoothmix(names[1],names[2],(x-cuts[2]+.007)/.014)
            bind(ringmesh(kind+'_'+s+'_'+fname,sec,skin,'X'),fw)
            # subtle fingernail geometry stays with fingertip
            bind(uvshape(kind+'_'+s+'_'+fname+'_nail',(sgn*(base+l-.010),y,1.046),(.0075,.0065,.0012),white,20,12),names[2])
        thumbpts=[(sgn*x,y,z) for x,y,z in th]
        thumbpath=catmull(thumbpts,10);tv=[];tf=[];tn=20
        for j,p in enumerate(thumbpath):
            t=j/(len(thumbpath)-1);tan=(thumbpath[min(j+1,len(thumbpath)-1)]-thumbpath[max(j-1,0)]).normalized()
            a=tan.cross(Vector((0,0,1))).normalized();b=tan.cross(a).normalized();r=(.013-.005*t)*max(.04,min(1,(1-t)*9))
            for q in range(tn):tv.append(tuple(p+r*(a*cos(q*2*pi/tn)+b*sin(q*2*pi/tn))))
        for j in range(len(thumbpath)-1):
            for q in range(tn):tf.append((j*tn+q,j*tn+(q+1)%tn,(j+1)*tn+(q+1)%tn,(j+1)*tn+q))
        tf.extend([tuple(range(tn-1,-1,-1)),tuple((len(thumbpath)-1)*tn+q for q in range(tn))])
        def tw(v,s=s):
            x=abs(v.x)
            if x<.609:return smoothmix(s+'Hand',s+'ThumbMetacarpal',(x-.597)/.012)
            if x<.629:return smoothmix(s+'ThumbMetacarpal',s+'ThumbProximal',(x-.615)/.014)
            return smoothmix(s+'ThumbProximal',s+'ThumbDistal',(x-.638)/.012)
        bind(mesh(kind+'_'+s+'_thumb',tv,tf,skin),tw)
        def lw(v,s=s):
            if v.z>.425:return {s+'UpperLeg':1}
            if v.z>.345:return smoothmix(s+'LowerLeg',s+'UpperLeg',(v.z-.345)/.08)
            if v.z>.14:return {s+'LowerLeg':1}
            return smoothmix(s+'Foot',s+'LowerLeg',(v.z-.085)/.055)
        bind(ringmesh(kind+'_'+s+'_leg',[((sgn*.09,y,z),rx,ry) for z,y,rx,ry in [(.70,0,.067,.068),(.62,0,.065,.065),(.54,-.006,.059,.060),(.46,-.010,.054,.052),(.385,-.012,.049,.048),(.32,-.007,.048,.047),(.25,0,.045,.046),(.17,0,.035,.039),(.105,0,.03,.033)]],skin),lw)
        bind(ringmesh(kind+'_'+s+'_shorts_leg',[((sgn*.084,0,z),rx,ry) for z,rx,ry in [(.73,.081,.09),(.68,.084,.09),(.61,.086,.09),(.552,.081,.085)]],navy),lambda v,s=s: smoothmix(s+'UpperLeg','hips',(v.z-.60)/.12))
        bind(ringmesh(kind+'_'+s+'_shorts_hem',[((sgn*.084,0,z),.0815,.0855) for z in [.550,.558]],navyseam),s+'UpperLeg')
        bind(tube(kind+'_'+s+'_side_stripe',[(sgn*.166,-.005,.715),(sgn*.169,-.005,.64),(sgn*.165,-.005,.563)],.0023,white),s+'UpperLeg')
        bind(ringmesh(kind+'_'+s+'_sock',[((sgn*.09,0,z),r,r*1.05) for z,r in [(.083,.036),(.12,.035),(.151,.034),(.157,.035)]],white),lw)
        bind(ringmesh(kind+'_'+s+'_sock_rim',[((sgn*.09,0,z),.0357,.0375) for z in [.148,.155]],rubber),s+'LowerLeg')
        bind(uvshape(kind+'_'+s+'_shoe',(sgn*.09,-.042,.065),(.061,.113,.052),white,40,22,lambda v:Vector((v.x,v.y,max(-.7,v.z)))),s+'Foot')
        bind(ringmesh(kind+'_'+s+'_sole',[((sgn*.09,-.042,z),rx,ry) for z,rx,ry in [(.026,.056,.108),(.036,.061,.113),(.046,.061,.112)]],rubber),s+'Foot')
        bind(uvshape(kind+'_'+s+'_tongue',(sgn*.09,-.013,.108),(.035,.051,.012),color,28,16),s+'Foot')
        bind(uvshape(kind+'_'+s+'_heel',(sgn*.09,.044,.075),(.048,.023,.032),color,28,16),s+'Foot')
        for q in range(4):
            yy=-.044+q*.018;bind(tube(kind+'_'+s+'_lace_'+str(q),[(sgn*.09-.031,yy,.113),(sgn*.09,yy-.004,.122),(sgn*.09+.031,yy,.113)],.0025,white),s+'Foot')
    # Small, sewn chest mark; understated sportswear, no printed brand.
    bind(uvshape(kind+'_chest_patch',(.085,-.096,.948),(.018,.002,.023),white,24,16),'chest')
    bind(tube(kind+'_chest_patch_stitch',[(.077,-.100,.947),(.084,-.102,.940),(.095,-.099,.957)],.0022,edge),'chest')
    # all face and hair geometry is bound exclusively to head
    def egg(v):
        x,y,z=v;fac=.92+.08*min(1,max(0,(z+.8)/.9));return Vector((x*fac,y,z))
    head=bind(uvshape(kind+'_head',(0,0,1.292),(.192,.160,.184),skin,64,40,egg),'head');cheek_colour(head)
    for s,sgn in [('left',1),('right',-1)]:
        bind(uvshape(kind+'_'+s+'_ear',(sgn*.181,.008,1.285),(.029,.022,.038),skin),'head');bind(uvshape(kind+'_'+s+'_ear_inner',(sgn*.193,-.010,1.284),(.012,.006,.021),earmat),'head')
        cx=sgn*.070;cz=1.323
        bind(face_patch(kind+'_'+s+'_eye_white',cx,cz,.038,.044,.003,eyewhite),'head')
        bind(face_patch(kind+'_'+s+'_iris_rim',cx-sgn*.001,cz,.0255,.032,.008,pupil),'head')
        bind(face_patch(kind+'_'+s+'_iris',cx-sgn*.001,cz,.0235,.030,.0095,iris),'head')
        bind(face_patch(kind+'_'+s+'_pupil',cx-sgn*.001,cz+.002,.012,.021,.011,pupil),'head')
        bind(face_patch(kind+'_'+s+'_eye_sparkle',cx-.008,cz+.016,.006,.008,.013,shine),'head')
        bind(face_patch(kind+'_'+s+'_eye_sparkle_small',cx+.010,cz-.014,.0025,.0035,.013,shine),'head')
        brow=[(sgn*(.038+i*.015),1.382+.009*sin(pi*i/4)) for i in range(5)]
        bind(face_curve(kind+'_'+s+'_brow',brow,.0042 if boy else .0035,hairmats[0],.005),'head')
        upper=[(cx+.039*cos(a),cz+.043*sin(a)) for a in [pi*i/16 for i in range(17)]]
        bind(face_curve(kind+'_'+s+'_eyelid',upper,.0018 if boy else .0025,hairmats[0],.005),'head')
    bind(uvshape(kind+'_nose',(0,-.157,1.274),(.018,.018,.018),skin,32,20),'head')
    # A small open smile with a curved tooth edge, rather than a painted line.
    mouthvs=[];mouthfc=[]
    for j in range(2):
        for i in range(25):
            t=(i-12)/12;x=.037*t;z=(1.234+.007*t*t) if j==0 else (1.215+.026*t*t)
            mouthvs.append((x,face_y(x,z)-.004,z))
    for i in range(24):mouthfc.append((i,i+1,26+i,25+i))
    bind(mesh(kind+'_smile',mouthvs,mouthfc,mouthmat),'head')
    teethvs=[];teethfc=[]
    for j in range(2):
        for i in range(19):
            t=(i-9)/12;x=.037*t;z=1.234+.007*t*t-j*.005*(1-t*t)
            teethvs.append((x,face_y(x,z)-.006,z))
    for i in range(18):teethfc.append((i,i+1,20+i,19+i))
    bind(mesh(kind+'_smile_teeth',teethvs,teethfc,eyewhite),'head')
    bind(face_curve(kind+'_lower_lip',[(-.025,1.219),(0,1.212),(.025,1.219)],.0027,lip,.004),'head')
    # scalp cap with asymmetrical sculpted fringe
    vs=[];fc=[];segs=64;rows=24
    for j in range(rows+1):
        for i in range(segs):
            ph=2*pi*i/segs;maxth=(1.56+.39*sin(ph)) if boy else (1.88+.66*sin(ph));th=maxth*j/rows
            xx=.199*sin(th)*cos(ph);yy=.170*sin(th)*sin(ph);zz=1.310+.187*cos(th)
            if not boy and sin(ph)>-.40:zz-=.075*(j/rows)**3
            vs.append((xx,yy,zz))
    for j in range(rows):
        for i in range(segs):fc.append((j*segs+i,j*segs+(i+1)%segs,(j+1)*segs+(i+1)%segs,(j+1)*segs+i))
    bind(mesh(kind+'_hair_cap',vs,fc,hairmats[0]),'head')
    if boy:
        locks=[([(.10,.015,1.485),(.055,-.080,1.501),(-.035,-.141,1.455),(-.133,-.135,1.365)],.064,.008),([(.13,.025,1.475),(.097,-.079,1.480),(.048,-.155,1.434),(-.025,-.165,1.368)],.058,.008),([(.16,.030,1.450),(.156,-.064,1.448),(.129,-.137,1.390),(.098,-.145,1.353)],.044,.007),([(-.070,.040,1.475),(-.140,-.030,1.460),(-.176,-.075,1.383),(-.175,-.066,1.326)],.037,.008)]
        for i,(p,w,d) in enumerate(locks):
            p[0]=(p[0][0]*.88,p[0][1]+.012,p[0][2]-.045)
            bind(lock(kind+'_hair_sweep_'+str(i),p,w,d,hairmats[i%4]),'head')
        for s,sgn in [('L',1),('R',-1)]:
            bind(lock(kind+'_side_hair_'+s,[(sgn*.135,.045,1.395),(sgn*.196,-.008,1.37),(sgn*.187,-.026,1.305)],.033,.007,hairmats[1]),'head')
    else:
        bangs=[([(.075,.015,1.490),(.01,-.101,1.480),(-.075,-.151,1.438),(-.145,-.123,1.365)],.064),([(.10,.010,1.482),(.065,-.101,1.455),(.010,-.166,1.412),(-.030,-.165,1.382)],.051),([(.12,.025,1.470),(.143,-.066,1.439),(.162,-.108,1.366),(.177,-.076,1.307)],.048)]
        for i,(p,w) in enumerate(bangs):
            p[0]=(p[0][0]*.9,p[0][1]+.01,p[0][2]-.045)
            bind(lock(kind+'_bang_'+str(i),p,w,.007,hairmats[i%4]),'head')
        for s,sgn in [('L',1),('R',-1)]:
            for j in range(2):
                y=-.025+j*.075;bind(lock(kind+'_bob_'+s+str(j),[(sgn*.138,y+.015,1.38),(sgn*.204,y-.018,1.315),(sgn*.211,y-.012,1.205),(sgn*.166,y-.022,1.135)],.048,.009,hairmats[(j+1)%4]),'head')
        for j in range(2):bind(tube(kind+'_hairclip_'+str(j),[(.147+j*.009,-.131,1.397),(.167+j*.009,-.115,1.419)],.0033,white),'head')
    rig.location.x=offset
    return rig,objects,defs

boy,bo,bdefs=character('boy',-.84)
girl,go,gdefs=character('girl',.84)

def set_world_delta(rig,name,axis,angle):
    pb=rig.pose.bones[name];R=rig.data.bones[name].matrix_local.to_quaternion();pb.rotation_mode='QUATERNION';pb.rotation_quaternion=R.inverted()@Quaternion(axis,angle)@R
def animate(rig):
    for f in range(1,289,3):
        t=(f-1)/24
        for b in rig.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0)
        # 0-3 sec walking; 3-6 arms; 6-9 knee lift; 9-12 wrists and fingers
        for s,sgn in [('left',1),('right',-1)]:
            arm=1.32
            if 3<=t<6:arm=1.32-2.50*(.5-.5*cos((t-3)*2*pi/3))
            set_world_delta(rig,s+'UpperArm',Vector((0,1,0)),sgn*arm)
            if t<3:
                leg=.40*sin(t*2*pi*1.15+ (0 if s=='left' else pi));knee=max(0,.52*sin(t*2*pi*1.15+(0 if s=='left' else pi)))
                set_world_delta(rig,s+'UpperLeg',Vector((1,0,0)),leg);set_world_delta(rig,s+'LowerLeg',Vector((1,0,0)),knee);set_world_delta(rig,s+'Foot',Vector((1,0,0)),-.5*(leg+knee))
            if 6<=t<9 and s=='left':
                p=.5-.5*cos((t-6)*2*pi/3);set_world_delta(rig,s+'UpperLeg',Vector((1,0,0)),-p*.95);set_world_delta(rig,s+'LowerLeg',Vector((1,0,0)),p*1.45)
            if t>=9:
                set_world_delta(rig,s+'UpperArm',Vector((0,1,0)),sgn*.22);set_world_delta(rig,s+'LowerArm',Vector((0,0,1)),-sgn*.7)
                curl=.5-.5*cos((t-9)*2*pi/3);set_world_delta(rig,s+'Hand',Vector((0,1,0)),sgn*.3*sin((t-9)*2*pi/3))
                for finger in ['Index','Middle','Ring','Little']:
                    for joint,a in [('Proximal',1.0),('Intermediate',1.25),('Distal',.8)]:set_world_delta(rig,s+finger+joint,Vector((0,1,0)),sgn*a*curl)
                for joint,a in [('Metacarpal',.20),('Proximal',.35),('Distal',.45)]:set_world_delta(rig,s+'Thumb'+joint,Vector((0,1,0)),sgn*a*curl)
                pb=rig.pose.bones[s+'ThumbMetacarpal'];R=rig.data.bones[s+'ThumbMetacarpal'].matrix_local.to_quaternion()
                pb.rotation_quaternion=R.inverted()@Quaternion((0,1,0),sgn*.20*curl)@Quaternion((0,0,1),sgn*.85*curl)@R
        for b in rig.pose.bones:b.keyframe_insert(data_path='rotation_quaternion',frame=f)
    rig.animation_data.action.name=rig.name+'_Walk_Arms_Knee_Hands'
for rig in [boy,girl]:animate(rig)

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.world.color=(.3,.3,.3)
world=scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.62,.68,.75,1);world.node_tree.nodes['Background'].inputs[1].default_value=.45
floor=material('Studio floor',(.73,.76,.71),.85)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,.005));bpy.context.object.data.materials.append(floor);bpy.context.object.name='Studio floor'
def area(name,loc,power,size,col):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=col;o.rotation_euler=(Vector((0,0,.9))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key',(-3,-4,5),650,4,(1,.88,.74));area('Fill',(3,-2,3),450,3,(.8,.9,1));area('Hair rim',(0,3,4),850,3,(1,.92,.82))
bpy.ops.object.camera_add(location=(0,-5.6,1.65));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.80))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=3.4;scene.camera=cam
scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.fps=24;scene.frame_start=1;scene.frame_end=288
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.frame_set(1)
report=[]
for key,rig,objs in [('boy',boy,bo),('girl',girl,go)]:
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
    for ob in objs:ob.select_set(True)
    old=rig.location.x;rig.location.x=0
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,key+'_direct.glb'),export_format='GLB',use_selection=True,export_animations=True,export_skins=True,export_yup=True,export_apply=False,export_force_sampling=True,export_frame_range=True)
    rig.location.x=old
    report.append({'model':key,'bones':len(rig.data.bones),'finger_bones':[b.name for b in rig.data.bones if any(q in b.name for q in ['Thumb','Index','Middle','Ring','Little'])],'meshes':len(objs),'vertices':sum(len(o.data.vertices) for o in objs),'source':'Locally authored geometry and explicit skin weights. No new paid generation.','limitations':'Stylized prototype; not an exact reconstruction of the approved image. Webcam tracking not tested.'})
with open(os.path.join(OUT,'rig_report.json'),'w',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'direct_avatars.blend'))
scene.render.filepath=os.path.join(OUT,'direct_avatars.png');bpy.ops.render.render(write_still=True)
print('DIRECT_AVATAR_COMPLETE',json.dumps(report))
