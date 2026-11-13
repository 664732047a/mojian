#!/usr/bin/env python3
"""Generate the local macOS icon from simple original vector shapes."""
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)
SCALE = 2
SIZE = 1024

def box(values):
    return tuple(round(x * SCALE) for x in values)

def line(draw, points, fill, width):
    draw.line([box(p) for p in points], fill=fill, width=round(width * SCALE), joint="curve")
    r = width / 2
    for x, y in (points[0], points[-1]):
        draw.ellipse(box((x-r, y-r, x+r, y+r)), fill=fill)

im = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE))
mask = Image.new("L", im.size)
ImageDraw.Draw(mask).rounded_rectangle(box((72, 72, 952, 952)), radius=198*SCALE, fill=255)
gradient = Image.new("RGBA", im.size)
pixels = gradient.load()
top, bottom = (77, 121, 105), (30, 68, 54)
for y in range(im.height):
    t = max(0, min(1, (y / SCALE - 72) / 880))
    c = tuple(round(a+(b-a)*t) for a, b in zip(top, bottom)) + (255,)
    for x in range(im.width):
        pixels[x, y] = c
im.paste(gradient, (0, 0), mask)
outline = Image.new("RGBA", im.size)
ImageDraw.Draw(outline).rounded_rectangle(box((74,74,950,950)), radius=196*SCALE, outline=(255,255,255,25), width=4*SCALE)
im = Image.alpha_composite(im, outline)
paper_mask = Image.new("L", im.size)
pd = ImageDraw.Draw(paper_mask)
pd.rounded_rectangle(box((258,220,738,804)), radius=49*SCALE, fill=255)
pd.polygon([box(p) for p in [(604,220),(738,220),(738,354)]], fill=0)
shadow = Image.new("RGBA", im.size, (8, 26, 18, 0))
shadow_alpha = Image.new("L", im.size)
shadow_alpha.paste(paper_mask, (0, 18*SCALE))
shadow_alpha = shadow_alpha.filter(ImageFilter.GaussianBlur(24*SCALE)).point(lambda v: int(v*.25))
shadow.putalpha(shadow_alpha)
im = Image.alpha_composite(im, shadow)
paper = Image.new("RGBA", im.size, (250, 249, 238, 255))
im.paste(paper, (0,0), paper_mask)
d = ImageDraw.Draw(im)
d.polygon([box(p) for p in [(604,220),(604,315),(610,338),(625,350),(643,354),(738,354)]], fill="#C8D6C5")
line(d, [(348,433),(594,433)], "#92A78C", 17)
for a,b,y in [(348,637,495),(348,575,551),(348,498,607)]:
    line(d,[(a,y),(b,y)],"#BEC9B7",13)
# A curved leaf doubles as an ink nib.
leaf = [(530,724),(540,700),(552,675),(568,650),(586,628),(608,607),(632,590),(637,620),(637,646),(632,672),(621,697),(604,718),(587,732),(570,741)]
d.polygon([box(p) for p in leaf], fill="#326657")
line(d,[(520,758),(599,652)],"#326657",10)
line(d,[(548,725),(600,653)],"#C5D7BB",4)
d.ellipse(box((763,247,805,289)), fill="#A3BA98")
im = im.resize((SIZE,SIZE), Image.Resampling.LANCZOS)
im.save(BUILD / "icon.png")
iconset = BUILD / "icon.iconset"
iconset.mkdir(exist_ok=True)
for px in (16,32,128,256,512):
    im.resize((px,px),Image.Resampling.LANCZOS).save(iconset / f"icon_{px}x{px}.png")
    im.resize((px*2,px*2),Image.Resampling.LANCZOS).save(iconset / f"icon_{px}x{px}@2x.png")
subprocess.run(["iconutil","-c","icns",str(iconset),"-o",str(BUILD / "icon.icns")],check=True)
print(f"Created {BUILD / 'icon.icns'}")
