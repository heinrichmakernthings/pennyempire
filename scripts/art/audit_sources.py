"""Read-only PNG inspection. Requires Pillow. Does not edit artwork."""
from pathlib import Path
from PIL import Image
import json
root = Path(__file__).resolve().parents[2]
results = []
for path in sorted((root / 'assets/art/source').glob('*.png')):
    with Image.open(path) as im:
        alpha = im.getchannel('A') if im.mode == 'RGBA' else None
        hist = alpha.histogram() if alpha else None
        total = im.width * im.height
        results.append({
            'file': path.name, 'dimensions': list(im.size), 'mode': im.mode,
            'alpha_range': list(alpha.getextrema()) if alpha else None,
            'transparent_fraction': round(hist[0] / total, 5) if hist else 0,
            'near_opaque_fraction': round(sum(hist[250:]) / total, 5) if hist else 1,
            'partial_alpha_fraction': round(sum(hist[1:250]) / total, 5) if hist else 0,
            'runtime_ready': False,
            'remaining_checks': ['edge composite inspection', 'extraction', 'pixel scale', 'pivot', 'grid composition']
        })
print(json.dumps({'note': 'Alpha statistics do not prove clean contours or tile compatibility. Near-opaque means alpha >=250, not only 255.', 'sources': results}, indent=2))
