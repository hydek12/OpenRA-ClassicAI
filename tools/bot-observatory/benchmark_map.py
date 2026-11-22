"""Assemble the original Observatory Range map using installed Red Alert terrain."""
import hashlib
import json
from pathlib import Path
import struct
import zipfile

MAP_NAME = "observatory-range.oramap"
SOURCE = Path(__file__).with_name("benchmark")


def wave_schedule():
    return {int(tick): units for tick, units in json.loads((SOURCE / "waves.json").read_text()).items()}


def opponent_script(waves):
    entries = [
        f"\t[{tick}] = {{ " + ", ".join(json.dumps(unit) for unit in units) + " }"
        for tick, units in waves.items()
    ]
    header = "local waves = {\n" + ",\n".join(entries) + "\n}\n\n"
    return header.encode() + (SOURCE / "opponent.lua").read_bytes()


def write_benchmark_map(destination, waves=None):
    if waves is None:
        waves = wave_schedule()
    width, height = 56, 48
    tile_offset = 17
    resource_offset = tile_offset + 3 * width * height
    tiles = bytearray()
    resources = bytearray()
    for x in range(width):
        for y in range(height):
            tiles.extend(struct.pack("<HB", 255, x % 4 + 4 * (y % 4)))
            ore = (x - 16) ** 2 + (y - 15) ** 2 <= 25 or (x - 37) ** 2 + (y - 32) ** 2 <= 16
            resources.extend((1, 8) if ore else (0, 0))

    map_data = struct.pack("<BHHIII", 2, width, height, tile_offset, 0, resource_offset)
    entries = {
        "map.yaml": (SOURCE / "map.yaml").read_bytes(),
        "map.bin": map_data + tiles + resources,
        "rules.yaml": (SOURCE / "rules.yaml").read_bytes(),
        "opponent.lua": opponent_script(waves),
        "benchmark.ftl": (SOURCE / "benchmark.ftl").read_bytes(),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(zipfile.ZipInfo(name), data, compress_type=zipfile.ZIP_DEFLATED)

    # OpenRA's format-11 UID hashes map YAML, tile data and Lua in package order.
    uid_data = b"".join(data for name, data in entries.items() if name.endswith((".yaml", ".bin", ".lua")))
    return hashlib.sha1(uid_data).hexdigest()
