"""Inspect the approved Blender source before creating web runtime assets.

Run with:
  Blender --background --python web/tools/blender/inspect_source.py

The script is read-only with respect to the .blend source. It writes a compact
JSON report used to choose export boundaries and performance budgets.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/store-v12-product-geometry/lawson-complete-v12.blend"
OUTPUT_DIR = ROOT / "art/web-export-v01"
OUTPUT = OUTPUT_DIR / "source-inspection.json"
MAIN_SCENE = "01 总场景 · 完整世界"
SAMPLE_ZONE = "A1"


def mesh_triangles(mesh: bpy.types.Mesh) -> int:
    return sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.polygons)


def object_bounds(obj: bpy.types.Object) -> dict[str, list[float]] | None:
    if not obj.bound_box:
        return None
    # Blender's bound_box entries are local-space tuples. Avoid importing
    # mathutils in the hot loop by multiplying their Vector representations.
    from mathutils import Vector

    world_corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min": [round(min(corner[i] for corner in world_corners), 5) for i in range(3)],
        "max": [round(max(corner[i] for corner in world_corners), 5) for i in range(3)],
    }


def union_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]] | None:
    bounds = [object_bounds(obj) for obj in objects]
    bounds = [value for value in bounds if value]
    if not bounds:
        return None
    return {
        "min": [min(value["min"][axis] for value in bounds) for axis in range(3)],
        "max": [max(value["max"][axis] for value in bounds) for axis in range(3)],
    }


def overlaps_xy(obj: bpy.types.Object, bounds: dict[str, list[float]], margin: float) -> bool:
    value = object_bounds(obj)
    if not value:
        return False
    return not (
        value["max"][0] < bounds["min"][0] - margin
        or value["min"][0] > bounds["max"][0] + margin
        or value["max"][1] < bounds["min"][1] - margin
        or value["min"][1] > bounds["max"][1] + margin
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.data.scenes[MAIN_SCENE]
    bpy.context.window.scene = scene
    bpy.context.view_layer.update()

    mesh_objects = [obj for obj in scene.objects if obj.type == "MESH"]
    stock_objects = [obj for obj in mesh_objects if obj.get("sku")]
    sample_stock = [obj for obj in stock_objects if obj.get("zone") == SAMPLE_ZONE]
    sample_front = [obj for obj in sample_stock if obj.get("depth_index") == 0]
    sample_bounds = union_bounds(sample_stock)

    fixture_collection = bpy.data.collections["12 FIXTURES / six stocked gondolas"]
    sample_fixture_objects = [
        obj
        for obj in fixture_collection.objects
        if obj.name in scene.objects
        and obj.type in {"MESH", "CURVE", "FONT"}
        and sample_bounds
        and overlaps_xy(obj, sample_bounds, margin=0.18)
    ]

    unique_meshes = {obj.data for obj in mesh_objects}
    stock_meshes = {obj.data for obj in stock_objects}
    sample_meshes = {obj.data for obj in sample_stock}

    mesh_users = Counter(obj.data.name for obj in stock_objects)
    sample_by_sku: dict[str, list[bpy.types.Object]] = defaultdict(list)
    for obj in sample_stock:
        sample_by_sku[str(obj.get("sku"))].append(obj)

    sample_items = []
    for sku, objects in sorted(sample_by_sku.items()):
        representative = objects[0]
        sample_items.append(
            {
                "sku": sku,
                "name": representative.name,
                "instances": len(objects),
                "front_instances": sum(obj.get("depth_index") == 0 for obj in objects),
                "mesh": representative.data.name,
                "mesh_users_in_store": mesh_users[representative.data.name],
                "triangles": mesh_triangles(representative.data),
                "materials": [
                    material.name for material in representative.data.materials if material
                ],
            }
        )

    collection_rows = []
    for collection in bpy.data.collections:
        scene_objects = [obj for obj in collection.objects if obj.name in scene.objects]
        if not scene_objects:
            continue
        collection_rows.append(
            {
                "name": collection.name,
                "objects": len(scene_objects),
                "mesh_objects": sum(obj.type == "MESH" for obj in scene_objects),
                "stock_objects": sum(bool(obj.get("sku")) for obj in scene_objects),
            }
        )

    report = {
        "source": str(SOURCE),
        "blender": bpy.app.version_string,
        "scene": MAIN_SCENE,
        "scene_objects": len(scene.objects),
        "mesh_objects": len(mesh_objects),
        "unique_scene_meshes": len(unique_meshes),
        "scene_unique_triangles": sum(mesh_triangles(mesh) for mesh in unique_meshes),
        "materials": len({material for obj in mesh_objects for material in obj.data.materials if material}),
        "packed_images": [
            {
                "name": image.name,
                "width": image.size[0],
                "height": image.size[1],
                "packed_bytes": len(image.packed_file.data),
                "file_format": image.file_format,
            }
            for image in bpy.data.images
            if image.packed_file
        ],
        "stock": {
            "instances": len(stock_objects),
            "skus": len({obj.get("sku") for obj in stock_objects}),
            "unique_meshes": len(stock_meshes),
            "unique_triangles": sum(mesh_triangles(mesh) for mesh in stock_meshes),
        },
        "sample_zone": {
            "zone": SAMPLE_ZONE,
            "instances": len(sample_stock),
            "front_instances": len(sample_front),
            "skus": len(sample_by_sku),
            "unique_meshes": len(sample_meshes),
            "unique_triangles": sum(mesh_triangles(mesh) for mesh in sample_meshes),
            "bounds": sample_bounds,
            "fixture_objects": [
                {
                    "name": obj.name,
                    "type": obj.type,
                    "bounds": object_bounds(obj),
                    "materials": [
                        material.name
                        for material in getattr(obj.data, "materials", [])
                        if material
                    ],
                }
                for obj in sorted(sample_fixture_objects, key=lambda item: item.name)
            ],
            "items": sample_items,
        },
        "collections": sorted(collection_rows, key=lambda row: row["name"]),
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WEB_SOURCE_INSPECTION", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
