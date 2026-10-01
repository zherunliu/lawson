"""Read-only regression checks against the final V8 Blender source."""
import bpy, bmesh, math, json, importlib.util
from pathlib import Path
from mathutils import Vector

spec=importlib.util.spec_from_file_location('cold_repair',Path(__file__).with_name('repair_cold_cases_meals.py'))
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)
bpy.ops.wm.open_mainfile(filepath=str(repair.TARGET))
scene=bpy.data.scenes['01 总场景 · 完整世界'];bpy.context.window.scene=scene
bpy.context.view_layer.update()
cases=[]
for zone in ['C1','C2','C3','C4']:
    base=scene.objects[zone+' / plinth'];panel=scene.objects[zone+' / recessed kick']
    origin=Vector((base.location.x,3.5,.06));direction=Vector((0,1,0))
    inverse=base.matrix_world.inverted()
    hit,point,normal,index=base.ray_cast(inverse@origin,(inverse.to_3x3()@direction).normalized())
    assert hit,zone
    world=base.matrix_world@point
    assert abs(world.y-3.64)<1e-5,(zone,tuple(world))
    front=min((panel.matrix_world@Vector(v)).y for v in panel.bound_box)
    assert 3.63<front<world.y-.001
    cases.append({'zone':zone,'recess_ray_hit_y':world.y,'panel_front_y':front})
products={str(o['sku']):o for o in scene.objects if o.type=='MESH' and o.get('sku')}
assert len(products)==846
mesh=products['new_9114'].data;w,d,h=repair.CAT['new_9114']['dims']
bm=bmesh.new();bm.from_mesh(mesh)
shrimp=[]
for group in repair.components(bm):
    low=min(v.co.z for v in group);high=max(v.co.z for v in group)
    if low>=h*.35 and h*.6<high<h*.78:shrimp.extend(group)
assert shrimp
clearance=min(w*.49*(.79+.21*min(1,max(0,(v.co.z/h-.07)/.66)))-math.hypot(v.co.x,v.co.y) for v in shrimp)
assert clearance>.0014,clearance
raised=[f for f in bm.faces if f.normal.z>.999 and f.calc_area()>.005 and
        all(abs(v.co.z-(h*.46+.0015))<1e-6 for v in f.verts)]
assert len(raised)==1,'Rice top must be above the ivory rice bed'
assert all(math.hypot(v.co.x,v.co.y)<.075 for v in raised[0].verts)
bm.free()
result={'source':str(repair.TARGET),'cases':cases,'unique_products':len(products),
        'shrimp_wall_clearance_after_refinement_m':clearance,'raised_rice_top':True}
(repair.OUT/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('COLD_MEAL_VERIFIED',json.dumps(result),flush=True)
