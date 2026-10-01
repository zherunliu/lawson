import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const executable = resolve(root, 'web/node_modules/.bin/gltf-transform')
const requestedArguments = new Set(process.argv.slice(2))
const requestedVersions = new Set([...requestedArguments].filter((value) => /^v\d+$/.test(value)))
const requestedOutputs = new Set([...requestedArguments].filter((value) => value.endsWith('.glb')))

const jobs = [
  ['a1-stock.glb', 'a1-stock-web.glb', 'v01', '8192'],
  ['a1-fixture.glb', 'a1-fixture-web.glb', 'v01', '8192'],
  ['full-stock.glb', 'full-stock-web.glb', 'v02', '8192'],
  ['store-static.glb', 'store-static-web.glb', 'v02', '8192'],
  ['store-roof.glb', 'store-roof-web.glb', 'v02', '8192'],
  ['full-stock.glb', 'full-stock-web.glb', 'v03', '8192'],
  ['store-static.glb', 'store-static-web.glb', 'v03', '8192'],
  ['store-roof.glb', 'store-roof-web.glb', 'v03', '8192'],
  ['full-stock.glb', 'full-stock-web.glb', 'v04', '8192'],
  ['store-static.glb', 'store-static-web.glb', 'v04', '8192'],
  ['store-roof.glb', 'store-roof-web.glb', 'v04', '8192'],
  ['full-stock.glb', 'full-stock-web.glb', 'v05', '8192'],
  ['store-static.glb', 'store-static-web.glb', 'v05', '8192'],
  ['store-roof.glb', 'store-roof-web.glb', 'v05', '8192'],
]

const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'lawson-assets-'))

try {
  for (const [input, output, version, textureSize] of jobs) {
    if (requestedVersions.size && !requestedVersions.has(version)) continue
    if (requestedOutputs.size && !requestedOutputs.has(output)) continue
    const exportRoot = resolve(root, `art/web-export-${version}`)
    const jobRaw = resolve(exportRoot, 'raw')
    const jobRuntime = resolve(exportRoot, 'runtime')
    if (!existsSync(resolve(jobRaw, input))) continue
    mkdirSync(jobRuntime, { recursive: true })

    const prepared = resolve(temporaryRoot, `${version}-${input}`)
    const prepareResult = spawnSync(
      executable,
      [
        'optimize',
        resolve(jobRaw, input),
        prepared,
        '--compress',
        'false',
        '--flatten',
        'false',
        '--join',
        'false',
        '--instance',
        'false',
        '--palette',
        'false',
        '--simplify',
        'false',
        '--texture-compress',
        'webp',
        '--texture-size',
        textureSize,
      ],
      { stdio: 'inherit' },
    )
    if (prepareResult.status !== 0) process.exit(prepareResult.status ?? 1)

    const compressResult = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, 'compress-geometry.mjs'),
        prepared,
        resolve(jobRuntime, output),
        input.includes('stock') ? 'stock' : 'scene',
      ],
      { stdio: 'inherit' },
    )
    if (compressResult.status !== 0) process.exit(compressResult.status ?? 1)
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
