"""Create V7 from V6, preserving UVs, material slots and shared SKU geometry.

Conservative repairs from the October surface audit. Never overwrite V6.
Only analytically verified circular rings are refined; no blanket subdivision.
"""
import bpy, bmesh, json, math
import numpy as np
from mathutils import Vector
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT/'art/store-v12-product-geometry'
SOURCE = BASE/'lawson-complete-v12-optimized-closeup-v6.blend'
TARGET = BASE/'lawson-complete-v12-optimized-closeup-v7.blend'
OUT = ROOT/'art/web-surface-repair-20261001'
AUDIT = json.loads((ROOT/'art/web-surface-audit-20261001/source-audit.json').read_text())
ROUND_SHAPES = {'cup','bowl','doublecup','can','canstack','twinjar','smallbottle','jar',
    'pump','cupstack','platestack','pumpbottle','spraycan','cosmetic','bottle','ribbedpet',
    'bottlecan','winebottle','parfait','icecup','toothpicks','rollpack','dessert_special'}

def triangles(mesh): return sum(len(p.vertices)-2 for p in mesh.polygons)

def separate_film(bm, mesh, audit):
    affected = set()
    for hit in audit['overlaps']:
        if hit['same_facing'] and hit['different_material']:
            for index, name in zip(hit['faces'],hit['materials']):
                if 'film' in name.lower() or 'transparent' in name.lower(): affected.add(index)
    bm.faces.ensure_lookup_table()
    seeds=[bm.faces[i] for i in affected]
    visited=set(); moved=0
    for seed in seeds:
        if seed in visited: continue
        component={seed}; pending=[seed]
        while pending:
            face=pending.pop()
            for v in face.verts:
                for other in v.link_faces:
                    name=mesh.materials[other.material_index].name.lower()
                    if ('film' in name or 'transparent' in name) and other not in component:
                        component.add(other); pending.append(other)
        visited.update(component)
        verts={v for f in component for v in f.verts}
        # Detach shared film vertices first, retaining face-loop UVs. Expanding
        # a shell must not drag the opaque food/container along with it.
        if any(any(f not in component for f in v.link_faces) for v in verts):
            edges={e for f in component for e in f.edges}
            copied=bmesh.ops.duplicate(bm,geom=list(verts|edges|component))['geom']
            bmesh.ops.delete(bm,geom=list(component),context='FACES_ONLY')
            component={g for g in copied if isinstance(g,bmesh.types.BMFace)}
            verts={v for f in component for v in f.verts}
        lo=[min(v.co[i] for v in verts) for i in range(3)]
        hi=[max(v.co[i] for v in verts) for i in range(3)]
        normal=sum((f.normal for f in component),Vector()).normalized()
        for v in verts:
            for i in range(3):
                extent=hi[i]-lo[i]
                if extent>1e-6:
                    center=(hi[i]+lo[i])/2
                    v.co[i]=center+(v.co[i]-center)*(1+.00046/extent)
                else: v.co[i]+=.00023*normal[i]
        moved+=len(component)
    return moved

def refine_round_rings(bm, max_angle=30.05):
    # Connected horizontal edge chains isolate rings/printed arcs from other
    # parts of a package at the same height. Fit a circle and reject rectangles,
    # ellipses, tiny hardware and non-circular chains before touching topology.
    horizontal={e for e in bm.edges if abs(e.verts[0].co.z-e.verts[1].co.z)<1e-7}
    unseen=set(horizontal); rings=[]; chosen=[]
    while unseen:
        edge=unseen.pop(); edges={edge}; verts=set(edge.verts); pending=list(edge.verts)
        while pending:
            v=pending.pop()
            for e in v.link_edges:
                if e not in unseen: continue
                unseen.remove(e); edges.add(e)
                for other in e.verts:
                    if other not in verts: verts.add(other); pending.append(other)
        if not 4<=len(verts)<=160: continue
        pts=np.array([(v.co.x,v.co.y) for v in verts])
        design=np.column_stack((2*pts[:,0],2*pts[:,1],np.ones(len(pts))))
        solution,_,rank,_=np.linalg.lstsq(design,np.sum(pts*pts,axis=1),rcond=None)
        if rank<3: continue
        cx,cy=solution[:2]; radii=np.linalg.norm(pts-[cx,cy],axis=1); radius=float(radii.mean())
        rx=ry=radius
        if np.max(np.abs(radii-radius))>max(1e-7,radius*.0005):
            # Some pump bottles use true elliptical rings, not circles. Fit an
            # axis-aligned ellipse, rejecting arbitrary packaging fold chains.
            if len(verts)<8: continue
            design=np.column_stack((pts[:,0]**2,pts[:,1]**2,pts[:,0],pts[:,1]))
            solution,_,rank,_=np.linalg.lstsq(design,np.ones(len(pts)),rcond=None)
            aa,bb,dd,ee=solution
            if rank<4 or aa<=0 or bb<=0: continue
            cx,cy=-dd/(2*aa),-ee/(2*bb); kk=1+aa*cx*cx+bb*cy*cy
            rx,ry=math.sqrt(kk/aa),math.sqrt(kk/bb)
            radial=np.linalg.norm((pts-[cx,cy])/[rx,ry],axis=1)
            if np.max(np.abs(radial-1))>.0005: continue
        if not .006<=min(rx,ry)<=max(rx,ry)<=.14: continue
        angles=[]
        for e in edges:
            a,b=e.verts
            dot=(a.co.x-cx)*(b.co.x-cx)/(rx*rx)+(a.co.y-cy)*(b.co.y-cy)/(ry*ry)
            angles.append(math.acos(max(-1,min(1,dot))))
        if not angles or max(angles)>math.radians(max_angle) or sum(angles)<math.radians(25): continue
        if max(angles)<math.radians(6): continue
        # Record the original chords so new vertices are reprojected only onto
        # the ring they actually came from, including nested lids and labels.
        rings.append((float(cx),float(cy),float(rx),float(ry),[(e.verts[0].co.copy(),e.verts[1].co.copy()) for e in edges]))
        chosen.extend(edges)
    if not chosen: return {'rings':0,'vertices_added':0}
    original=set(bm.verts)
    original_positions={tuple(v.co) for v in bm.verts}
    bmesh.ops.subdivide_edges(bm,edges=chosen,cuts=3,use_grid_fill=True)
    added=[v for v in bm.verts if v not in original and tuple(v.co) not in original_positions]
    by_z=defaultdict(list)
    for cx,cy,rx,ry,chords in rings:
        for a,b in chords: by_z[round(a.z,6)].append((cx,cy,rx,ry,a,b))
    projected=set()
    for v in added:
        for cx,cy,rx,ry,a,b in by_z.get(round(v.co.z,6),[]):
            direction=b-a; t=(v.co-a).dot(direction)/direction.length_squared
            if not -1e-5<=t<=1.00001 or (v.co-(a+direction*t)).length>2e-7: continue
            x,y=(v.co.x-cx)/rx,(v.co.y-cy)/ry; length=math.hypot(x,y)
            v.co.x=cx+x*rx/length; v.co.y=cy+y*ry/length
            projected.add(v); break
    bm.normal_update()
    # Subdividing an n-gon can also create interior cap vertices. Those stay
    # in their plane; projecting them to the circumference would collapse it.
    interior=[v for v in added if v not in projected]
    if any(any(abs(f.normal.z)<=.999 for f in v.link_faces) for v in interior):
        print('UNPROJECTED',[(tuple(v.co),[tuple(f.normal) for f in v.link_faces]) for v in interior],flush=True)
    assert all(all(abs(f.normal.z)>.999 for f in v.link_faces) for v in interior), ('Unprojected side vertices',len(added),len(projected))
    bm.normal_update()
    curved={f for v in projected for f in v.link_faces if abs(f.normal.z)<.999}
    for f in curved: f.smooth=True
    for e in bm.edges:
        if any(f in curved for f in e.link_faces) and len(e.link_faces)==2:
            e.smooth=all(f.smooth for f in e.link_faces) and e.calc_face_angle()<math.radians(45)
    return {'rings':len(rings),'vertices_added':len(added),'smooth_faces':len(curved)}

def main():
    if TARGET.exists(): raise RuntimeError('V7 exists; inspect it before replacing')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene=bpy.data.scenes['01 总场景 · 完整世界']; bpy.context.window.scene=scene
    objects={}
    for obj in scene.objects:
        if obj.type=='MESH' and obj.get('sku'): objects.setdefault(str(obj['sku']),obj)
    results=[]
    for record in AUDIT['products']:
        sku=record['sku']; obj=objects[sku]; mesh=obj.data
        rounds=record['shape'] in ROUND_SHAPES
        film=any(h['same_facing'] and h['different_material'] and any('film' in m.lower() or 'transparent' in m.lower() for m in h['materials']) for h in record['overlaps'])
        if not (rounds or film or sku=='campus_blue'): continue
        before=triangles(mesh); bm=bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
        change={'sku':sku,'before_triangles':before}
        if film: change['film_faces_separated']=separate_film(bm,mesh,record)
        if sku in {'new_118','kanzen_dry','new_3009'}:
            index=89 if sku=='new_3009' else 81
            assert mesh.materials[bm.faces[index].material_index].name=='STOCK / shared material colors'
            bm.faces.remove(bm.faces[index]); change['removed_duplicate_face']=index
        if sku=='campus_blue':
            # Trim the spine's inner edge to the cover boundary, retaining the
            # exposed spine strip instead of deleting the partly overlapped face.
            count=0
            for v in bm.verts:
                if abs(v.co.x+.0895)<1e-7: v.co.x=-.0905; count+=1
            assert count>0
            change['trimmed_spine_vertices']=count
        if rounds:
            print('REFINE',sku,flush=True)
            change.update(refine_round_rings(bm))
        bm.to_mesh(mesh); bm.free(); mesh.update()
        assert all(math.isfinite(c) for v in mesh.vertices for c in v.co)
        assert all(math.isfinite(c) for uv in mesh.uv_layers for loop in uv.data for c in loop.uv)
        change['after_triangles']=triangles(mesh); results.append(change)
        if len(results)%25==0: print('REPAIR_PROGRESS',len(results),flush=True)
    OUT.mkdir(parents=True,exist_ok=True)
    payload={'source':str(SOURCE),'target':str(TARGET),'products':results,
        'scope':'Opaque duplicates; independent transparent shells; verified circular rings. No blanket smoothing or removal of static contact faces.'}
    (OUT/'model-repairs.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
    print('REPAIR_COMPLETE',len(results),str(TARGET),flush=True)

if __name__=='__main__': main()
