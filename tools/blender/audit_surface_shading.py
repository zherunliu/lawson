import json
from collections import Counter
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/store-v12-product-geometry/lawson-complete-v12-optimized-closeup.blend"
OUTPUT = ROOT / "art/web-export-v02/surface-shading-audit.json"
SCENE_NAME = "01 总场景 · 完整世界"


def row_for_object(obj, instances=1):
    polygons = obj.data.polygons
    smooth = sum(polygon.use_smooth for polygon in polygons)
    triangles = sum(max(0, len(polygon.vertices) - 2) for polygon in polygons)
    return {
        "name": obj.name,
        "mesh": obj.data.name,
        "sku": str(obj.get("sku")) if obj.get("sku") else None,
        "collections": [collection.name for collection in obj.users_collection],
        "materials": [material.name for material in obj.data.materials if material],
        "polygons": len(polygons),
        "instances": instances,
        "instanced_polygons": len(polygons) * instances,
        "triangles": triangles,
        "instanced_triangles": triangles * instances,
        "smooth_polygons": smooth,
        "flat_polygons": len(polygons) - smooth,
        "smooth_ratio": round(smooth / len(polygons), 6) if polygons else 0,
    }


bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.data.scenes[SCENE_NAME]
mesh_objects = [obj for obj in scene.objects if obj.type == "MESH" and not obj.hide_render]

static_rows = [row_for_object(obj) for obj in mesh_objects if not obj.get("sku")]
unique_stock = {}
stock_instances = Counter()
for obj in mesh_objects:
    if obj.get("sku"):
        unique_stock.setdefault(obj.data.as_pointer(), obj)
        stock_instances[obj.data.as_pointer()] += 1
stock_rows = [
    row_for_object(obj, stock_instances[pointer])
    for pointer, obj in unique_stock.items()
]

keywords = ("fuji", "mount", "tree", "bush", "shrub", "plant", "rock", "山", "木", "树")
organic_rows = [
    row
    for row in static_rows
    if any(keyword in row["name"].lower() for keyword in keywords)
    or any(any(keyword in collection.lower() for keyword in keywords) for collection in row["collections"])
]

payload = {
    "source": str(SOURCE),
    "summary": {
        "static_mesh_objects": len(static_rows),
        "static_fully_flat": sum(row["smooth_ratio"] == 0 for row in static_rows),
        "static_fully_smooth": sum(row["smooth_ratio"] == 1 for row in static_rows),
        "unique_stock_meshes": len(stock_rows),
        "stock_fully_flat": sum(row["smooth_ratio"] == 0 for row in stock_rows),
        "stock_fully_smooth": sum(row["smooth_ratio"] == 1 for row in stock_rows),
        "stock_mixed": sum(0 < row["smooth_ratio"] < 1 for row in stock_rows),
        "stock_ratio_buckets": dict(
            Counter(
                "0"
                if row["smooth_ratio"] == 0
                else "1"
                if row["smooth_ratio"] == 1
                else "mixed"
                for row in stock_rows
            )
        ),
    },
    "organic_candidates": sorted(organic_rows, key=lambda row: row["name"]),
    "static_objects": sorted(static_rows, key=lambda row: (row["smooth_ratio"], row["name"])),
    "stock_meshes": sorted(stock_rows, key=lambda row: (row["smooth_ratio"], row["sku"] or "")),
}

OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
