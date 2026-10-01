"""Export the complete V12 store into Web-oriented GLB layers.

Outputs raw intermediate files only. Run tools/optimize-assets.mjs afterwards.
The approved V12 source is opened read-only and is never saved.
"""

from __future__ import annotations

import json
import struct
import sys
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "art/store-v12-product-geometry/lawson-complete-v12-optimized-closeup-v9.blend"
CATALOG_PATH = ROOT / "art/store-v10-whole-fixture/catalog.json"
CHANGES_PATH = ROOT / "art/store-v12-product-geometry/changes.json"
EXPORT_DIR = Path(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--output=')), str(ROOT / "art/web-export-v02")))
RAW_DIR = EXPORT_DIR / "raw"
GENERATED_DIR = ROOT / "art/web-export-v02/generated"
ATLAS_MANIFEST_PATH = GENERATED_DIR / "product-atlas.json"
FRONT_ATLAS_PATH = GENERATED_DIR / "product-front-atlas.png"
BACK_ATLAS_PATH = GENERATED_DIR / "product-back-atlas.png"
SCENE_NAME = "01 总场景 · 完整世界"
ROOF_COLLECTION = "08 STORE / removable roof and ceiling"


def object_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector] | None:
    if not obj.bound_box:
        return None
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(corner[index] for corner in corners) for index in range(3))),
        Vector(tuple(max(corner[index] for corner in corners) for index in range(3))),
    )


def combined_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    values = [object_bounds(obj) for obj in objects]
    values = [value for value in values if value]
    return {
        "min": [round(min(value[0][index] for value in values), 5) for index in range(3)],
        "max": [round(max(value[1][index] for value in values), 5) for index in range(3)],
    }


def new_scene(name: str) -> bpy.types.Scene:
    scene = bpy.data.scenes.new(name)
    bpy.context.window.scene = scene
    return scene


def duplicate(source: bpy.types.Object, scene: bpy.types.Scene, *, copy_data: bool) -> bpy.types.Object:
    clone = source.copy()
    if source.data and copy_data:
        clone.data = source.data.copy()
    clone.parent = None
    clone.matrix_world = source.matrix_world.copy()
    scene.collection.objects.link(clone)
    return clone


def new_atlas_material(name: str, path: Path) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (1, 1, 1, 1)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = bpy.data.images.load(str(path), check_existing=True)
    image_node.interpolation = "Linear"
    links.new(image_node.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Roughness"].default_value = 0.55
    shader.inputs["Metallic"].default_value = 0.0
    return material


def remap_product_mesh(
    source: bpy.types.Object,
    atlas_manifest: dict,
    front_material: bpy.types.Material,
    back_material: bpy.types.Material,
    gusset_pack_skus: set[str],
) -> bpy.types.Mesh:
    mesh = source.data.copy()
    sku = str(source.get("sku"))
    tile = atlas_manifest["items"].get(sku)
    if not tile or not mesh.uv_layers.active:
        return mesh

    width = atlas_manifest["width"]
    height = atlas_manifest["height"]
    tile_size = atlas_manifest["tileSize"]
    padding = atlas_manifest["padding"]
    inner_size = atlas_manifest["innerSize"]
    atlas_slots = {}
    for index, material in enumerate(mesh.materials):
        name = material.name.lower() if material else ""
        if name.endswith("/ closeup front"):
            atlas_slots[index] = front_material
        elif name.endswith("/ closeup back"):
            atlas_slots[index] = back_material

    uv_data = mesh.uv_layers.active.data
    for polygon in mesh.polygons:
        replacement = atlas_slots.get(polygon.material_index)
        if not replacement:
            continue
        for loop_index in polygon.loop_indices:
            uv = uv_data[loop_index].uv
            if (
                sku in gusset_pack_skus
                and replacement == front_material
                and polygon.normal.y > -0.25
            ):
                # These six multi-pack meshes wrap the front material over the
                # top and side gussets. Collapse those faces to one brown point
                # in the artwork instead of turning its light center into a
                # vertical stripe while the product rotates.
                uv.x = 0.98
                uv.y = 0.05
            uv.x = (tile["x"] + padding + uv.x * inner_size) / width
            uv.y = (tile["yBottom"] + padding + uv.y * inner_size) / height

    for slot_index, replacement in atlas_slots.items():
        mesh.materials[slot_index] = replacement
    return mesh


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def join_layer(scene: bpy.types.Scene, sources: list[bpy.types.Object], name: str) -> bpy.types.Object:
    clones = [duplicate(source, scene, copy_data=True) for source in sources]
    for obj in clones:
        if obj.type == "FONT":
            # The source scene keeps signage text at resolution 3-4. That is
            # visibly faceted once large Japanese glyphs are converted to a
            # Web mesh, while the added geometry is negligible for this scene.
            obj.data.resolution_u = max(obj.data.resolution_u, 16)
    if clones:
        # Bake EACH object's own evaluated geometry before joining. Joining
        # unbaked meshes discards non-active modifiers and applies the active
        # object's bevel/normal modifiers to the entire scene instead.
        select_only(clones)
        bpy.ops.object.convert(target="MESH")

    meshes = [obj for obj in clones if obj.type == "MESH"]
    assert all(not obj.modifiers for obj in meshes), "Unbaked modifiers before scene join"
    select_only(meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    assert not joined.modifiers, "Joined scene must not inherit modifiers"
    return joined


def is_near_store(obj: bpy.types.Object) -> bool:
    bounds = object_bounds(obj)
    if not bounds:
        return True
    minimum, maximum = bounds
    return (
        minimum.x >= -30
        and maximum.x <= 30
        and minimum.y >= -30
        and maximum.y <= 30
        and minimum.z >= -5
        and maximum.z <= 15
    )


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
    return {
        "bytes": total,
        "nodes": len(document.get("nodes", [])),
        "meshes": len(document.get("meshes", [])),
        "materials": len(document.get("materials", [])),
        "images": len(document.get("images", [])),
    }


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    source_scene = bpy.data.scenes[SCENE_NAME]
    bpy.context.window.scene = source_scene
    bpy.context.view_layer.update()

    catalog_document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    catalog = {product["id"]: product for product in catalog_document["products"]}
    changes = json.loads(CHANGES_PATH.read_text(encoding="utf-8"))
    gusset_pack_skus = {
        change["sku"] for change in changes if change.get("repair") == "gusset_pack"
    }
    atlas_manifest = json.loads(ATLAS_MANIFEST_PATH.read_text(encoding="utf-8"))
    front_atlas_material = new_atlas_material("WEB / product front atlas", FRONT_ATLAS_PATH)
    back_atlas_material = new_atlas_material("WEB / product back atlas", BACK_ATLAS_PATH)

    stock_sources = [
        obj
        for obj in source_scene.objects
        if obj.type == "MESH" and obj.get("sku") and not obj.hide_render
    ]
    roof_sources = [
        obj
        for obj in source_scene.objects
        if not obj.get("sku")
        and obj.type in {"MESH", "FONT", "CURVE"}
        and not obj.hide_render
        and any(collection.name == ROOF_COLLECTION for collection in obj.users_collection)
        and not obj.name.startswith("CEILING /")
    ]
    door_roots = [obj for obj in source_scene.objects if '_GLASS_DOOR_' in obj.name and obj.type == 'EMPTY']
    door_parts = {child for root in door_roots for child in root.children_recursive}
    static_sources = [
        obj
        for obj in source_scene.objects
        if not obj.get("sku")
        and obj.type in {"MESH", "FONT", "CURVE"}
        and not obj.hide_render
        and obj not in roof_sources
        and obj not in door_parts
    ]

    environment_only = "--environment-only" in sys.argv
    stock_only = "--stock-only" in sys.argv
    if not environment_only:
        stock_scene = new_scene("WEB / full store stock")
        remapped_meshes = {}
        for source in stock_sources:
            clone = duplicate(source, stock_scene, copy_data=False)
            sku = str(source.get("sku"))
            product = catalog[sku]
            source_mesh_key = source.data.as_pointer()
            if source_mesh_key not in remapped_meshes:
                remapped_meshes[source_mesh_key] = remap_product_mesh(
                    source,
                    atlas_manifest,
                    front_atlas_material,
                    back_atlas_material,
                    gusset_pack_skus,
                )
            clone.data = remapped_meshes[source_mesh_key]
            clone.name = source.name
            clone["instance_id"] = source.name
            clone["product_name"] = product["name"]
            clone["brand"] = product.get("brand", "")
            clone["price"] = product["price"]
            clone["shape"] = product.get("shape", "")
            tile = atlas_manifest["items"].get(sku)
            if tile:
                clone["atlas_width"] = atlas_manifest["width"]
                clone["atlas_height"] = atlas_manifest["height"]
                clone["atlas_inner_size"] = atlas_manifest["innerSize"]
                clone["atlas_x"] = tile["x"] + atlas_manifest["padding"]
                # glTF flips Blender's UV V axis. The inverse texture transform used
                # for held products therefore needs the tile's top coordinate.
                clone["atlas_y"] = tile["yTop"] + atlas_manifest["padding"]
        export_glb(stock_scene, RAW_DIR / "full-stock.glb")

    if not stock_only:
        static_scene = new_scene("WEB / full store static environment")
        near_static_sources = [obj for obj in static_sources if is_near_store(obj)]
        far_static_sources = [obj for obj in static_sources if obj not in near_static_sources]
        join_layer(static_scene, near_static_sources, "STORE / near static environment batch")
        join_layer(static_scene, far_static_sources, "WORLD / distant scenery batch")
        for root in door_roots:
            sources = [child for child in root.children_recursive if child.type in {'MESH', 'CURVE', 'FONT'}]
            bounds = combined_bounds(sources)
            joined = join_layer(static_scene, sources, 'FRIDGE / '+root.name)
            world = joined.matrix_world.copy()
            pivot = bpy.data.objects.new(root.name, None)
            static_scene.collection.objects.link(pivot)
            pivot.matrix_world = root.matrix_world.copy()
            pivot['door_id'] = root.name
            pivot['zone'] = root.name.split('_')[0]
            pivot['door_width'] = bounds['max'][0] - root.matrix_world.translation.x
            joined.parent = pivot
            joined.matrix_world = world
        export_glb(static_scene, RAW_DIR / "store-static.glb")

        roof_scene = new_scene("WEB / removable roof")
        join_layer(roof_scene, roof_sources, "STORE / removable roof batch")
        export_glb(roof_scene, RAW_DIR / "store-roof.glb")

    stacks = Counter(
        (
            str(obj.get("zone")),
            str(obj.get("shelf_level")),
            str(obj.get("shelf_side")),
            str(obj.get("facing_index")),
        )
        for obj in stock_sources
    )
    manifest = {
        "source": str(SOURCE),
        "source_scene": SCENE_NAME,
        "blender": bpy.app.version_string,
        "stock_instances": len(stock_sources),
        "front_instances": sum(obj.get("depth_index") == 0 for obj in stock_sources),
        "skus": len({obj.get("sku") for obj in stock_sources}),
        "zones": sorted({str(obj.get("zone")) for obj in stock_sources}),
        "facing_stacks": len(stacks),
        "maximum_stack_depth": max(stacks.values()),
        "static_source_objects": len(static_sources),
        "interactive_doors": len(door_roots),
        "door_source_objects": len(door_parts),
        "roof_source_objects": len(roof_sources),
        "stock_bounds_blender": combined_bounds(stock_sources),
        "static_bounds_blender": combined_bounds(static_sources),
        "roof_bounds_blender": combined_bounds(roof_sources),
        "files": {
            "full-stock.glb": glb_stats(RAW_DIR / "full-stock.glb"),
            "store-static.glb": glb_stats(RAW_DIR / "store-static.glb"),
            "store-roof.glb": glb_stats(RAW_DIR / "store-roof.glb"),
        },
    }
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    (EXPORT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("FULL_STORE_EXPORT", json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
