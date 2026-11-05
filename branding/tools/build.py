"""Build outlined SVG masters and a deterministic PNG export plan."""

import html
import json
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.svgLib.path import parse_path
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / "source/brand.json").read_text(encoding="utf-8"))
MARKS = json.loads((ROOT / "source/marks.json").read_text(encoding="utf-8"))
C = SPEC["colors"]
JOBS = []


@lru_cache
def font(weight):
    variable = TTFont(ROOT / "fonts/Manrope-Variable.ttf")
    return instantiateVariableFont(variable, {"wght": weight})


def text_width(value, size, weight=650, tracking=-0.025):
    face = font(weight)
    cmap = face.getBestCmap()
    units = face["head"].unitsPerEm
    advance = sum(face["hmtx"][cmap[ord(char)]][0] for char in value)
    return advance * size / units + max(0, len(value) - 1) * tracking * size


def text(value, x, y, size, color, weight=650, tracking=-0.025):
    face = font(weight)
    glyphs, cmap = face.getGlyphSet(), face.getBestCmap()
    units = face["head"].unitsPerEm
    scale = size / units
    baseline = y + face["OS/2"].sCapHeight * scale
    pen = SVGPathPen(glyphs)
    cursor = x
    for character in value:
        name = cmap[ord(character)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        cursor += face["hmtx"][name][0] * scale + tracking * size
    return f'<path fill="{color}" d="{pen.getCommands()}"/>'


def rect(x, y, width, height, fill, radius=0, extra=""):
    return f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}" {extra}/>'


def mark(brand, x, y, size, color, accent=False):
    data = MARKS[brand]
    scale = size / max(data["width"], data["height"])
    tx = x + (size - data["width"] * scale) / 2
    ty = y + (size - data["height"] * scale) / 2
    paths = []
    for index, path in enumerate(data["paths"]):
        fill = C["cobalt"] if accent and index < 3 else C["ice"] if accent else color
        paths.append(f'<path fill="{fill}" transform="{path["transform"]}" d="{path["d"]}"/>')
    return f'<g transform="translate({tx} {ty}) scale({scale})">{"".join(paths)}</g>'


def lockup(brand, x, y, height, ink, symbol_ink=None, endorsed=False):
    size = height * 0.74
    fontsize = height * (0.58 if endorsed else 0.67)
    sx, tx = x + height * 0.08, x + height * 1.02
    word_y = y + height * (0.13 if endorsed else 0.25)
    result = mark(brand, sx, y + height * 0.13, size, symbol_ink or ink)
    result += text(SPEC["brands"][brand]["name"], tx, word_y, fontsize, ink, 750, -0.04)
    if endorsed:
        result += text("by Servio", tx + 1, y + height * 0.68, height * 0.17, ink, 500, 0.03)
    return result


def svg(width, height, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}">'
            f'<title>{html.escape(title)}</title>{body}</svg>\n')


def asset(relative, width, height, body, title, raster_widths=None):
    relative = Path("exports") / relative
    destination = ROOT / relative.with_suffix(".svg")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(svg(width, height, body, title), encoding="utf-8", newline="\n")
    for raster_width in raster_widths or [width]:
        suffix = "" if raster_width == width else f"-{raster_width}w"
        target = relative.with_suffix("").as_posix().replace("/svg/", "/png/") + suffix + ".png"
        JOBS.append({"source": relative.with_suffix(".svg").as_posix(), "target": target,
                     "width": raster_width, "height": round(height * raster_width / width)})


def build_logos():
    schemes = {"primary": (C["navy"], None), "inverse": (C["white"], None),
               "black": ("#000000", None), "white": (C["white"], None)}
    for brand in SPEC["brands"]:
        for scheme, (ink, symbol_ink) in schemes.items():
            if scheme == "primary" and brand == "servio":
                symbol_ink = C["cobalt"]
            prefix = f"{brand}/svg/{brand}"
            symbol = mark(brand, 16, 16, 224, symbol_ink or ink)
            asset(f"{prefix}-symbol-{scheme}", 256, 256, symbol, f"{brand} symbol {scheme}", [128, 256, 512, 1024, 2048])
            name = SPEC["brands"][brand]["name"]
            width = round(text_width(name, 76, 750, -0.04) + 32)
            asset(f"{prefix}-wordmark-{scheme}", width, 96,
                  text(name, 16, 20, 76, ink, 750, -0.04), f"{name} wordmark {scheme}", [1200, 2400])
            width = round(text_width(name, 112 * 0.67, 750, -0.04) + 144)
            asset(f"{prefix}-logo-horizontal-{scheme}", width, 112,
                  lockup(brand, 8, 0, 112, ink, symbol_ink), f"{name} logo {scheme}", [1200, 2400])
            width = round(max(176, text_width(name, 64, 750, -0.04) + 40))
            body = mark(brand, (width - 128) / 2, 16, 128, symbol_ink or ink)
            body += text(name, (width - text_width(name, 64, 750, -0.04)) / 2, 174, 64, ink, 750, -0.04)
            asset(f"{prefix}-logo-stacked-{scheme}", width, 248, body, f"{name} stacked logo {scheme}", [800, 1600])
            if brand == "sable":
                width = round(text_width(name, 130 * 0.58, 750, -0.04) + 166)
                asset(f"{prefix}-logo-endorsed-{scheme}", width, 130,
                      lockup(brand, 8, 0, 130, ink, endorsed=True), f"Sable by Servio {scheme}", [1200, 2400])


def build_icons():
    for brand in SPEC["brands"]:
        favicon = rect(0, 0, 64, 64, C["navy"], 12)
        favicon += mark(brand, 6, 6, 52, C["white"])
        asset(f"{brand}/icons/{brand}-favicon", 64, 64, favicon,
              f"{brand} browser favicon", [16, 32, 48, 64])
        for theme, background, foreground in [("dark", C["navy"], C["white"]),
                                                ("light", C["mist"], C["cobalt"] if brand == "servio" else C["navy"]),
                                                ("accent", C["cobalt"] if brand == "servio" else C["navy"], C["white"])]:
            body = rect(0, 0, 512, 512, background)
            body += mark(brand, 112, 112, 288, foreground, accent=(brand == "sable" and theme == "accent"))
            asset(f"{brand}/icons/{brand}-app-{theme}", 512, 512, body,
                  f"{brand} {theme} app icon", [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024])
        body = rect(0, 0, 512, 512, C["navy"])
        body += mark(brand, 126, 126, 260, C["white"])
        asset(f"{brand}/icons/{brand}-maskable", 512, 512, body, f"{brand} maskable PWA icon", [192, 512])
        (ROOT / f"exports/{brand}/icons/site.webmanifest").write_text(json.dumps({
            "name": SPEC["brands"][brand]["name"], "short_name": SPEC["brands"][brand]["name"],
            "start_url": "/", "display": "standalone", "background_color": C["navy"], "theme_color": C["navy"],
            "icons": [{"src": f"{brand}-app-dark-192w.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                      {"src": f"{brand}-app-dark.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                      {"src": f"{brand}-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]
        }, indent=2) + "\n", encoding="utf-8", newline="\n")


def background(width, height, theme):
    return rect(0, 0, width, height, C["navy"] if theme == "dark" else C["mist"])


def brand_colors(theme):
    return (C["white"], C["ice"], "#9DACBF") if theme == "dark" else (C["navy"], C["cobalt"], C["muted"])


def build_banners():
    for theme in ["dark", "light"]:
        ink, accent, muted = brand_colors(theme)
        body = background(1600, 560, theme)
        body += text("OPEN SOURCE ITSM  /  HUMAN + AI", 80, 48, 17, muted, 600, 0.1)
        body += lockup("servio", 68, 112, 156, ink, C["cobalt"] if theme == "light" else C["white"])
        body += text("Service, in flow.", 80, 330, 66, ink, 650, -0.04)
        body += text("Your service desk. A smarter teammate.", 82, 435, 23, muted, 400, -0.01)
        body += '<g opacity="0.12">' + mark("sable", 1120, -65, 560, accent) + '</g>'
        body += rect(1060, 322, 452, 164, "#FFFFFF", 20, 'opacity="0.055"')
        body += lockup("sable", 1080, 337, 120, ink, endorsed=True)
        asset(f"banners/readme-family-{theme}", 1600, 560, body, "Servio and Sable - Service, in flow.", [1600, 3200])
        for brand in SPEC["brands"]:
            body = background(1600, 480, theme)
            body += lockup(brand, 64, 72, 160, ink, C["cobalt"] if brand == "servio" and theme == "light" else ink, endorsed=(brand == "sable"))
            tagline = "The open-source service desk." if brand == "servio" else SPEC["taglines"]["sable"]
            body += text(tagline, 80, 304, 38, ink, 600, -0.025)
            detail = "Tickets / Knowledge / Changes / Assets" if brand == "servio" else "Understands context. Proposes action. Awaits your approval."
            body += text(detail, 82, 398, 20, muted, 400, 0)
            body += '<g opacity="0.16">' + mark(brand, 1180, 60, 360, accent) + '</g>'
            asset(f"banners/readme-{brand}-{theme}", 1600, 480, body, f"{brand} README banner", [1600, 3200])
            body = background(1200, 630, theme)
            body += lockup(brand, 62, 60, 138, ink, C["cobalt"] if brand == "servio" and theme == "light" else ink, endorsed=(brand == "sable"))
            lines = ["Service,", "in flow."] if brand == "servio" else ["A capable", "teammate."]
            for index, line in enumerate(lines):
                body += text(line, 76, 290 + index * 100, 85, ink, 650, -0.04)
            body += '<g opacity="0.28">' + mark(brand, 800, 260, 320, accent) + '</g>'
            body += text("OPEN SOURCE ITSM" if brand == "servio" else "SABLE BY SERVIO", 80, 564, 17, muted, 600, 0.12)
            asset(f"social/{brand}-og-{theme}", 1200, 630, body, f"{brand} social preview", [1200, 2400])
            github = background(1280, 640, theme) + '<g transform="translate(40 5)">' + body + '</g>'
            asset(f"social/{brand}-github-{theme}", 1280, 640, github,
                  f"{brand} GitHub repository social preview", [1280, 2560])
        body = background(1920, 1080, theme)
        body += mark("sable", 1210, 180, 550, accent)
        body += lockup("servio", 110, 240, 200, ink, C["cobalt"] if theme == "light" else ink)
        body += text("Service, in flow.", 128, 612, 100, ink, 650, -0.045)
        body += text("SERVIO + SABLE", 133, 938, 20, muted, 600, 0.14)
        asset(f"wallpapers/servio-sable-{theme}", 1920, 1080, body, "Servio and Sable wallpaper", [1920, 3840])


def build_patterns():
    for brand in SPEC["brands"]:
        body = ""
        for row in range(4):
            for column in range(4):
                body += '<g opacity="0.14">' + mark(brand, column * 128 + 24, row * 128 + 24, 80, C["navy"]) + '</g>'
        asset(f"patterns/{brand}-repeat", 512, 512, body, f"{brand} transparent repeat pattern", [1024])


def build_overview():
    body = background(1800, 1200, "light")
    body += text("SERVIO + SABLE", 60, 42, 21, C["navy"], 750, 0.04)
    body += text("BRAND SYSTEM  /  1.0", 1370, 46, 15, C["muted"], 600, 0.06)
    body += rect(60, 120, 820, 360, C["white"], 24)
    body += rect(900, 120, 840, 360, C["navy"], 24)
    body += lockup("servio", 115, 200, 185, C["navy"], C["cobalt"])
    body += lockup("sable", 965, 200, 185, C["white"], endorsed=True)
    body += text("RELAY  /  THE PLATFORM", 120, 430, 15, C["muted"], 600, 0.04)
    body += text("NOVA FLOW  /  THE AI TEAMMATE", 966, 430, 15, C["ice"], 600, 0.04)
    for index, color in enumerate([C["navy"], C["cobalt"], C["mist"], C["ice"]]):
        border = 'stroke="#D5DDE8" stroke-width="1.5"' if color == C["mist"] else ""
        body += rect(60 + index * 135, 540, 119, 145, color, 16, border)
        body += text(color.upper(), 64 + index * 135, 705, 15, C["navy"], 600, 0)
    body += text("Manrope", 654, 550, 60, C["navy"], 750, -0.04)
    body += text("Calm. Capable. Clear.", 658, 654, 26, C["muted"], 400, -0.02)
    for index, brand in enumerate(["servio", "sable"]):
        body += rect(1260 + index * 230, 536, 192, 192, C["navy"], 36)
        body += mark(brand, 1292 + index * 230, 568, 128, C["white"], accent=(brand == "sable"))
    body += rect(60, 808, 1680, 330, C["navy"], 24)
    body += text("Service, in flow.", 118, 904, 100, C["white"], 650, -0.04)
    body += text("Your service desk. A smarter teammate.", 124, 1058, 23, C["ice"], 400, 0)
    body += mark("sable", 1370, 850, 235, C["white"])
    asset("brand-overview", 1800, 1200, body, "Servio Relay and Sable Nova Flow brand kit", [1800])


def main():
    for weight, name in [(400, "Regular"), (650, "Semibold"), (750, "Bold")]:
        font(weight).save(ROOT / f"fonts/Manrope-{name}.ttf")
    build_logos()
    build_icons()
    build_banners()
    build_patterns()
    build_overview()
    words = {}
    for brand, spec in SPEC["brands"].items():
        path = ET.fromstring(text(spec["name"], 0, 0, 76, C["navy"], 750, -0.04)).attrib["d"]
        bounds = BoundsPen(None)
        parse_path(path, bounds)
        left, top, right, bottom = bounds.bounds
        words[brand] = {"viewBox": f"{left} {top} {right - left} {bottom - top}", "path": path}
    runtime = {"colors": C, "marks": MARKS, "wordmarks": words}
    (ROOT / "exports/runtime.json").write_text(json.dumps(runtime, indent=2) + "\n", encoding="utf-8", newline="\n")
    tokens = {"color": {name: {"$type": "color", "$value": value} for name, value in C.items()}}
    (ROOT / "exports/tokens.json").write_text(json.dumps(tokens, indent=2) + "\n", encoding="utf-8", newline="\n")
    (ROOT / "exports/tokens.css").write_text(":root {\n" + "".join(f"  --servio-{name}: {value};\n" for name, value in C.items()) + "}\n", encoding="utf-8", newline="\n")
    temporary = ROOT / ".build"
    temporary.mkdir(exist_ok=True)
    (temporary / "jobs.json").write_text(json.dumps(JOBS, indent=2), encoding="utf-8", newline="\n")
    print(f"SVG masters ready; {len(JOBS)} PNG exports planned.")


if __name__ == "__main__":
    main()
