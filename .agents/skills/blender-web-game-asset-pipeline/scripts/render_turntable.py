#!/usr/bin/env python3
"""Render standard transparent verification views of a Blender collection.

Run inside Blender:
  blender --background asset.blend --python render_turntable.py -- \
    --collection EXPORT --output previews --resolution 768
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import List, Sequence, Tuple

try:
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit("This script must run inside Blender's Python environment.") from exc


def user_args() -> List[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", default="EXPORT")
    parser.add_argument("--output", type=Path, default=Path("previews"))
    parser.add_argument("--resolution", type=int, default=768)
    parser.add_argument("--transparent", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args(argv)


def collection_meshes(name: str):
    collection = bpy.data.collections.get(name)
    if collection is None:
        raise ValueError(f"Collection not found: {name}")
    return [obj for obj in collection.all_objects if obj.type == "MESH" and not obj.hide_render]


def bounds(objects) -> Tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise ValueError("No renderable mesh objects found")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def look_at(obj, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(collection, name: str, location, energy: float, size: float, target: Vector):
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def main() -> int:
    args = parse_args(user_args())
    objects = collection_meshes(args.collection)
    minimum, maximum = bounds(objects)
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    radius = max(extent.x, extent.y, extent.z) * 0.5
    distance = max(radius * 3.2, 2.0)
    elevation = center.z + max(extent.z * 0.18, 0.15)

    temp = bpy.data.collections.new("__TURN_TABLE_TEMP__")
    bpy.context.scene.collection.children.link(temp)

    camera_data = bpy.data.cameras.new("__TurntableCamera__")
    camera = bpy.data.objects.new("__TurntableCamera__", camera_data)
    temp.objects.link(camera)
    camera_data.lens = 58
    camera_data.sensor_width = 36

    add_area_light(temp, "__Key__", center + Vector((-distance, -distance, distance)), 1000, radius * 2.2, center)
    add_area_light(temp, "__Fill__", center + Vector((distance, -distance * 0.5, distance * 0.5)), 600, radius * 2.0, center)
    add_area_light(temp, "__Rim__", center + Vector((0, distance, distance)), 850, radius * 1.5, center)

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = args.transparent
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except TypeError:
            pass

    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass

    views = {
        "front": Vector((0, -distance, elevation)),
        "front_three_quarter": Vector((distance * 0.72, -distance * 0.72, elevation)),
        "side": Vector((distance, 0, elevation)),
        "rear": Vector((0, distance, elevation)),
    }

    args.output.mkdir(parents=True, exist_ok=True)
    for name, location in views.items():
        camera.location = center + location - Vector((0, 0, center.z))
        look_at(camera, center)
        scene.render.filepath = str((args.output / f"{name}.png").resolve())
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {scene.render.filepath}")

    for obj in list(temp.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(temp)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
