"""Write the small terrain grids that let the browser trace a custom point near the south pole (lunazen/custom.py)."""
from lunazen.custom import OUT, export

manifest = export()
size = sum(p.stat().st_size for p in OUT.glob("*.bin"))
print(f"wrote {len(manifest['sites'])} site crops + far field to {OUT} ({size / 1e6:.1f} MB raw)")
for s in manifest["sites"]:
    print(f"  {s['id']:10s} {s['cols']}x{s['rows']} px at {s['pixelM']:.0f} m")
print(f"  far field {manifest['far']['cols']}x{manifest['far']['rows']} px at {manifest['far']['pixelM']:.0f} m")
