import fs from 'node:fs'
import { resolve } from 'node:path'

const out = resolve(import.meta.dirname, '../../art/web-surface-audit-20261001')
const source = JSON.parse(fs.readFileSync(resolve(out, 'source-audit.json')))
const runtime = JSON.parse(fs.readFileSync(resolve(out, 'runtime-audit.json')))
const joined = JSON.parse(fs.readFileSync(resolve(out, 'join-audit.json')))
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const fmt = v => Number(v).toLocaleString('zh-CN')
const high = p => p.overlaps.filter(h => h.same_facing && h.different_material)
const opaque = p => high(p).filter(h => h.materials.every(m => !/film|transparent/i.test(m)))
const low = p => p.circular_caps.filter(c => c.segments <= 24)
const productRows = source.products.map(p => ({...p,
  flags:[opaque(p).length?'不透明共面':high(p).length?'透明包装共面':p.overlaps.length?'其他共面候选':'',
    low(p).length?'低圆周分段':'',p.flat_gentle_edges&&!p.custom_normals?'平滑复核':''].filter(Boolean),
})).sort((a,b)=>(opaque(b).length>0)-(opaque(a).length>0)||(high(b).length>0)-(high(a).length>0)||b.flags.length-a.flags.length||a.sku.localeCompare(b.sku))
const instanceCount = pred => source.products.filter(pred).reduce((n,p)=>n+p.instances,0)
const csv = (name,cols,rows) => fs.writeFileSync(resolve(out,name),'\ufeff'+[cols,...rows].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n'))
csv('商品排查清单.csv',['SKU','名称','形状','实例数','标记','同向异材质共面对数','最低圆形封口分段','平缓夹角平面着色边数','Blender对象','面编号证据'],productRows.map(p=>[p.sku,p.name,p.shape,p.instances,p.flags.join('；'),high(p).length,p.circular_caps.length?Math.min(...p.circular_caps.map(c=>c.segments)):'',p.flat_gentle_edges,p.object,high(p).map(h=>h.faces.join('/')).join(';')]))
csv('场景重叠候选.csv',['对象A','对象B','面A','面B','同向','材质A','材质B','轴XYZ','坐标米','间距米','重叠面积平方米'],source.static_cross_overlaps.map(h=>[...h.objects,...h.faces,h.same_facing,...h.materials,'XYZ'[h.axis],h.distance,h.separation,h.area]))
const sampleProducts = productRows.filter(p=>opaque(p).length)
const samePairs = new Set(source.static_cross_overlaps.filter(h=>h.same_facing).map(h=>h.objects.slice().sort().join('|'))).size
const layerSummary = runtime.layers.map(l=>({layer:l.name,rawTriangles:l.raw.triangles,runtimeTriangles:l.runtime.triangles,rawZero:l.raw.exactZeroAreaTriangles,runtimeZero:l.runtime.exactZeroAreaTriangles}))
fs.writeFileSync(resolve(out,'summary.json'),JSON.stringify({date:'2026-10-01',source:source.source,coverage:source.summary,
  findings:{pipelineModifierInheritance:joined,opaqueOverlapSkus:sampleProducts.map(p=>p.sku),differentMaterialOverlap:{skus:41,instances:instanceCount(p=>high(p).length)},lowCircularCaps:{skus:169,instances:instanceCount(p=>low(p).length)},flatCandidates:346,staticSameFacingObjectPairs:samePairs},layers:layerSummary},null,2))
const findings = [
 ['P1 · 已复现','场景合并错误继承修改器','网页导出器','近景以地基为活动对象合并 3,062 个对象后，保留地基 0.05m / 3 段倒角及 Weighted Normal，导出时再应用于整个网格。其他对象原有修改器并未逐个固化。屋顶同样继承 0.028m 倒角。','先逐个固化每个对象自身的修改器，再合并；文字、贴花、细小构件避免被批量倒角。修复后重新审计，再判断剩余画面问题。'],
 ['P1 · 几何已确认','商品同向不同材质重叠','Blender 模型','41 个 SKU、237 个陈列实例。4 个 SKU 涉及不透明材质，其余主要为透明膜、包装与实体接触；几何共面已确认，是否在所有视角可见尚未逐个验收。','优先 new_118、kanzen_dry、new_3009、campus_blue；合并重复外表面，或按实际结构分开。透明包装需检查厚度、间隙及遮挡。'],
 ['P2 · 结构已确认 / 观感待复核','近看轮廓可能有棱角','Blender 模型 + 近景资源策略','169 个 SKU、886 个陈列实例检出 ≤24 段圆形封口。截图 new_118 为 20 段；cup_original、cup_seafood、donbei 等为 24 段。并非每个小圆件都需要提高分段。','按拿取后的屏幕尺寸挑选杯口、瓶肩和大圆盖提高分段；货架与手持可使用不同精度。当前手持克隆货架几何，仅提升贴图。'],
 ['P2 · 待视觉复核','平滑着色候选','Blender 模型','346 个 SKU 检出相邻面夹角 3°–45°、至少一面平面着色且无自定义法线。多数是袋装折边等，不能全部视为错误。场景中 3 个 BIN / recessed sorting lid 也命中。','优先复核饮料瓶、泵头、圆罐等曲面；保留纸盒、包装折痕的硬边，避免全局强制平滑。'],
 ['P2 · 几何候选','场景构件共面/近共面','Blender 模型','应用现有修改器后检出 366 对重叠面；其中 246 对同向，涉及 127 对对象。包含地面底面、墙体接触面等不可见接触，不能当成 366 处画面缺陷。','优先复核屋顶与招牌外壳、C1–C4 冷柜底座与踢脚、门窗框、屋顶风扇护栏。结合遮挡关系判断是否修复。'],
 ['P2 · 数据已确认','场景压缩精度仍会压扁细节','Web 压缩','近景静态网格坐标步长约 0.688mm，屋顶 0.285mm，远景 6.104mm。静态 GLB 的零面积三角形由原始 1,463,350 增至运行版 2,185,323；需先消除错误倒角再重新衡量。','细小字形、薄片与大结构分组压缩，按可接受误差设精度。当前计数不能等同于同数量的可见缺陷。'],
]
const table = (headers,rows) => `<div class="scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
const row = vals=>`<tr>${vals.map(v=>`<td>${v}</td>`).join('')}</tr>`
const report = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lawson 表面质量审计 · 2026-10-01</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f6;color:#20313c;font:15px/1.65 system-ui,-apple-system,sans-serif}main{max-width:1240px;margin:auto;padding:40px 24px 80px}h1{font-size:32px;line-height:1.25}h2{margin:36px 0 14px;font-size:23px}h3{font-size:18px;margin:0 0 8px}p{margin:8px 0 16px}header{border-bottom:3px solid #0068b7;padding-bottom:20px}.muted{color:#596873}section,.card{background:white;border:1px solid #dce2e6;border-radius:10px;padding:20px;margin-top:16px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card b{display:block;font-size:28px;color:#0068b7}.card{margin:0}.finding{border-left:4px solid #cb8320}.finding:first-of-type{border-left-color:#b84437}.tag{font-size:12px;font-weight:700;color:#97430f}a{color:#005d9f}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e1e5e8;vertical-align:top}th{background:#eaf1f5;white-space:nowrap}code{font-size:12px;overflow-wrap:anywhere}.scroll{overflow:auto;max-height:620px}input,select{font:inherit;padding:9px;border:1px solid #b7c4ce;border-radius:6px;max-width:100%}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.issues{color:#a5401d}.small{font-size:12px}.numbers{font-variant-numeric:tabular-nums}@media(max-width:700px){.cards{grid-template-columns:1fr}main{padding:22px 14px}h1{font-size:26px}}
</style><main><header><div class="muted">只读审计 · 2026-10-01 · V6 源模型 / 原始 GLB / Meshopt 运行 GLB</div><h1>表面问题不只来自建模，<br>场景导出也存在可复现错误。</h1><p>最先修复：合并场景错误继承首个物体的倒角与法线修改器。商品还存在重复面、低圆周分段；其余检测项按证据保留为候选。</p><p class="small">本轮仅新增审计脚本与报告，未更改 .blend、网页功能或运行模型。</p></header>
<h2>扫描范围与证据边界</h2><div class="cards"><div class="card"><b>846 / 3,880</b>商品 SKU / 陈列实例</div><div class="card"><b>3,115</b>场景对象（含屋顶、91 个文字、435 个曲线）</div><div class="card"><b>3 层 × 2 版本</b>商品 / 静态场景 / 屋顶，原始与运行 GLB</div></div>
<p class="muted">全量自动扫描 + 导出合并的内存复现；并非人工逐个旋转全部商品。曲面分段统计只识别圆形多边形封口，共面检测只覆盖轴对齐凸面；斜面、凹面、任意穿插及所有视角的可见性未穷尽。跨对象扫描排除超过 5,000 面的单体和 X/Y 距原点超过 30m 的远景。</p>
<h2>按修复优先级整理</h2>${findings.map(([level,title,owner,evidence,fix])=>`<section class="finding"><div class="tag">${level} · ${owner}</div><h3>${title}</h3><p>${evidence}</p><p><b>建议处理：</b>${fix}</p></section>`).join('')}
<h2>导出错误的直接证据</h2>${table(['层','首个对象 / 继承参数','合并后、修改器前（三角形）','修改器后（三角形）','修改器后零面积三角形'],joined.map(j=>row([esc(j.layer),`<code>${esc(j.first_source)}</code><br>${j.inherited_modifiers.map(m=>esc(m.type)+(m.width?` ${Number(m.width.toFixed(3))}m`:'' )).join(' / ')||'无'}`,fmt(j.joined_before_modifiers.triangles),fmt(j.joined_after_modifiers.triangles),fmt(j.joined_after_modifiers.zero_area_triangles)])))}
<p class="small">以上来自 Blender 内存复现，与原始 GLB 的三角形数量一致。原始 GLB 零面积计数因导出浮点结果略有差异。零面积三角形是几何退化证据，不能直接对应同数量的闪面。</p>
<h2>商品端：四个优先定位对象</h2>${table(['SKU / 名称','源模型对象','重叠证据（Blender 面编号）','圆形封口'],sampleProducts.map(p=>row([`<b>${esc(p.sku)}</b><br>${esc(p.name)}`,`<code>${esc(p.object)}</code>`,opaque(p).map(h=>`面 ${h.faces.join(' / ')} · ${'XYZ'[h.axis]}=${h.distance.toFixed(7)}m<br>${h.materials.map(esc).join(' ↔ ')}`).join('<br>'),[...new Set(p.circular_caps.map(c=>c.segments))].join(' / ')||'不适用'])))}
<p>用户截图中的 <code>new_118</code>：源模型顶部面 81 与 125 同高重叠；原始和运行 GLB 中，两种材质的顶面各有 18 个三角形，仍同处 Y≈0.157m。运行版最近顶点误差约 0.00135mm，排除了“商品压缩造成大幅变形”这一解释。</p>
<h2>846 个商品的完整排查表</h2><p>标记是扫描结果，不是统一判为缺陷。“未检出本轮指标”也不代表已全面验收合格。各类数量有重叠，不能相加。</p><div class="toolbar"><input id="search" aria-label="搜索商品" placeholder="搜索 SKU、名称、形状"><select id="filter" aria-label="筛选问题"><option value="">全部商品</option><option>不透明共面</option><option>透明包装共面</option><option>低圆周分段</option><option>平滑复核</option><option>其他共面候选</option></select><span id="count"></span><a href="商品排查清单.csv" download>下载商品 CSV</a></div>
${table(['SKU / 名称','形状 / 实例','标记','圆形封口分段','平缓夹角平面着色边','重叠面证据'],productRows.map(p=>`<tr data-product data-search="${esc([p.sku,p.name,p.shape].join(' ').toLowerCase())}" data-flags="${esc(p.flags.join('|'))}"><td><b>${esc(p.sku)}</b><br>${esc(p.name)}</td><td>${esc(p.shape)}<br>${p.instances}</td><td class="issues">${p.flags.join('<br>')||'未检出本轮指标'}</td><td>${[...new Set(p.circular_caps.map(c=>c.segments))].sort((a,b)=>a-b).join(' / ')||'未检出圆形封口'}</td><td>${p.flat_gentle_edges}${p.custom_normals?'（有自定义法线）':''}</td><td>${high(p).slice(0,6).map(h=>h.faces.join('/')).join('，')||'—'}${high(p).length>6?' … 完整数据见 JSON':''}</td></tr>`))}
<h2>场景共面候选：应用各对象修改器后的结果</h2><p>366 对面，其中 246 对同向，涉及 ${samePairs} 对对象。先检查外露表面；地面底面、柜体内部等接触不直接认定为画面错误。下面保留全部检出项。</p><p><a href="场景重叠候选.csv" download>下载场景 CSV</a></p>
${table(['对象对','面编号 / 朝向','材质','重叠面积 m² / 间距 m'],source.static_cross_overlaps.slice().sort((a,b)=>Number(b.same_facing)-Number(a.same_facing)||b.area-a.area).map(h=>row([h.objects.map(x=>`<code>${esc(x)}</code>`).join('<br>'),h.faces.join(' / ')+'<br>'+(h.same_facing?'同向':'相反朝向：常见于内部接触'),h.materials.map(esc).join('<br>'),h.area.toPrecision(4)+' / '+h.separation.toExponential(2)])))}
<h2>压缩与法线完整性</h2>${table(['层','原始 / 运行三角形','原始 / 运行零面积','缺失或异常法线'],runtime.layers.map(l=>row([esc(l.name),fmt(l.raw.triangles)+' / '+fmt(l.runtime.triangles),fmt(l.raw.exactZeroAreaTriangles)+' / '+fmt(l.runtime.exactZeroAreaTriangles),(l.runtime.missingNormals+l.runtime.invalidNormals).toString()])))}
<p>三层压缩前后三角形数量均相同，未启用简化减面。全部运行网格都带法线，未检出非法长度，但这不证明法线方向及着色意图全部正确。商品包围盒边界最大偏差约 0.00216mm；五个代表商品的最近顶点偏差约 0.001–0.003mm。静态场景量化精度和错误倒角应单独整改。</p>
<p>富士山三部分与树冠源模型已使用平滑着色，不应把场景所有折面都归咎于“未开平滑”。91 个文字对象源分辨率仍为 3–4，导出器会提高到至少 16，但又可能受上述场景整体倒角影响。</p>
<h2>建议执行顺序</h2><ol><li>修正导出器逐对象应用修改器的时机，重建审计版场景；先对比文字、细杆、柜体和屋顶。</li><li>处理 4 个不透明商品重叠实例类型，再复核另外 37 个含透明包装的候选 SKU。</li><li>按拿取后的屏幕大小提升主要圆形外轮廓分段，复核曲面法线；保留纸盒与包装折痕。</li><li>细分场景压缩分组；重跑几何检查及旋转验收，并比较体积与帧率。</li></ol>
<h2>可复核的原始数据</h2><p><a href="source-audit.json">源模型逐对象证据 JSON</a> · <a href="runtime-audit.json">原始/运行 GLB 对照 JSON</a> · <a href="join-audit.json">合并修改器复现 JSON</a> · <a href="summary.json">摘要 JSON</a></p><p class="small">源文件：${esc(source.source)}<br>代码定位：web/tools/blender/export_full_store.py 的 join_layer() 与 export_glb()；web/src/scene/FullStore.tsx 的 HeldProduct()。本轮审计没有实施这些修复。</p></main><script>
const search=document.querySelector('#search'),filter=document.querySelector('#filter'),rows=[...document.querySelectorAll('[data-product]')];function apply(){let n=0;for(const r of rows){r.hidden=!(r.dataset.search.includes(search.value.trim().toLowerCase())&&(!filter.value||r.dataset.flags.split('|').includes(filter.value)));if(!r.hidden)n++}document.querySelector('#count').textContent=n+' / '+rows.length+' 个 SKU'}search.addEventListener('input',apply);filter.addEventListener('change',apply);apply();
</script></html>`
fs.writeFileSync(resolve(out,'审计报告.html'),report)
console.log('REPORT',resolve(out,'审计报告.html'))
