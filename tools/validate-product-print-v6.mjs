import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const buffer = await readFile(resolve(root, 'art/web-export-v02/raw/full-stock.glb'))
const jsonLength = buffer.readUInt32LE(12)
const data = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString())
const binStart = 28 + jsonLength
const readUV = (index) => {
  const accessor = data.accessors[index]
  const view = data.bufferViews[accessor.bufferView]
  if (accessor.componentType !== 5126) throw new Error('Unexpected raw UV component type')
  const offset = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = view.byteStride ?? 8
  return Array.from({ length: accessor.count }, (_, i) => [
    buffer.readFloatLE(offset + i * stride), buffer.readFloatLE(offset + i * stride + 4),
  ])
}
const nodes = new Map(data.nodes.map((node) => [node.mesh, node]))
let vertices = 0, worstOutside = 0
const failures = []
for (const [meshIndex, mesh] of data.meshes.entries()) {
  const node = nodes.get(meshIndex)
  const extra = node.extras
  for (const primitive of mesh.primitives) {
    if (!('NORMAL' in primitive.attributes) || !('TEXCOORD_0' in primitive.attributes))
      failures.push({ sku: extra.sku, reason: 'Missing normal or UV' })
    if (!/\/ product (front|back) atlas$/.test(data.materials[primitive.material].name)) continue
    for (const [u, v] of readUV(primitive.attributes.TEXCOORD_0)) {
      const x = (u * extra.atlas_width - extra.atlas_x) / extra.atlas_inner_size
      const y = (v * extra.atlas_height - extra.atlas_y) / extra.atlas_inner_size
      const outside = Math.max(0, -x, -y, x - 1, y - 1)
      worstOutside = Math.max(worstOutside, outside)
      if (!Number.isFinite(outside) || outside > 0.00002)
        failures.push({ sku: extra.sku, reason: 'Print UV outside island', uv: [x, y] })
      vertices++
    }
  }
}
const report = {
  nodes: data.nodes.length, meshes: data.meshes.length, materials: data.materials.length,
  allNormalsAndUVs: !failures.some((x) => x.reason === 'Missing normal or UV'),
  printVertices: vertices, worstUVOutside: worstOutside,
  transparentMaterials: data.materials.filter((m) => m.alphaMode === 'BLEND').map((m) => ({ name: m.name, doubleSided: m.doubleSided })),
  failures,
}
await writeFile(resolve(root, 'art/store-v12-product-geometry/qa/glb-print-validation-v6.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, failures: failures.length }))
if (failures.length || report.nodes !== 3880 || report.meshes !== 846) process.exitCode = 1
