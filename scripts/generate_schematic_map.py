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
MUTED = "#66736f"
GREEN = "#287a59"
GREEN_DARK = "#12563f"
ACCENT = "#ef6a3b"
PAPER = "#e8eee7"
WHITE = "#fffdf8"
LAND = "#edf3e9"
LOT = "#f6f4e9"
LOT_EDGE = "#c8d3c9"
SIDEWALK = "#f4f2ec"
CURB = "#bcc5bf"
ASPHALT = "#d5d9d7"
ROAD_MARKING = "#f8faf8"
BUILDING = "#eea080"
BUILDING_ALT = "#f3b293"
BUILDING_EDGE = "#b9684b"
WATER = "#69c3dd"
SAND = "#e8d39a"
PARK = "#dcebd3"


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
        color = "#d0dcd3" if major else "#dce5de"
        draw.line((sc(x), 0, sc(x), sc(MAP_HEIGHT)), fill=color, width=sc(0.7 if major else 0.4))
        if major:
            draw.text(point(x + 3, 38), f"X{x}", font=font(5.5, True), fill="#96a39d")
    for y in range(50, 801, 50):
        major = y % 100 == 0
        color = "#d0dcd3" if major else "#dce5de"
        draw.line((0, sc(y), sc(MAP_WIDTH), sc(y)), fill=color, width=sc(0.7 if major else 0.4))
        if major:
            draw.text(point(30, y + 3), f"Y{y}", font=font(5.5, True), fill="#96a39d")


def draw_rotated_text(base: Image.Image, position: tuple[float, float], text: str) -> None:
    label_font = font(6, True)
    bounds = label_font.getbbox(text)
    width = bounds[2] - bounds[0] + sc(8)
    height = bounds[3] - bounds[1] + sc(6)
    layer = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    layer_draw = ImageDraw.Draw(layer)
    layer_draw.text((sc(4), sc(2)), text, font=label_font, fill="#6f7975")
    rotated = layer.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
    x, y = point(*position)
    base.alpha_composite(rotated, (x - rotated.width // 2, y - rotated.height // 2))


def dashed_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    fill: str,
    width: float = 1,
    dash: float = 7,
    gap: float = 7,
) -> None:
    length = math.dist(start, end)
    if not length:
        return
    ux = (end[0] - start[0]) / length
    uy = (end[1] - start[1]) / length
    cursor = 0.0
    while cursor < length:
        finish = min(length, cursor + dash)
        draw.line(
            (
                point(start[0] + ux * cursor, start[1] + uy * cursor),
                point(start[0] + ux * finish, start[1] + uy * finish),
            ),
            fill=fill,
            width=sc(width),
        )
        cursor += dash + gap


def draw_tree(draw: ImageDraw.ImageDraw, x: float, y: float, size: float = 6) -> None:
    center = point(x, y)
    draw.ellipse(
        (center[0] - sc(size + 1), center[1] - sc(size), center[0] + sc(size + 1), center[1] + sc(size + 2)),
        fill=(48, 84, 62, 35),
    )
    draw.ellipse(
        (center[0] - sc(size), center[1] - sc(size), center[0] + sc(size), center[1] + sc(size)),
        fill="#4b9369",
        outline="#2f7250",
        width=sc(.7),
    )
    draw.ellipse(
        (center[0] - sc(size * .45), center[1] - sc(size * .55), center[0] + sc(size * .1), center[1]),
        fill="#82b98d",
    )


def draw_building(
    image: Image.Image,
    x: float,
    y: float,
    label: str,
    angle: float = 0,
    width: float = 23,
    height: float = 12,
    alternate: bool = False,
) -> None:
    roof_fill = BUILDING_ALT if alternate else BUILDING
    pixel_width, pixel_height = sc(width + 4), sc(height + 4)
    roof = Image.new("RGBA", (pixel_width, pixel_height), (255, 255, 255, 0))
    roof_draw = ImageDraw.Draw(roof, "RGBA")
    roof_draw.rounded_rectangle(
        (sc(2.8), sc(3.2), pixel_width - sc(.8), pixel_height - sc(.8)),
        radius=sc(2),
        fill=(38, 54, 47, 42),
    )
    roof_draw.rounded_rectangle(
        (sc(1.2), sc(1.2), pixel_width - sc(2.8), pixel_height - sc(2.8)),
        radius=sc(1.8),
        fill=roof_fill,
        outline=BUILDING_EDGE,
        width=sc(.8),
    )
    roof_draw.line(
        (sc(width * .30), sc(2), sc(width * .30), pixel_height - sc(3.5)),
        fill="#f9c5ac",
        width=sc(.8),
    )
    if angle:
        roof = roof.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    px, py = point(x, y)
    image.alpha_composite(roof, (px - roof.width // 2, py - roof.height // 2))

    draw = ImageDraw.Draw(image, "RGBA")
    label_font = font(5.2, True)
    bounds = draw.textbbox((0, 0), label, font=label_font)
    label_width = bounds[2] - bounds[0]
    label_height = bounds[3] - bounds[1]
    draw.rounded_rectangle(
        (
            px - label_width / 2 - sc(2.3),
            py - label_height / 2 - sc(1.6),
            px + label_width / 2 + sc(2.3),
            py + label_height / 2 + sc(1.4),
        ),
        radius=sc(2.5),
        fill=(255, 253, 248, 224),
    )
    draw.text((px - label_width / 2, py - label_height / 2 - sc(.7)), label, font=label_font, fill=INK)


def draw_common_area(draw: ImageDraw.ImageDraw) -> None:
    rounded(draw, (545, 70, 925, 179), 22, fill=PARK, outline="#afcaae", width=sc(1.2))

    # Caminhos de pedestres.
    draw.line((point(555, 161), point(913, 161)), fill="#f8f4e9", width=sc(10))
    draw.line((point(740, 161), point(740, 83)), fill="#f8f4e9", width=sc(8))

    # Piscina e deck.
    rounded(draw, (739, 81, 793, 113), 8, fill="#eadfc9", outline="#d0bea3", width=sc(1))
    rounded(draw, (746, 86, 786, 108), 6, fill=WATER, outline="#3f96b4", width=sc(1.2))
    draw.arc(tuple(sc(value) for value in (755, 90, 778, 104)), 0, 180, fill="#c9f2fb", width=sc(1))

    # Quadra poliesportiva.
    rounded(draw, (650, 99, 705, 143), 5, fill="#7eb890", outline="#3f866b", width=sc(1.2))
    draw.rectangle(tuple(sc(value) for value in (656, 105, 699, 137)), outline="#eaf5e9", width=sc(1))
    draw.line((point(677.5, 105), point(677.5, 137)), fill="#eaf5e9", width=sc(.8))
    draw.ellipse(tuple(sc(value) for value in (670, 113.5, 685, 128.5)), outline="#eaf5e9", width=sc(.8))

    # Vôlei de areia.
    rounded(draw, (610, 98, 642, 137), 6, fill=SAND, outline="#c6ab68", width=sc(1))
    draw.line((point(626, 103), point(626, 132)), fill="#fff9e9", width=sc(1))

    # Quiosque e clube.
    rounded(draw, (566, 126, 598, 155), 7, fill="#d37c5e", outline="#a3543c", width=sc(1))
    draw.polygon([point(563, 128), point(582, 114), point(601, 128)], fill="#b86145")
    rounded(draw, (807, 87, 861, 134), 5, fill=BUILDING, outline=BUILDING_EDGE, width=sc(1.2))
    draw.line((point(816, 96), point(852, 96)), fill="#f9c5ac", width=sc(1))

    # Academia e estacionamento.
    rounded(draw, (874, 106, 908, 143), 7, fill="#b9d6cf", outline="#6d9e92", width=sc(1))
    for x in (880, 890, 900):
        draw.line((point(x, 113), point(x, 136)), fill="#6d9e92", width=sc(1.4))
    rounded(draw, (849, 146, 915, 174), 5, fill="#d9dddb", outline="#a9b1ad", width=sc(1))
    for x in range(858, 911, 13):
        draw.line((point(x, 150), point(x - 6, 169)), fill=WHITE, width=sc(.8))

    for x, y, size in (
        (554, 91, 7), (575, 88, 6), (602, 82, 7), (628, 79, 6),
        (714, 80, 6), (726, 128, 7), (799, 76, 7), (870, 77, 6),
        (897, 84, 7), (916, 94, 6), (915, 127, 6), (613, 158, 5),
    ):
        draw_tree(draw, x, y, size)


def create_map() -> Image.Image:
    houses = json.loads(HOUSES_PATH.read_text(encoding="utf-8"))
    grouped: dict[str, list[dict]] = defaultdict(list)
    for house in houses:
        grouped[house["quadra"]].append(house)

    image = Image.new("RGBA", (sc(MAP_WIDTH), sc(MAP_HEIGHT)), PAPER)
    draw = ImageDraw.Draw(image, "RGBA")
    draw_grid(draw)

    # Limite esquemático da área navegável.
    rounded(draw, (72, 55, 1118, 695), 34, fill=LAND, outline="#91b7a1", width=sc(2))
    rounded(draw, (83, 66, 1107, 684), 27, outline=(255, 255, 255, 175), width=sc(1))

    # Paisagismo de borda, inspirado na leitura visual de mapas urbanos.
    for x, y, size in (
        (92, 126, 7), (94, 154, 6), (96, 183, 7), (98, 214, 6),
        (103, 246, 7), (108, 278, 6), (111, 311, 7), (1090, 219, 7),
        (1090, 250, 6), (1091, 283, 7), (1091, 318, 6), (1092, 352, 7),
        (1092, 389, 6), (1089, 426, 7), (1089, 465, 6), (1088, 505, 7),
        (1088, 547, 6), (1086, 587, 7), (995, 660, 6), (1020, 659, 7),
        (1046, 656, 6), (1072, 650, 7),
    ):
        draw_tree(draw, x, y, size)

    for index, quadra in enumerate("ABCDEFGHIJKL"):
        group = grouped[quadra]
        xs = [item["x"] for item in group]
        ys = [item["y"] for item in group]
        if max(xs) - min(xs) < 8 or max(ys) - min(ys) < 8:
            box = (min(xs) - 17, min(ys) - 16, max(xs) + 17, max(ys) + 16)
            rounded(draw, box, 13, fill=LOT, outline=LOT_EDGE, width=sc(1.2))
        else:
            hull = expanded_hull([(item["x"], item["y"]) for item in group])
            polygon = [point(x, y) for x, y in hull]
            draw.polygon(polygon, fill=LOT)
            draw.line(polygon + [polygon[0]], fill=LOT_EDGE, width=sc(1.2), joint="curve")

    road_segments = [(ROAD_NODES[a], ROAD_NODES[b]) for a, b in ROAD_EDGES]
    for start, end in road_segments:
        draw.line((point(*start), point(*end)), fill=CURB, width=sc(43))
    for start, end in road_segments:
        draw.line((point(*start), point(*end)), fill=SIDEWALK, width=sc(39))
    for start, end in road_segments:
        draw.line((point(*start), point(*end)), fill=ASPHALT, width=sc(29))
        dashed_line(draw, start, end, ROAD_MARKING, width=.8, dash=6, gap=8)

    draw.text(point(568, 188), "RUA 2", font=font(6.5, True), fill="#69736f")
    draw.text(point(568, 572), "RUA 3", font=font(6.5, True), fill="#69736f")
    draw.text(point(972, 181), "RUA 1", font=font(5.5, True), fill="#69736f")
    for name, x in (("RUA 4", 934), ("RUA 5", 828), ("RUA 6", 720), ("RUA 7", 615),
                    ("RUA 8", 507), ("RUA 9", 399), ("RUA 10", 293), ("RUA 11", 188)):
        draw_rotated_text(image, (x, 410), name)

    draw = ImageDraw.Draw(image, "RGBA")
    for index, quadra in enumerate("ABCDEFGHIJKL"):
        group = grouped[quadra]
        center_x = sum(item["x"] for item in group) / len(group)
        badge_x = center_x
        badge_y = min(item["y"] for item in group) - 23
        if quadra in "G":
            badge_x, badge_y = 310, 170
        rounded(draw, (badge_x - 20, badge_y - 8, badge_x + 20, badge_y + 8), 8, fill=(21, 59, 51, 236))
        label = f"QUADRA {quadra}"
        label_font = font(5.5, True)
        bounds = draw.textbbox((0, 0), label, font=label_font)
        draw.text(point(badge_x - (bounds[2] - bounds[0]) / SCALE / 2, badge_y - 3), label, font=label_font, fill=WHITE)

        for house_index, house in enumerate(group):
            x, y = house["x"], house["y"]
            label = f"{quadra}{house['numero']}"
            if quadra == "G":
                draw_building(image, x, y, label, angle=-20, width=22, height=11, alternate=house_index % 2 == 0)
            elif quadra in "KL":
                draw_building(image, x, y, label, width=18, height=11, alternate=house_index % 2 == 0)
            elif quadra == "J":
                draw_building(image, x, y, label, width=24, height=14, alternate=house_index % 2 == 0)
            else:
                draw_building(image, x, y, label, width=24, height=13, alternate=house_index % 2 == 0)

    draw = ImageDraw.Draw(image, "RGBA")
    draw_common_area(draw)

    label_positions = {
        "Piscina": (765, 80),
        "Clube social": (830, 139),
        "Quadra": (679, 105),
        "Vôlei": (636, 137),
        "Quiosque": (585, 123),
        "Academia": (914, 151),
        "Visitantes": (846, 166),
    }

    # Rótulos cartográficos das áreas comuns, com marcadores consistentes.
    for label, icon, x, y, color in POIS:
        marker = point(x, y)
        draw.ellipse((marker[0] - sc(7), marker[1] - sc(7), marker[0] + sc(7), marker[1] + sc(7)), fill=color, outline=WHITE, width=sc(2))
        icon_font = font(5.6, True)
        bounds = draw.textbbox((0, 0), icon, font=icon_font)
        draw.text((marker[0] - (bounds[2] - bounds[0]) / 2, marker[1] - sc(3.3)), icon, font=icon_font, fill=WHITE)
        label_x, label_y = label_positions[label]
        if math.dist((x, y), (label_x, label_y)) > 18:
            draw.line((point(x, y), point(label_x, label_y)), fill=(77, 95, 87, 115), width=sc(.7))
        label_width = max(43, len(label) * 3.8)
        rounded(draw, (label_x - label_width / 2, label_y - 6, label_x + label_width / 2, label_y + 6), 5.5, fill=(255, 253, 248, 235), outline=color, width=sc(0.8))
        poi_font = font(5.2, True)
        bounds = draw.textbbox((0, 0), label, font=poi_font)
        text_width = (bounds[2] - bounds[0]) / SCALE
        draw.text(point(label_x - text_width / 2, label_y - 3), label, font=poi_font, fill=INK)

    port_x, port_y = ROAD_NODES["portaria"]
    port = point(port_x, port_y)
    draw.ellipse((port[0] - sc(12), port[1] - sc(12), port[0] + sc(12), port[1] + sc(12)), fill=ACCENT, outline=WHITE, width=sc(3))
    draw.text(point(port_x - 3.7, port_y - 4.2), "P", font=font(8, True), fill=WHITE)
    rounded(draw, (1029, 165, 1091, 194), 12, fill=INK)
    draw.text(point(1040, 171), "PORTARIA", font=font(7, True), fill=WHITE)

    # Cabine, cancela e acesso principal.
    rounded(draw, (1000, 155, 1012, 174), 3, fill=BUILDING, outline=BUILDING_EDGE, width=sc(1))
    draw.line((point(1010, 181), point(1031, 181)), fill="#d9533f", width=sc(2))
    draw.ellipse(tuple(sc(value) for value in (1028, 178, 1034, 184)), fill=WHITE, outline="#9ea7a3", width=sc(.7))

    rounded(draw, (82, 64, 337, 111), 14, fill=(255, 253, 248, 242), outline="#b8c7be", width=sc(.8))
    draw.ellipse(tuple(sc(value) for value in (96, 76, 119, 99)), fill=INK)
    draw.text(point(103, 82), "JP", font=font(6.2, True), fill=WHITE)
    draw.text(point(130, 75), "MAPA DE NAVEGAÇÃO", font=font(9, True), fill=INK)
    draw.text(point(130, 94), "COORDENADAS X/Y • SEM GPS", font=font(5.5, True), fill=GREEN)

    rounded(draw, (808, 650, 1097, 681), 11, fill=(255, 253, 248, 235), outline="#b7cfc2", width=sc(0.8))
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
