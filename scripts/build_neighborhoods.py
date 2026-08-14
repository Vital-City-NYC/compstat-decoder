#!/usr/bin/env python3
"""Build a searchable neighborhood -> precinct crosswalk for the geography search.

Source: NYC 2020 Neighborhood Tabulation Areas (NTAs), NYC Open Data 9nt8-h7nd,
intersected with the app's own precinct boundary file (src/data/nyc_precincts.json)
by area overlap -- the same method scripts/build_council_districts.py uses for
council districts. Residential NTAs only (ntatype 0); parks, cemeteries, airports
and Rikers are excluded.

A neighborhood that spans several precincts gets one entry per precinct with the
share of the NEIGHBORHOOD's area that falls in that precinct, largest first.
Precincts covering less than 15% of the neighborhood are dropped (boundary
slivers), except that the largest precinct is always kept.

Output: src/data/neighborhoods.json
  [{"name": "Bedford-Stuyvesant (East)", "boro": "Brooklyn",
    "precincts": [{"p": "81st Precinct", "share": 0.87}, ...]}, ...]

Re-run: python3 scripts/build_neighborhoods.py  (needs shapely, urllib access)
"""
import json
import urllib.request
from pathlib import Path

from shapely.geometry import shape
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parent.parent
NTA_URL = "https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=1000"
MIN_SHARE = 0.15

def ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf} Precinct"

def main() -> None:
    print("downloading 2020 NTAs...")
    with urllib.request.urlopen(NTA_URL) as r:
        ntas = json.load(r)["features"]
    residential = [f for f in ntas if f["properties"].get("ntatype") == "0"]
    print(f"  {len(ntas)} NTAs, {len(residential)} residential")

    precincts = json.load(open(ROOT / "src/data/nyc_precincts.json"))["features"]
    pshapes = []
    for f in precincts:
        geom = make_valid(shape(f["geometry"]))
        pshapes.append((int(f["properties"]["precinct"]), geom))
    print(f"  {len(pshapes)} precincts")

    out = []
    for f in residential:
        name = f["properties"]["ntaname"].strip()
        boro = f["properties"]["boroname"]
        geom = make_valid(shape(f["geometry"]))
        area = geom.area
        if area == 0:
            continue
        overlaps = []
        for pnum, pgeom in pshapes:
            if not geom.intersects(pgeom):
                continue
            inter = geom.intersection(pgeom).area / area
            if inter > 0.001:
                overlaps.append((pnum, inter))
        if not overlaps:
            continue
        overlaps.sort(key=lambda t: -t[1])
        kept = [o for o in overlaps if o[1] >= MIN_SHARE] or overlaps[:1]
        out.append({
            "name": name,
            "boro": boro,
            "precincts": [{"p": ordinal(p), "share": round(s, 3)} for p, s in kept],
        })

    out.sort(key=lambda d: d["name"])
    dst = ROOT / "src/data/neighborhoods.json"
    json.dump(out, open(dst, "w"), separators=(",", ":"))
    multi = sum(1 for d in out if len(d["precincts"]) > 1)
    print(f"wrote {dst}: {len(out)} neighborhoods, {multi} spanning 2+ precincts")
    for probe in ("Bedford-Stuyvesant", "Prospect Lefferts"):
        hits = [d for d in out if probe.lower() in d["name"].lower()]
        for h in hits:
            print("  check:", h["name"], "->", h["precincts"])

if __name__ == "__main__":
    main()
