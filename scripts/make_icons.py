"""Generate Yoink .ico from existing public/icon-*.png files."""
from PIL import Image
import os

ROOT = os.path.dirname(__file__)
OUT  = os.path.join(ROOT, "public")

ico_sizes = [16, 32, 48, 256]
imgs = [Image.open(os.path.join(OUT, f"icon-{s}.png")).convert("RGBA") for s in ico_sizes]

# favicon.ico
imgs[0].save(
    os.path.join(OUT, "favicon.ico"),
    format="ICO",
    append_images=imgs[1:],
    sizes=[(s, s) for s in ico_sizes],
)
print("  favicon.ico")

# yoink.ico for Windows shortcut / build script
imgs[0].save(
    os.path.join(ROOT, "yoink.ico"),
    format="ICO",
    append_images=imgs[1:],
    sizes=[(s, s) for s in ico_sizes],
)
print("  yoink.ico")
print("Done.")
