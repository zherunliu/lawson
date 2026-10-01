// Preserve scene positions and normals exactly. The old high-level meshopt
// preset quantized large batches and reduced normals to an 8-bit filter.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireCLI = createRequire(fs.realpathSync(resolve(import.meta.dirname, '../node_modules/@gltf-transform/cli/package.json')))
const { NodeIO } = requireCLI('@gltf-transform/core')
const { ALL_EXTENSIONS, EXTMeshoptCompression } = requireCLI('@gltf-transform/extensions')
const { reorder, quantize } = requireCLI('@gltf-transform/functions')
const { MeshoptEncoder, MeshoptDecoder } = requireCLI('meshoptimizer')
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
const [input, output, mode] = process.argv.slice(2)
if (!input || !output || !['scene', 'stock'].includes(mode)) throw new Error('Expected input output scene|stock')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const document = await io.read(input)
await document.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }))
if (mode === 'stock') {
  // Each SKU has its own compact bounds, so 16-bit position quantization is
  // sub-millimetric by a wide margin. Keep float normals to preserve shading.
  await document.transform(quantize({ pattern: /^(POSITION|TEXCOORD_\d+)$/, quantizePosition: 16, quantizeTexcoord: 16 }))
}
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
})
await io.write(output, document)
console.log('GEOMETRY_COMPRESSED', mode, output)
