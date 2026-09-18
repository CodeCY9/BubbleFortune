# Failure Patterns and Corrective Actions

## Crude nested cubes

Symptoms:

- large rectangular slabs approximate the image;
- frame members do not connect correctly;
- no designed silhouette or bevel hierarchy;
- no clear body/lid/latch construction.

Cause:

- one-shot prompt asked Blender MCP to create the final asset;
- no reference decomposition or blockout review;
- procedural primitives were mistaken for a completed model.

Correction:

1. Save the failed result as evidence.
2. Delete or isolate the failed model collection.
3. Write the part hierarchy and ratios.
4. rebuild a clean blockout;
5. render four views;
6. correct silhouette before detail.

## Floating lid or disconnected parts

Symptoms:

- lid appears suspended;
- hinge has no physical relationship to lid and body;
- trim pieces float away from the shell.

Correction:

- define hinge axis first;
- parent the lid to a dedicated pivot empty;
- model rear hinge clearances;
- use snapping and measured offsets;
- verify side and rear renders.

## Good front view, broken side/rear view

Cause:

- single-image modeling optimized only for the camera angle.

Correction:

- create explicit depth assumptions;
- obtain or synthesize side/rear references;
- require four-view acceptance before production detailing.

## Materials used to hide bad geometry

Symptoms:

- strong glow and dark colors make the asset look acceptable from one angle;
- neutral-light render exposes flat, intersecting, or missing geometry.

Correction:

- enforce neutral-light acceptance before target lighting;
- do not begin materials until topology and silhouette pass.

## Animation rotates the entire object

Cause:

- moving part was not separated or pivoted.

Correction:

- separate lid and latch;
- create functional pivot objects;
- keep root transform stable;
- rerun animation acceptance frames.

## Export differs from Blender

Check:

- unsupported procedural shader nodes;
- missing packed textures;
- action not assigned or stashed;
- unapplied negative scale;
- alpha mode mismatch;
- tangent requirement for normal maps;
- helper objects accidentally exported.

Never approve based only on the Blender viewport. Verify the GLB independently.
