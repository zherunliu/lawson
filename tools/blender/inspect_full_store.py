"""Inspect the approved V12 scene for full-store Web navigation/export."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/store-v12-product-geometry/lawson-complete-v12.blend"
OUTPUT = ROOT / "art/web-export-v02/full-store-inspection.json"
SCENE_NAME = "01 总场景 · 完整世界"
KEYWORDS = (
    "door",
    "entrance",
    "entry",
    "floor",
    "roof",
    "ceiling",
    "wall",
    "checkout",
    "register",
    "counter",
    "fuji",
)


def object_bounds(obj: bpy.types.Object) -> dict[str, list[float]] | None:
    if not obj.bound_box:
        return None
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min": [round(min(corner[index] for corner in corners), 5) for index in range(3)],
        "max": [round(max(corner[index] for corner in corners), 5) for index in range(3)],
    }


def combined_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    values = [object_bounds(obj) for obj in objects]
    values = [value for value in values if value]
    return {
        "min": [min(value["min"][index] for value in values) for index in range(3)],
        "max": [max(value["max"][index] for value in values) for index in range(3)],
    }


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.data.scenes[SCENE_NAME]
    bpy.context.window.scene = scene
    bpy.context.view_layer.update()

    stock = [obj for obj in scene.objects if obj.get("sku")]
    environment = [obj for obj in scene.objects if not obj.get("sku")]
    searchable = []
    for obj in environment:
        collection_names = [collection.name for collection in obj.users_collection]
        haystack = " ".join([obj.name, *collection_names]).lower()
        if any(keyword in haystack for keyword in KEYWORDS):
            searchable.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "collections": collection_names,
                    "bounds": object_bounds(obj),
                    "materials": [slot.material.name for slot in obj.material_slots if slot.material],
                }
            )

    collection_counts = []
    for collection in bpy.data.collections:
        scene_members = [obj for obj in collection.objects if obj.name in scene.objects]
        if not scene_members:
            continue
        collection_counts.append(
            {
                "name": collection.name,
                "objects": len(scene_members),
                "types": dict(Counter(obj.type for obj in scene_members)),
                "stock": sum(bool(obj.get("sku")) for obj in scene_members),
                "bounds": combined_bounds(scene_members),
            }
        )

    document = {
        "source": str(SOURCE),
        "scene": SCENE_NAME,
        "scene_bounds": combined_bounds(list(scene.objects)),
        "stock_bounds": combined_bounds(stock),
        "environment_bounds": combined_bounds(environment),
        "environment_objects": len(environment),
        "environment_types": dict(Counter(obj.type for obj in environment)),
        "collections": sorted(collection_counts, key=lambda value: value["name"]),
        "navigation_candidates": searchable,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print("FULL_STORE_INSPECTION", json.dumps({
        "environment_objects": document["environment_objects"],
        "scene_bounds": document["scene_bounds"],
        "candidates": len(searchable),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
