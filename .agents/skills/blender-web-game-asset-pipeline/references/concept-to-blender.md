# Concept images to Blender 5.2

Use for new assets and substantial shape changes. This is a production workflow, not permission to create every asset in the GDD at once.

## 1. Establish the asset

Read DESIGN.md and the asset brief. Confirm milestone, silhouette, dimensions, moving parts, camera distance, simultaneous instances and output budgets. Reuse the project's violet/gold visual identity. Record unspecified dimensions as proposed starting values; do not present them as GDD requirements.

## 2. Generate or reuse references

Use the imagegen skill and image-generation tool for a new raster concept when no suitable image exists. Prefer a readable three-quarter view and the orthographic/structural views actually needed. Avoid generating many variants without a decision they help resolve.

Prompt example (adapt to the brief):

> Original BubbleFortune game prop, deep violet body with warm metallic gold trim, restrained emissive accents, readable at mobile game-camera distance. Show the same chest in a neutral three-quarter view and front/side structural views. Solid body, separate lid rotating around a rear hinge, usable interior and blank number display. Consistent dimensions and material zones, neutral studio lighting, no dramatic perspective hiding joints, no baked game amounts or interface text.

Save the prompt and selected image paths under art/<asset-id>/concept/ and reference them from brief.md. Record provenance. Inspect generated images; do not assume multiple generated views describe one consistent object. Resolve differences in lid depth, trim, symmetry and hinge placement in the brief. Request or generate additional views only when necessary. Infer unseen surfaces conservatively and identify those assumptions.

Choose a direction against the established brief and continue autonomously unless the user asked to choose or a material design decision remains unresolved. A visually attractive image is not proof of buildable geometry.

## 3. Transfer into Blender

Confirm Blender 5.2 using the actual runtime and inspect the current file before mutation. Prefer discovered Blender MCP Python execution, otherwise a local Blender Python script. A launcher path is only a discovery clue. If native UI control is needed, load the computer-use skill and verify that native control is available; do not pretend a browser-only tool controls Blender.

Use images as references. Build real mesh volumes and functional pivots. Render the white-box model against the reference before detailing. Continue through the main skill's mesh, materials, animation and export gates. Keep checkpoints outside public/; do not overwrite the only valid source.

## 4. Validate and hand off

Check the asset under neutral light and actual stage light. Test scale, orientation, textures, lid motion, named clips and anchors in the game. Measure at the target simultaneous instance count (16 now, 26 when relevant); record device, browser and quality tier. A screenshot is visual evidence, not an FPS measurement.

Record source/export identifiers with Blender and game-side checks. If only historical validation exists, mark awaiting validation. Update brief.md, ASSETS.md and the linked ROADMAP task as appropriate. Never label an asset complete merely because a GLB exists or a script returned success.
