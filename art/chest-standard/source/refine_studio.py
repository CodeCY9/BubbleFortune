"""Blender 5.2 refinement of approved, measured checkpoints. Run model then export."""
import bpy, math, sys, json
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
MODE=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'chest'
exec((ROOT/'art/chest-standard/source/build_briefcase.py').read_text().split('\nreset()\n')[0])
TEX=ROOT/'art/chest-standard/source/textures';TEX.mkdir(exist_ok=True)

def grain(material, name, color, roughness, strength, seed):
    """Periodic authored micro-height map converted to portable tangent normals."""
    rng=np.random.default_rng(seed); n=512
    h=rng.random((n,n)).astype(np.float32)
    for _ in range(3):h=(h+np.roll(h,1,0)+np.roll(h,-1,0)+np.roll(h,1,1)+np.roll(h,-1,1))/5
    gx=(np.roll(h,-1,1)-np.roll(h,1,1))*strength
    gy=(np.roll(h,-1,0)-np.roll(h,1,0))*strength
    normal=np.stack((-gx,-gy,np.ones_like(h)),axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    pixels=np.ones((n,n,4),np.float32);pixels[:,:,:3]=normal*.5+.5
    im=bpy.data.images.new(name,width=n,height=n,alpha=False);im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(pixels.ravel());im.filepath_raw=str(TEX/(name+'.png'));im.file_format='PNG';im.save();im.pack()
    p=material.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=roughness
    ns=material.node_tree.nodes;ls=material.node_tree.links
    tex=ns.new('ShaderNodeTexImage');tex.image=im
    uv=ns.new('ShaderNodeTexCoord');mapping=ns.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(5,5,5)
    ls.new(uv.outputs['UV'],mapping.inputs['Vector']);ls.new(mapping.outputs['Vector'],tex.inputs['Vector'])
    normalnode=ns.new('ShaderNodeNormalMap');normalnode.inputs['Strength'].default_value=.55
    ls.new(tex.outputs['Color'],normalnode.inputs['Color']);ls.new(normalnode.outputs['Normal'],p.inputs['Normal'])

def cylinder(name,loc,radius,depth,mat,parent,axis='Z'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=radius,depth=depth)
    o=bpy.context.object;move(o);o.name=name;o.parent=parent;o.location=loc
    if axis=='X':o.rotation_euler.y=math.pi/2
    if axis=='Y':o.rotation_euler.x=math.pi/2
    o.data.materials.append(mat)
    mod=o.modifiers.new('machined_edge','BEVEL');mod.width=.002;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def save_render_chest():
    rig=bpy.data.objects['BF_Case_Tilt'];lid=bpy.data.objects['BF_Case_LidPivot']
    for name,eye in [('front',(0,-4,1)),('three_quarter',(2,-3,1.8)),('side',(4,-.3,1)),('rear',(0,4,1))]:
        pose(rig,lid,0);render(ART/'previews'/('v009_'+name+'.png'),eye,(0,-.35,.48),2.1)
    for name,p in [('half',.72),('open',1)]:
        pose(rig,lid,p);render(ART/'previews'/('v009_'+name+'.png'),(1.4,-3,1.7),(0,-.35,.45),2.1)
    pose(rig,lid,0)

if MODE=='chest':
    bpy.ops.wm.open_mainfile(filepath=str(ART/'source/briefcase_v008_animation.blend'))
    rig=bpy.data.objects['BF_Case_Tilt'];lid=bpy.data.objects['BF_Case_LidPivot'];gold=bpy.data.materials['Champagne_Trim'];body=bpy.data.materials['Case_Lacquer'];lining=bpy.data.materials['Interior']
    grain(body,'leather_normal',(.035,.011,.060),.48,3.0,81)
    grain(lining,'velvet_normal',(.043,.009,.060),.89,.9,83)
    gold.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.62,.46,.27,1)
    gold.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.31
    # Expanded framed display covers most of the interior lid, within its shell.
    cube('Wide_Plaque_Frame',(1.19,.49,.014),(0,-.39,.026),gold,lid,.017,4)
    plaque=lining
    cube('Wide_Plaque_Inset',(1.13,.43,.010),(0,-.39,.015),plaque,lid,.012,4)
    bpy.data.objects['BF_UI_AmountAnchor'].location=(0,-.39,.007)
    for parent,z in [(rig,-.112),(lid,.118)]:
        for x in [-.657,.657]:
            for y in [-.73,-.05]:
                cylinder('Corner_Rivet',(x,y,z),.012,.006,gold,parent)
        # Fine piping defines the inset, avoiding hundreds of stitch meshes.
        for x in [-.618,.618]:cube('Leather_Piping',(.007,.595,.006),(x,-.39,z),lining,parent,.002,2)
        for y in [-.689,-.091]:cube('Leather_Piping',(1.235,.007,.006),(0,y,z),lining,parent,.002,2)
    for i,x in enumerate([-.46,.46]):
        lp=bpy.data.objects['BF_Latch_'+str(i)]
        cylinder('Latch_Pivot',(0,-.025,.025),.012,.105,gold,lp,'X')
        cube('Latch_Catch',(.076,.012,.05),(0,-.028,-.002),gold,lp,.008,3)
        for dx in [-.066,0,.066]:cylinder('Hinge_Knuckle',(x+dx,0,.014),.031,.06,gold,rig,'X')
    for x in [-.22,.22]:
        cube('Handle_Foot',(.088,.035,.055),(x,-.794,-.04),gold,rig,.012,3)
        cylinder('Handle_Pin',(x,-.812,-.04),.013,.062,gold,rig,'X')
    for parent in [rig,lid,bpy.data.objects['BF_Latch_0'],bpy.data.objects['BF_Latch_1']]:merge_parts(parent)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source/briefcase_v009_material.blend'))
    save_render_chest()
    print('CHEST_MATERIAL_CHECKPOINT_READY')

if MODE=='export':
    bpy.ops.wm.open_mainfile(filepath=str(ART/'source/briefcase_v009_material.blend'))
    export(ROOT/'public/assets/models/runtime/BF_Briefcase_v009.glb')
    for o in bpy.data.collections['EXPORT'].all_objects:
        if o.type=='MESH' and len(o.data.polygons)>100:
            bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Mobile_LOD','DECIMATE');mod.ratio=.48;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source/briefcase_v009_low.blend'))
    export(ROOT/'public/assets/models/runtime/BF_Briefcase_v009_low.glb')
    print('CHEST_EXPORT_READY')
