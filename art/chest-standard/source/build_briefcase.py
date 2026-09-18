"""Blender 5.2: staged, reproducible briefcase construction. Existing assets stay intact."""
import bpy, math, json, sys, random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / 'art/chest-standard'
PHASE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'blockout'
DETAILED = PHASE != 'blockout'

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new('Studio')
    sc.unit_settings.system = 'METRIC'
    sc.render.fps = 30
    for name in ['REF', 'BLOCKOUT', 'MODEL', 'RIG', 'VFX_GUIDES', 'EXPORT']:
        col = bpy.data.collections.new(name); sc.collection.children.link(col)

def move(o, collection='EXPORT'):
    for c in list(o.users_collection): c.objects.unlink(o)
    bpy.data.collections[collection].objects.link(o)
    return o

def empty(name, parent=None, loc=(0,0,0)):
    o = bpy.data.objects.new(name,None); bpy.data.collections['EXPORT'].objects.link(o)
    o.parent=parent; o.location=loc
    return o

def material(name, color, metal=0, rough=.4):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    return m

def cube(name, dims, loc, mat, parent=None, bevel=.012, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=bpy.context.object; o.name=name; move(o); o.dimensions=dims
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Edge_radius','BEVEL'); mod.width=bevel; mod.segments=segments
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Face_normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat); o.parent=parent; o.location=loc
    return o

def tube(name, pts, radius, mat, parent):
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'; cu.bevel_depth=radius; cu.bevel_resolution=2
    sp=cu.splines.new('POLY'); sp.points.add(len(pts)-1)
    for p,co in zip(sp.points,pts): p.co=(*co,1)
    o=bpy.data.objects.new(name,cu); bpy.data.collections['EXPORT'].objects.link(o)
    bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o.select_set(False)
    o.parent=parent; o.data.materials.append(mat)
    # Curve end caps and generated UVs are required for the export validator.
    return o

def shell(prefix, parent, low, high, body, gold, lining):
    floor=low if low<0 else high-.025
    cube(prefix+'_Shell',(1.4,.78,.035),(0,-.39,floor+.0175),body,parent,.017)
    for x in [-.68,.68]:
        cube(prefix+('_Left' if x<0 else '_Right'),(.04,.78,high-low),(x,-.39,(low+high)/2),body,parent,.012)
    for y in [-.76,-.02]:
        cube(prefix+('_Front' if y<-.4 else '_Rear'),(1.34,.04,high-low),(0,y,(low+high)/2),body,parent,.012)
    edge=high-.009 if low<0 else low+.009
    for x in [-.683,.683]: cube(prefix+'_SideTrim_'+str(int(x*100)),(.022,.77,.022),(x,-.39,edge),gold,parent,.009)
    for y in [-.767,-.013]: cube(prefix+'_EdgeTrim_'+str(int(y*100)),(1.35,.022,.022),(0,y,edge),gold,parent,.009)
    inside=low+.04 if low<0 else high-.045
    cube(prefix+'_Lining',(1.28,.65,.012),(0,-.39,inside),lining,parent,.02)
    if DETAILED:
        outside=low-.004 if low<0 else high+.007
        cube(prefix+'_InsetPanel',(1.26,.64,.012),(0,-.39,outside),body,parent,.025,5)
        for x in [-.66,.66]:
            for y in [-.74,-.04]:
                cube(prefix+'_Corner_'+str(x)+'_'+str(y),(.08,.075,.025),(x,y,outside),gold,parent,.02,4)

def pose(rig,lid,progress):
    t=min(1,progress/.48); t=t*t*(3-2*t)
    angle=(1-t)*math.pi/2
    rig.rotation_euler.x=-angle
    rig.location=(0,0,.03+.10*math.cos(angle))
    q=max(0,min(1,(progress-.48)/.52)); q=q*q*(3-2*q)
    lid.rotation_euler.x=-math.radians(100)*q
    bpy.context.view_layer.update()

def render(path, eye, target, ortho=2.4):
    sc=bpy.context.scene
    if not sc.camera:
        bpy.ops.object.camera_add(); cam=bpy.context.object; move(cam,'REF'); sc.camera=cam
        for name,loc,power,size in [('Key',(-3,-4,5),650,4),('Rim',(3,2,4),850,3),('Fill',(3,-3,2),350,3)]:
            bpy.ops.object.light_add(type='AREA',location=loc); l=bpy.context.object; move(l,'REF'); l.name=name; l.data.energy=power; l.data.shape='DISK'; l.data.size=size
            l.rotation_euler=(Vector(target)-l.location).to_track_quat('-Z','Y').to_euler()
    cam=sc.camera; cam.location=eye; cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO'; cam.data.ortho_scale=ortho
    sc.render.engine='CYCLES'; sc.cycles.samples=24
    sc.render.resolution_x=900;sc.render.resolution_y=700;sc.render.resolution_percentage=100
    sc.render.film_transparent=False; sc.world.color=(.18,.18,.18)
    sc.view_settings.view_transform='AgX'; sc.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)

def merge_parts(parent):
    for mat in list(bpy.data.materials):
        obs=[o for o in list(parent.children) if o.type=='MESH' and o.data.materials and o.data.materials[0]==mat]
        if not obs: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join()
        o=bpy.context.object;o.name=parent.name+'_'+mat.name
        if not o.data.uv_layers:
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT')

def animate(rig,lid,latches):
    objects=[rig,lid,*latches]
    for name in ['Chest_Idle','Chest_Hover','Chest_Selected','Chest_Shake','Chest_Open','Chest_RewardHold']:
        for o in objects:o.animation_data_create();o.animation_data.action=None
        frames=range(1,62) if name=='Chest_Open' else [1,31]
        for frame in frames:
            progress=(frame-1)/60 if name=='Chest_Open' else (1 if name=='Chest_RewardHold' else 0)
            pose(rig,lid,progress)
            for latch in latches:
                latch.rotation_euler.x=-.5*min(1,progress*5) if name=='Chest_Open' else (-.5 if name=='Chest_RewardHold' else 0)
            for o in objects:
                o.keyframe_insert('location',frame=frame);o.keyframe_insert('rotation_euler',frame=frame)
        for o in objects:
            action=o.animation_data.action;action.name=name+'_'+o.name
            track=o.animation_data.nla_tracks.new();track.name=name
            strip=track.strips.new(name,1,action);strip.name=name
            o.animation_data.action=None;track.mute=True
    pose(rig,lid,0)
    for l in latches:l.rotation_euler.x=0

def export(path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.collections['EXPORT'].all_objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_extras=True)

reset()
body=material('Case_Lacquer',(.065,.025,.13),.08,.34)
gold=material('Champagne_Trim',(.67,.43,.16),.82,.27)
lining=material('Interior',(.026,.019,.045),0,.68)
root=empty('BF_Case_Root');rig=empty('BF_Case_Tilt',root);lid=empty('BF_Case_LidPivot',rig,(0,0,.018))
shell('Base',rig,-.10,0,body,gold,lining)
shell('Lid',lid,.008,.10,body,gold,lining)
cube('Amount_Plate',(.97,.32,.012),(0,-.39,.046),gold,lid,.024,5)
number=empty('BF_UI_NumberAnchor',rig,(0,-.39,-.115))
amount=empty('BF_UI_AmountAnchor',lid,(0,-.39,.033))
empty('BF_FX_RewardAnchor',lid,(0,-.39,.03));empty('BF_SFX_LatchAnchor',rig,(0,-.79,.01))
latches=[]
for i,x in enumerate([-.46,.46]):
    lp=empty('BF_Latch_'+str(i),rig,(x,-.782,-.025));latches.append(lp)
    cube('Latch_Plate_'+str(i),(.12,.04,.09),(0,0,0),gold,lp,.01)
    cube('Latch_Recess_'+str(i),(.047,.008,.035),(0,-.023,0),lining,lp,.006)
    cube('Hinge_'+str(i),(.18,.054,.06),(x,0,.014),gold,rig,.022,5)
if DETAILED:
    pts=[(-.22,-.79,-.04),(-.22,-.87,-.04),(-.18,-.93,-.04),(.18,-.93,-.04),(.22,-.87,-.04),(.22,-.79,-.04)]
    # Explicit capped sweep keeps the handle manifold at every path joint.
    vertices=[];faces=[];sides=12
    for i,p in enumerate(pts):
        tangent=(Vector(pts[min(i+1,len(pts)-1)])-Vector(pts[max(0,i-1)])).normalized()
        normal=Vector((-tangent.y,tangent.x,0))
        for j in range(sides):
            a=2*math.pi*j/sides
            vertices.append(Vector(p)+.025*(math.cos(a)*normal+math.sin(a)*Vector((0,0,1))))
    for i in range(len(pts)-1):
        for j in range(sides):
            k=(j+1)%sides;faces.append((i*sides+j,i*sides+k,(i+1)*sides+k,(i+1)*sides+j))
    faces.extend([tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+j for j in range(sides))])
    mesh=bpy.data.meshes.new('Handle_Profile');mesh.from_pydata(vertices,[],faces);mesh.update()
    o=bpy.data.objects.new('Handle',mesh);bpy.data.collections['EXPORT'].objects.link(o);o.parent=rig;o.data.materials.append(gold)
    cube('Handle_Grip',(.34,.056,.056),(0,-.93,-.04),lining,rig,.022,5)
for p in [rig,lid,*latches]:merge_parts(p)
pose(rig,lid,0)
tag='v006_blockout' if not DETAILED else 'v007_model'
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source'/('briefcase_'+tag+'.blend')))
for name,eye in [('front',(0,-4,1.1)),('three_quarter',(2.5,-3,2)),('side',(4,-.3,1)),('rear',(0,4,1.2))]:
    render(ART/'previews'/(tag+'_'+name+'.png'),eye,(0,-.45,.55))
if DETAILED:
    for name,p in [('laid',.48),('half',.72),('open',1)]:
        pose(rig,lid,p);render(ART/'previews'/('v007_'+name+'.png'),(2,-3,2),(0,-.35,.45))
    animate(rig,lid,latches)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source'/'briefcase_v008_animation.blend'))
    export(ROOT/'public/assets/models/runtime/BF_Briefcase_v008.glb')
    # Lower bevel resolution is baked into a separate source/export checkpoint.
    for o in bpy.data.collections['EXPORT'].all_objects:
        if o.type=='MESH' and len(o.data.polygons)>100:
            bpy.context.view_layer.objects.active=o
            mod=o.modifiers.new('Distant_simplification','DECIMATE');mod.ratio=.55
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source'/'briefcase_v008_low.blend'))
    export(ROOT/'public/assets/models/runtime/BF_Briefcase_v008_low.glb')
print('BRIEFCASE_PHASE_COMPLETE',PHASE)
