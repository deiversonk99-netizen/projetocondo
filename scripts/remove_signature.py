"""Clean non-map annotations from the app's rotated condominium plan.

The affected lots repeat the same drafting pattern every 45 pixels. The script
copies a clean three-row strip from the same block, restores the correct C4-C6
labels, removes the unused side/footer labels, and writes a new asset without
touching the source image.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: remove_signature.py input.png output.png")

    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    image = Image.open(source_path).convert("RGB")

    # Clean repeated drafting strip from the same Quadra C column (C7-C10),
    # shifted exactly four 48.9-pixel house rows upward onto C3-C6. Starting
    # below C6 also guarantees that none of the blue ink is copied back.
    clean_strip = image.crop((1940, 820, 2080, 1016))
    image.paste(clean_strip, (1940, 625))

    draw = ImageDraw.Draw(image)
    font_path = Path(r"C:\Windows\Fonts\arial.ttf")
    font = ImageFont.truetype(str(font_path), 12)

    for digit, center_y in (("3", 645), ("4", 694), ("5", 743), ("6", 792)):
        # Replace only the copied numeric suffix (7/8/9/10), retaining the original
        # CASA C lettering and every surrounding architectural line.
        draw.rectangle((2008, center_y - 7, 2024, center_y + 7), fill="white")
        draw.text((2013, center_y), digit, fill=(42, 42, 42), font=font, anchor="mm")

    # The right-hand ownership note is outside the condominium's navigable
    # geometry. Keep the nearby boundary and MURO line untouched.
    draw.rectangle((2535, 990, 2810, 1100), fill="white")

    # Remove the complete notes/title/footer panel marked by the user. The
    # condominium plan ends above this area; the vertical DocuSign identifier
    # at the far left is intentionally kept because it was not selected.
    draw.rectangle((122, 1675, image.width - 1, image.height - 1), fill="white")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, optimize=True)
    print(f"Saved corrected map to {output_path}")


if __name__ == "__main__":
    main()
