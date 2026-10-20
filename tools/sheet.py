#!/usr/bin/env python3
"""Contact sheet: sheet.py out.jpg cols width img1 img2 ...  (labels = file stem)"""
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
h = int(w * ims[0].height / ims[0].width); rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * (h + 16)), (20, 20, 20)); d = ImageDraw.Draw(S)
for i, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    x, y = (i % cols) * w, (i // cols) * (h + 16); S.paste(im.resize((w, h)), (x, y + 16)); d.text((x + 4, y + 2), p.split('/')[-1], fill=(230, 230, 230))
S.save(out, quality=85); print(out, S.size)
