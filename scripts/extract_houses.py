"""Extract semantic house-label coordinates from the condominium PDF.

Usage:
    python scripts/extract_houses.py source.pdf src/data/houses.json

The PDF is portrait while the app displays it rotated 90 degrees counter-clockwise.
Coordinates are therefore converted to the app SVG coordinate system here.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber


EXPECTED_COUNTS = {
    "A": 18,
    "B": 36,
    "C": 36,
    "D": 36,
    "E": 36,
    "F": 32,
    "G": 20,
    "H": 28,
    "I": 24,
    "J": 8,
    "K": 20,
    "L": 22,
}


def rotate_point(page_width: float, x: float, y_from_top: float) -> tuple[float, float]:
    return y_from_top, page_width - x


def house_record(page_width: float, quadra: str, number: int, box: dict[str, float]) -> dict:
    center_x = (box["x0"] + box["x1"]) / 2
    center_y = (box["top"] + box["bottom"]) / 2
    x, y = rotate_point(page_width, center_x, center_y)
    return {
        "id": f"{quadra}{number}",
        "label": f"Casa {quadra}{number}",
        "quadra": quadra,
        "numero": number,
        "x": round(x, 2),
        "y": round(y, 2),
    }


def extract(source: Path) -> list[dict]:
    with pdfplumber.open(source) as document:
        page = document.pages[0]
        records: dict[str, dict] = {}

        words = page.extract_words(
            x_tolerance=2,
            y_tolerance=2,
            keep_blank_chars=True,
            use_text_flow=False,
        )
        for word in words:
            match = re.search(r"CASA\s*([A-L])\s*(\d+)", word["text"])
            if not match:
                continue
            quadra, raw_number = match.groups()
            number = int(raw_number)
            records[f"{quadra}{number}"] = house_record(page.width, quadra, number, word)

        # Quadra G is drawn at an angle. pdfplumber exposes its individual glyphs,
        # so recover each complete label from the original character stream.
        chars = page.chars
        stream = "".join(char["text"] for char in chars)
        for match in re.finditer(r"CASA\s*G(?:20|1[0-9]|[1-9])", stream):
            number = int(re.search(r"(\d+)$", match.group()).group(1))
            glyphs = chars[match.start() : match.end()]
            box = {
                "x0": min(char["x0"] for char in glyphs),
                "x1": max(char["x1"] for char in glyphs),
                "top": min(char["top"] for char in glyphs),
                "bottom": max(char["bottom"] for char in glyphs),
            }
            records[f"G{number}"] = house_record(page.width, "G", number, box)

    expected = {
        f"{quadra}{number}"
        for quadra, count in EXPECTED_COUNTS.items()
        for number in range(1, count + 1)
    }
    missing = expected - records.keys()
    unexpected = records.keys() - expected
    if missing or unexpected:
        raise RuntimeError(
            f"House validation failed. Missing={sorted(missing)} unexpected={sorted(unexpected)}"
        )

    return sorted(records.values(), key=lambda item: (item["quadra"], item["numero"]))


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_houses.py source.pdf output.json")
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    houses = extract(source)
    output.write_text(json.dumps(houses, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(houses)} houses to {output}")


if __name__ == "__main__":
    main()
