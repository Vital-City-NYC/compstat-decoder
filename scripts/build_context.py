#!/usr/bin/env python3
"""Build data/context.json — the numbers the dashboard uses to describe its own reliability.

Two things are computed here, both from this repo's own weekly snapshot archive
(data/archive/YYYY-MM-DD.json, written by scripts/scrape_compstat.py on every run):

  1. REVISIONS. NYPD classifies a complaint when it is reported and reclassifies it as
     evidence arrives. Each snapshot's year-to-date total should grow by exactly that
     week's week-to-date count; anything left over is backfill into weeks already
     published. Running the same test on the prior-year column measures how much a
     closed year still moves (very little), which is what lets the site tell readers
     the current year is provisional and last year is settled.

  2. YTD VOLATILITY. Year-to-date is a window whose LENGTH changes: eight weeks in
     March, thirty in July. So a precinct's year-to-date percent change wanders on its
     own, with no revision involved, and settles as the year fills in. For every
     geography we record the range that figure has occupied across the archive.

Both are regenerated on every run so nothing the site states about itself goes stale.

Usage:  python3 scripts/build_context.py [--out data/context.json]
"""

import argparse
import json
import statistics
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Revisions can only be measured against what the NYPD published at the time, so this needs a
# record of past weeks as-published. That record is now entirely our own: scrape_compstat.py
# archives a snapshot every run, and the weeks before we started were imported once by
# scripts/import_upstream_archive.py. Nothing here reaches off this repo.
ARCHIVE_DIR = Path(__file__).resolve().parent.parent / "data" / "archive"

MAJOR7 = ["Murder", "Rape", "Robbery", "Fel. Assault", "Burglary", "Gr. Larceny", "G.L.A."]
ROOT = Path(__file__).resolve().parent.parent


def fetch_json(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "compstat-decoder/context-builder"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def load_snapshots():
    """Pull every archived weekly snapshot, oldest first — ours first, upstream for the rest."""
    files = sorted(ARCHIVE_DIR.glob("*.json"))
    if not files:
        raise SystemExit(f"No weekly snapshots in {ARCHIVE_DIR} — nothing to measure against.")
    print(f"  {len(files)} weekly snapshots ({files[0].stem} -> {files[-1].stem})", flush=True)
    snaps = [(p.stem, json.loads(p.read_text())) for p in files]
    for i, (d, _) in enumerate(snaps, 1):
        if i % 5 == 0 or i == len(snaps):
            print(f"  fetched {i}/{len(snaps)}", flush=True)
    return snaps


def total7(snap, geo, window, key):
    try:
        return snap[geo]["total_seven_major"][window][key]
    except (KeyError, TypeError):
        return None


def crime7(snap, geo, crime, window, key):
    try:
        return snap[geo]["seven_major_felonies"][crime][window][key]
    except (KeyError, TypeError):
        return None


def measure_revisions(snaps):
    """Backfill = YTD growth in excess of the single week that was added.

    Compares consecutive snapshots. Because the CompStat weeks tile exactly (each runs
    Monday to Sunday with no gap or overlap), any excess is a revision to a week that
    had already been published, not a counting artifact.
    """
    def backfill(getter):
        added = seen_weeks = 0
        for i in range(1, len(snaps)):
            prev, cur = snaps[i - 1][1], snaps[i][1]
            ytd_prev, ytd_cur = getter(prev, "year_to_date"), getter(cur, "year_to_date")
            wtd = getter(cur, "week_to_date")
            if None in (ytd_prev, ytd_cur, wtd):
                continue
            added += ytd_cur - ytd_prev
            seen_weeks += wtd
        return added, added - seen_weeks

    out = {"by_offense": {}}

    added, back = backfill(lambda s, w: total7(s, "citywide", w, "current_year"))
    out["citywide_added"] = round(added)
    out["citywide_backfill"] = round(back)
    out["citywide_pct"] = round(100 * back / added, 2) if added else None

    p_added, p_back = backfill(lambda s, w: total7(s, "citywide", w, "prior_year"))
    out["prior_year_added"] = round(p_added)
    out["prior_year_backfill"] = round(p_back)
    out["prior_year_pct"] = round(100 * p_back / p_added, 2) if p_added else None

    for c in MAJOR7:
        a, b = backfill(lambda s, w, c=c: crime7(s, "citywide", c, w, "current_year"))
        out["by_offense"][c] = {
            "added": round(a),
            "backfill": round(b),
            "pct": round(100 * b / a, 2) if a else None,
        }

    ranked = [(v["pct"], k) for k, v in out["by_offense"].items() if v["pct"] is not None]
    if ranked:
        out["largest_upward"] = max(ranked)[1]
        out["only_downward"] = [k for p, k in ranked if p < 0]
    return out


def ytd_range(snaps, pick):
    """min / max / latest of a per-snapshot YTD percent change, plus whether it crossed zero.

    Restricted to the CURRENT calendar year. Year-to-date resets every January, so a 2026
    year-to-date percentage and a 2027 one describe different windows and comparing them
    would be meaningless. That also makes the window start move on its own: it is March 1,
    2026 today only because the upstream archive begins there, and it becomes early
    January once the archive spans a full year.

    Fewer than three snapshots into a new year there is no range worth quoting, so the
    result carries n and no min/max and the site falls back to a caution without figures —
    which is when the caution matters most.
    """
    vals = [(d, pick(s)) for d, s in snaps]
    vals = [(d, v) for d, v in vals if isinstance(v, (int, float))]
    if not vals:
        return None
    year = vals[-1][0][:4]
    vals = [(d, v) for d, v in vals if d.startswith(year)]
    if not vals:
        return None
    if len(vals) < 3:
        return {"n": len(vals), "from": vals[0][0], "year": year, "insufficient": True}
    nums = [v for _, v in vals]
    return {
        "min": round(min(nums), 1),
        "max": round(max(nums), 1),
        "latest": round(nums[-1], 1),
        "spread": round(max(nums) - min(nums), 1),
        "crossed_zero": min(nums) < 0 < max(nums),
        "n": len(nums),
        "from": vals[0][0],
        "year": year,
    }


def district_ytd_pct(snap, district):
    """A council district's YTD percent change: its precincts' counts, weighted by the
    share of the district's area each precinct covers — the same weighting the
    Council Districts tab applies to the live feed."""
    cur = pri = 0.0
    for p in district["precincts"]:
        geo = f"{p['precinct']}"
        name = next((k for k in snap if k.startswith(geo + "th ") or k.startswith(geo + "st ")
                     or k.startswith(geo + "nd ") or k.startswith(geo + "rd ")), None)
        if not name:
            continue
        c = total7(snap, name, "year_to_date", "current_year")
        q = total7(snap, name, "year_to_date", "prior_year")
        if c is None or q is None:
            continue
        cur += c * p["share"]
        pri += q * p["share"]
    return 100 * (cur - pri) / pri if pri else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "context.json"))
    args = ap.parse_args()

    print("Loading weekly snapshot archive...", flush=True)
    snaps = load_snapshots()
    if len(snaps) < 4:
        sys.exit(f"Only {len(snaps)} usable snapshots — refusing to write a context file "
                 f"that would understate volatility.")

    print("Measuring revisions...", flush=True)
    revisions = measure_revisions(snaps)
    print(f"  current year +{revisions['citywide_pct']}%  |  "
          f"prior year {revisions['prior_year_pct']:+}%", flush=True)

    print("Measuring year-to-date volatility...", flush=True)
    latest = snaps[-1][1]
    geos = [k for k in latest if k != "citywide"] + ["citywide"]
    volatility = {}
    for geo in geos:
        r = ytd_range(snaps, lambda s, g=geo: total7(s, g, "year_to_date", "pct_change"))
        if r:
            volatility[geo] = r

    districts = json.loads((ROOT / "src" / "data" / "council_districts.json").read_text())["districts"]
    district_vol = {}
    for d in districts:
        r = ytd_range(snaps, lambda s, d=d: district_ytd_pct(s, d))
        if r:
            district_vol[str(d["district"])] = r

    precinct_spreads = [v["spread"] for k, v in volatility.items()
                        if k.endswith("Precinct") and "spread" in v]
    flips = sum(1 for k, v in volatility.items()
                if k.endswith("Precinct") and v.get("crossed_zero"))

    out = {
        "generated_from": f"{len(snaps)} weekly CompStat snapshots, {snaps[0][0]} to {snaps[-1][0]}",
        "window_start": snaps[0][0],
        "window_end": snaps[-1][0],
        "n_snapshots": len(snaps),
        "revisions": revisions,
        "ytd_volatility": volatility,
        "council_ytd_volatility": district_vol,
        "summary": {
            "median_precinct_spread": round(statistics.median(precinct_spreads), 1) if precinct_spreads else None,
            "precincts_crossing_zero": flips,
            "precincts_measured": len(precinct_spreads),
        },
    }

    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=1) + "\n")
    print(f"\nWrote {dest} ({dest.stat().st_size:,} bytes)")
    print(f"  median precinct YTD spread {out['summary']['median_precinct_spread']} pts; "
          f"{flips}/{len(precinct_spreads)} precincts crossed zero")


if __name__ == "__main__":
    main()
