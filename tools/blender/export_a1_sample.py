"""Export the A1 performance slice from the approved V12 source.

Outputs:
  art/web-export-v01/raw/a1-fixture.glb
  art/web-export-v01/raw/a1-stock.glb
  art/web-export-v01/a1-manifest.json

The V12 source is never saved or modified. Stock objects remain separate nodes
with shared meshes so the web runtime can build pickable InstancedMesh groups.
"""

from __future__ import annotations

import json
import struct
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/store-v12-product-geometry/lawson-complete-v12.blend"
CATALOG_PATH = ROOT / "art/store-v10-whole-fixture/catalog.json"
EXPORT_DIR = ROOT / "art/web-export-v01"
RAW_DIR = EXPORT_DIR / "raw"
MAIN_SCENE = "01 总场景 · 完整世界"
ZONE = "A1"


def bounds(obj: bpy.types.Object) -> tuple[Vector, Vector] | None:
    if not obj.bound_box:
        return None
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(corner[i] for corner in corners) for i in range(3))),
        Vector(tuple(max(corner[i] for corner in corners) for i in range(3))),
    )


def union_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    values = [bounds(obj) for obj in objects]
    values = [value for value in values if value]
    return (
        Vector(tuple(min(value[0][i] for value in values) for i in range(3))),
        Vector(tuple(max(value[1][i] for value in values) for i in range(3))),
    )


def overlaps_xy(obj: bpy.types.Object, area: tuple[Vector, Vector], margin: float = 0.18) -> bool:
    value = bounds(obj)
    if not value:
        return False
    low, high = value
    area_low, area_high = area
    return not (
        high.x < area_low.x - margin
        or low.x > area_high.x + margin
        or high.y < area_low.y - margin
        or low.y > area_high.y + margin
    )


def duplicate(
    source: bpy.types.Object, scene: bpy.types.Scene, *, copy_data: bool
) -> bpy.types.Object:
    clone = source.copy()
    if source.data and copy_data:
        clone.data = source.data.copy()
    clone.parent = None
    clone.matrix_world = source.matrix_world.copy()
    scene.collection.objects.link(clone)
    return clone


def new_scene(name: str) -> bpy.types.Scene:
    scene = bpy.data.scenes.new(name)
    bpy.context.window.scene = scene
    return scene


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def export_glb(scene: bpy.types.Scene, output: Path) -> None:
    bpy.context.window.scene = scene
    bpy.context.view_layer.update()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_active_scene=True,
        use_visible=True,
        use_renderable=True,
        export_apply=True,
        export_extras=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )


def glb_stats(path: Path) -> dict[str, int]:
    with path.open("rb") as handle:
        magic, version, total = struct.unpack("<4sII", handle.read(12))
        json_length, chunk_type = struct.unpack("<I4s", handle.read(8))
        document = json.loads(handle.read(json_length))
    assert magic == b"glTF" and version == 2 and chunk_type == b"JSON"
    assert total == path.stat().st_size
    return {
        "bytes": total,
        "nodes": len(document.get("nodes", [])),
        "meshes": len(document.get("meshes", [])),
        "materials": len(document.get("materials", [])),
        "images": len(document.get("images", [])),
    }


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    source_scene = bpy.data.scenes[MAIN_SCENE]
    bpy.context.window.scene = source_scene
    bpy.context.view_layer.update()

    catalog_document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    catalog = {product["id"]: product for product in catalog_document["products"]}

    stock_sources = [
        obj
        for obj in source_scene.objects
        if obj.type == "MESH" and obj.get("sku") and obj.get("zone") == ZONE
    ]
    stock_area = union_bounds(stock_sources)

    fixture_collection = bpy.data.collections["12 FIXTURES / six stocked gondolas"]
    fixture_sources = [
        obj
        for obj in fixture_collection.objects
        if obj.name in source_scene.objects and obj.name.startswith(f"{ZONE} /")
    ]
    price_collection = bpy.data.collections["43 STOCK / populated price rails"]
    price_sources = [
        obj
        for obj in price_collection.objects
        if obj.name in source_scene.objects and overlaps_xy(obj, stock_area)
    ]

    stock_scene = new_scene("WEB / A1 stock")
    stock_clones = []
    for source in stock_sources:
        # Preserve the source's linked-mesh relationship: every placement gets
        # its own node and metadata, while repeated products share one mesh.
        clone = duplicate(source, stock_scene, copy_data=False)
        sku = str(source.get("sku"))
        product = catalog[sku]
        clone.name = source.name
        clone["instance_id"] = source.name
        clone["product_name"] = product["name"]
        clone["brand"] = product.get("brand", "")
        clone["price"] = product["price"]
        clone["shape"] = product.get("shape", "")
        stock_clones.append(clone)
    export_glb(stock_scene, RAW_DIR / "a1-stock.glb")

    fixture_scene = new_scene("WEB / A1 fixture")
    fixture_clones = [
        duplicate(source, fixture_scene, copy_data=True)
        for source in fixture_sources + price_sources
    ]
    # glTF does not carry editable font/curve objects. Convert only the clones.
    for obj in list(fixture_clones):
        if obj.type not in {"FONT", "CURVE"}:
            continue
        select_only([obj])
        bpy.ops.object.convert(target="MESH")

    mesh_clones = [obj for obj in fixture_scene.objects if obj.type == "MESH"]
    select_only(mesh_clones)
    if mesh_clones:
        bpy.context.view_layer.objects.active = mesh_clones[0]
        bpy.ops.object.join()
        mesh_clones[0].name = "A1 / web fixture batch"
    export_glb(fixture_scene, RAW_DIR / "a1-fixture.glb")

    stacks = Counter(
        (
            str(obj.get("shelf_level")),
            str(obj.get("shelf_side")),
            str(obj.get("facing_index")),
        )
        for obj in stock_sources
    )
    manifest = {
        "source": str(SOURCE),
        "source_scene": MAIN_SCENE,
        "zone": ZONE,
        "blender": bpy.app.version_string,
        "stock_instances": len(stock_sources),
        "front_instances": sum(obj.get("depth_index") == 0 for obj in stock_sources),
        "skus": len({obj.get("sku") for obj in stock_sources}),
        "facing_stacks": len(stacks),
        "maximum_stack_depth": max(stacks.values()),
        "fixture_source_objects": len(fixture_sources),
        "price_source_objects": len(price_sources),
        "bounds_blender": {
            "min": [round(value, 5) for value in stock_area[0]],
            "max": [round(value, 5) for value in stock_area[1]],
        },
        "files": {
            "a1-stock.glb": glb_stats(RAW_DIR / "a1-stock.glb"),
            "a1-fixture.glb": glb_stats(RAW_DIR / "a1-fixture.glb"),
        },
    }
    (EXPORT_DIR / "a1-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("WEB_A1_EXPORT", json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
