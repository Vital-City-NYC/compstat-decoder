#!/usr/bin/env python3
"""Build precinct populations and the precinct-by-district resident crosswalk.

Replaces two things we used to inherit:

  1. Precinct populations came from John Keefe's census-by-precincts crosswalk
     (github.com/jkeefe/census-by-precincts), last updated March 2023. Sound
     method, but a static file cannot know about boundary changes made after it
     was published — and the NYPD has made two since: the 116th Precinct opened
     in December 2024 out of the 105th and 113th, and Patrol Borough Bronx split
     in May 2026. So the 105th carried 75,772 residents it no longer polices and
     the 116th had no population at all.

  2. Council district figures were weighted by each precinct's share of the
     district's LAND AREA, which assumes crime is spread evenly across acreage.
     That badly misweights districts holding large uninhabited ground: the 113th
     Precinct is 43% of District 31 by area and holds two residents (Jamaica Bay
     and JFK), and the 22nd is 46% of District 6 with 129 residents (Central Park).
     We now weight by the share of each precinct's RESIDENTS living in the
     district, which assumes crime is spread evenly across people instead.

Source: 2020 Decennial Census blocks via the Census TIGERweb API — a whole count,
not a sample, and the only population published at block level. No API key needed.
Each block is assigned whole to the precinct and district containing its internal
point; blocks are small enough that the error is immaterial (see the guards below).

The 2020 vintage is the real limitation. Block-level population exists only in the
decennial count, so this is frozen until 2030 and cannot see post-2020 housing.

Usage:  python3 scripts/build_populations.py
Writes: src/data/precinct_populations.json   (also patches GEO_POPULATIONS in shared.js)
        src/data/district_crosswalk.json
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
TIGER = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
         "tigerWMS_Census2020/MapServer/10/query")
COUNTIES = {"005": "Bronx", "047": "Brooklyn", "061": "Manhattan",
            "081": "Queens", "085": "Staten Island"}
NYC_2020 = 8_804_190          # the published citywide total; the blocks must sum to it
MAX_UNPLACED_FRAC = 0.001     # blocks whose internal point lands in water, etc.


def ordinal(n):
    suf = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def fetch_blocks():
    out = []
    for code, name in COUNTIES.items():
        q = urllib.parse.urlencode({
            "where": f"STATE='36' AND COUNTY='{code}'",
            "outFields": "GEOID,POP100,INTPTLAT,INTPTLON",
            "returnGeometry": "false", "resultRecordCount": "100000", "f": "json"})
        with urllib.request.urlopen(f"{TIGER}?{q}", timeout=180) as r:
            feats = json.load(r).get("features", [])
        pop = sum(int(f["attributes"]["POP100"] or 0) for f in feats)
        print(f"  {name:14} {len(feats):6,} blocks  {pop:10,} residents")
        out.extend(f["attributes"] for f in feats)
    total = sum(int(a["POP100"] or 0) for a in out)
    if total != NYC_2020:
        sys.exit(f"blocks sum to {total:,}, expected {NYC_2020:,} — the pull is incomplete")
    print(f"  {'TOTAL':14} {len(out):6,} blocks  {total:10,} residents  (matches the published count)")
    return out


def locator(features, id_of):
    polys = [shape(f["geometry"]) for f in features]
    ids = [id_of(f) for f in features]
    tree = STRtree(polys)

    def find(pt):
        for i in tree.query(pt):
            if polys[i].covers(pt):
                return ids[i]
        return None
    return find


def main():
    print("Fetching 2020 Census blocks from TIGERweb...")
    blocks = fetch_blocks()

    precincts = json.load(open(ROOT / "src/data/nyc_precincts.json"))
    districts = json.load(open(ROOT / "src/data/council_districts.json"))["districts"]
    find_precinct = locator(precincts["features"], lambda f: int(f["properties"]["precinct"]))
    find_district = locator([{"geometry": d["geometry"]} for d in districts],
                            lambda f: None)
    # the district locator needs its own ids, so rebuild it with them attached
    dpolys = [shape(d["geometry"]) for d in districts]
    dnums = [d["district"] for d in districts]
    dtree = STRtree(dpolys)

    def find_district(pt):
        for i in dtree.query(pt):
            if dpolys[i].covers(pt):
                return dnums[i]
        return None

    pop_precinct, pop_district, pair = {}, {}, {}
    unplaced = 0
    for a in blocks:
        p = int(a["POP100"] or 0)
        if not p:
            continue
        pt = Point(float(a["INTPTLON"]), float(a["INTPTLAT"]))
        pr, di = find_precinct(pt), find_district(pt)
        if pr is None:
            unplaced += p
            continue
        pop_precinct[pr] = pop_precinct.get(pr, 0) + p
        if di is None:
            unplaced += p
            continue
        pop_district[di] = pop_district.get(di, 0) + p
        pair[(pr, di)] = pair.get((pr, di), 0) + p

    frac = unplaced / NYC_2020
    print(f"\n  unplaced residents: {unplaced:,} ({frac*100:.3f}%)")
    if frac > MAX_UNPLACED_FRAC:
        sys.exit(f"{frac*100:.2f}% of residents could not be placed — check the boundary files")

    # ---- precinct populations ----
    pops = {f"{ordinal(n)} Precinct": v for n, v in sorted(pop_precinct.items())}
    (ROOT / "src/data/precinct_populations.json").write_text(
        json.dumps({"source": "2020 Decennial Census blocks via TIGERweb",
                    "citywide": NYC_2020, "precincts": pops}, indent=1))
    print(f"  precinct populations: {len(pops)} precincts")

    # ---- district crosswalk ----
    # residentShare drives the MATH: of this precinct's residents, the fraction
    #   living in the district. Slice its crime by this and the pieces sum to the
    #   crime inside the district.
    # populationShare is for DISPLAY: of the district's residents, the fraction in
    #   this precinct's part. Sums to 1, so it reads as "share of district".
    # Where to put each precinct's label on the district map. The map used to take the
    # centroid of the WHOLE precinct, which for a precinct that barely overlaps sits far
    # outside the frame — so those labels were silently dropped (District 2's 17th and
    # 14th). representative_point() on the intersection is guaranteed to fall inside the
    # visible sliver.
    pshapes = {int(f["properties"]["precinct"]): shape(f["geometry"]).buffer(0)
               for f in precincts["features"]}
    dshapes = {d["district"]: shape(d["geometry"]).buffer(0) for d in districts}

    out = {}
    for d in districts:
        n = d["district"]
        rows = []
        for (pr, di), v in pair.items():
            if di != n:
                continue
            label = None
            try:
                piece = pshapes[pr].intersection(dshapes[n])
                if not piece.is_empty:
                    if piece.geom_type == "MultiPolygon":
                        piece = max(piece.geoms, key=lambda g: g.area)
                    pt = piece.representative_point()
                    label = [round(pt.x, 5), round(pt.y, 5)]
            except Exception:
                label = None
            rows.append({"precinct": pr,
                         "residents": v,
                         "residentShare": round(v / pop_precinct[pr], 6),
                         "populationShare": round(v / pop_district[n], 6),
                         "labelPoint": label})
        rows.sort(key=lambda r: -r["populationShare"])
        out[str(n)] = {"population": pop_district[n], "precincts": rows}
    (ROOT / "src/data/district_crosswalk.json").write_text(
        json.dumps({"source": "2020 Decennial Census blocks via TIGERweb",
                    "districts": out}, indent=1))
    print(f"  district crosswalk: {len(out)} districts, "
          f"{sum(len(v['precincts']) for v in out.values())} precinct pairs")

    # ---- guard: apportioning any precinct quantity must conserve it ----
    worst = max((abs(sum(r["residentShare"] for v in out.values()
                         for r in v["precincts"] if r["precinct"] == pr) - 1.0), pr)
                for pr in pop_precinct)
    print(f"  worst residentShare rounding error across a precinct: {worst[0]:.4f} "
          f"({ordinal(worst[1])} Precinct)")
    if worst[0] > 0.01:
        sys.exit("a precinct's resident shares do not sum to 1 — crime would leak on apportionment")

    # ---- patch GEO_POPULATIONS in shared.js ----
    sj = ROOT / "src/shared.js"
    src = sj.read_text()
    block = re.search(r"(export const GEO_POPULATIONS = \{)(.*?)(\n\};)", src, re.S)
    boroughs = dict(re.findall(r'"((?:Bronx|Brooklyn|Manhattan|Queens|Staten)[^"]*)":\s*(\d+)',
                               block.group(2)))
    lines = []
    for i, (k, v) in enumerate(pops.items()):
        lines.append(f'  "{k}": {v},' if (i + 1) % 5 else f'  "{k}": {v},\n')
    body = "\n" + "".join(l if l.endswith("\n") else l + " " for l in lines).rstrip()
    # patrol borough totals are sums of their precincts; recompute from shared.js's own map
    pb = re.search(r"PATROL_BOROUGHS = \{(.*?)\};", src, re.S).group(1)
    for boro, nums in re.findall(r"'([^']+)':\s*\[([0-9,\s]+)\]", pb):
        tot = sum(pop_precinct.get(int(x), 0) for x in re.findall(r"\d+", nums))
        boroughs[boro] = tot
    body += "\n" + "\n".join(f'  "{k}": {v},' for k, v in boroughs.items())
    sj.write_text(src[:block.start(2)] + body + src[block.end(2):])
    print("  patched GEO_POPULATIONS in src/shared.js")


if __name__ == "__main__":
    main()
