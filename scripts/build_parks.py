#!/usr/bin/env python3
"""Big-park overlay geometry for the precinct map.

The giant parks (Central, Prospect, Pelham Bay, Van Cortlandt...) read as ordinary
precinct territory on the choropleth, which misleads: nobody lives there, and their
acreage visually inflates the precincts they sit in. This pulls NYC Parks Properties
(NYC Open Data enfh-gkve), keeps parks over MIN_ACRES, dissolves each park's parts,
and writes a small overlay file the map renders as a hatch texture.

⚠️ d3-geo reads polygons spherically and wants CLOCKWISE exterior rings — the
opposite of RFC 7946/shapely's default. orient(sign=-1.0), wind LAST, and drop
degenerate parts with a real area floor (see the precinct-map build notes).

Re-run: python3 scripts/build_parks.py   (needs shapely)
"""
import json
import urllib.request
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parent.parent
URL = "https://data.cityofnewyork.us/resource/enfh-gkve.geojson?$limit=3000"
MIN_ACRES = 400
MIN_PART_AREA = 1e-9  # square degrees; kills collinear slivers d3 reads as the whole globe

def main():
    print("downloading Parks Properties...")
    feats = json.load(urllib.request.urlopen(URL))["features"]
    by_name = {}
    for f in feats:
        try:
            acres = float(f["properties"].get("acres") or 0)
        except ValueError:
            continue
        if acres < MIN_ACRES or not f.get("geometry"):
            continue
        name_l = (f["properties"].get("signname") or "").lower()
        # linear corridors hatch as weird shoreline ribbons — this layer is about big green blobs
        if any(w in name_l for w in ("parkway", "boardwalk", "beach")):
            continue
        name = f["properties"]["signname"]
        by_name.setdefault(name, []).append(shape(f["geometry"]))
    out = []
    for name, geoms in sorted(by_name.items()):
        g = unary_union(geoms).simplify(0.0003, preserve_topology=True)
        polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
        kept = [p for p in polys if p.area > MIN_PART_AREA]
        if not kept:
            continue
        wound = [orient(p, sign=-1.0) for p in kept]
        geom = mapping(unary_union(wound)) if len(wound) > 1 else mapping(wound[0])
        # round coordinates to 5dp
        def rnd(coords):
            if isinstance(coords[0], (int, float)):
                return [round(coords[0], 5), round(coords[1], 5)]
            return [rnd(c) for c in coords]
        geom["coordinates"] = rnd(geom["coordinates"])
        out.append({"type": "Feature", "properties": {"name": name}, "geometry": geom})
        print(f"  {name}")
    dst = ROOT / "src/data/big_parks.json"
    json.dump({"type": "FeatureCollection", "features": out}, open(dst, "w"), separators=(",", ":"))
    print(f"wrote {dst} ({len(out)} parks, {dst.stat().st_size // 1024}KB)")

if __name__ == "__main__":
    main()
