import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/store-v12-product-geometry/lawson-complete-v12-optimized-closeup.blend"
MAIN_SCENE = "01 总场景 · 完整世界"


def script_args():
    if "--" not in sys.argv:
        raise SystemExit("Expected: blender --background file.blend --python script.py -- output.json")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 1:
        raise SystemExit("Expected exactly one output path")
    return Path(args[0]).resolve()


def material_kind(name):
    value = (name or "").lower()
    if "atlas" in value or "packag" in value or "label" in value or "closeup" in value:
        return "printed"
    if "color" in value or "palette" in value:
        return "solid"
    return "other"


def sku_for_object(obj):
    for key in ("sku", "product_id", "catalog_id"):
        if obj.get(key):
            return str(obj[key])
    name = obj.name
    if name.startswith("STOCK_"):
        parts = name.split("__")
        if parts:
            return parts[0].removeprefix("STOCK_")
    return None


def percentile(values, fraction):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


output_path = script_args()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.data.scenes[MAIN_SCENE]
unique_meshes = {}
for obj in scene.objects:
    if obj.type != "MESH":
        continue
    sku = sku_for_object(obj)
    if not sku:
        continue
    unique_meshes.setdefault(obj.data.as_pointer(), (sku, obj))

records = []
material_totals = Counter()
kind_totals = defaultdict(float)

for sku, obj in unique_meshes.values():
    mesh = obj.data
    slots = [slot.material.name if slot.material else "<none>" for slot in obj.material_slots]
    areas = defaultdict(float)
    polygon_counts = Counter()
    axis_kind_areas = defaultdict(float)

    for polygon in mesh.polygons:
        material_name = slots[polygon.material_index] if polygon.material_index < len(slots) else "<none>"
        kind = material_kind(material_name)
        area = float(polygon.area)
        areas[kind] += area
        polygon_counts[kind] += 1
        material_totals[material_name] += 1
        kind_totals[kind] += area

        normal = polygon.normal
        components = {"x": abs(normal.x), "y": abs(normal.y), "z": abs(normal.z)}
        axis = max(components, key=components.get)
        sign = "+" if getattr(normal, axis) >= 0 else "-"
        axis_kind_areas[f"{axis}{sign}:{kind}"] += area

    total = sum(areas.values())
    printed_ratio = areas["printed"] / total if total else 0.0
    solid_ratio = areas["solid"] / total if total else 0.0
    records.append(
        {
            "sku": sku,
            "object": obj.name,
            "mesh": mesh.name,
            "materials": slots,
            "polygons": dict(polygon_counts),
            "surface_area": round(total, 8),
            "printed_area_ratio": round(printed_ratio, 6),
            "solid_area_ratio": round(solid_ratio, 6),
            "axis_area_by_kind": {key: round(value, 8) for key, value in sorted(axis_kind_areas.items())},
        }
    )

ratios = [record["printed_area_ratio"] for record in records]
records.sort(key=lambda record: (record["printed_area_ratio"], record["sku"]))
summary = {
    "unique_product_meshes": len(records),
    "printed_material_products": sum(record["printed_area_ratio"] > 0 for record in records),
    "mixed_printed_and_solid_products": sum(
        record["printed_area_ratio"] > 0 and record["solid_area_ratio"] > 0 for record in records
    ),
    "printed_area_ratio": {
        "min": round(min(ratios), 6) if ratios else 0,
        "p25": round(percentile(ratios, 0.25), 6),
        "median": round(percentile(ratios, 0.5), 6),
        "p75": round(percentile(ratios, 0.75), 6),
        "max": round(max(ratios), 6) if ratios else 0,
    },
    "products_below_printed_coverage": {
        "10_percent": sum(value < 0.1 for value in ratios),
        "25_percent": sum(value < 0.25 for value in ratios),
        "50_percent": sum(value < 0.5 for value in ratios),
    },
    "material_polygon_counts": dict(material_totals.most_common()),
    "surface_area_by_kind": {key: round(value, 6) for key, value in kind_totals.items()},
}

payload = {
    "source": bpy.data.filepath,
    "summary": summary,
    "lowest_printed_coverage": records[:40],
    "products": records,
}
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
