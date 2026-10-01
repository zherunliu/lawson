"""Small deterministic Blender regression test; does not read/write assets."""
import bpy, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('exporter',Path(__file__).with_name('export_full_store.py'))
e=importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
bpy.ops.wm.read_factory_settings(use_empty=True)
source_scene=bpy.context.scene
objects=[]
for x,width in [(0,.05),(3,.005)]:
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,0,0))
    obj=bpy.context.object
    bevel=obj.modifiers.new('Own bevel','BEVEL'); bevel.width=width; bevel.segments=3
    objects.append(obj)
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
expected=[]; expected_triangles=0
for obj in objects:
    evaluated=obj.evaluated_get(deps); mesh=evaluated.to_mesh(); mesh.calc_loop_triangles()
    expected_triangles+=len(mesh.loop_triangles)
    expected.extend(tuple(round(c,6) for c in obj.matrix_world@v.co) for v in mesh.vertices)
    evaluated.to_mesh_clear()
joined=e.join_layer(e.new_scene('TEST output'),objects,'joined')
actual=[tuple(round(c,6) for c in joined.matrix_world@v.co) for v in joined.data.vertices]
joined.data.calc_loop_triangles()
assert sorted(actual)==sorted(expected),'Per-object bevel geometry changed during join'
assert len(joined.data.loop_triangles)==expected_triangles
assert not joined.modifiers
assert len(objects[0].modifiers)==1 and len(objects[1].modifiers)==1,'Source objects mutated'
print('PASS individual modifiers preserved; joined modifiers empty; sources untouched',flush=True)
