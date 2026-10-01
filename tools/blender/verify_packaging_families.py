"""Read-only V8/V9 invariants: SKU counts, bounds, untouched geometry hashes."""
import bpy, json, hashlib, array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'art/web-interaction-repair-20261001'
report=json.loads((OUT/'repairs.json').read_text())
changed={p['sku'] for p in report['products']}

def snapshot(path):
    bpy.ops.wm.open_mainfile(filepath=path)
    scene=bpy.data.scenes['01 总场景 · 完整世界'];products={};instances=0
    for obj in scene.objects:
        if obj.type!='MESH' or not obj.get('sku'):continue
        instances+=1;sku=str(obj['sku'])
        if sku in products:continue
        mesh=obj.data;digest=hashlib.sha256()
        for collection,field,width,kind in [(mesh.vertices,'co',3,'f'),(mesh.loops,'vertex_index',1,'i'),(mesh.polygons,'material_index',1,'i')]:
            buffer=array.array(kind,[0])*(len(collection)*width)
            collection.foreach_get(field,buffer);digest.update(buffer.tobytes())
        if mesh.uv_layers.active:
            buffer=array.array('f',[0])*(len(mesh.loops)*2)
            mesh.uv_layers.active.data.foreach_get('uv',buffer);digest.update(buffer.tobytes())
        products[sku]={'hash':digest.hexdigest(),'bounds':[(min(v.co[i] for v in mesh.vertices),max(v.co[i] for v in mesh.vertices)) for i in range(3)]}
    assert instances==3880 and len(products)==846
    return products

before=snapshot(report['source']);after=snapshot(report['target'])
for sku,original in before.items():
    current=after[sku]
    assert max(abs(a-b) for ab,cd in zip(original['bounds'],current['bounds']) for a,b in zip(ab,cd))<1e-6,(sku,'bounds changed')
    if sku not in changed:assert original['hash']==current['hash'],(sku,'unexpected change')
audit=json.loads((OUT/'source-audit.json').read_text())
assert audit['summary']['products_same_facing_different_color_uv_overlap']==0
assert audit['summary']['products_same_facing_different_material_overlap']==0
result={'instances':3880,'skus':846,'repaired_skus':len(changed),'unchanged_geometry_and_uv_hashes':846-len(changed),'all_product_bounds_preserved':True,'audited_color_overlap_remaining':0}
(OUT/'geometry-verification.json').write_text(json.dumps(result,indent=2))
print('FAMILY_VERIFIED',json.dumps(result),flush=True)
