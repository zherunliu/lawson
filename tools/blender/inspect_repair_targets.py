import bpy, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/store-v12-product-geometry/lawson-complete-v12-optimized-closeup-v6.blend'))
scene=bpy.data.scenes['01 总场景 · 完整世界']
for sku, ids in {'new_118':[81,125],'new_3009':[67,89],'campus_blue':[87,99,97,103]}.items():
    obj=next(o for o in scene.objects if o.get('sku')==sku)
    for i in ids:
        f=obj.data.polygons[i]
        print('TARGET',json.dumps({'sku':sku,'face':i,'area':f.area,'normal':list(f.normal),'vertices':[list(obj.data.vertices[v].co) for v in f.vertices],'material':obj.data.materials[f.material_index].name}),flush=True)
