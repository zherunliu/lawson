import fs from 'node:fs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const root=resolve(import.meta.dirname,'../..')
const before=resolve(root,'art/web-surface-audit-20261001')
const after=resolve(root,'art/web-surface-repair-20261001')
const read=(dir,file)=>JSON.parse(fs.readFileSync(resolve(dir,file)))
const original=read(before,'source-audit.json'),source=read(after,'source-audit.json')
const joined=read(after,'join-audit.json'),runtime=read(after,'runtime-audit.json')
const changes=read(after,'model-repairs.json')
const overlap=p=>p.overlaps.some(h=>h.same_facing&&h.different_material)
assert.equal(source.summary.unique_products,846)
assert.equal(source.summary.product_instances,3880)
assert.equal(source.products.filter(overlap).length,0)
assert.ok(joined.every(j=>j.inherited_modifiers.length===0))
for(const layer of runtime.layers){
  assert.equal(layer.raw.triangles,layer.runtime.triangles)
  assert.equal(layer.runtime.missingNormals+layer.runtime.invalidNormals,0)
  if(layer.name!=='full-stock'){
    assert.ok(layer.geometry.every(g=>g.maxBoundsErrorMeters===0))
    assert.equal(layer.raw.exactZeroAreaTriangles,layer.runtime.exactZeroAreaTriangles)
  }
}
for(const sku of ['new_118','kanzen_dry']){
  const p=source.products.find(p=>p.sku===sku)
  assert.ok(p.circular_caps.every(c=>c.segments>=80))
}
const prior=read(before,'runtime-audit.json')
const summary={
  source:changes.target,
  publishedRuntime:resolve(root,'art/web-export-v02/runtime'),
  backup:resolve(after,'backup-v02'),
  checks:{skus:846,instances:3880,sameFacingDifferentMaterialOverlap:[original.products.filter(overlap).length,0],
    refinedProducts:changes.products.filter(p=>p.rings).length,
    separatedFilmProducts:changes.products.filter(p=>p.film_faces_separated).length,
    cupSegments:[20,80],noInheritedModifiers:true,scenePositionBoundsErrorMeters:0,validRuntimeNormals:true},
  layers:runtime.layers.map(l=>({name:l.name,trianglesBefore:prior.layers.find(p=>p.name===l.name).runtime.triangles,
    trianglesAfter:l.runtime.triangles,degenerateBefore:prior.layers.find(p=>p.name===l.name).runtime.exactZeroAreaTriangles,
    degenerateAfter:l.runtime.exactZeroAreaTriangles,bytes:l.runtimeBytes})),
  browser:{checked:'Store entry, A2 signage, picking new_118, dragging through lid/side/bottom views; no console warnings/errors captured.',
    fpsObserved:'59–60 after settling; movement/texture loading can transiently dip. Not a benchmark or mobile acceptance.'},
  remaining:{staticOverlapFacePairs:366,lowCircularCapCandidates:source.summary.products_low_round_segments,
    flatShadingCandidates:source.summary.products_flat_gentle_edges,
    note:'Candidates are not confirmed visible defects. No blanket removal of static contacts or smoothing of packaging folds. Not every SKU was visually reviewed.'},
}
fs.writeFileSync(resolve(after,'verification.json'),JSON.stringify(summary,null,2))
const fmt=n=>n.toLocaleString('zh-CN')
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lawson 表面修复结果</title><style>body{max-width:1000px;margin:40px auto;padding:0 20px;color:#20313c;font:16px/1.7 system-ui,sans-serif}h1{border-bottom:3px solid #0068b7}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce2e6}a{color:#005d9f}img{max-width:100%;height:auto}small{color:#596873}</style><h1>表面修复结果 · V7</h1><p>已生成 V7 并替换网页资源；V6 源模型和旧运行资源均保留。</p><ul><li>846 种商品、3,880 个陈列实例完整保留。</li><li>本轮轴对齐凸面扫描：同向、不同材质重叠涉及商品从 41 种降至 0；不是任意曲面穿插的穷尽检测。</li><li>160 种商品细化圆形/椭圆形结构；截图杯面从 20 段提升至 80 段。</li><li>37 种商品的透明膜与实体分离；笔记本书脊保留外露部分并修窄重叠边界。</li><li>每个场景对象先应用自身修改器再合并；场景压缩保留浮点位置与法线。</li></ul><h2>运行资源前后对照</h2><table><tr><th>资源</th><th>三角形：修复前 → 后</th><th>零面积三角形：前 → 后</th></tr>${summary.layers.map(l=>`<tr><td>${l.name}</td><td>${fmt(l.trianglesBefore)} → ${fmt(l.trianglesAfter)}</td><td>${fmt(l.degenerateBefore)} → ${fmt(l.degenerateAfter)}</td></tr>`).join('')}</table><p><small>三角形统计按唯一网格，不等于场景实际绘制总量。零面积计数不等于可见缺陷数量。</small></p><h2>验证范围</h2><p>5 项应用测试、1 项压缩精度回归测试、Blender 逐对象修改器回归测试通过；生产构建通过（保留主包体积提示）。浏览器完成入店、A2 文字、同款杯面的拿取与多角度拖动检查，已检查视角未复现杯盖条纹，未捕获控制台错误/警告。</p><img src="cup-top-fixed.png" alt="修复后杯盖"><h2>仍需区别对待的候选项</h2><p>静态场景 366 对接触/重叠面未一律删除；仍有 ${summary.remaining.lowCircularCapCandidates} 种商品命中小圆件低分段指标、${summary.remaining.flatShadingCandidates} 种商品命中平滑复核指标，包含包装折痕和硬边，不应全部判错。本轮未逐个旋转验收全部商品，也未完成移动设备性能验收。</p><p><a href="verification.json">验证摘要</a> · <a href="model-repairs.json">逐商品修复记录</a> · <a href="source-audit.json">修复后源模型审计</a> · <a href="runtime-audit.json">修复后运行资源审计</a></p></html>`
fs.writeFileSync(resolve(after,'修复结果.html'),html)
console.log(JSON.stringify(summary,null,2))
