# Web GLB Export and Verification

## Source and runtime files

Keep separate:

```text
art/<asset-id>/source/<asset>.blend
public/assets/models/runtime/<asset>_lod0.glb
public/assets/models/runtime/<asset>_lod1.glb
public/assets/models/runtime/<asset>_lod2.glb
art/<asset-id>/previews/
art/<asset-id>/validation/validation.json
```

## Blender export requirements

These are BubbleFortune paths. Reuse another project's established equivalent paths. Existing legacy sources must be inventoried and their references checked before migration; do not delete the only editable source.

- format: binary glTF `.glb`;
- axis: glTF Y-up conversion enabled;
- units: 1 Blender meter equals 1 runtime meter;
- export only the approved `EXPORT` collection;
- include normals, tangents when normal maps need them, UVs, materials, and animations;
- avoid exporting reference images, work lights, helper cameras, or blockout collections;
- use unique object, material, and action names;
- include custom properties only when the runtime consumes them.

## Compression

After export, inspect before optimizing. When glTF Transform is available:

```bash
gltf-transform inspect asset.glb
gltf-transform optimize asset.glb asset.optimized.glb --texture-compress webp
```

Use Meshopt and KTX2 only when the runtime loaders are configured for them. Never enable compression without testing the actual Three.js loading path.

## Three.js verification

Verify in a minimal scene with:

- neutral HDRI or hemisphere light;
- one directional or spot light;
- orbit controls for inspection;
- animation clip selector;
- bounding box helper;
- model statistics panel;
- transparent-background toggle;
- mobile pixel-ratio cap.

Check:

- scale and ground contact;
- front direction;
- normals and shading;
- material colors and roughness;
- emissive intensity;
- alpha sorting;
- animation clip names and duration;
- pivot behavior;
- texture loading and color space;
- file size and frame rate with expected instance count.

## Delivery manifest

After neutral-scene inspection, verify the exported file in the actual game scene with runtime material overrides, cameras, animations and expected instance count. Record device/browser/quality/FPS. Bind evidence to source and export hashes or precise versions; a historical Blender PASS does not validate a newer GLB.

Provide a manifest entry:

```json
{
  "asset": "BF_Chest",
  "source": "art/chest-standard/source/BF_Chest.blend",
  "runtime": {
    "lod0": "public/assets/models/runtime/BF_Chest_lod0.glb",
    "lod1": "public/assets/models/runtime/BF_Chest_lod1.glb",
    "lod2": "public/assets/models/runtime/BF_Chest_lod2.glb"
  },
  "animations": ["Chest_Idle", "Chest_Hover", "Chest_Selected", "Chest_Shake", "Chest_Open", "Chest_RewardHold"],
  "units": "meters",
  "forward": "-Z",
  "up": "+Y"
}
```
