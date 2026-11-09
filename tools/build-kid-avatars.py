import bpy, bmesh, math, os, json, sys
from mathutils import Vector, Quaternion
from math import sin, cos, pi

OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for b in bpy.data.materials: bpy.data.materials.remove(b)

def material(name, color, rough=.5, metallic=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metallic
    if 'Skin' in name: p.inputs['Subsurface Weight'].default_value=.055
    return m
skin=material('Skin warm peach',(.64,.37,.22),.52)
earmat=material('Skin inner ear',(.57,.25,.18),.65)
white=material('Warm ivory',(.91,.88,.79),.6)
eyewhite=material('Eye sclera',(.95,.93,.87),.24)
iris=material('Brown irises',(.075,.034,.014),.25)
pupil=material('Pupils',(.006,.004,.003),.2)
shine=material('Eye highlights',(1,1,1),.08)
mouthmat=material('Smile',(.21,.055,.025),.6)
lip=material('Skin lips',(.57,.22,.15),.6)
navy=material('Navy shorts',(.022,.043,.086),.78)
navyseam=material('Shorts seams',(.075,.11,.18),.8)
hairmats=[material('Hair '+str(i),c,.63) for i,c in enumerate([(.044,.021,.012),(.062,.030,.018),(.077,.038,.022),(.052,.025,.014)])]
yellow=material('Sunflower shirt',(.98,.58,.032),.72)
yellowedge=material('Sunflower seam',(.79,.37,.018),.78)
purple=material('Lavender shirt',(.49,.32,.69),.74)
purpleedge=material('Lavender seam',(.35,.2,.49),.8)
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
        a.normalize();b=tan.cross(a).normalized();f=max(.025,sin(pi*(.12+.88*t))**.7)*(1-.55*t)
        for j in range(n):vs.append(tuple(p+a*cos(j*2*pi/n)*width*f+b*sin(j*2*pi/n)*depth*f))
    for i in range(len(ps)-1):
        for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(ps)-1)*n+j for j in range(n))]);return mesh(name,vs,faces,mat)

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
    bind(ringmesh(kind+'_shirt',[((0,0,z),rx,ry) for z,rx,ry in [(.725,.151,.087),(.735,.155,.09),(.77,.158,.094),(.84,.151,.09),(.93,.167,.094),(.99,.193,.092),(1.035,.17,.085),(1.075,.113,.064),(1.09,.055,.045)]],color),upperweights)
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
        sleeve=ringmesh(kind+'_'+s+'_sleeve',[((sgn*x,0,z),ry,rz) for x,z,ry,rz in [(.133,1.032,.045,.048),(.15,1.036,.061,.065),(.18,1.037,.068,.071),(.205,1.039,.068,.068),(.245,1.04,.063,.059),(.263,1.04,.059,.055)]],color,'X')
        bind(sleeve,s+'UpperArm');bind(ringmesh(kind+'_'+s+'_sleeve_seam',[((sgn*x,0,1.04),.0595,.0555) for x in [.257,.263]],edge,'X'),s+'UpperArm')
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
    # all face and hair geometry is bound exclusively to head
    def egg(v):
        x,y,z=v;fac=.80+.20*min(1,max(0,(z+.85)/.9));return Vector((x*fac,y,z))
    bind(uvshape(kind+'_head',(0,0,1.285),(.181,.155,.201),skin,64,40,egg),'head')
    for s,sgn in [('left',1),('right',-1)]:
        bind(uvshape(kind+'_'+s+'_ear',(sgn*.167,.004,1.282),(.035,.024,.048),skin),'head');bind(uvshape(kind+'_'+s+'_ear_inner',(sgn*.18,-.016,1.282),(.016,.006,.027),earmat),'head')
        bind(uvshape(kind+'_'+s+'_eye_white',(sgn*.069,-.139,1.325),(.051,.025,.059),eyewhite),'head')
        bind(uvshape(kind+'_'+s+'_iris',(sgn*.067,-.162,1.322),(.031,.009,.039),iris),'head');bind(uvshape(kind+'_'+s+'_pupil',(sgn*.067,-.170,1.323),(.017,.003,.026),pupil),'head')
        bind(uvshape(kind+'_'+s+'_eye_sparkle',(sgn*.067-.010,-.174,1.341),(.009,.002,.011),shine,24,16),'head');bind(uvshape(kind+'_'+s+'_eye_sparkle_small',(sgn*.067+.012,-.173,1.308),(.004,.002,.005),shine,20,12),'head')
        brow=[(sgn*(.035+i*.019),-.142-(.004 if i==2 else 0),1.393+.012*sin(pi*i/4)) for i in range(5)];bind(tube(kind+'_'+s+'_brow',brow,.0055 if boy else .0045,hairmats[0]),'head')
        upper=[(sgn*(.069+.052*cos(a)),-.148,1.325+.058*sin(a)) for a in [pi*i/10 for i in range(11)]];bind(tube(kind+'_'+s+'_eyelid',upper,.0025,hairmats[0]),'head')
    bind(uvshape(kind+'_nose',(0,-.151,1.274),(.023,.030,.024),skin,32,20),'head')
    bind(tube(kind+'_smile',[(-.044,-.148,1.235),(-.022,-.160,1.222),(0,-.163,1.219),(.022,-.160,1.222),(.044,-.148,1.235)],.0033,mouthmat),'head')
    bind(tube(kind+'_lower_lip',[(-.026,-.158,1.216),(0,-.164,1.211),(.026,-.158,1.216)],.0038,lip),'head')
    # scalp cap with asymmetrical sculpted fringe
    vs=[];fc=[];segs=64;rows=24
    for j in range(rows+1):
        for i in range(segs):
            ph=2*pi*i/segs;maxth=(1.58+.40*sin(ph)) if boy else (1.85+.67*sin(ph));th=maxth*j/rows
            xx=.187*sin(th)*cos(ph);yy=.161*sin(th)*sin(ph);zz=1.305+.207*cos(th)
            if not boy and sin(ph)>-.35:zz-=.045*(j/rows)**3
            vs.append((xx,yy,zz))
    for j in range(rows):
        for i in range(segs):fc.append((j*segs+i,j*segs+(i+1)%segs,(j+1)*segs+(i+1)%segs,(j+1)*segs+i))
    bind(mesh(kind+'_hair_cap',vs,fc,hairmats[0]),'head')
    if boy:
        locks=[([(-.17,.0,1.40),(-.15,-.07,1.49),(-.09,-.145,1.49),(-.135,-.15,1.39)],.055,.024),([(-.13,.01,1.47),(-.09,-.05,1.55),(.025,-.11,1.54),(-.05,-.168,1.398)],.065,.025),([(-.07,.065,1.50),(.01,.00,1.568),(.12,-.07,1.53),(.02,-.163,1.42)],.064,.027),([(.0,.09,1.49),(.08,.055,1.55),(.17,-.01,1.49),(.11,-.133,1.39)],.054,.025),([(.07,.09,1.43),(.15,.055,1.50),(.19,-.02,1.43),(.17,-.075,1.34)],.040,.024)]
        for i,(p,w,d) in enumerate(locks):bind(lock(kind+'_hair_sweep_'+str(i),p,w,d,hairmats[i%4]),'head')
        for s,sgn in [('L',1),('R',-1)]:
            for j in range(3):bind(lock(kind+'_side_hair_'+s+str(j),[(sgn*.11,.075-j*.035,1.46),(sgn*.18,.055-j*.035,1.40),(sgn*.176,.028-j*.03,1.30)],.026,.013,hairmats[(j+1)%4]),'head')
    else:
        for i,x in enumerate([-.13,-.075,-.02,.04,.10]):
            bind(lock(kind+'_bang_'+str(i),[(x*.45,.0,1.50),(x*.8,-.10,1.48),(x,-.16,1.425),(x+.018,-.154,1.39)],.040,.014,hairmats[i%4]),'head')
        for s,sgn in [('L',1),('R',-1)]:
            for j in range(5):
                y=-.055+j*.035;bind(lock(kind+'_bob_'+s+str(j),[(sgn*.13,y,1.46),(sgn*.19,y-.018,1.34),(sgn*.20,y-.012,1.19),(sgn*.15,y-.022,1.116)],.035,.026,hairmats[(j+1)%4]),'head')
        bind(tube(kind+'_hairclip',[(.145,-.112,1.41),(.169,-.105,1.439),(.177,-.098,1.434),(.153,-.11,1.405),(.145,-.112,1.41)],.004,purple),'head')
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
