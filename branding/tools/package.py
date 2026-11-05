"""Validate deliverables, build native icons, and package the finished brand kit."""

import hashlib
import json
import shutil
import struct
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
COLORS = json.loads((ROOT / "source/brand.json").read_text(encoding="utf-8"))["colors"]
ARCHIVE = ROOT / "servio-sable-brand-kit.zip"


def build_native_icons():
    for brand in ["servio", "sable"]:
        folder = ROOT / f"exports/{brand}/icons"
        with Image.open(folder / f"{brand}-app-dark-1024w.png") as original:
            image = original.convert("RGBA")
            image.save(folder / f"{brand}.ico", sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]])
            image.save(folder / f"{brand}.icns", format="ICNS")
        with Image.open(folder / f"{brand}-favicon.png") as favicon:
            favicon.save(folder / "favicon.ico", sizes=[(s, s) for s in [16, 24, 32, 48, 64]])
        aliases = {"apple-touch-icon.png": f"{brand}-app-dark-180w.png",
                   "icon-192.png": f"{brand}-app-dark-192w.png",
                   "icon-512.png": f"{brand}-app-dark.png",
                   "maskable-512.png": f"{brand}-maskable.png",
                   "favicon.svg": f"{brand}-favicon.svg"}
        for target, source in aliases.items():
            shutil.copyfile(folder / source, folder / target)
        with Image.open(folder / f"{brand}.ico") as icon:
            if not {(16, 16), (32, 32), (256, 256)}.issubset(icon.ico.sizes()):
                raise ValueError(f"Missing native icon sizes: {brand}")
        with Image.open(folder / f"{brand}.icns") as icon:
            if icon.format != "ICNS":
                raise ValueError(f"Invalid ICNS: {brand}")


def build_palettes():
    swatches = {key: COLORS[key] for key in ["navy", "cobalt", "mist", "ice"]}
    ase = b"ASEF" + struct.pack(">HHI", 1, 0, len(swatches))
    gpl = "GIMP Palette\nName: Servio + Sable\nColumns: 4\n# sRGB\n"
    for name, hex_value in swatches.items():
        rgb = tuple(int(hex_value[index:index + 2], 16) for index in (1, 3, 5))
        label = name.title() + "\0"
        content = struct.pack(">H", len(label)) + label.encode("utf-16-be")
        content += b"RGB " + struct.pack(">fffH", *(component / 255 for component in rgb), 0)
        ase += struct.pack(">HI", 1, len(content)) + content
        gpl += f"{rgb[0]:3} {rgb[1]:3} {rgb[2]:3}\t{name.title()} {hex_value}\n"
    (ROOT / "exports/palette.ase").write_bytes(ase)
    (ROOT / "exports/palette.gpl").write_text(gpl, encoding="utf-8", newline="\n")


def validate_exports():
    records = []
    for path in sorted((ROOT / "exports").rglob("*")):
        if not path.is_file():
            continue
        record = {"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        if path.suffix == ".svg":
            tree = ET.parse(path).getroot()
            invalid = [node.tag for node in tree.iter()
                       if node.tag.rsplit("}", 1)[-1] in {"image", "text", "script", "foreignObject"}]
            if invalid:
                raise ValueError(f"Non-vector or active SVG content: {path}")
            record["viewBox"] = tree.attrib["viewBox"]
        if path.suffix == ".png":
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                record["width"], record["height"] = image.size
                if not image.convert("RGBA").getbbox():
                    raise ValueError(f"Empty PNG: {path}")
                if "/png/" in path.as_posix():
                    low, high = image.convert("RGBA").getchannel("A").getextrema()
                    if low != 0 or high != 255:
                        raise ValueError(f"Logo transparency is missing: {path}")
        records.append(record)
    counts = {extension: sum(Path(item["path"]).suffix == extension for item in records)
              for extension in [".svg", ".png", ".ico", ".icns"]}
    manifest = {"version": "1.0.0", "colorSpace": "sRGB", "counts": counts, "assets": records}
    (ROOT / "asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    return counts


def kit_files():
    excluded = {"node_modules", ".build", "concepts", "__pycache__"}
    return [path for path in sorted(ROOT.rglob("*"))
            if path.is_file() and not excluded.intersection(path.relative_to(ROOT).parts)
            and path.name not in {ARCHIVE.name, "checksums.sha256"}]


def package():
    files = kit_files()
    sums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(ROOT).as_posix()}\n"
                   for path in files)
    checksum_file = ROOT / "checksums.sha256"
    checksum_file.write_text(sums, encoding="utf-8", newline="\n")
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files + [checksum_file]:
            archive.write(path, "servio-sable-brand-kit/" + path.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(ARCHIVE) as archive:
        if archive.testzip() is not None:
            raise ValueError("Brand kit archive failed verification")
    print(f"Packaged {len(files) + 1} files; {ARCHIVE.stat().st_size:,} bytes.")


def main():
    project_license = ROOT.parent / "LICENSE"
    kit_license = ROOT / "LICENSE-PROJECT.txt"
    if project_license.exists():
        shutil.copyfile(project_license, kit_license)
    elif not kit_license.exists():
        raise FileNotFoundError("The project license must be included in the brand kit.")
    build_native_icons()
    build_palettes()
    print(validate_exports())
    if not (ROOT / "brand-guide.pdf").is_file():
        raise FileNotFoundError("Build the brand guide before packaging.")
    package()


if __name__ == "__main__":
    main()
