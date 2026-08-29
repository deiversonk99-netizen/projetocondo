"""Generate the original schematic map and social card used by the app.

This renderer uses only the application's location and routing datasets. It does
not read or reuse the condominium's architectural drawing.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
HOUSES_PATH = ROOT / "src" / "data" / "houses.json"
MAP_OUTPUT = ROOT / "public" / "mapa-esquematico.png"
OG_OUTPUT = ROOT / "public" / "og.png"

MAP_WIDTH = 1190.52
MAP_HEIGHT = 841.92
SCALE = 2

INK = "#153b33"
MUTED = "#668078"
GREEN = "#1d7657"
GREEN_DARK = "#12563f"
ACCENT = "#ef6a3b"
PAPER = "#edf4ee"
WHITE = "#fffdf8"
ROAD_EDGE = "#c5ddcf"
ROAD_CENTER = "#d7e7de"

BLOCK_COLORS = (
    ("#e3f1e9", "#8bb9a2"),
    ("#fff0e8", "#e4a387"),
    ("#e8f1f4", "#91b9c1"),
    ("#f2eedf", "#c8b982"),
)


ROAD_NODES = {
    "portaria": (1014, 180),
    "t4": (934, 196),
    "t5": (828, 196),
    "t6": (720, 196),
    "t7": (615, 196),
    "t8": (507, 221),
    "t9": (399, 262),
    "t10": (293, 306),
    "t11": (188, 381),
    "tl": (121, 410),
    "b4": (934, 580),
    "b5": (828, 580),
    "b6": (720, 580),
    "b7": (615, 580),
    "b8": (507, 580),
    "b9": (399, 580),
    "b10": (293, 580),
    "b11": (188, 580),
    "bl": (121, 580),
}

ROAD_EDGES = [
    ("portaria", "t4"), ("t4", "t5"), ("t5", "t6"), ("t6", "t7"),
    ("t7", "t8"), ("t8", "t9"), ("t9", "t10"), ("t10", "t11"),
    ("t11", "tl"), ("t4", "b4"), ("t5", "b5"), ("t6", "b6"),
    ("t7", "b7"), ("t8", "b8"), ("t9", "b9"), ("t10", "b10"),
    ("t11", "b11"), ("tl", "bl"), ("b4", "b5"), ("b5", "b6"),
    ("b6", "b7"), ("b7", "b8"), ("b8", "b9"), ("b9", "b10"),
    ("b10", "b11"), ("b11", "bl"),
]

POIS = [
    ("Piscina", "P", 765, 103, "#3f96b4"),
    ("Clube social", "C", 839, 119, "#7b68a8"),
    ("Quadra", "Q", 679, 128, "#3f866b"),
    ("Vôlei", "V", 637, 117, "#d08b42"),
    ("Quiosque", "Q", 585, 146, "#b26754"),
    ("Academia", "A", 893, 132, "#497a9e"),
    ("Visitantes", "E", 876, 168, "#667b75"),
]


def sc(value: float) -> int:
    return round(value * SCALE)


def point(x: float, y: float) -> tuple[int, int]:
    return sc(x), sc(y)


def font(size: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), sc(size))


def rounded(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], radius: float, **kwargs) -> None:
    draw.rounded_rectangle(tuple(sc(value) for value in box), radius=sc(radius), **kwargs)


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    unique = sorted(set(points))
    if len(unique) <= 2:
        return unique

    def cross(origin, a, b):
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for item in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], item) <= 0:
            lower.pop()
        lower.append(item)

    upper: list[tuple[float, float]] = []
    for item in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], item) <= 0:
            upper.pop()
        upper.append(item)
    return lower[:-1] + upper[:-1]


def expanded_hull(points: list[tuple[float, float]], padding: float = 15) -> list[tuple[float, float]]:
    hull = convex_hull(points)
    if len(hull) < 3:
        return hull
    center_x = sum(x for x, _ in hull) / len(hull)
    center_y = sum(y for _, y in hull) / len(hull)
    result = []
    for x, y in hull:
        distance = math.hypot(x - center_x, y - center_y) or 1
        result.append((x + (x - center_x) / distance * padding, y + (y - center_y) / distance * padding))
    return result


def draw_grid(draw: ImageDraw.ImageDraw) -> None:
    for x in range(50, 1151, 50):
        major = x % 100 == 0
        color = "#cbded2" if major else "#dce9e1"
        draw.line((sc(x), 0, sc(x), sc(MAP_HEIGHT)), fill=color, width=sc(0.7 if major else 0.4))
        if major:
            draw.text(point(x + 3, 38), f"X{x}", font=font(5.5, True), fill="#91a69b")
    for y in range(50, 801, 50):
        major = y % 100 == 0
        color = "#cbded2" if major else "#dce9e1"
        draw.line((0, sc(y), sc(MAP_WIDTH), sc(y)), fill=color, width=sc(0.7 if major else 0.4))
        if major:
            draw.text(point(30, y + 3), f"Y{y}", font=font(5.5, True), fill="#91a69b")


def draw_rotated_text(base: Image.Image, position: tuple[float, float], text: str) -> None:
    label_font = font(6, True)
    bounds = label_font.getbbox(text)
    width = bounds[2] - bounds[0] + sc(8)
    height = bounds[3] - bounds[1] + sc(6)
    layer = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    layer_draw = ImageDraw.Draw(layer)
    layer_draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=sc(3), fill=(255, 253, 248, 225))
    layer_draw.text((sc(4), sc(2)), text, font=label_font, fill=GREEN_DARK)
    rotated = layer.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
    x, y = point(*position)
    base.alpha_composite(rotated, (x - rotated.width // 2, y - rotated.height // 2))


def create_map() -> Image.Image:
    houses = json.loads(HOUSES_PATH.read_text(encoding="utf-8"))
    grouped: dict[str, list[dict]] = defaultdict(list)
    for house in houses:
        grouped[house["quadra"]].append(house)

    image = Image.new("RGBA", (sc(MAP_WIDTH), sc(MAP_HEIGHT)), PAPER)
    draw = ImageDraw.Draw(image, "RGBA")
    draw_grid(draw)

    rounded(draw, (72, 55, 1118, 695), 34, fill="#f8fbf7", outline="#9fc5b0", width=sc(2))

    for index, quadra in enumerate("ABCDEFGHIJKL"):
        group = grouped[quadra]
        xs = [item["x"] for item in group]
        ys = [item["y"] for item in group]
        fill, outline = BLOCK_COLORS[index % len(BLOCK_COLORS)]
        if max(xs) - min(xs) < 8 or max(ys) - min(ys) < 8:
            box = (min(xs) - 17, min(ys) - 16, max(xs) + 17, max(ys) + 16)
            rounded(draw, box, 13, fill=fill, outline=outline, width=sc(1.2))
        else:
            hull = expanded_hull([(item["x"], item["y"]) for item in group])
            polygon = [point(x, y) for x, y in hull]
            draw.polygon(polygon, fill=fill)
            draw.line(polygon + [polygon[0]], fill=outline, width=sc(1.2), joint="curve")

    road_segments = [(ROAD_NODES[a], ROAD_NODES[b]) for a, b in ROAD_EDGES]
    for start, end in road_segments:
        draw.line((point(*start), point(*end)), fill=ROAD_EDGE, width=sc(36))
    for start, end in road_segments:
        draw.line((point(*start), point(*end)), fill=WHITE, width=sc(29))
        draw.line((point(*start), point(*end)), fill=ROAD_CENTER, width=sc(1.3))

    draw.text(point(575, 181), "RUA 2", font=font(7, True), fill=GREEN_DARK)
    draw.text(point(575, 591), "RUA 3", font=font(7, True), fill=GREEN_DARK)
    for name, x in (("RUA 4", 934), ("RUA 5", 828), ("RUA 6", 720), ("RUA 7", 615),
                    ("RUA 8", 507), ("RUA 9", 399), ("RUA 10", 293), ("RUA 11", 188)):
        draw_rotated_text(image, (x, 410), name)

    draw = ImageDraw.Draw(image, "RGBA")
    for index, quadra in enumerate("ABCDEFGHIJKL"):
        group = grouped[quadra]
        center_x = sum(item["x"] for item in group) / len(group)
        center_y = sum(item["y"] for item in group) / len(group)
        fill, outline = BLOCK_COLORS[index % len(BLOCK_COLORS)]
        badge_x = center_x
        badge_y = min(item["y"] for item in group) - 23
        if quadra in "G":
            badge_x, badge_y = 310, 170
        rounded(draw, (badge_x - 20, badge_y - 8, badge_x + 20, badge_y + 8), 8, fill=INK)
        label = f"QUADRA {quadra}"
        label_font = font(5.5, True)
        bounds = draw.textbbox((0, 0), label, font=label_font)
        draw.text(point(badge_x - (bounds[2] - bounds[0]) / SCALE / 2, badge_y - 3), label, font=label_font, fill=WHITE)

        for house in group:
            x, y = house["x"], house["y"]
            label = f"{quadra}{house['numero']}"
            rounded(draw, (x - 10.5, y - 5.2, x + 10.5, y + 5.2), 4.8, fill=WHITE, outline=outline, width=sc(0.8))
            house_font = font(5.4, True)
            bounds = draw.textbbox((0, 0), label, font=house_font)
            text_width = (bounds[2] - bounds[0]) / SCALE
            draw.text(point(x - text_width / 2, y - 3.1), label, font=house_font, fill=INK)

    for index, (label, icon, x, y, color) in enumerate(POIS):
        marker = point(x, y)
        draw.ellipse((marker[0] - sc(8), marker[1] - sc(8), marker[0] + sc(8), marker[1] + sc(8)), fill=color, outline=WHITE, width=sc(2))
        icon_font = font(6, True)
        bounds = draw.textbbox((0, 0), icon, font=icon_font)
        draw.text((marker[0] - (bounds[2] - bounds[0]) / 2, marker[1] - sc(3.3)), icon, font=icon_font, fill=WHITE)
        offset_y = -23 if index % 2 == 0 else 13
        label_width = max(43, len(label) * 3.8)
        rounded(draw, (x - label_width / 2, y + offset_y - 6, x + label_width / 2, y + offset_y + 6), 5.5, fill=(255, 253, 248, 235), outline=color, width=sc(0.8))
        poi_font = font(5.2, True)
        bounds = draw.textbbox((0, 0), label, font=poi_font)
        text_width = (bounds[2] - bounds[0]) / SCALE
        draw.text(point(x - text_width / 2, y + offset_y - 3), label, font=poi_font, fill=INK)

    port_x, port_y = ROAD_NODES["portaria"]
    port = point(port_x, port_y)
    draw.ellipse((port[0] - sc(12), port[1] - sc(12), port[0] + sc(12), port[1] + sc(12)), fill=ACCENT, outline=WHITE, width=sc(3))
    draw.text(point(port_x - 3.7, port_y - 4.2), "P", font=font(8, True), fill=WHITE)
    rounded(draw, (1029, 165, 1091, 194), 12, fill=INK)
    draw.text(point(1040, 171), "PORTARIA", font=font(7, True), fill=WHITE)

    rounded(draw, (82, 64, 365, 116), 15, fill=(21, 59, 51, 238))
    draw.text(point(101, 78), "MAPA ESQUEMÁTICO", font=font(11, True), fill=WHITE)
    draw.text(point(101, 98), "ORIENTAÇÃO POR COORDENADAS X/Y", font=font(5.7, True), fill="#bce5d3")

    rounded(draw, (808, 650, 1097, 681), 11, fill=(255, 253, 248, 230), outline="#b7cfc2", width=sc(0.8))
    draw.text(point(824, 659), "Representação funcional • sem escala técnica", font=font(6.2, True), fill=MUTED)
    return image.convert("RGB")


def create_social_card(schematic: Image.Image) -> Image.Image:
    width, height = 1200, 630
    card = Image.new("RGB", (width, height), "#0e342b")
    draw = ImageDraw.Draw(card)
    for y in range(height):
        ratio = y / height
        color = (14 + int(12 * ratio), 52 + int(30 * ratio), 43 + int(20 * ratio))
        draw.line((0, y, width, y), fill=color)

    draw.rounded_rectangle((58, 58, 126, 126), radius=20, fill=WHITE)
    draw.text((77, 78), "JP", font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 24), fill=INK)
    draw.text((58, 168), "DUO JARDIM PARAÍSO", font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 20), fill="#9ed1bd")
    draw.text((58, 207), "Encontre seu\ncaminho", font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 54), fill=WHITE, spacing=2)
    draw.text((58, 355), "Mapa esquemático interativo com\nrotas em coordenadas X/Y.", font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 24), fill="#c8ded5", spacing=7)
    draw.rounded_rectangle((58, 478, 386, 528), radius=25, fill=ACCENT)
    draw.text((91, 492), "CASAS • QUADRAS • ÁREAS COMUNS", font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 13), fill=WHITE)

    preview = schematic.crop((120, 80, 2180, 1350))
    preview.thumbnail((700, 500), Image.Resampling.LANCZOS)
    mask = Image.new("L", preview.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, preview.width, preview.height), radius=28, fill=255)
    shadow = Image.new("RGBA", (preview.width + 70, preview.height + 70), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((35, 35, preview.width + 35, preview.height + 35), radius=30, fill=(0, 0, 0, 100))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    card.paste(shadow, (460, 28), shadow)
    card.paste(preview, (495, 63), mask)
    return card


def main() -> None:
    schematic = create_map()
    schematic.save(MAP_OUTPUT, optimize=True)
    create_social_card(schematic).save(OG_OUTPUT, optimize=True)
    print(MAP_OUTPUT)
    print(OG_OUTPUT)


if __name__ == "__main__":
    main()
