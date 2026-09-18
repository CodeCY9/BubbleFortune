# Blender MCP Runbook

## Contents

1. Tool discovery
2. Image-to-asset workflow
3. Checkpoint protocol
4. Focused MCP request templates
5. Repair workflow
6. Failure recovery

## 1. Tool discovery

Before editing, discover or confirm actions for:

- scene/object inspection;
- Blender Python execution;
- image/reference import;
- viewport or still rendering;
- file save/save-as;
- glTF export;
- reading command output.

Prefer Blender Python execution as the stable common denominator. Do not assume a specific community Blender MCP function name.

For BubbleFortune, verify Blender 5.2 and the active file. If MCP is unavailable, locate the actual Blender executable and run Blender Python locally. The supplied launcher path is not itself proof of Python execution support. Record an unavailable capability without blocking independent brief/concept work.

## 2. Image-to-asset workflow

Use this order:

1. Read the asset brief and progress; generate a concept through imagegen when a new asset lacks a usable reference. Inspect structural consistency and save the chosen image/prompt, then decompose it into the written brief.
2. Set units and create collections.
3. Build a primitive blockout.
4. Render four views.
5. Compare proportions and revise.
6. Build the production mesh.
7. Fix pivots and hierarchy.
8. Validate topology and UVs.
9. Add materials.
10. Add animations and anchors.
11. Render animation key frames.
12. Validate and export GLB.
13. Verify independently and in the actual game scene; bind evidence to the source/export versions and update the asset brief, index and task status. Agent review normally suffices at intermediate gates; do not ask for approval at every checkpoint.

Do not collapse these into one long Python script. Use short scripts that can be rerun safely.

## 3. Checkpoint protocol

Save before:

- applying modifiers;
- joining or separating meshes;
- remeshing or decimation;
- rebaking textures;
- changing hierarchy or pivots;
- creating or replacing animation actions;
- export cleanup.

Filename pattern:

```text
<asset>_v001_blockout.blend
<asset>_v002_model.blend
<asset>_v003_material.blend
<asset>_v004_animation.blend
<asset>_v005_export.blend
```

## 4. Focused MCP request templates

### Scene setup

```text
Inspect the active Blender file. Report Blender version, unit settings, collections, selected objects, and existing cameras/lights. Do not edit yet.
```

### Reference decomposition

```text
Analyze the supplied concept image as a hard-surface prop. Return width:height:depth ratios, major parts, negative spaces, symmetry, materials, moving parts, inferred hidden geometry, and uncertain areas. Do not create geometry yet.
```

### Blockout

```text
Using Blender Python, create only the major volumes in collection BLOCKOUT. Use named primitives and non-destructive modifiers. Match the approved proportions. Do not add trim, materials, text, or animation. Save a checkpoint and render front, three-quarter, side, and rear verification views.
```

### Proportion revision

```text
Compare the four verification views against the reference brief. List the three largest silhouette errors, then correct only those errors. Render the same views again.
```

### Production construction

```text
Convert the approved blockout into modular hard-surface parts in MODEL. Preserve symmetry and separate all moving parts. Set functional pivots. Add bevels and weighted normals without applying destructive operations yet. Report hierarchy, dimensions, and triangle count.
```

### Material pass

```text
Create glTF-compatible PBR materials for body, metal trim, and emissive accents. Use physically plausible metallic and roughness values. Do not use unsupported procedural nodes unless baked. Render under neutral light and target stage light.
```

### Animation pass

```text
Create the required named animation Actions. Keep the asset root stationary. Animate the lid around its hinge pivot and the latch independently. Add empties for effects and UI anchors. Render the specified key frames and report clip frame ranges and durations.
```

### Validation and export

```text
Run the bundled Blender validator using the asset config. Fix all errors. Export only the EXPORT collection to GLB, then inspect the exported file in an independent viewer or test scene. Return paths, statistics, errors, warnings, and screenshots.
```

## 5. Repair workflow

When the current asset looks like a crude collection of cubes:

1. Save it as an evidence checkpoint.
2. Inspect object hierarchy, dimensions, and origins.
3. Keep only parts whose silhouette and placement are useful.
4. Recreate the blockout from the reference brief.
5. Do not refine incorrect geometry.
6. Restart at Gate 2 rather than adding materials to a failed silhouette.

## 6. Failure recovery

- **MCP call timed out:** inspect the scene before retrying. The operation may have completed.
- **Partial geometry created:** do not rerun blindly. Delete or rename the partial collection first.
- **Script error:** capture traceback, object state, and Blender version; patch only the failed step.
- **Bad render:** check camera clipping, object bounds, world lighting, normals, and color management.
- **Broken export animation:** verify actions are assigned or stashed in NLA and that object names are unique.
- **Model too heavy:** optimize a duplicate LOD collection; never decimate the only source model.
