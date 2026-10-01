"""Targeted V8: real refrigerator toe recesses and contained round-bowl food."""
import bpy, bmesh, json, math, importlib.util
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'art/store-v12-product-geometry'
SOURCE=BASE/'lawson-complete-v12-optimized-closeup-v7.blend'
TARGET=BASE/'lawson-complete-v12-optimized-closeup-v8.blend'
OUT=ROOT/'art/web-cold-meal-repair-20261001'
spec=importlib.util.spec_from_file_location('surface_repair',Path(__file__).with_name('repair_surface_quality.py'))
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)
CAT={p['id']:p for p in json.loads((ROOT/'art/store-v10-whole-fixture/catalog.json').read_text())['products']}

def components(bm):
    unseen=set(bm.verts); result=[]
    while unseen:
        seed=unseen.pop(); group={seed}; pending=[seed]
        while pending:
            v=pending.pop()
            for e in v.link_edges:
                other=e.other_vert(v)
                if other in unseen: unseen.remove(other);group.add(other);pending.append(other)
        result.append(group)
    return result

def fix_rice(mesh, product):
    w,d,h=product['dims']; bm=bmesh.new();bm.from_mesh(mesh)
    groups=components(bm)
    lo=(-w*.425,-d*.40,h*.14);hi=(w*.025,d*.40,h*.46)
    matches=[]
    for verts in groups:
        bounds=[(min(v.co[i] for v in verts),max(v.co[i] for v in verts)) for i in range(3)]
        if all(abs(bounds[i][0]-lo[i])<1e-6 and abs(bounds[i][1]-hi[i])<1e-6 for i in range(3)):
            matches.append(verts)
    assert len(matches)==1,('Rice block not uniquely located',len(matches))
    verts=matches[0];faces={f for v in verts for f in v.link_faces}
    assert len(faces)==6
    face=next(iter(faces));mat=face.material_index;uvlayer=bm.loops.layers.uv.active
    color_uv=face.loops[0][uvlayer].uv.copy()
    bmesh.ops.delete(bm,geom=list(verts),context='VERTS')
    # Circular segment on the left, with a 1.5 mm clearance from the actual
    # tapered bowl wall at the bottom of the rice, not just the wider rim.
    radius=w*.49*(.79+(.14-.07)/(.73-.07)*(.21))-.0015
    outline=[(radius*math.cos(i*2*math.pi/96),radius*math.sin(i*2*math.pi/96)) for i in range(96)]
    # Clip a convex circle by the original rice portion rectangle.
    for axis,bound,sign in [(0,lo[0],1),(0,hi[0],-1),(1,lo[1],1),(1,hi[1],-1)]:
        source=outline;outline=[];previous=source[-1];dp=(previous[axis]-bound)*sign
        for point in source:
            dc=(point[axis]-bound)*sign
            if (dc>=0)!=(dp>=0):
                t=dp/(dp-dc);outline.append(tuple(previous[i]+t*(point[i]-previous[i]) for i in range(2)))
            if dc>=0:outline.append(point)
            previous,dp=point,dc
    lower=[bm.verts.new((x,y,lo[2])) for x,y in outline]
    # The original yellow portion and ivory rice bed both ended at h*.46.
    # They share a color-atlas material, so material-only overlap audits miss
    # the different-UV coplanar surfaces. Give the portion a real raised top.
    rice_lift=.0015
    upper=[bm.verts.new((x,y,hi[2]+rice_lift)) for x,y in outline]
    newfaces=[bm.faces.new(list(reversed(lower))),bm.faces.new(upper)]
    for i in range(len(outline)):
        j=(i+1)%len(outline);newfaces.append(bm.faces.new([lower[i],lower[j],upper[j],upper[i]]))
    for f in newfaces:
        f.material_index=mat
        for loop in f.loops:loop[uvlayer].uv=color_uv
    # Translate complete rice-grain components inward; never squash individual
    # grain vertices onto the bowl boundary. Identify by their original layer.
    moved=0;worst=0
    for group in groups:
        if group is verts:continue
        zmin=min(v.co.z for v in group);zmax=max(v.co.z for v in group)
        if not (h*.44<zmin<h*.48 and h*.47<zmax<h*.51):continue
        if max(v.co.x for v in group)>hi[0]+.005:continue
        for v in group:v.co.z+=rice_lift
        center=sum((v.co for v in group),Vector())/len(group)
        spread=max(math.hypot(v.co.x-center.x,v.co.y-center.y) for v in group)
        dist=math.hypot(center.x,center.y)
        allowed=radius-spread-.0003
        if dist>allowed:
            offset=Vector((center.x*(allowed/dist-1),center.y*(allowed/dist-1),0))
            for v in group:v.co+=offset
            moved+=1
        worst=max(worst,max(math.hypot(v.co.x,v.co.y) for v in group))
    assert worst<=radius+1e-6,(worst,radius)
    bm.normal_update();bm.to_mesh(mesh);bm.free();mesh.update()
    return {'rice_radius_m':radius,'rice_top_clearance_m':rice_lift,'rice_grains_repositioned':moved,'max_grain_radius_m':worst,'outline_vertices':len(outline)}

def contain_shrimp(mesh, product):
    w,d,h=product['dims'];bm=bmesh.new();bm.from_mesh(mesh)
    centers=[Vector((w*(.1+.22*(j%2)),d*(-.27+.25*(j//2)),0)) for j in range(6)]
    assemblies=[set() for _ in centers]
    for group in components(bm):
        low=min(v.co.z for v in group);high=max(v.co.z for v in group)
        if not (low>=h*.35 and h*.6<high<h*.78):continue
        center=sum((v.co for v in group),Vector())/len(group);center.z=0
        nearest=min(range(6),key=lambda i:(center-centers[i]).length)
        assemblies[nearest].update(group)
    assert all(assemblies),'Expected six shrimp assemblies'
    def clearance(group,offset):
        # Match the tapered wall at each vertex height; the top rim alone
        # is too generous and lets the sauce protrude through the side.
        return min(w*.49*(.79+.21*min(1,max(0,(v.co.z/h-.07)/.66)))-
                   math.hypot(v.co.x+offset.x,v.co.y+offset.y) for v in group)
    moved=0
    for center,group in zip(centers,assemblies):
        if clearance(group,Vector())>=.0015:continue
        low=0;high=1
        assert clearance(group,-center)>=.0015
        for _ in range(32):
            t=(low+high)/2
            if clearance(group,-center*t)>=.0015:high=t
            else:low=t
        for v in group:v.co-=center*high
        moved+=1
    minimum=min(clearance(group,Vector()) for group in assemblies)
    assert minimum>=.00149
    bm.normal_update();bm.to_mesh(mesh);bm.free();mesh.update()
    return {'shrimp_assemblies_moved':moved,'shrimp_wall_clearance_m':minimum}

def main():
    assert not TARGET.exists(),'Do not overwrite existing V8'
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene=bpy.data.scenes['01 总场景 · 完整世界'];bpy.context.window.scene=scene
    result={'source':str(SOURCE),'target':str(TARGET),'cases':[],'products':[]}
    for zone in ['C1','C2','C3','C4']:
        base=scene.objects[zone+' / plinth'];kick=scene.objects[zone+' / recessed kick']
        # Bake only this object's own original bevel and normals before cutting.
        bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
        baked=bpy.data.meshes.new_from_object(base.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
        base.data=baked;base.modifiers.clear()
        x=base.location.x;width=base.dimensions.x
        bpy.ops.mesh.primitive_cube_add(size=1,location=(x,3.57,.06))
        cutter=bpy.context.object;cutter.name='TEMP / toe recess cutter';cutter.dimensions=(width-.15,.14,.084)
        bpy.context.view_layer.objects.active=cutter
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        boolean=base.modifiers.new('Actual recessed toe opening','BOOLEAN');boolean.operation='DIFFERENCE';boolean.solver='EXACT';boolean.object=cutter
        bpy.context.view_layer.objects.active=base
        bpy.ops.object.modifier_apply(modifier=boolean.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
        kick.location.y=3.646;kick.location.z=.06
        kick.dimensions=(width-.13,.020,.096)
        bpy.context.view_layer.update()
        assert not base.modifiers
        result['cases'].append({'zone':zone,'recess_opening_z':[.018,.102],'recess_back_y':3.64,'dark_panel_front_y':3.636,'opening_width':width-.15})
    products={}
    for obj in scene.objects:
        if obj.type=='MESH' and obj.get('sku'):products.setdefault(str(obj['sku']),obj)
    for sku in ['new_9107','new_9109','new_9110','new_9111','new_9113','new_9114']:
        mesh=products[sku].data;before=repair.triangles(mesh);entry={'sku':sku,'before_triangles':before}
        if sku=='new_9114':
            entry.update(fix_rice(mesh,CAT[sku]))
            entry.update(contain_shrimp(mesh,CAT[sku]))
        bm=bmesh.new();bm.from_mesh(mesh)
        entry.update(repair.refine_round_rings(bm,max_angle=45.05))
        bm.to_mesh(mesh);bm.free();mesh.update()
        entry['after_triangles']=repair.triangles(mesh);result['products'].append(entry)
        assert all(math.isfinite(c) for v in mesh.vertices for c in v.co)
        print('MEAL_REPAIR',json.dumps(entry),flush=True)
    assert len([o for o in scene.objects if o.get('sku')])==3880
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'repairs.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
    print('V8_SAVED',str(TARGET),flush=True)

if __name__=='__main__':main()
