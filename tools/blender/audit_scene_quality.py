"""Read-only source audit. Writes evidence, never saves the opened .blend.

Axis-aligned convex face overlap is a conservative subset, not a complete
mesh intersection/visibility test. Contact surfaces can be intentional.
"""
import bpy
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--output=')), str(ROOT / 'art/web-surface-audit-20261001')))
SOURCE = Path(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--source=')), str(ROOT / 'art/store-v12-product-geometry/lawson-complete-v12-optimized-closeup-v6.blend')))
CAT = {p['id']: p for p in json.loads((ROOT / 'art/store-v10-whole-fixture/catalog.json').read_text())['products']}

def area(points):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1])) / 2

def cross(a,b,p):
    return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])

def convex(points):
    return all(cross(a,b,c) >= -1e-12 for a,b,c in zip(points,points[1:]+points[:1],points[2:]+points[:2]))

def overlap(a,b):
    if any(min(a['bounds'][k][1],b['bounds'][k][1])-max(a['bounds'][k][0],b['bounds'][k][0]) <= 1e-7 for k in (0,1)):
        return 0
    points = a['points']
    for c,d in zip(b['points'], b['points'][1:]+b['points'][:1]):
        source = points
        points = []
        if not source: return 0
        previous = source[-1]
        dp = cross(c,d,previous)
        for p in source:
            dc = cross(c,d,p)
            if (dc >= 0) != (dp >= 0):
                t = dp/(dp-dc)
                points.append([previous[0]+t*(p[0]-previous[0]),previous[1]+t*(p[1]-previous[1])])
            if dc >= 0: points.append(p)
            previous, dp = p, dc
    return abs(area(points)) if len(points)>2 else 0

def plane_record(p, coordinates):
    # Only exact axis-parallel planes; the thresholds are in mesh units/metres.
    ranges = [(min(v[a] for v in coordinates),max(v[a] for v in coordinates)) for a in range(3)]
    axes = [a for a in range(3) if ranges[a][1]-ranges[a][0] < 1e-7]
    if len(axes)!=1: return None
    axis = axes[0]
    dims = [a for a in range(3) if a!=axis]
    points = [[v[a] for a in dims] for v in coordinates]
    signed = area(points)
    if abs(signed)<1e-10: return None
    if signed<0: points.reverse()
    if not convex(points): return None
    return {'face':p.index,'axis':axis,'distance':(ranges[axis][0]+ranges[axis][1])/2,
            'sign':1 if signed>0 else -1,'mat':p.material_index,'points':points,
            'bounds':[ranges[a] for a in dims],'area':abs(signed)}

def analyze(obj, mesh=None):
    m=mesh if mesh is not None else obj.data
    records=defaultdict(list)
    exact=defaultdict(list)
    edges=defaultdict(list)
    rings=[]
    zero=0
    uniform_uv={}
    uv_layer=m.uv_layers.active
    for p in m.polygons:
        if uv_layer:
            values={tuple(round(c,6) for c in uv_layer.data[i].uv) for i in p.loop_indices}
            if len(values)==1:uniform_uv[p.index]=next(iter(values))
        if p.area<1e-12: zero+=1
        coords=[tuple(m.vertices[v].co) for v in p.vertices]
        exact[tuple(sorted(tuple(round(c,7) for c in v) for v in coords))].append(p.index)
        rec=plane_record(p,coords)
        if rec:
            records[(rec['axis'],round(rec['distance'],6))].append(rec)
            if len(coords)>=8:
                pts=rec['points']; cx=sum(v[0] for v in pts)/len(pts); cy=sum(v[1] for v in pts)/len(pts)
                radii=[math.hypot(v[0]-cx,v[1]-cy) for v in pts]
                r=sum(radii)/len(radii)
                if r and (max(radii)-min(radii))/r<.025:
                    rings.append({'face':p.index,'segments':len(coords),'radius':r,'axis':rec['axis'],'distance':rec['distance']})
        if len(m.polygons)<50000:
            for edge in p.edge_keys: edges[edge].append(p.index)
    overlaps=[]
    for values in records.values():
        for i,a in enumerate(values):
            for b in values[i+1:]:
                hit=overlap(a,b)
                if hit>1e-9 and hit/min(a['area'],b['area'])>.01:
                    overlaps.append({'faces':[a['face'],b['face']],'axis':a['axis'],'distance':a['distance'],
                        'separation':abs(a['distance']-b['distance']),'area':hit,
                        'same_facing':a['sign']==b['sign'],'different_material':a['mat']!=b['mat'],
                        'different_color_uv':a['face'] in uniform_uv and b['face'] in uniform_uv and uniform_uv[a['face']]!=uniform_uv[b['face']],
                        'materials':[m.materials[x['mat']].name if m.materials[x['mat']] else '' for x in [a,b]]})
    gentle_flat=0
    for face_ids in edges.values():
        if len(face_ids)!=2: continue
        a,b=(m.polygons[i] for i in face_ids)
        angle=math.degrees(a.normal.angle(b.normal,0))
        if 3<angle<45 and not (a.use_smooth and b.use_smooth): gentle_flat+=1
    return {'vertices':len(m.vertices),'faces':len(m.polygons),'triangles':sum(len(p.vertices)-2 for p in m.polygons),
        'smooth_faces':sum(p.use_smooth for p in m.polygons),'custom_normals':m.has_custom_normals,
        'zero_area_faces':zero,'duplicate_faces':[v for v in exact.values() if len(v)>1],
        'overlaps':overlaps,'circular_caps':rings,'flat_gentle_edges':gentle_flat,
        'edge_audit_skipped':len(m.polygons)>=50000,
        'boundary_edges':sum(len(v)==1 for v in edges.values()),'nonmanifold_edges':sum(len(v)>2 for v in edges.values())}

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene=bpy.data.scenes['01 总场景 · 完整世界']
bpy.context.window.scene=scene
bpy.context.view_layer.update()
depsgraph=bpy.context.evaluated_depsgraph_get()
objects=[o for o in scene.objects if o.type in {'MESH','FONT','CURVE'} and not o.hide_render]
cache={}
rows=[]
fonts=[]
cross_planes=defaultdict(list)
exact_objects=defaultdict(list)
for k,obj in enumerate(objects):
    if k%500==0: print('AUDIT_PROGRESS',k,len(objects),flush=True)
    if obj.type!='MESH':
        fonts.append({'object':obj.name,'type':obj.type,'resolution':obj.data.resolution_u,'body':getattr(obj.data,'body','')})
        continue
    sku=str(obj.get('sku') or '')
    key=obj.data.as_pointer() if sku else obj.as_pointer()
    evaluated=obj.evaluated_get(depsgraph) if obj.modifiers else None
    mesh=evaluated.to_mesh() if evaluated else obj.data
    if key not in cache: cache[key]=analyze(obj,mesh)
    row={'object':obj.name,'mesh':obj.data.name,'sku':sku,'name':CAT.get(sku,{}).get('name',''),
         'shape':CAT.get(sku,{}).get('shape',''),'collections':[c.name for c in obj.users_collection],
         'modifiers':[(m.name,m.type,m.show_viewport,m.show_render) for m in obj.modifiers],
         'materials':[m.name if m else '' for m in obj.data.materials],
         'scale':list(obj.scale),'mesh_key':key,'source_faces':len(obj.data.polygons),
         'evaluated':bool(evaluated)}
    rows.append(row)
    if sku:
        if evaluated: evaluated.to_mesh_clear()
        continue
    exact_objects[(obj.data.as_pointer(),tuple(round(v,7) for r in obj.matrix_world for v in r))].append(obj.name)
    # World-space overlap candidates between near-store static objects.
    if max(abs(obj.matrix_world.translation.x),abs(obj.matrix_world.translation.y))>30 or len(mesh.polygons)>5000:
        if evaluated: evaluated.to_mesh_clear()
        continue
    for p in mesh.polygons:
        rec=plane_record(p,[tuple(obj.matrix_world @ mesh.vertices[v].co) for v in p.vertices])
        if rec:
            rec['object']=obj.name
            rec['material']=mesh.materials[p.material_index].name if mesh.materials[p.material_index] else ''
            cross_planes[(rec['axis'],round(rec['distance'],5))].append(rec)
    if evaluated: evaluated.to_mesh_clear()

print('AUDIT_CROSS_OBJECTS',sum(len(v) for v in cross_planes.values()),flush=True)
cross_hits=[]
for group in cross_planes.values():
    group.sort(key=lambda r:r['bounds'][0][0])
    for i,a in enumerate(group):
        for b in group[i+1:]:
            if b['bounds'][0][0]>=a['bounds'][0][1]: break
            if a['object']==b['object']: continue
            if abs(a['distance']-b['distance'])>2e-6: continue
            hit=overlap(a,b)
            if hit>1e-8 and hit/min(a['area'],b['area'])>.02:
                cross_hits.append({'objects':[a['object'],b['object']],'faces':[a['face'],b['face']],
                    'axis':a['axis'],'distance':a['distance'],'separation':abs(a['distance']-b['distance']),
                    'area':hit,'same_facing':a['sign']==b['sign'],
                    'materials':[a['material'],b['material']]})

products=[]; static=[]
for key,stats in cache.items():
    members=[r for r in rows if r['mesh_key']==key]
    entry={**members[0],**stats,'instances':len(members),'objects':[r['object'] for r in members]}
    (products if entry['sku'] else static).append(entry)
summary={'source_objects':len(objects),'mesh_objects':len(rows),'product_instances':sum(p['instances'] for p in products),
    'unique_products':len(products),'static_mesh_instances':sum(p['instances'] for p in static),'static_mesh_records':len(static),
    'fonts_curves':len(fonts),'products_overlap':sum(bool(p['overlaps']) for p in products),
    'products_same_facing_different_material_overlap':sum(any(h['same_facing'] and h['different_material'] for h in p['overlaps']) for p in products),
    'products_same_facing_different_color_uv_overlap':sum(any(h['same_facing'] and h['different_color_uv'] for h in p['overlaps']) for p in products),
    'products_low_round_segments':sum(any(r['segments']<=24 for r in p['circular_caps']) for p in products),
    'products_flat_gentle_edges':sum(p['flat_gentle_edges']>0 for p in products),
    'static_overlap_meshes':sum(bool(p['overlaps']) for p in static),
    'static_cross_overlap_pairs':len(cross_hits),'static_cross_same_facing':sum(h['same_facing'] for h in cross_hits),
    'static_duplicate_placements':[v for v in exact_objects.values() if len(v)>1]}
payload={'source':str(SOURCE),'source_mtime':SOURCE.stat().st_mtime,'summary':summary,'products':products,'static':static,
    'static_objects':rows,'fonts_curves':fonts,'static_cross_overlaps':cross_hits,
    'limitations':['Coplanar overlap scan covers axis-aligned convex faces only; angled, concave, near-coplanar and non-planar intersections need further checks.',
    'Cross-object scan excludes meshes over 5000 faces and distant objects over 30m on X/Y. Same-facing overlaps are candidates until visibility is checked.',
    'Boundary edges are not automatically defects: printing and films can intentionally be open.',
    'Low-segment detector uses circular polygon caps; open or triangulated circles may not be counted.',
    'Mesh audit includes evaluated viewport modifiers; any viewport/render modifier mismatch must be checked separately. Exported geometry is checked separately.']}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'source-audit.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
print('AUDIT_COMPLETE',json.dumps(summary,ensure_ascii=False),flush=True)
