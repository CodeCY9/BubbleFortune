"""Layered studio architecture, preserving previously measured case sockets."""
import bpy, bmesh, math, json, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
exec((ROOT/'art/stage-basic/source/build_display_stage.py').read_text().split('\nlayouts={}')[0].replace('n=64','n=24'))
MODE=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'model'
layouts=json.loads((ROOT/'src/stage-layout.json').read_text())

for count in [16,26]:
    if MODE=='export':
        bpy.ops.wm.open_mainfile(filepath=str(ART/'source'/f'display_stage_{count}_v007.blend'))
    else:
        bpy.ops.wm.open_mainfile(filepath=str(ART/'source'/f'display_stage_{count}_v006.blend'))
        sc=bpy.context.scene;col=bpy.data.collections['EXPORT'];bpy.context.view_layer.active_layer_collection=bpy.context.view_layer.layer_collection.children['EXPORT']
        last_h=3.60 if count==16 else 5.65
        stone=bpy.data.materials['Stage_Indigo'];topmat=bpy.data.materials['Stage_Porcelain'];gold=bpy.data.materials['Stage_Champagne']
        for m,c,r in [(stone,(.024,.012,.038),.48),(topmat,(.095,.059,.098),.36),(gold,(.61,.45,.27),.3)]:
            p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=r
        # Lower the old continuous deck to expose the independent layered plinths.
        for name in ['Stage_Indigo','Stage_Champagne']:
            obj=bpy.data.objects[name];inv=obj.matrix_world.inverted()
            for v in obj.data.vertices:
                p=obj.matrix_world@v.co
                if p.z>last_h+1.95:p.z+=2.4
                for r,h in zip([7,9.4,11.8,14.2],[.3,1.85,3.6,5.65]):
                    if name=='Stage_Indigo' and abs(p.z-(h-.12))<.022:
                        p.z-=min(.30,h-.14);break
                    if name=='Stage_Champagne' and r-1.31<math.hypot(p.x,p.y)<r-1.15 and h-.22<p.z<h-.12:
                        p.z-=min(.30,h-.14);break
                v.co=inv@p
        panel=mat('Wall_Inset',(.047,.025,.052),.06,.56)
        warm=mat('Practical_Light',(.85,.6,.3),0,.4);p=warm.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(1,.63,.28,1);p.inputs['Emission Strength'].default_value=2
        for i,s in enumerate(layouts[str(count)]['slots']):
            x,h,z=s['position'];a=s['rotation'][1];theta=a-math.pi;r=math.hypot(x,z)-.37
            px=math.sin(theta)*r;py=-math.cos(theta)*r
            # The measured top and hinge height remain unchanged; layers grow downwards.
            box('Podium_Recess_'+str(i),(px,py,h-.235),(1.67,1.35,.18),stone,a,.045)
            box('Podium_Foot_'+str(i),(px,py,h-.325),(1.84,1.51,.075),topmat,a,.03)
            box('Podium_Lower_Reveal_'+str(i),(px,py,h-.286),(1.77,1.44,.016),gold,a,.006)
        nr=3 if count==16 else 4;last_r=[7,9.4,11.8,14.2][nr-1];last_h=[.3,1.85,3.6,5.65][nr-1]
        for row,(r,h) in enumerate(zip([7,9.4,11.8,14.2],[.3,1.85,3.6,5.65])):
            if row>=nr:break
            arc('Tier_Base_Reveal',r-1.28,r-1.21,h-.56,h-.535,gold)
        # Architectural bays on the existing concave wall, clear of all box silhouettes.
        for j in range(9):
            a=-.76+1.52*j/8;r=last_r+.90
            box('Wall_Panel_'+str(j),(math.sin(a)*r,-math.cos(a)*r,last_h+2.35),(.185*r,.075,3.95),panel,a,.035)
        # Actual extruded wordmark, no generated billboard plane.
        cu=bpy.data.curves.new('Studio_Wordmark','FONT');cu.body='BubbleFortune';cu.align_x='CENTER';cu.size=1.05;cu.extrude=.012;cu.bevel_depth=0;cu.resolution_u=3
        font=Path('C:/Windows/Fonts/georgia.ttf')
        if font.exists():cu.font=bpy.data.fonts.load(str(font))
        box('Wordmark_Backplate',(0,-last_r-.02,last_h+3.02),(6.7,.12,1.2),stone,bevel=.06)
        o=bpy.data.objects.new('Studio_Wordmark',cu);col.objects.link(o);o.location=(0,-last_r+.08,last_h+2.65);o.rotation_euler=(math.pi/2,0,math.pi);o.data.materials.append(gold)
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
        o=bpy.context.object;bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
        for material in [stone,topmat,gold,panel]:
            obs=[o for o in col.objects if o.type=='MESH' and o.data.materials[0]==material]
            if not obs:continue
            bpy.ops.object.select_all(action='DESELECT')
            for o in obs:o.select_set(True)
            bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();o=bpy.context.object;o.name=material.name
            if not o.data.uv_layers:
                bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.wm.save_as_mainfile(filepath=str(ART/'source'/f'display_stage_{count}_v007.blend'))
        bpy.ops.object.camera_add(location=(0,4,7));cam=bpy.context.object;cam.rotation_euler=(Vector((0,-8,3))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=26;sc.camera=cam
        for loc,power,size in [((-5,0,10),2700,8),((5,-10,12),2000,6)]:
            bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,-8,2))-o.location).to_track_quat('-Z','Y').to_euler()
        sc.render.engine='CYCLES';sc.cycles.samples=24;sc.render.resolution_x=1280;sc.render.resolution_y=800;sc.render.resolution_percentage=100
        sc.render.filepath=str(ART/'previews'/f'stage_{count}_v007.png');bpy.ops.render.render(write_still=True)
    if MODE=='export':
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.data.collections['EXPORT'].all_objects:o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/assets/models/runtime'/f'BF_DisplayStage_{count}_v007.glb'),export_format='GLB',use_selection=True,export_animations=False,export_extras=True)
print('STUDIO_STAGE_CHECKPOINT_READY',MODE)
