"""Reproduce exporter joins in memory only, without exporting or saving."""
import bpy, json, importlib.util, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('exporter',Path(__file__).with_name('export_full_store.py'))
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
bpy.ops.wm.open_mainfile(filepath=str(e.SOURCE))
original=bpy.data.scenes[e.SCENE_NAME]
bpy.context.window.scene=original
deps=bpy.context.evaluated_depsgraph_get()
roof=[o for o in original.objects if not o.get('sku') and o.type in {'MESH','FONT','CURVE'} and not o.hide_render and any(c.name==e.ROOF_COLLECTION for c in o.users_collection) and not o.name.startswith('CEILING /')]
static=[o for o in original.objects if not o.get('sku') and o.type in {'MESH','FONT','CURVE'} and not o.hide_render and o not in roof]
groups=[('near',[o for o in static if e.is_near_store(o)]),('far',[o for o in static if not e.is_near_store(o)]),('roof',roof)]
report=[]
def stats(mesh):
    mesh.calc_loop_triangles()
    return {'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'zero_area_triangles':sum(t.area==0 for t in mesh.loop_triangles)}
for name,objects in groups:
    scene=e.new_scene('AUDIT '+name)
    joined=e.join_layer(scene,objects,'AUDIT '+name)
    bpy.context.view_layer.update()
    base=stats(joined.data)
    mods=[{'name':m.name,'type':m.type,'width':getattr(m,'width',None),'segments':getattr(m,'segments',None),'limit_method':getattr(m,'limit_method',None)} for m in joined.modifiers]
    final=joined.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=final.to_mesh();evaluated=stats(mesh);final.to_mesh_clear()
    row={'layer':name,'first_source':objects[0].name,'source_objects':len(objects),'inherited_modifiers':mods,'joined_before_modifiers':base,'joined_after_modifiers':evaluated}
    report.append(row);print('JOIN_AUDIT',json.dumps(row),flush=True)
out=Path(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--audit-output=')),str(ROOT/'art/web-surface-audit-20261001')))
out.mkdir(parents=True,exist_ok=True)
(out/'join-audit.json').write_text(json.dumps(report,indent=2))
