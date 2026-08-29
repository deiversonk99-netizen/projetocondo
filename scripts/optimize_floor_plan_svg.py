"""Simplify the supplied floor-plan SVG for the interactive map.

The script intentionally keeps the original page geometry and house labels while
removing decorative vegetation, small red access/garage markers, document stamps,
and editor metadata. Repeated inline styles are converted to CSS classes so the
result remains vector-based but is substantially smaller.
"""

from __future__ import annotations

import argparse
import collections
import re
import xml.etree.ElementTree as ET
from pathlib import Path


SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"
SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)
ET.register_namespace("inkscape", INKSCAPE_NS)
ET.register_namespace("sodipodi", SODIPODI_NS)

GREEN_COLORS = {
    "#00dd6e",
    "#5cb873",
    "#009500",
    "#397200",
    "#00b800",
    "#00b82e",
    # Brown canopy outlines are part of the same imported tree blocks.
    "#954a4a",
    # Fine branch and leaf strokes from the imported landscaping symbols.
    "#767676",
}
RED_COLORS = {"#ff0000", "#ff3f00"}
REMOVED_STROKE_COLORS = {"#ff00ff"}
UNNECESSARY_STROKE_COLORS = {"#808080"}
REMOVED_GROUP_IDS = {"g47941", "g47947"}
REMOVED_ELEMENT_IDS = {"image47936"}
REMOVED_LABELS = {
    "ÁREA RESERVADA",
    "AREA RESERVADA",
    " DO PROPRIETÁRIO",
    " DO PROPRIETARIO",
}

NUMBER_RE = r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?"
TOKEN_RE = re.compile(rf"[AaCcHhLlMmQqSsTtVvZz]|{NUMBER_RE}")
REFERENCE_RE = re.compile(r"url\(#([^)]+)\)|(?:href|xlink:href)=?[\"']?#([^\"']+)")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def style_values(style: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for declaration in style.split(";"):
        if ":" not in declaration:
            continue
        key, value = declaration.split(":", 1)
        values[key.strip()] = value.strip().lower()
    return values


def replace_red(style: str) -> str:
    for color in RED_COLORS:
        style = re.sub(
            rf"(?i)((?:fill|stroke):)\s*{re.escape(color)}",
            r"\1#000000",
            style,
        )
    return style


def path_bbox(path_data: str) -> tuple[float, float, float, float] | None:
    """Return a control-point bounding box for the common SVG path commands."""

    tokens = TOKEN_RE.findall(path_data.replace(",", " "))
    if not tokens:
        return None

    parameter_counts = {
        "M": 2,
        "L": 2,
        "H": 1,
        "V": 1,
        "C": 6,
        "S": 4,
        "Q": 4,
        "T": 2,
        "A": 7,
    }
    points: list[tuple[float, float]] = []
    x = y = start_x = start_y = 0.0
    command: str | None = None
    first_move = False
    index = 0

    def add(px: float, py: float) -> None:
        points.append((px, py))

    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command in "Zz":
                x, y = start_x, start_y
                add(x, y)
                command = None
                continue
            first_move = command in "Mm"

        if command is None:
            continue

        upper = command.upper()
        count = parameter_counts.get(upper)
        if count is None or index + count > len(tokens):
            break
        if tokens[index].isalpha():
            continue

        values = [float(value) for value in tokens[index : index + count]]
        index += count
        relative = command.islower()

        if upper in {"M", "L", "T"}:
            nx, ny = values
            if relative:
                nx += x
                ny += y
            x, y = nx, ny
            add(x, y)
            if upper == "M" and first_move:
                start_x, start_y = x, y
                first_move = False
                command = "l" if relative else "L"
        elif upper == "H":
            nx = values[0] + x if relative else values[0]
            x = nx
            add(x, y)
        elif upper == "V":
            ny = values[0] + y if relative else values[0]
            y = ny
            add(x, y)
        elif upper == "C":
            coords = [(values[0], values[1]), (values[2], values[3]), (values[4], values[5])]
            if relative:
                coords = [(px + x, py + y) for px, py in coords]
            for point in coords:
                add(*point)
            x, y = coords[-1]
        elif upper in {"S", "Q"}:
            coords = [(values[0], values[1]), (values[2], values[3])]
            if relative:
                coords = [(px + x, py + y) for px, py in coords]
            for point in coords:
                add(*point)
            x, y = coords[-1]
        elif upper == "A":
            radius_x, radius_y = abs(values[0]), abs(values[1])
            nx, ny = values[5], values[6]
            if relative:
                nx += x
                ny += y
            add(x - radius_x, y - radius_y)
            add(x + radius_x, y + radius_y)
            add(nx - radius_x, ny - radius_y)
            add(nx + radius_x, ny + radius_y)
            x, y = nx, ny
            add(x, y)

    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def transformed_bbox(element: ET.Element) -> tuple[float, float, float, float] | None:
    bbox = path_bbox(element.attrib.get("d", ""))
    if bbox is None:
        return None

    corners = [
        (bbox[0], bbox[1]),
        (bbox[0], bbox[3]),
        (bbox[2], bbox[1]),
        (bbox[2], bbox[3]),
    ]
    transform = element.attrib.get("transform", "")
    match = re.fullmatch(r"\s*matrix\(([^)]+)\)\s*", transform)
    if match:
        values = [float(value) for value in re.findall(NUMBER_RE, match.group(1))]
        if len(values) == 6:
            a, b, c, d, e, f = values
            corners = [(a * x + c * y + e, b * x + d * y + f) for x, y in corners]
    else:
        match = re.fullmatch(r"\s*translate\(([^)]+)\)\s*", transform)
        if match:
            values = [float(value) for value in re.findall(NUMBER_RE, match.group(1))]
            tx = values[0] if values else 0
            ty = values[1] if len(values) > 1 else 0
            corners = [(x + tx, y + ty) for x, y in corners]

    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    return min(xs), min(ys), max(xs), max(ys)


def is_small_access_marker(element: ET.Element, style: dict[str, str]) -> bool:
    if style.get("fill") != "none" or style.get("stroke") not in RED_COLORS:
        return False
    bbox = path_bbox(element.attrib.get("d", ""))
    if bbox is None:
        return False
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    longest = max(width, height)
    shortest = min(width, height)
    return longest <= 18 or (shortest <= 5.2 and longest <= 24)


def element_references(element: ET.Element) -> set[str]:
    references: set[str] = set()
    for value in element.attrib.values():
        for match in re.finditer(r"url\(#([^)]+)\)", value):
            references.add(match.group(1))
        if value.startswith("#"):
            references.add(value[1:])
    return references


def prune_unused_defs(root: ET.Element) -> int:
    defs = next((element for element in root if local_name(element.tag) == "defs"), None)
    if defs is None:
        return 0

    definitions = {element.attrib["id"]: element for element in list(defs) if "id" in element.attrib}
    required: set[str] = set()
    for element in root.iter():
        if element is defs or element in definitions.values():
            continue
        required.update(element_references(element))

    pending = list(required)
    while pending:
        identifier = pending.pop()
        definition = definitions.get(identifier)
        if definition is None:
            continue
        for child in definition.iter():
            for reference in element_references(child):
                if reference not in required:
                    required.add(reference)
                    pending.append(reference)

    removed = 0
    for element in list(defs):
        identifier = element.attrib.get("id")
        if identifier and identifier not in required:
            defs.remove(element)
            removed += 1
    return removed


def remove_unreferenced_ids(root: ET.Element) -> int:
    referenced: set[str] = set()
    for element in root.iter():
        referenced.update(element_references(element))

    removed = 0
    for element in root.iter():
        identifier = element.attrib.get("id")
        if identifier and identifier not in referenced and element is not root:
            del element.attrib["id"]
            removed += 1
    return removed


def consolidate_styles(root: ET.Element) -> int:
    counts = collections.Counter(
        element.attrib["style"]
        for element in root.iter()
        if "style" in element.attrib and len(element.attrib["style"]) >= 24
    )
    styles = [style for style, count in counts.most_common() if count >= 2]
    if not styles:
        return 0

    classes = {style: f"s{index}" for index, style in enumerate(styles)}
    changed = 0
    for element in root.iter():
        style = element.attrib.get("style")
        class_name = classes.get(style or "")
        if class_name:
            del element.attrib["style"]
            element.set("class", class_name)
            changed += 1

    style_element = ET.Element(f"{{{SVG_NS}}}style", {"type": "text/css"})
    style_element.text = "".join(f".{classes[style]}{{{style}}}" for style in styles)
    root.insert(0, style_element)
    return changed


def strip_whitespace(root: ET.Element) -> None:
    for element in root.iter():
        if element.tail is not None:
            element.tail = None
        if element.text is not None and not element.text.strip():
            element.text = None


def optimize(source: Path, destination: Path, access_threshold_report: bool = False) -> dict[str, int]:
    tree = ET.parse(source)
    root = tree.getroot()
    before_paths = sum(local_name(element.tag) == "path" for element in root.iter())

    stats = collections.Counter()
    red_dimensions: list[float] = []

    for parent in list(root.iter()):
        for element in list(parent):
            identifier = element.attrib.get("id", "")
            label = element.attrib.get("aria-label", "")
            style_text = element.attrib.get("style", "")
            style = style_values(style_text)

            if identifier in REMOVED_GROUP_IDS or identifier in REMOVED_ELEMENT_IDS:
                parent.remove(element)
                stats["document_artifacts"] += 1
                continue
            if local_name(element.tag) == "image":
                # The PDF export uses embedded raster masks for landscaping blocks
                # and document stamps. The navigation map does not need either.
                parent.remove(element)
                stats["embedded_images"] += 1
                continue
            if label in REMOVED_LABELS:
                parent.remove(element)
                stats["document_labels"] += 1
                continue
            if local_name(element.tag) != "path":
                continue

            if local_name(parent.tag) not in {"defs", "clipPath", "mask"}:
                page_bbox = transformed_bbox(element)
                if page_bbox is not None and page_bbox[2] < 205:
                    parent.remove(element)
                    stats["off_map_document_paths"] += 1
                    continue

            colors = {style.get("fill"), style.get("stroke")}
            if colors & GREEN_COLORS:
                parent.remove(element)
                stats["vegetation_paths"] += 1
                continue
            if style.get("stroke") in UNNECESSARY_STROKE_COLORS:
                bbox = path_bbox(element.attrib.get("d", ""))
                if bbox is not None and max(bbox[2] - bbox[0], bbox[3] - bbox[1]) <= 10:
                    parent.remove(element)
                    stats["construction_and_access_fragments"] += 1
                    continue
            if style.get("stroke") == "#dbdbdb":
                parent.remove(element)
                stats["faint_construction_lines"] += 1
                continue
            if style.get("stroke") in REMOVED_STROKE_COLORS:
                parent.remove(element)
                stats["page_border_lines"] += 1
                continue

            if style.get("fill") in RED_COLORS and element.attrib.get("clip-path"):
                # Tiny clipped paths form the developer/logo stamp in the PDF
                # footer and are unrelated to condominium navigation.
                parent.remove(element)
                stats["document_artifacts"] += 1
                continue

            if style.get("stroke") in RED_COLORS:
                bbox = path_bbox(element.attrib.get("d", ""))
                if bbox is not None:
                    red_dimensions.append(max(bbox[2] - bbox[0], bbox[3] - bbox[1]))
                if is_small_access_marker(element, style):
                    parent.remove(element)
                    stats["access_markers"] += 1
                    continue
                element.set("style", replace_red(style_text))
                stats["red_lines_to_black"] += 1
                style_text = element.attrib["style"]

            if style.get("fill") in RED_COLORS:
                element.set("style", replace_red(style_text))
                stats["red_fills_to_black"] += 1

    stats["unused_definitions"] = prune_unused_defs(root)
    stats["unreferenced_ids"] = remove_unreferenced_ids(root)
    stats["styles_consolidated"] = consolidate_styles(root)
    strip_whitespace(root)

    root.attrib.pop(f"{{{SODIPODI_NS}}}docname", None)
    for child in list(root):
        if local_name(child.tag) == "namedview":
            root.remove(child)
            stats["editor_metadata"] += 1

    destination.parent.mkdir(parents=True, exist_ok=True)
    tree.write(destination, encoding="utf-8", xml_declaration=True, short_empty_elements=True)

    stats["paths_before"] = before_paths
    stats["paths_after"] = sum(local_name(element.tag) == "path" for element in root.iter())
    stats["bytes_before"] = source.stat().st_size
    stats["bytes_after"] = destination.stat().st_size

    if access_threshold_report and red_dimensions:
        bins = [5, 10, 18, 24, 40, 80, 160, 320, 640, float("inf")]
        counts = collections.Counter()
        for dimension in red_dimensions:
            upper = next(limit for limit in bins if dimension <= limit)
            counts[str(upper)] += 1
        print("red-path longest-dimension bins:", dict(counts))

    return dict(stats)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--report-red-dimensions", action="store_true")
    args = parser.parse_args()

    stats = optimize(args.source, args.destination, args.report_red_dimensions)
    for key in sorted(stats):
        print(f"{key}: {stats[key]}")


if __name__ == "__main__":
    main()

