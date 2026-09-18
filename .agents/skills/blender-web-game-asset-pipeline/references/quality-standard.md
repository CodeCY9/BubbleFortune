# Production Quality Standard

## Contents

1. Geometry
2. Hard-surface construction
3. Topology and shading
4. UV and textures
5. PBR materials
6. Animation
7. Performance
8. Acceptance renders

## 1. Geometry

- Use meaningful scale and dimensions.
- Avoid overlapping coplanar surfaces and hidden internal geometry.
- Give shells visible thickness where the camera can see edges.
- Model functional relationships: hinge, latch, lid clearance, trim attachment.
- Avoid floating decorative parts unless intentionally suspended.
- Use modular parts for repeated structure.

## 2. Hard-surface construction

- Match silhouette before detail.
- Use bevel width consistently across related parts.
- Use larger bevels for stylized readability at game-camera distance.
- Keep trim proud of the body surface enough to avoid z-fighting.
- Use weighted normals or controlled topology to prevent wavy shading.
- Do not use boolean stacks as a substitute for cleanup.

## 3. Topology and shading

Errors:

- non-manifold edges;
- inverted normals;
- zero-area faces;
- duplicate vertices;
- accidental internal faces;
- extreme thin triangles;
- transforms with unexplained negative scale;
- duplicate object or action names.

Warnings requiring review:

- n-gons on curved/deforming surfaces;
- more than three materials for one prop;
- unapplied scale on exported mesh;
- excessive bevel segments;
- dense geometry invisible at runtime camera distance.

## 4. UV and textures

- Create at least one non-empty UV map for textured meshes.
- Keep consistent texel density.
- Use sufficient island padding for mipmaps.
- Avoid mirrored UVs when unique text, dirt, or normal direction requires asymmetry.
- Prefer one texture set for a normal prop.
- Use 2K only for hero assets; use 1K or lower for repeated/mobile assets.
- Pack ORM where the pipeline supports it.

## 5. PBR materials

- Metal trim: metallic near 1.0, varied roughness, not mirror-perfect everywhere.
- Painted body: metallic near 0.0 unless explicitly metal-flake.
- Emissive: use controlled masks and intensities; do not illuminate the entire material.
- Use normal detail to support, not replace, silhouette.
- Verify materials in glTF-compatible nodes.

## 6. Animation

- Root remains stable unless locomotion is required.
- Hinged parts rotate around real hinge pivots.
- No mesh collisions during normal motion.
- First and last frames are intentional.
- Looping clips have matching start/end states.
- Clip names use ASCII and underscores.
- Effects anchors and audio event empties are documented.

## 7. Performance

Measure:

- triangles;
- mesh objects;
- material slots;
- texture count and maximum dimensions;
- animation actions;
- armature/bone count if applicable;
- expected number of simultaneous instances.

Repeated props should be instancing-friendly. Avoid unique duplicated geometry for number variants.

## 8. Acceptance renders

Required stills:

- front;
- front three-quarter;
- side;
- rear;
- neutral material/light test;
- target stage-light test.

Required animation frames for an opening prop:

- closed;
- anticipation;
- latch release;
- half open;
- fully open;
- reward hold.
