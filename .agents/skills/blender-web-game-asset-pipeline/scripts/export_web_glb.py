#!/usr/bin/env python3
"""Export an approved Blender collection to a binary glTF file.

Run inside Blender:
  blender --background asset.blend --python export_web_glb.py -- \
    --collection EXPORT --output runtime/asset.glb
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Sequence

try:
    import bpy  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit("This script must run inside Blender's Python environment.") from exc


def user_args() -> List[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", default="EXPORT")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--no-animations", action="store_true")
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args(user_args())
    collection = bpy.data.collections.get(args.collection)
    if collection is None:
        raise SystemExit(f"Collection not found: {args.collection}")

    bpy.ops.object.select_all(action="DESELECT")
    export_objects = list(collection.all_objects)
    if not export_objects:
        raise SystemExit(f"Collection is empty: {args.collection}")

    for obj in export_objects:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)

    bpy.context.view_layer.objects.active = next((obj for obj in export_objects if obj.type in {"ARMATURE", "EMPTY", "MESH"}), export_objects[0])
    args.output.parent.mkdir(parents=True, exist_ok=True)

    kwargs = {
        "filepath": str(args.output.resolve()),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": not args.no_animations,
        "export_materials": "EXPORT",
        "export_normals": True,
        "export_texcoords": True,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": True,
    }

    # Filter keyword arguments against the installed Blender export operator.
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    supported = {key: value for key, value in kwargs.items() if key in properties}
    result = bpy.ops.export_scene.gltf(**supported)
    if "FINISHED" not in result:
        raise SystemExit(f"glTF export failed: {result}")

    print(f"Exported {len(export_objects)} objects to {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
