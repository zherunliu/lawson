import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const req=createRequire(await realpath(resolve(import.meta.dirname,'../node_modules/@gltf-transform/cli/package.json')))
const { Document, NodeIO }=req('@gltf-transform/core')
const { ALL_EXTENSIONS }=req('@gltf-transform/extensions')
const { MeshoptDecoder }=req('meshoptimizer')
await MeshoptDecoder.ready
test('scene compression preserves thin geometry and float normals in a wide batch',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'lawson-compression-test-'))
  try {
    const doc=new Document(),buffer=doc.createBuffer()
    const positions=new Float32Array([0,0,0, .00004,0,0, 0,.00004,0, 40,0,0,40,1,0,39,0,0])
    const normals=new Float32Array(Array.from({length:6},()=>[.1,.2,Math.sqrt(.95)]).flat())
    const accessor=(name,array)=>doc.createAccessor(name).setType('VEC3').setArray(array).setBuffer(buffer)
    const primitive=doc.createPrimitive().setAttribute('POSITION',accessor('positions',positions)).setAttribute('NORMAL',accessor('normals',normals))
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)))
    const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
    const input=resolve(dir,'input.glb'),output=resolve(dir,'output.glb')
    await io.write(input,doc)
    const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'compress-geometry.mjs'),input,output,'scene'],{encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
    const decoded=await io.read(output),p=decoded.getRoot().listMeshes()[0].listPrimitives()[0]
    const sorted=values=>Array.from({length:values.length/3},(_,i)=>Array.from(values.slice(i*3,i*3+3)).join(',')).sort()
    assert.deepEqual(sorted(p.getAttribute('POSITION').getArray()),sorted(positions))
    assert.deepEqual(sorted(p.getAttribute('NORMAL').getArray()),sorted(normals))
    assert.equal(p.getAttribute('POSITION').getComponentType(),5126)
  } finally { await rm(dir,{recursive:true,force:true}) }
})
