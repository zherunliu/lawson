import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Box3, Matrix4, Vector3 } from 'three'

const root = resolve(import.meta.dirname, '../..')
const req = createRequire(fs.realpathSync(resolve(root, 'web/node_modules/@gltf-transform/cli/package.json')))
const { NodeIO } = req('@gltf-transform/core')
const { ALL_EXTENSIONS } = req('@gltf-transform/extensions')
const { MeshoptDecoder } = req('meshoptimizer')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
function doors(doc) {
  const values = doc.getRoot().listNodes().filter(n => n.getExtras().door_id)
  assert.equal(values.length, 8)
  return values.map(n => {
    const bounds = new Box3(), p = new Vector3()
    assert.ok(n.getExtras().door_width > 0.90 && n.getExtras().door_width < 0.92)
    assert.equal(n.listChildren().length, 1)
    let triangles = 0
    for (const child of n.listChildren()) {
      const matrix = new Matrix4().fromArray(child.getWorldMatrix())
      for (const primitive of child.getMesh().listPrimitives()) {
        const position = primitive.getAttribute('POSITION')
        triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3
        for (let i = 0; i < position.getCount(); i++) bounds.expandByPoint(p.fromArray(position.getElement(i, [])).applyMatrix4(matrix))
      }
    }
    assert.ok(triangles > 100)
    const hinge = n.getTranslation()
    assert.ok(Math.abs(hinge[2] + 3.53) < 1e-5)
    assert.ok(bounds.max.x - bounds.min.x > 0.88)
    assert.ok(bounds.max.y - bounds.min.y > 1.6)
    return { id: n.getExtras().door_id, hinge, min: bounds.min.toArray(), max: bounds.max.toArray(), triangles }
  })
}
const raw = doors(await io.read(resolve(root, 'art/web-export-v05/raw/store-static.glb')))
const runtime = doors(await io.read(resolve(root, 'art/web-export-v05/runtime/store-static-web.glb')))
for (const door of raw) {
  const match = runtime.find(d => d.id === door.id)
  assert.ok(match)
  assert.equal(door.triangles, match.triangles)
  for (const field of ['hinge', 'min', 'max']) door[field].forEach((v, i) => assert.ok(Math.abs(v - match[field][i]) < 1e-5))
}
fs.writeFileSync(resolve(root, 'art/web-interaction-repair-20261001/door-verification.json'), JSON.stringify({ raw, runtime }, null, 2))
console.log('All 8 door pivots, closed bounds and mesh triangles preserved in runtime assets')
