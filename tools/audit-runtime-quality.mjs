import fs from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Matrix4, Vector3 } from 'three'

const root = resolve(import.meta.dirname, '../..')
const req = createRequire(fs.realpathSync(resolve(root, 'web/node_modules/@gltf-transform/cli/package.json')))
const { NodeIO } = req('@gltf-transform/core')
const { ALL_EXTENSIONS } = req('@gltf-transform/extensions')
const { MeshoptDecoder } = req('meshoptimizer')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const out = resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9) ?? resolve(root, 'art/web-surface-audit-20261001'))
const exportRoot = resolve(process.argv.find(a=>a.startsWith('--export='))?.slice(9) ?? resolve(root, 'art/web-export-v02'))
const position = (p, i, matrix) => new Vector3().fromArray(p.getElement(i, [])).applyMatrix4(matrix)
function stats(doc) {
  let triangles = 0, invalidNormals = 0, missingNormals = 0, degenerate = 0
  const primitives = []
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const beforeDegenerate = degenerate
    const pos = p.getAttribute('POSITION'), normal = p.getAttribute('NORMAL'), indices = p.getIndices()
    const count = indices?.getCount() ?? pos.getCount()
    triangles += count / 3
    if (!normal) missingNormals++
    else for (let i=0;i<normal.getCount();i++) {
      const v=normal.getElement(i,[]), len=Math.hypot(...v)
      if (!Number.isFinite(len) || len < .9 || len > 1.1) invalidNormals++
    }
    const a=new Vector3(),b=new Vector3(),c=new Vector3()
    for(let i=0;i<count;i+=3){
      a.fromArray(pos.getElement(indices?indices.getScalar(i):i,[]))
      b.fromArray(pos.getElement(indices?indices.getScalar(i+1):i+1,[])).sub(a)
      c.fromArray(pos.getElement(indices?indices.getScalar(i+2):i+2,[])).sub(a)
      if (b.cross(c).lengthSq()===0) degenerate++
    }
    primitives.push({mesh:mesh.getName(),material:p.getMaterial()?.getName(),triangles:count/3,exactZeroAreaTriangles:degenerate-beforeDegenerate})
  }
  return { nodes:doc.getRoot().listNodes().length,meshes:doc.getRoot().listMeshes().length,triangles,invalidNormals,missingNormals,exactZeroAreaTriangles:degenerate,primitives }
}
function meshBounds(node){
  const m=new Matrix4().fromArray(node.getWorldMatrix()),lo=new Vector3(Infinity,Infinity,Infinity),hi=new Vector3(-Infinity,-Infinity,-Infinity)
  for(const p of node.getMesh().listPrimitives()){
    const pos=p.getAttribute('POSITION')
    for(let i=0;i<pos.getCount();i++){const v=position(pos,i,m);lo.min(v);hi.max(v)}
  }
  return [lo.toArray(),hi.toArray()]
}
const layers=[]
for(const name of ['full-stock','store-static','store-roof']){
  const rawPath=resolve(exportRoot,`raw/${name}.glb`),runPath=resolve(exportRoot,`runtime/${name}-web.glb`)
  const raw=await io.read(rawPath),runtime=await io.read(runPath)
  const r=stats(raw),c=stats(runtime)
  const rawNodes=raw.getRoot().listNodes().filter(n=>n.getMesh())
  const runtimeNodes=runtime.getRoot().listNodes().filter(n=>n.getMesh())
  const byName=new Map(runtimeNodes.map(n=>[n.getName(),n]))
  const rows=[],seen=new Set()
  for(const node of rawNodes){
    const key=node.getExtras().sku || node.getName()
    if(seen.has(key))continue
    seen.add(key)
    const other=byName.get(node.getName())
    if(!other){rows.push({key,missing:true});continue}
    const rb=meshBounds(node),cb=meshBounds(other)
    const scale=other.getWorldScale()
    const quantized=other.getMesh().listPrimitives().some(p=>p.getAttribute('POSITION').getComponentType()===5122)
    rows.push({key,name:node.getName(),maxBoundsErrorMeters:Math.max(...rb.flat().map((v,i)=>Math.abs(v-cb.flat()[i]))),
      quantizationStepMeters:quantized?Math.max(...scale.map(Math.abs))/32767:0,
      rawTriangles:node.getMesh().listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),
      runtimeTriangles:other.getMesh().listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0)})
  }
  const samples=[]
  if(name==='full-stock')for(const sku of ['new_118','kanzen_dry','new_3009','campus_blue','cup_original','new_9107','new_9109','new_9110','new_9111','new_9113','new_9114']){
    const node=rawNodes.find(n=>n.getExtras().sku===sku),other=byName.get(node.getName())
    const inverse=new Matrix4().fromArray(node.getWorldMatrix()).invert()
    const original=[]
    for(const p of node.getMesh().listPrimitives()){const a=p.getAttribute('POSITION');for(let i=0;i<a.getCount();i++)original.push(new Vector3().fromArray(a.getElement(i,[])))}
    const matrix=new Matrix4().fromArray(other.getWorldMatrix()).premultiply(inverse)
    let maxError=0
    const horizontal=[]
    for(const p of other.getMesh().listPrimitives()){
      const a=p.getAttribute('POSITION'),idx=p.getIndices(),pts=[]
      for(let i=0;i<a.getCount();i++){
        const v=position(a,i,matrix);pts.push(v)
        maxError=Math.max(maxError,Math.sqrt(Math.min(...original.map(o=>o.distanceToSquared(v)))))
      }
      const planes=new Map()
      for(let i=0;i<(idx?.getCount()??a.getCount());i+=3){
        const tri=[0,1,2].map(k=>pts[idx?idx.getScalar(i+k):i+k])
        if(Math.max(...tri.map(p=>p.y))-Math.min(...tri.map(p=>p.y))<1e-7){const h=tri[0].y.toFixed(7);planes.set(h,(planes.get(h)||0)+1)}
      }
      horizontal.push({material:p.getMaterial()?.getName(),planes:Object.fromEntries(planes)})
    }
    samples.push({sku,maxNearestVertexErrorMeters:maxError,horizontal})
  }
  layers.push({name,raw:r,runtime:c,rawBytes:fs.statSync(rawPath).size,runtimeBytes:fs.statSync(runPath).size,geometry:rows,samples})
  console.log(name,JSON.stringify({raw:{...r,primitives:r.primitives.length},runtime:{...c,primitives:c.primitives.length},maxBoundsError:Math.max(...rows.map(r=>r.maxBoundsErrorMeters||0)),samples:samples.map(({sku,maxNearestVertexErrorMeters})=>({sku,maxNearestVertexErrorMeters}))}))
}
fs.mkdirSync(out,{recursive:true})
fs.writeFileSync(resolve(out,'runtime-audit.json'),JSON.stringify({layers,limitations:['Bounding-box difference is not a per-vertex error metric. Nearest-vertex checks cover five representative SKUs only.','Zero-area triangles alone do not establish a visible defect.','This scan checks geometry and normal integrity, not all shading or texture behavior.']},null,2))
