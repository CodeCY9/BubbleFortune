"""Build a single visible stage and matching public slot transforms in Blender 5.2."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
ART=ROOT/'art/stage-basic'

def mat(name,color,metal=0,rough=.45):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m

def finish(o,name,material,bevel=.02):
    o.name=name;o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('Edge_radius','BEVEL');m.width=bevel;m.segments=2;bpy.ops.object.modifier_apply(modifier=m.name)
        m=o.modifiers.new('Face_normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=m.name)
    return o

def box(name,loc,dims,material,angle=0,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=dims
    finish(o,name,material,bevel);o.rotation_euler.z=angle
    return o

def arc(name,rin,rout,bottom,top,material,half=.92):
    n=64;vs=[]
    for z in [bottom,top]:
        for r in [rin,rout]:
            vs.extend([(math.sin(-half+2*half*i/n)*r,-math.cos(-half+2*half*i/n)*r,z) for i in range(n+1)])
    stride=n+1;faces=[]
    for i in range(n):
        faces.extend([(i,i+1,stride+i+1,stride+i),(2*stride+i,3*stride+i,3*stride+i+1,2*stride+i+1),
                      (i,2*stride+i,2*stride+i+1,i+1),(stride+i,stride+i+1,3*stride+i+1,3*stride+i)])
    faces.extend([(0,stride,3*stride,2*stride),(n,2*stride+n,3*stride+n,stride+n)])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o,name,material,.018)

layouts={}
for count,counts in [(26,[6,7,7,6]),(16,[5,6,5])]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene;sc.unit_settings.system='METRIC';sc.world=bpy.data.worlds.new('StageWorld');sc.world.color=(.12,.12,.12)
    col=bpy.data.collections.new('EXPORT');sc.collection.children.link(col)
    bpy.context.view_layer.active_layer_collection=bpy.context.view_layer.layer_collection.children['EXPORT']
    stone=mat('Stage_Indigo',(.029,.025,.065),.12,.46)
    topmat=mat('Stage_Porcelain',(.20,.17,.27),.08,.38)
    gold=mat('Stage_Champagne',(.58,.35,.12),.78,.3)
    slots=[];radii=[7,9.4,11.8,14.2];heights=[.30,1.85,3.60,5.65]
    box('Stage_Foundation',(0,-7,-.2),(28,22,.4),stone,bevel=.12)
    for row,n in enumerate(counts):
        r=radii[row];h=heights[row]
        arc('Display_Tier_'+str(row),r-1.25,r+.8,-.02,h-.12,stone)
        arc('Tier_Lip_'+str(row),r-1.26,r-1.20,h-.19,h-.14,gold)
        for j in range(n):
            theta=(j-(n-1)/2)*2.05/r
            x=math.sin(theta)*r;y=-math.cos(theta)*r
            # Open footprint extends toward stage center; podium is centered under it.
            pr=r-.37
            box('Podium_'+str(row)+'_'+str(j),(math.sin(theta)*pr,-math.cos(theta)*pr,h-.06),(1.78,1.46,.12),topmat,math.pi+theta,.04)
            box('Podium_Trim_'+str(row)+'_'+str(j),(math.sin(theta)*pr,-math.cos(theta)*pr,h-.135),(1.80,1.48,.035),gold,math.pi+theta,.016)
            slot={'position':[round(x,6),h,round(-y,6)],'rotation':[0,round(math.pi+theta,8),0], 'row':row}
            slots.append(slot)
    # Retain numbered order from the back toward the front, never encode an amount.
    slots=sorted(slots,key=lambda s:-s['row'])
    for i,s in enumerate(slots):
        o=bpy.data.objects.new('BoxSlot_'+str(i).zfill(2),None);col.objects.link(o)
        o.location=(s['position'][0],-s['position'][2],s['position'][1]);o.rotation_euler.z=s['rotation'][1]
    last_r=radii[len(counts)-1];last_h=heights[len(counts)-1]
    arc('Backdrop',last_r+.95,last_r+1.18,0,last_h+2.2,stone)
    arc('Backdrop_Crown',last_r+.90,last_r+1.21,last_h+2.17,last_h+2.23,gold)
    for j in range(13):
        a=-.85+1.7*j/12;r=last_r+.91
        box('Backdrop_Rib_'+str(j),(math.sin(a)*r,-math.cos(a)*r,(last_h+2)/2),(.055,.10,last_h+2),gold,-a,.012)
    # Join static pieces by material: exactly one stage, three material batches.
    for material in [stone,topmat,gold]:
        obs=[o for o in list(col.objects) if o.type=='MESH' and o.data.materials[0]==material]
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();bpy.context.object.name=material.name
    path=ROOT/'public/assets/models/runtime'/('BF_DisplayStage_'+str(count)+'_v006.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source'/('display_stage_'+str(count)+'_v006.blend')))
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=False,export_extras=True)
    layouts[str(count)]={'stage': '/assets/models/runtime/'+path.name,'slots':slots}
    # Preview a genuine single-LOD stage before runtime composition.
    bpy.ops.object.camera_add(location=(0,4,7));cam=bpy.context.object;cam.rotation_euler=(Vector((0,-8,3))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=26;sc.camera=cam
    for loc,power,size in [((-5,0,10),2200,8),((5,-10,12),3200,8)]:
        bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,-8,2))-o.location).to_track_quat('-Z','Y').to_euler()
    sc.render.engine='CYCLES';sc.cycles.samples=24;sc.render.resolution_x=1280;sc.render.resolution_y=800;sc.render.resolution_percentage=100
    sc.render.filepath=str(ART/'previews'/('stage_'+str(count)+'_v006.png'));bpy.ops.render.render(write_still=True)
(ROOT/'src/stage-layout.json').write_text(json.dumps(layouts,indent=2),encoding='utf-8')
print('STAGE_COMPLETE')
