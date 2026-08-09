"""Generate the Windows icon used by the desktop widget.

The artwork is deliberately geometric so it stays legible from a 16px tray icon
up to the large Windows app tile.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "build"
MOBILE_ASSETS = ROOT / "assets"
CANVAS = 1024
TRAY_CANVAS = 256


def font(size: int) -> ImageFont.FreeTypeFont:
    candidates = (
        Path("C:/Windows/Fonts/seguisb.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def create_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (82, 94, 942, 954),
        radius=214,
        fill=(0, 0, 0, 155),
    )
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(32)))

    card = Image.new("RGBA", image.size, (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card)
    for y in range(72, 930):
        progress = (y - 72) / 858
        color = (
            round(13 + 1 * progress),
            round(30 + 13 * progress),
            round(32 + 5 * progress),
            255,
        )
        card_draw.rounded_rectangle(
            (72, y, 952, 930),
            radius=220,
            fill=color,
        )
    card_draw.rounded_rectangle(
        (72, 72, 952, 930),
        radius=220,
        outline=(65, 104, 97, 255),
        width=14,
    )
    card_draw.arc(
        (95, 95, 929, 910),
        start=202,
        end=326,
        fill=(72, 232, 179, 105),
        width=9,
    )
    image.alpha_composite(card)

    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((214, 173, 810, 769), fill=(20, 224, 156, 55))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))

    draw = ImageDraw.Draw(image)
    draw.ellipse(
        (220, 175, 804, 759),
        fill=(7, 18, 21, 225),
        outline=(47, 222, 165, 255),
        width=18,
    )
    draw.ellipse(
        (253, 208, 771, 726),
        outline=(199, 159, 83, 170),
        width=6,
    )

    label_font = font(430)
    label = "P"
    box = draw.textbbox((0, 0), label, font=label_font)
    label_width = box[2] - box[0]
    label_height = box[3] - box[1]
    label_position = (
        (CANVAS - label_width) / 2 - 5,
        425 - label_height / 2 - box[1],
    )
    draw.text(
        (label_position[0] + 9, label_position[1] + 12),
        label,
        font=label_font,
        fill=(0, 0, 0, 115),
    )
    draw.text(
        label_position,
        label,
        font=label_font,
        fill=(234, 244, 240, 255),
        stroke_width=2,
        stroke_fill=(255, 255, 255, 90),
    )

    chart_points = (
        (206, 788),
        (322, 746),
        (421, 768),
        (527, 680),
        (635, 712),
        (812, 590),
    )
    chart_glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    chart_glow_draw = ImageDraw.Draw(chart_glow)
    chart_glow_draw.line(chart_points, fill=(26, 237, 169, 165), width=32, joint="curve")
    image.alpha_composite(chart_glow.filter(ImageFilter.GaussianBlur(20)))
    draw = ImageDraw.Draw(image)
    draw.line(chart_points, fill=(56, 239, 179, 255), width=21, joint="curve")
    for point in (chart_points[0], chart_points[-1]):
        draw.ellipse(
            (point[0] - 19, point[1] - 19, point[0] + 19, point[1] + 19),
            fill=(234, 244, 240, 255),
            outline=(44, 231, 171, 255),
            width=7,
        )

    return image


def create_tray_icon() -> Image.Image:
    """Create a deliberately simple high-contrast icon for the Windows tray."""
    image = Image.new("RGBA", (TRAY_CANVAS, TRAY_CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (8, 8, 248, 248),
        radius=58,
        fill=(9, 21, 25, 255),
        outline=(46, 230, 184, 255),
        width=14,
    )
    draw.rounded_rectangle(
        (25, 25, 231, 231),
        radius=43,
        outline=(197, 157, 82, 180),
        width=5,
    )

    label_font = font(164)
    box = draw.textbbox((0, 0), "P", font=label_font)
    label_width = box[2] - box[0]
    label_height = box[3] - box[1]
    position = (
        (TRAY_CANVAS - label_width) / 2 - 2,
        (TRAY_CANVAS - label_height) / 2 - box[1] - 4,
    )
    draw.text(
        (position[0] + 4, position[1] + 5),
        "P",
        font=label_font,
        fill=(0, 0, 0, 150),
    )
    draw.text(
        position,
        "P",
        font=label_font,
        fill=(237, 248, 244, 255),
    )

    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    MOBILE_ASSETS.mkdir(parents=True, exist_ok=True)
    icon = create_icon()
    icon.save(OUTPUT / "icon.png", optimize=True)
    icon.save(MOBILE_ASSETS / "logo.png", optimize=True)
    icon.save(
        OUTPUT / "icon.ico",
        format="ICO",
        sizes=((16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)),
    )
    tray_icon = create_tray_icon()
    tray_icon.save(OUTPUT / "tray.png", optimize=True)
    tray_icon.save(
        OUTPUT / "tray.ico",
        format="ICO",
        sizes=((16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)),
    )


if __name__ == "__main__":
    main()
