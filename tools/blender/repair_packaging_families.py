"""V9: partition overlapping color-atlas faces instead of hiding them with offsets.

Only audited, convex, axis-aligned, same-facing, uniform-color faces are changed.
The smaller detail takes precedence; larger backing faces are trimmed around it.
UVs, material slots, silhouette and all non-candidate faces stay in place.
"""
import bpy, bmesh, json, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'art/store-v12-product-geometry/lawson-complete-v12-optimized-closeup-v8.blend'
TARGET=SOURCE.with_name('lawson-complete-v12-optimized-closeup-v9.blend')
OUT=ROOT/'art/web-interaction-repair-20261001'
AUDIT=ROOT/'art/web-cold-meal-repair-20261001/source-audit.json'

def signed_area(poly):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1]))/2

def side(a,b,p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])

def halfplane(poly,a,b,inside):
    output=[];previous=poly[-1];dp=side(a,b,previous)
    for point in poly:
        dc=side(a,b,point)
        ip=dp>=0 if inside else dp<=0
        ic=dc>=0 if inside else dc<=0
        if ip!=ic:
            t=dp/(dp-dc);output.append(tuple(previous[i]+t*(point[i]-previous[i]) for i in range(2)))
        if ic:output.append(point)
        previous,dp=point,dc
    cleaned=[]
    for point in output:
        if not cleaned or math.dist(point,cleaned[-1])>1e-9:cleaned.append(point)
    if len(cleaned)>1 and math.dist(cleaned[0],cleaned[-1])<1e-9:cleaned.pop()
    return cleaned if len(cleaned)>=3 and abs(signed_area(cleaned))>1e-12 else []

def subtract(poly,clip):
    # Emit disjoint outside fragments while passing only the inside remainder
    # to the next clip edge. No holes, offsets or priority-dependent z-buffer.
    remainder=poly;pieces=[]
    for a,b in zip(clip,clip[1:]+clip[:1]):
        if not remainder:break
        outside=halfplane(remainder,a,b,False)
        if outside:pieces.append(outside)
        remainder=halfplane(remainder,a,b,True)
    return pieces

def repair(mesh,row):
    bm=bmesh.new();bm.from_mesh(mesh);bm.faces.ensure_lookup_table()
    original_faces=list(bm.faces)
    uv=bm.loops.layers.uv.active;groups={}
    hits=[h for h in row['overlaps'] if h['same_facing'] and h.get('different_color_uv')]
    for hit in hits:
        for index in hit['faces']:
            face=original_faces[index];axis=hit['axis'];normal=face.normal.copy()
            groups.setdefault((axis,round(hit['distance'],6),round(normal[axis])),set()).add(index)
    altered=0;added=0;removed_area=0
    for (axis,plane,sign),indices in groups.items():
        dims=[i for i in range(3) if i!=axis];records=[]
        for index in indices:
            face=original_faces[index];points=[tuple(v.co[i] for i in dims) for v in face.verts]
            if signed_area(points)<0:points.reverse()
            values={tuple(round(c,6) for c in loop[uv].uv) for loop in face.loops}
            assert len(values)==1
            records.append((face,points,face.loops[0][uv].uv.copy()))
        records.sort(key=lambda r:(abs(signed_area(r[1])),-r[0].index))
        overlays=[]
        for face,points,color in records:
            pieces=[points]
            for clip,other in overlays:
                if (color-other).length<1e-7:continue
                pieces=[part for piece in pieces for part in subtract(piece,clip)]
            overlays.append((points,color))
            before=abs(signed_area(points));after=sum(abs(signed_area(p)) for p in pieces)
            assert after<=before+1e-9
            if before-after<1e-11:continue
            normal=face.normal.copy();material=face.material_index;smooth=face.smooth
            distance=face.verts[0].co[axis]
            bm.faces.remove(face);altered+=1;removed_area+=before-after
            for poly in pieces:
                vertices=[]
                for point in poly:
                    xyz=[0,0,0];xyz[axis]=distance
                    for i,dim in enumerate(dims):xyz[dim]=point[i]
                    vertices.append(bm.verts.new(xyz))
                candidate=bm.faces.new(vertices);candidate.normal_update()
                if candidate.normal.dot(normal)<0:candidate.normal_flip()
                candidate.material_index=material;candidate.smooth=smooth
                for loop in candidate.loops:loop[uv].uv=color
                added+=1
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-8)
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bm.normal_update();bm.to_mesh(mesh);bm.free();mesh.update()
    return {'sku':row['sku'],'name':row['name'],'overlap_pairs':len(hits),'faces_partitioned':altered,'fragments':added,'overlap_area_removed_m2':removed_area}

def main():
    assert not TARGET.exists(),'Preserve existing V9'
    # Known nested/partial overlap examples: areas must be conserved.
    a=[(0,0),(2,0),(2,2),(0,2)];b=[(.5,.5),(1.5,.5),(1.5,1.5),(.5,1.5)]
    assert abs(sum(abs(signed_area(p)) for p in subtract(a,b))-3)<1e-9
    assert subtract(a,a)==[]
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE));scene=bpy.data.scenes['01 总场景 · 完整世界'];bpy.context.window.scene=scene
    products={str(o['sku']):o for o in scene.objects if o.type=='MESH' and o.get('sku')}
    report=[]
    for row in json.loads(AUDIT.read_text())['products']:
        if not any(h['same_facing'] and h.get('different_color_uv') for h in row['overlaps']):continue
        result=repair(products[row['sku']].data,row);report.append(result)
        print('FAMILY_REPAIR',json.dumps(result,ensure_ascii=False),flush=True)
    assert len(report)==28,len(report)
    assert len(products)==846
    doors=[{'name':o.name,'children':len(o.children),'position':list(o.location)} for o in scene.objects if '_GLASS_DOOR_' in o.name]
    assert len(doors)==8,doors
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'repairs.json').write_text(json.dumps({'source':str(SOURCE),'target':str(TARGET),'products':report,'doors':doors},ensure_ascii=False,indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
    print('V9_SAVED',TARGET,flush=True)

if __name__=='__main__':main()
