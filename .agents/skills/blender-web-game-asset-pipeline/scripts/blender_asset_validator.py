#!/usr/bin/env python3
"""Validate a Blender asset for real-time web export.

Run inside Blender:
  blender --background asset.blend --python blender_asset_validator.py -- \
    --config chest-validator-config.json --report validation.json

The script is intentionally conservative: errors block export, warnings require review.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import bpy  # type: ignore
    import bmesh  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError as exc:  # pragma: no cover - expected outside Blender
    raise SystemExit("This script must run inside Blender's Python environment.") from exc


DEFAULT_CONFIG: Dict[str, Any] = {
    "collection": "EXPORT",
    "required_objects": [],
    "required_actions": [],
    "max_triangles": 30000,
    "max_materials": 3,
    "max_texture_size": 2048,
    "require_uv": True,
    "require_material": True,
    "allow_non_manifold": False,
    "scale_tolerance": 0.001,
    "name_pattern": r"^[A-Za-z0-9_]+$",
    "pivot_rules": [],
}


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="JSON validation configuration")
    parser.add_argument("--report", type=Path, default=Path("validation.json"))
    return parser.parse_args(argv)


def user_args() -> List[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def load_config(path: Optional[Path]) -> Dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    if path:
        with path.open("r", encoding="utf-8") as handle:
            config.update(json.load(handle))
    return config


def collection_objects(collection_name: str) -> List[Any]:
    collection = bpy.data.collections.get(collection_name)
    if collection is None:
        raise ValueError(f"Collection not found: {collection_name}")
    return list(collection.all_objects)


def world_bbox(obj: Any) -> List[Any]:
    return [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]


def bbox_extrema(obj: Any) -> Tuple[Vector, Vector]:
    points = world_bbox(obj)
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def non_manifold_edge_count(obj: Any) -> int:
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return sum(1 for edge in bm.edges if not edge.is_manifold)
    finally:
        bm.free()


def triangle_count(obj: Any) -> int:
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def texture_records(materials: Iterable[Any]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    seen = set()
    for material in materials:
        if not material or not material.use_nodes or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            image = node.image
            key = image.name_full
            if key in seen:
                continue
            seen.add(key)
            filepath = bpy.path.abspath(image.filepath) if image.filepath else ""
            records.append(
                {
                    "name": image.name_full,
                    "width": int(image.size[0]) if image.size else 0,
                    "height": int(image.size[1]) if image.size else 0,
                    "filepath": filepath,
                    "exists": bool(image.packed_file) or (bool(filepath) and os.path.exists(filepath)),
                    "packed": bool(image.packed_file),
                }
            )
    return records


def normalized_axis_value(value: float, minimum: float, maximum: float) -> float:
    span = maximum - minimum
    if abs(span) < 1e-8:
        return 0.5
    return (value - minimum) / span


def check_pivot_rule(rule: Dict[str, Any]) -> Optional[str]:
    pivot_obj = bpy.data.objects.get(rule.get("object", ""))
    target_obj = bpy.data.objects.get(rule.get("relative_to", ""))
    if pivot_obj is None or target_obj is None:
        return f"Pivot rule objects missing: {rule}"

    minimum, maximum = bbox_extrema(target_obj)
    position = pivot_obj.matrix_world.translation
    tolerance = float(rule.get("tolerance", 0.1))
    expectations = rule.get("axis_expectations", {})
    axes = {"x": 0, "y": 1, "z": 2}
    failures = []

    for axis_name, expectation in expectations.items():
        index = axes[axis_name]
        normalized = normalized_axis_value(position[index], minimum[index], maximum[index])
        target = {"min": 0.0, "center": 0.5, "max": 1.0}[expectation]
        if abs(normalized - target) > tolerance:
            failures.append(f"{axis_name}={normalized:.3f}, expected {expectation}±{tolerance}")

    if failures:
        return f"Pivot {pivot_obj.name} invalid relative to {target_obj.name}: " + "; ".join(failures)
    return None


def main() -> int:
    args = parse_args(user_args())
    config = load_config(args.config)
    errors: List[str] = []
    warnings: List[str] = []

    try:
        objects = collection_objects(config["collection"])
    except ValueError as exc:
        errors.append(str(exc))
        objects = []

    mesh_objects = [obj for obj in objects if obj.type == "MESH"]
    object_names = [obj.name for obj in objects]
    name_pattern = re.compile(config["name_pattern"])

    for required in config["required_objects"]:
        if bpy.data.objects.get(required) is None:
            errors.append(f"Missing required object: {required}")

    for name in object_names:
        if not name_pattern.match(name):
            warnings.append(f"Non-portable object name: {name}")
        if re.search(r"\.\d{3}$", name):
            warnings.append(f"Auto-suffixed object name suggests unintended duplicate: {name}")

    total_triangles = 0
    materials = set()
    mesh_stats = []
    scale_tolerance = float(config["scale_tolerance"])

    for obj in mesh_objects:
        triangles = triangle_count(obj)
        total_triangles += triangles
        material_names = [slot.material.name for slot in obj.material_slots if slot.material]
        materials.update(material_names)
        uv_count = len(obj.data.uv_layers)
        manifold_count = non_manifold_edge_count(obj)
        scale = obj.scale

        if any(abs(component - 1.0) > scale_tolerance for component in scale):
            errors.append(f"Unapplied scale on {obj.name}: {tuple(round(v, 6) for v in scale)}")
        if config["require_uv"] and uv_count == 0:
            errors.append(f"Missing UV map: {obj.name}")
        if config["require_material"] and not material_names:
            errors.append(f"Missing material: {obj.name}")
        if manifold_count and not config["allow_non_manifold"]:
            errors.append(f"Non-manifold edges on {obj.name}: {manifold_count}")

        mesh_stats.append(
            {
                "name": obj.name,
                "triangles": triangles,
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
                "uv_layers": uv_count,
                "materials": material_names,
                "non_manifold_edges": manifold_count,
                "dimensions": [round(float(v), 6) for v in obj.dimensions],
            }
        )

    if total_triangles > int(config["max_triangles"]):
        errors.append(f"Triangle budget exceeded: {total_triangles} > {config['max_triangles']}")
    if len(materials) > int(config["max_materials"]):
        errors.append(f"Material budget exceeded: {len(materials)} > {config['max_materials']}")

    material_objects = [bpy.data.materials.get(name) for name in materials]
    textures = texture_records(material_objects)
    for texture in textures:
        if max(texture["width"], texture["height"]) > int(config["max_texture_size"]):
            errors.append(
                f"Texture too large: {texture['name']} {texture['width']}x{texture['height']} "
                f"> {config['max_texture_size']}"
            )
        if not texture["exists"]:
            errors.append(f"Missing external texture: {texture['name']} ({texture['filepath']})")

    action_names = sorted(action.name for action in bpy.data.actions)
    for required in config["required_actions"]:
        if required not in action_names:
            errors.append(f"Missing required animation action: {required}")

    for rule in config.get("pivot_rules", []):
        pivot_error = check_pivot_rule(rule)
        if pivot_error:
            errors.append(pivot_error)

    scene = bpy.context.scene
    if scene.unit_settings.system != "METRIC":
        warnings.append(f"Scene unit system is {scene.unit_settings.system}, expected METRIC")
    if not math.isclose(scene.unit_settings.scale_length, 1.0, abs_tol=1e-6):
        warnings.append(f"Scene unit scale is {scene.unit_settings.scale_length}, expected 1.0")

    report = {
        "status": "PASS" if not errors else "FAIL",
        "blender_version": bpy.app.version_string,
        "blend_file": bpy.data.filepath,
        "collection": config["collection"],
        "summary": {
            "objects": len(objects),
            "mesh_objects": len(mesh_objects),
            "triangles": total_triangles,
            "materials": len(materials),
            "textures": len(textures),
            "actions": len(action_names),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "mesh_stats": mesh_stats,
        "materials": sorted(materials),
        "textures": textures,
        "actions": action_names,
        "errors": errors,
        "warnings": warnings,
        "config": config,
    }

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2, ensure_ascii=False))
    for error in errors:
        print(f"ERROR: {error}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    print(f"Validation report: {args.report.resolve()}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
