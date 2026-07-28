#!/usr/bin/env python3
"""Build src/data/nyc_precincts.json — the precinct outlines every map on the site draws.

The shapes are bundled rather than fetched, so they have to be small: the file is imported
straight into the JS bundle. NYC's published boundaries are ~3.8MB, far too heavy, so they are
simplified until the whole city is a few thousand points and coordinates are rounded to five
decimals (about a metre — well past what a 190px locator map can show).

Why this exists as a script: the file it replaces had 77 precincts and no 116th, so the
116th Precinct selected on the site lit up nothing at all, and the 105th was still drawn
around territory it gave up in December 2024. Boundaries change. Re-run this when they do.

The source dataset also moved — the old id (78dh-3ptz) now 404s — which is worth remembering
if the maps ever go blank again.

Usage:  python3 scripts/build_precinct_geo.py [--tolerance 0.0002]
"""

import argparse
import json
import urllib.request
from pathlib import Path

from shapely.geometry import MultiPolygon, mapping, shape
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "nyc_precincts.json"
DATASET = "y76i-bdw7"          # NYC Open Data, "Police Precincts"
SOURCE = f"https://data.cityofnewyork.us/api/geospatial/{DATASET}?method=export&format=GeoJSON"
PRECISION = 5
# Minimum area for a polygon part, in square degrees (~9 m² at this latitude). Rounding
# leaves behind rings of three collinear points: shapely calls their area 1e-20 rather than
# 0, so a "> 0" test keeps them, and d3 then reads each one as covering the entire sphere.
# Anything this small is far below one pixel on the maps here.
MIN_PART_AREA = 1e-9


def count_points(geometry):
    total = 0
    stack = [geometry["coordinates"]]
    while stack:
        item = stack.pop()
        if item and isinstance(item[0], (int, float)):
            total += 1
        else:
            stack.extend(item)
    return total


def wind(geom):
    """Force CLOCKWISE exterior rings — d3-geo's convention, not RFC 7946's.

    This is the one genuinely counter-intuitive step. d3-geo treats polygons as spherical,
    so ring direction is what separates the inside of a precinct from the entire rest of the
    planet, and it wants the opposite of what the GeoJSON spec recommends: exterior rings
    clockwise. Hand it counter-clockwise rings and every precinct is read as "the whole globe
    except this bit" — geoBounds returns [[-180,-90],[180,90]], fitSize scales down by ~650x,
    and the map renders as a flat grey rectangle.

    Note that a plain bounding-box check on the coordinates looks perfectly healthy either
    way, so this cannot be caught by inspecting the file. Re-render after any change here.
    """
    if geom.geom_type == "Polygon":
        return orient(geom, sign=-1.0)
    if geom.geom_type == "MultiPolygon":
        return MultiPolygon([orient(p, sign=-1.0) for p in geom.geoms])
    return geom


def round_coords(obj):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), PRECISION) for v in obj]
        return [round_coords(v) for v in obj]
    return obj


def main():
    ap = argparse.ArgumentParser()
    # 0.0001 lands within ~1% of the point count the previous file carried, so the outlines
    # look the same as before while the coordinate rounding roughly halves the bytes.
    ap.add_argument("--tolerance", type=float, default=0.0001,
                    help="simplification tolerance in degrees (~11m at 0.0001)")
    args = ap.parse_args()

    print(f"Downloading {DATASET} …", flush=True)
    with urllib.request.urlopen(SOURCE, timeout=180) as r:
        raw = json.load(r)
    print(f"  {len(raw['features'])} features, {sum(count_points(f['geometry']) for f in raw['features']):,} points")

    features, dropped_parts = [], 0
    for feat in raw["features"]:
        pct = feat["properties"].get("precinct")
        if pct is None:
            continue
        geom = shape(feat["geometry"]).buffer(0)          # repair any self-intersections
        simple = geom.simplify(args.tolerance, preserve_topology=True)
        if simple.is_empty:
            simple = geom

        # Round first, then check what survived. The waterfront precincts carry dozens of
        # offshore slivers a few metres across; at five decimals those collapse to rings with
        # no area, which d3 then reads as inverted polygons covering the globe. Rounding
        # before the check is the only way to catch the ones that actually break.
        rounded = shape({"type": mapping(simple)["type"],
                         "coordinates": round_coords(mapping(simple)["coordinates"])})
        if rounded.geom_type == "MultiPolygon":
            parts = [p for p in rounded.geoms
                     if p.area >= MIN_PART_AREA and len(p.exterior.coords) >= 4]
            dropped_parts += len(rounded.geoms) - len(parts)
            if not parts:
                print(f"  ! precinct {pct} vanished when rounded, keeping unrounded")
                parts = list(rounded.geoms)
            rounded = parts[0] if len(parts) == 1 else MultiPolygon(parts)
        elif rounded.area <= 0:
            print(f"  ! precinct {pct} has no area after rounding")

        final = wind(rounded)                             # winding must be the last word
        features.append({
            "type": "Feature",
            # The app reads properties.precinct and parses it as an int; keep it a string so
            # the shape matches what the previous file carried.
            "properties": {"precinct": str(int(pct))},
            "geometry": {"type": mapping(final)["type"],
                         "coordinates": round_coords(mapping(final)["coordinates"])},
        })
    print(f"  dropped {dropped_parts} sub-metre offshore slivers that rounding collapsed")

    features.sort(key=lambda f: int(f["properties"]["precinct"]))
    out = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")

    pts = sum(count_points(f["geometry"]) for f in features)
    nums = [int(f["properties"]["precinct"]) for f in features]
    print(f"\nWrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:,.0f}KB)")
    print(f"  {len(features)} precincts, {pts:,} points, tolerance {args.tolerance}")
    print(f"  116th Precinct present: {116 in nums}")
    missing = [n for n in nums if nums.count(n) > 1]
    if missing:
        print(f"  ! duplicate precincts: {sorted(set(missing))}")


if __name__ == "__main__":
    main()
