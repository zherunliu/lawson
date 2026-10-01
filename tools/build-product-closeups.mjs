import { cpus } from 'node:os'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import sharp from 'sharp'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(root, 'art/store-v12-product-geometry/textures/closeup')
const output = resolve(root, 'art/web-export-v02/runtime/product-textures')
const generated = resolve(root, 'art/web-export-v02/generated')
const files = (await readdir(source)).filter((file) => file.endsWith('.png')).sort()
const skuArgument = process.argv.find((argument) => argument.startsWith('--sku='))
const selectedSkus = skuArgument ? new Set(skuArgument.slice(6).split(',')) : null
const pendingFiles = selectedSkus
  ? files.filter((file) => selectedSkus.has(file.replace(/-(front|back)\.png$/, '')))
  : files
const concurrency = Math.min(12, Math.max(4, cpus().length))
const tileSize = 256
const padding = 4
const innerSize = tileSize - padding * 2
const columns = 32

await mkdir(output, { recursive: true })
await mkdir(generated, { recursive: true })

let cursor = 0
let writtenBytes = 0
async function worker() {
  while (cursor < pendingFiles.length) {
    const file = pendingFiles[cursor]
    cursor += 1
    const result = await sharp(resolve(source, file))
      .webp({ effort: 4, lossless: true })
      .toFile(resolve(output, file.replace(/\.png$/, '.webp')))
    writtenBytes += result.size
    await sharp(resolve(source, file))
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .webp({ effort: 4, lossless: true })
      .toFile(resolve(output, file.replace(/\.png$/, '-near.webp')))
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))

const variants = new Map()
for (const file of files) {
  const match = file.match(/^(.*)-(front|back)\.png$/)
  if (!match) continue
  const [, sku, side] = match
  const record = variants.get(sku) ?? {}
  record[side] = file
  variants.set(sku, record)
}
const skus = [...variants.keys()].sort()
const rows = Math.ceil(skus.length / columns)
const width = columns * tileSize
const height = rows * tileSize
const items = {}

const composites = { front: [], back: [] }
for (const [index, sku] of skus.entries()) {
  const column = index % columns
  const row = Math.floor(index / columns)
  const x = column * tileSize
  const yTop = row * tileSize
  const yBottom = height - yTop - tileSize
  items[sku] = { column, index, row, x, yBottom, yTop }
  for (const side of ['front', 'back']) {
    const file = variants.get(sku)?.[side]
    if (!file) continue
    const input = await sharp(resolve(source, file))
      .resize(innerSize, innerSize, { fit: 'fill' })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        extendWith: 'copy',
      })
      .png()
      .toBuffer()
    composites[side].push({ input, left: x, top: yTop })
  }
}

for (const side of ['front', 'back']) {
  await sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  })
    .composite(composites[side])
    .png({ compressionLevel: 9 })
    .toFile(resolve(generated, `product-${side}-atlas.png`))
}

const manifest = { columns, height, innerSize, items, padding, rows, tileSize, width }
await writeFile(
  resolve(generated, 'product-atlas.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)

console.log(
  `PRODUCT_CLOSEUPS ${files.length} files, ${(writtenBytes / 1024 / 1024).toFixed(2)} MB; `
    + `SHELF_ATLAS ${skus.length} SKUs, ${width}x${height}`,
)
