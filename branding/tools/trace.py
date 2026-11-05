"""Reconstruct the two approved silhouettes; regular builds use marks.json."""

import json
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image
import vtracer

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "source" / "references"


def trace(filename, crop, predicate):
    pixels = np.asarray(Image.open(REFERENCES / filename).convert("RGB").crop(crop))
    mask = predicate(pixels.astype(int))
    rows, columns = np.where(mask)
    mask = mask[rows.min():rows.max() + 1, columns.min():columns.max() + 1]
    height, width = mask.shape
    with tempfile.TemporaryDirectory() as temporary:
        source = Path(temporary) / "mask.png"
        target = Path(temporary) / "trace.svg"
        Image.fromarray(np.where(mask, 0, 255).astype("uint8")).save(source)
        vtracer.convert_image_to_svg_py(
            str(source), str(target), colormode="binary", mode="spline",
            filter_speckle=10, corner_threshold=70, length_threshold=3.0,
            splice_threshold=45, path_precision=3,
        )
        elements = ET.parse(target).getroot()
        paths = [{"d": node.attrib["d"], "transform": node.get("transform", "")}
                 for node in elements.iter() if node.tag.endswith("path")]
    return {"width": width, "height": height, "paths": paths}


def main():
    marks = {
        "servio": trace("servio-relay-approved.png", (25, 215, 200, 380),
                        lambda rgb: (rgb[:, :, 2] > 120) &
                        (rgb[:, :, 2] - rgb[:, :, 0] > 50) &
                        (rgb[:, :, 2] - rgb[:, :, 1] > 35)),
        "sable": trace("sable-nova-flow-approved.png", (45, 200, 340, 490),
                       lambda rgb: rgb.max(axis=2) < 100),
    }
    destination = ROOT / "source" / "marks.json"
    destination.write_text(json.dumps(marks, indent=2) + "\n", encoding="utf-8", newline="\n")
    print({name: {"size": [mark["width"], mark["height"]],
                  "components": len(mark["paths"])} for name, mark in marks.items()})


if __name__ == "__main__":
    main()
