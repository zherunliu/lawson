# Lawson at Mount Fuji · Interactive 3D Store

A browser-based 3D store where you can walk around, open refrigerator doors, pick up products, and drag to inspect them. The project includes the complete V12 store model, first-person navigation, and basket interactions.

Packaged models and product textures are included, so Blender is not required to run the app. This repository publishes the source code and runtime assets; a live website has not been deployed.

## Features

- 3,880 product instances, 1,724 shelf positions, and 846 product variants across 12 display zones.
- Pick up front-row products, rotate them freely by dragging, return them to the shelf, or add them to the basket.
- Inspected products use a separate depth layer to avoid shelf occlusion while preserving their own internal depth ordering.
- Short transitions for picking up, returning, and adding products to the basket, with simplified animations when reduced motion is enabled.
- Eight refrigerator doors in C1/C4 support clicking or pressing E when prompted. Closed doors block product selection through the glass, and door interactions account for player clearance and movement collisions.
- Products behind the front row become selectable as items are removed.
- Products are batched by material while retaining per-item raycasting and application data.
- Orbit around the store outside, then enter smoothly through the front door without removing the roof.
- Move with WASD or arrow keys and drag to look around, with collision boundaries for the store and six central shelf groups.
- The static store, roof, and shelf products load separately, totaling approximately 32 MiB of GLB assets.
- Shelves use shared 256px front/back texture atlases; higher-resolution front/back WebP textures load on demand for nearby and inspected products.

## Local Setup

Install Node.js and pnpm, then run:

```bash
git clone https://github.com/zherunliu/lawson.git
cd lawson
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/`.

The packaged models and product textures are included in `public/`. Running the cloned project does not require Blender or an external `art/` directory.

## Controls

- Enter the store: click the entry button.
- Move and look: use WASD or arrow keys to move; drag to look around.
- Inspect a product: pick up a front-row item and drag to rotate it; press Esc to return it.
- Basket: add a product to the basket while inspecting it.
- Refrigerator doors: click a door or press E when the open/close prompt appears.

On-screen hints use concise English. Product packaging and names retain their original language.

## Tests and Build

```bash
pnpm test
pnpm test:assets
pnpm build
```

Build output is written to `dist/`. Run `pnpm preview` to preview the production build locally; this does not deploy it to the internet.

## Model and Texture Pipeline

The following optional modeling tools require Blender and source assets in an external `../art/` directory. Original `.blend` files, intermediate exports, and historical backups are not included in this web repository.

The current export source is `lawson-complete-v12-optimized-closeup-v9.blend`; V6–V8 originals are retained in the modeling workspace.
Exports leave the source file unchanged and apply each object's modifiers before merging. Scene meshes use Meshopt compression while preserving floating-point positions and normals; product meshes quantize only positions and texture coordinates.

To regenerate assets in the modeling workspace:

```bash
pnpm assets:closeups
/Applications/Blender.app/Contents/MacOS/Blender \
  --background \
  --python tools/blender/export_full_store.py
pnpm assets:optimize -- v02
```

- Raw intermediate files: `../art/web-export-v02/raw/`
- Exported runtime files: `../art/web-export-v02/runtime/`; sync these to this repository's `public/` after exporting.
- On-demand textures used by the app: `public/product-textures/`
- Export manifest: `../art/web-export-v02/manifest.json`

Surface repair records and original asset backups are stored in `../art/web-surface-repair-20261001/`.
Refrigerator groove repairs, refinements to six bowl types, shrimp-rice intersection fixes, and V7 asset backups are stored in `../art/web-cold-meal-repair-20261001/`. The corresponding verification script is `tools/blender/verify_cold_meal.py`.

V9 clips overlapping colored faces for 28 product variants. Audit results, repair records, and V8 asset backups are stored in `../art/web-interaction-repair-20261001/`. All eight doors retain separate hinge nodes in the scene GLB instead of being merged into the static cabinets. Automated checks do not establish visual acceptance for every product at every angle.

Exporter regression test: `Blender --background --python tools/blender/test_export_modifiers.py`.

The runtime includes 3,268 WebP images: front and back textures at two resolution levels for 817 products. Images load on demand to avoid decoding the entire collection at once.

## Known Limitations

- Automated tests do not replace visual inspection of every product from all angles.
- GPU texture compression with KTX2/Basis and view- or zone-based asset unloading remain future work.
- Mobile performance and interaction testing are not yet complete.
