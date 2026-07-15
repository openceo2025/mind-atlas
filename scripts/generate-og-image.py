from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 1200, 630
ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = Path("C:/Windows/Fonts")


def load_font(name: str, size: int):
    path = FONT_DIR / name
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


image = Image.new("RGB", (WIDTH, HEIGHT), "#050706")
pixels = image.load()
for y in range(HEIGHT):
    for x in range(WIDTH):
        dx = (x - 600) / 720
        dy = (y - 220) / 500
        glow = max(0.0, 1.0 - math.sqrt(dx * dx + dy * dy))
        pixels[x, y] = (int(5 + 18 * glow), int(7 + 55 * glow), int(6 + 42 * glow))

draw = ImageDraw.Draw(image, "RGBA")
for y in range(105, HEIGHT, 105):
    draw.line((0, y, WIDTH, y), fill=(215, 234, 217, 28), width=1)
for x in range(150, WIDTH, 150):
    draw.line((x, 0, x, HEIGHT), fill=(215, 234, 217, 28), width=1)

draw.ellipse((686, 198, 1146, 434), outline=(245, 223, 128, 190), width=8)
draw.ellipse((808, 208, 1024, 424), fill=(105, 214, 164, 255))
draw.ellipse((847, 249, 893, 295), fill=(215, 234, 217, 220))
draw.ellipse((939, 327, 1001, 389), fill=(47, 127, 104, 185))

draw.text((86, 165), "MIND ATLAS", font=load_font("segoeuib.ttf", 82), fill=(245, 251, 239, 255))
draw.text((92, 282), "Turn your thoughts into a universe.", font=load_font("segoeuib.ttf", 34), fill=(216, 245, 109, 255))
draw.text((92, 344), "Spatial notebook for ideas and AI-assisted work", font=load_font("segoeui.ttf", 26), fill=(215, 234, 217, 205))
draw.text((92, 496), "mind-atlas.org", font=load_font("segoeuib.ttf", 24), fill=(120, 223, 187, 255))

output = ROOT / "public" / "og-image.png"
image.save(output, optimize=True)
print(output)
