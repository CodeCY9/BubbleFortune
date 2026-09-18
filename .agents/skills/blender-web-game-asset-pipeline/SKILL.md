---
name: blender-web-game-asset-pipeline
description: Create game asset concept images when needed, then build, animate, validate, and export editable Blender assets for Three.js and React Three Fiber. Use for new 3D chests, stages, props and characters, image-to-model work, repairs, variants and LODs; preserve production checkpoints and asset progress. Not for UI-only graphics or gameplay logic.
---

# Blender Web Game Asset Pipeline

Build real 3D assets through a gated Blender workflow. Treat reference images as design evidence, not geometry. Never attempt a final production asset in one opaque generation step.

## Operating principles

1. Use the user's specified Blender version (BubbleFortune: Blender 5.2). Discover available Blender MCP actions first; use Blender Python through the actual Blender executable as a fallback. An app mention or installed npm package is not proof of a working connection. Confirm version and active file before editing. Do not treat blender-launcher.exe as the Python-capable Blender executable without checking.
2. Use small, idempotent operations. Save a checkpoint before destructive changes.
3. Separate visual reference, mesh construction, materials, animation, export, and validation.
4. Render verification views after every major gate. Do not claim completion from object names or script success alone.
5. Preserve editable `.blend` source and export a separate runtime `.glb`.
6. Continue independent authorized work when a tool or gate is unavailable; record the exact blocked gate and next action. Do not claim completion without its evidence.

## Project context and durable progress

Read the project's AGENTS.md, DESIGN.md, docs/ASSETS.md and the target asset brief before production. In BubbleFortune, briefs live at art/<asset-id>/brief.md; development scope is in docs/ROADMAP.md. Read only relevant GDD sections and supporting references.

- Reuse existing sources and accepted references; do not regenerate an asset because a new task has started.
- Record latest inspected checkpoint separately from latest valid checkpoint. A newer filename is not evidence of validity.
- Keep sources, concept prompts/images, previews and reports outside public/. Preserve existing paths until a tracked migration checks references and backups.
- Gate checks are normally performed by the agent. Proceed when evidence satisfies the brief; do not require user approval at every gate. Ask only for unresolved material direction or user-requested concept selection.
- Update the brief at major gates and before stopping: stage, evidence paths, source/export version, unresolved issues, next action and date. Update ASSETS.md when the stage changes and ROADMAP.md when its task changes. Read before updating to preserve concurrent edits.
- A Blender validator PASS is only one check. Asset completion requires the matching GLB to pass actual game-scene visual, animation and performance checks. Record hashes or another unambiguous version identifier with reports.

## Concept images before new modeling

For a new asset without a suitable reference, read and use the available imagegen skill/tool to create design images before modeling. Follow references/concept-to-blender.md. Save the prompt, generated reference, selected direction and inferred geometry in the asset record. Do not use rendered planes as a substitute for real 3D geometry.

Repairs, material adjustments and LODs reuse the existing design unless the requested change needs a new concept. If image generation is unavailable, use an existing adequate reference or visual brief where possible; record the missing concept stage rather than silently claiming it is complete.

## Choose the workflow

- **New asset**: establish the brief, generate or reuse concept images, then follow the complete workflow below.
- **Repair an existing Blender asset**: inspect the current file, compare against the quality gates, then restart at the earliest failed gate.
- **Variant or LOD**: reuse the accepted source; repeat every affected gate (materials for a material variant, geometry for a silhouette change), then optimization and export.
- **Simple procedural prop**: Blender Python may create the base forms, but the same review gates still apply.
- **Deforming character**: use the same concept, checkpoint and export workflow, but adapt topology and animation gates to deformation, skin weights and pose tests. Chest dimensions, hierarchy and hard-surface-only constraints do not apply.

## Required inputs

Before modeling, establish:

- asset purpose and camera distance;
- reference image or visual brief;
- approximate real-world dimensions;
- target platform: desktop, tablet, mobile, or all;
- required moving parts and animation clips;
- required output files;
- triangle, texture, and material budgets;
- naming prefix and destination folder.

If only one perspective image is available, infer hidden geometry conservatively. Record assumptions. Request or create front, side, rear, and top references when the silhouette or mechanisms are ambiguous.

## Phase-gated workflow

### Gate 0 — Scene and tool preparation

1. Confirm Blender version and active file.
2. Set units to Metric, unit scale `1.0`, and model around the world origin.
3. Create collections: `REF`, `BLOCKOUT`, `MODEL`, `RIG`, `VFX_GUIDES`, `EXPORT`.
4. Save `<asset>_v001.blend` before edits.
5. Confirm the MCP can execute Blender Python, render stills, save files, and export glTF. Use script files as fallback when a direct action is unavailable.

### Gate 1 — Reference decomposition and asset brief

Do not model yet. Produce a concise asset brief containing:

- primary and secondary silhouettes;
- major proportions expressed as ratios;
- material zones;
- repeated modules and symmetry;
- moving parts, hinges, pivots, sockets, and effects anchors;
- parts visible only by inference;
- web performance target;
- acceptance views and animation clips.

For mechanical props, create a part hierarchy before creating geometry. Consult `references/chest-spec.md` for the BubbleFortune chest.

**Pass condition:** the hierarchy, dimensions, movement, and deliverables are explicit.

### Gate 2 — Blockout

1. Build only large volumes with primitives.
2. Match width, height, depth, lid/body ratio, corner radius, and silhouette.
3. Use Mirror and Array modifiers where appropriate.
4. Do not add tiny trim, textures, or effects.
5. Render transparent front, front three-quarter, side, and rear views using `scripts/render_turntable.py` or equivalent MCP actions.
6. Compare the blockout to the reference. Correct proportions before continuing.

**Pass condition:** silhouette and major negative spaces match from all acceptance views. A blockout is not a final asset.

### Gate 3 — Production mesh construction

1. Replace blockout volumes with clean modular geometry.
2. Use physically plausible thickness. Avoid infinitely thin lids and panels.
3. Add support loops or weighted normals for controlled hard-surface shading.
4. Use Bevel non-destructively until the shape is approved.
5. Separate moving parts. Set parent-child relationships before animation.
6. Place origins at functional pivots, not object centers.
7. Avoid disconnected floating parts unless they are intentional detachable pieces.
8. Keep symmetry until asymmetric detail is required.
9. Apply transforms only when safe; never apply modifiers or transforms that break approved animation without making a checkpoint.

**Pass condition:** clean silhouette, plausible construction, correct pivots, no accidental intersections, and no unexplained floating geometry.

### Gate 4 — Topology, UV, and shading

1. Inspect face orientation and recalculate normals outward.
2. Remove duplicate vertices and accidental internal faces.
3. Fix non-manifold edges unless explicitly required.
4. Use quads for deforming or curved areas; controlled n-gons are acceptable only on flat, non-deforming surfaces.
5. Create UVs with consistent texel density and sufficient padding.
6. Use one to three materials for a normal prop. Avoid one material per decorative part.
7. Use smooth shading plus Auto Smooth or weighted normals as appropriate.
8. Run `scripts/blender_asset_validator.py` and resolve all errors before materials.

**Pass condition:** validator has no errors; warnings are documented and intentional.

### Gate 5 — PBR materials

Use glTF-compatible PBR materials:

- Base Color;
- Normal;
- packed ORM when available: occlusion, roughness, metallic;
- Emissive for controlled glow;
- Alpha only where necessary.

Rules:

1. Use material contrast to communicate structure: body, metal trim, glass/emissive, interior.
2. Keep metallic and roughness physically plausible.
3. Do not rely on viewport-only procedural nodes unsupported by glTF. Bake them to textures.
4. Avoid pure black and fully saturated emissive values.
5. Test under neutral studio light and under the target stage lighting.
6. Check that external textures resolve and are packed or exported correctly.

**Pass condition:** the asset reads correctly without post-processing and improves with stage lighting rather than depending on it.

### Gate 6 — Animation

1. Create named clips as separate Actions or NLA strips.
2. Animate mechanical parts around functional pivots.
3. Keep gameplay-critical timing deterministic.
4. Avoid baking camera motion into a prop asset.
5. Add event anchors as empties, for example `FX_Reward`, `FX_Dust`, `UI_Amount`, `SFX_Latch`.
6. Test clips individually and in sequence.
7. Render key frames: closed, anticipation, half-open, fully open, reward hold.

**Pass condition:** no mesh penetration, pivot slip, transform jump, or first-frame pop. Required clips are present and named correctly.

### Gate 7 — LOD and real-time optimization

Create LODs only after the hero model is approved.

- `LOD0`: desktop hero view;
- `LOD1`: tablet and medium distance;
- `LOD2`: mobile or far distance.

Prioritize silhouette. Remove unseen backfaces, tiny bevel segments, and micro-detail before reducing major forms. Preserve UVs, material slots, animation hierarchy, and pivots.

Project asset and total-scene budgets override these fallback starting budgets. Account for 16/26 simultaneous boxes, materials, draw calls and animation cost; instancing is not automatically compatible with independent lids. Record the chosen strategy (shared static instances plus active animated object, or measured equivalent). Do not equate cloning meshes with instancing.

Default starting budgets, unless the project specifies others:

- hero chest LOD0: 12k–30k triangles;
- chest LOD1: 6k–14k triangles;
- chest LOD2: 2k–6k triangles;
- prop materials: 1–3;
- hero texture set: maximum 2K; mobile: 1K;
- static stage geometry: modular and instancing-friendly.

Treat these as budgets, not targets to fill.

### Gate 8 — Export and validation

1. Save the approved `.blend` source.
2. Copy approved objects to the `EXPORT` collection.
3. Run `scripts/blender_asset_validator.py` with the relevant config.
4. Export GLB using `scripts/export_web_glb.py` or equivalent MCP operation.
5. Inspect the GLB independently, then in the actual Three.js / R3F game scene using the current lighting, camera, concurrent instance count and quality tier.
6. Verify orientation, scale, materials, textures, animation names, pivots, bounding box, and transparency.
7. Run glTF Transform inspection/optimization when available, then re-check visual output.
8. Deliver the validation report and turntable renders with the asset.

Do not mark the task complete unless both Blender and exported GLB checks pass.

## Blender MCP execution pattern

Prefer a sequence like:

1. inspect scene and selected objects;
2. execute one focused Python operation;
3. inspect object hierarchy and dimensions;
4. render a verification image;
5. compare and revise;
6. save checkpoint;
7. continue to the next gate.

Never issue a single instruction such as “generate the final chest from this image.” That commonly produces crude boxes, disconnected pieces, wrong pivots, and no production topology.

Use `references/mcp-runbook.md` for concrete request templates and recovery behavior.

## Required deliverables

For a production asset, return:

- editable `.blend` source;
- runtime `.glb`;
- textures or packed source;
- four-view or turntable previews;
- animation clip list and durations;
- triangle, material, and texture statistics;
- validator JSON report;
- documented assumptions and remaining warnings.
- updated asset brief and index with the next action or matching completion evidence.

## Quality response format

Report work by gate:

```text
Asset: <name>
Status: PASS / BLOCKED / NEEDS REVIEW
Completed gates: 0–N
Geometry: <triangles, objects, materials>
Animations: <clip names>
Exports: <paths>
Validation errors: <count>
Validation warnings: <count>
Assumptions: <brief list>
Next action: <one concrete step>
```

## Resources

- `references/concept-to-blender.md`: concept generation, structural consistency, Blender 5.2 handoff and durable records.
- `references/mcp-runbook.md`: phased Blender MCP prompts, checkpoint rules, and failure recovery.
- `references/quality-standard.md`: hard-surface, PBR, animation, and web-runtime acceptance standards.
- `references/chest-spec.md`: BubbleFortune chest hierarchy, dimensions, pivots, clips, and visual requirements.
- `references/web-export.md`: glTF/GLB export and Three.js verification requirements.
- `references/failure-patterns.md`: diagnose crude, disconnected, camera-dependent, or export-broken assets.
- `references/asset-brief-template.md`: reusable requirements template before modeling.
- `scripts/blender_asset_validator.py`: Blender-side automated checks and JSON reporting.
- `scripts/render_turntable.py`: render standard verification views.
- `scripts/export_web_glb.py`: export an approved collection to GLB.
- `assets/chest-validator-config.json`: example validation configuration for the BubbleFortune chest.
