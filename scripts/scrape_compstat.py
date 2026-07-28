#!/usr/bin/env python3
"""Build data/latest_compstat.json straight from the NYPD's weekly CompStat workbooks.

This replaces a dependency on a third-party scraper. The dashboard reads its live feed
from this file, so the only thing standing between the NYPD's published numbers and the
page is this script.

The NYPD posts one workbook per geography — citywide, each patrol borough, each precinct —
at a stable URL, rewritten in place every Monday. That layout has one sharp edge, which is
the reason this script exists: when a geography is retired, the file is not always removed.
Patrol Borough Bronx was split in two on May 20, 2026, and cs-en-us-pbbx.xlsx still answers
with HTTP 200 today, serving the last report it ever carried. A scraper that only checks for
missing files will read ten-week-old numbers and call them current. So every workbook is
checked against the citywide report period, and a lagging file is a hard error, not a shrug.

Usage:
    python3 scripts/scrape_compstat.py                 # write data/latest_compstat.json
    python3 scripts/scrape_compstat.py --compare URL   # parse, then diff against another feed
    python3 scripts/scrape_compstat.py --dry-run       # parse and report, write nothing
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "latest_compstat.json"
ARCHIVE = ROOT / "data" / "archive"
INDEX = ROOT / "data" / "index.json"
BASE = "https://www.nyc.gov/assets/nypd/downloads/excel/crime_statistics"

# nyc.gov returns 403 to a bare urllib/curl request; it wants a browser-shaped one.
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Cache-Control": "no-cache",
}

# Patrol-borough workbook slugs. Bronx North and Bronx South (pbxn/pbxs) replaced the
# combined Bronx file (pbbx) on 2026-05-20; pbbx is deliberately absent — see module docstring.
BOROUGH_FILES = {
    "Manhattan South": "pbms", "Manhattan North": "pbmn",
    "Bronx South": "pbxs", "Bronx North": "pbxn",
    "Brooklyn South": "pbbs", "Brooklyn North": "pbbn",
    "Queens South": "pbqs", "Queens North": "pbqn",
    "Staten Island": "pbsi",
}

MAJOR7 = ["Murder", "Rape", "Robbery", "Fel. Assault", "Burglary", "Gr. Larceny", "G.L.A."]
ADDITIONAL = ["Transit", "Housing", "Petit Larceny", "Retail Theft", "Misd. Assault",
              "UCR Rape*", "Other Sex Crimes", "Shooting Vic.", "Shooting Inc.",
              "Hate Crimes", "Traffic Fatalities"]

# Column letters for each reporting window: current year, prior year, percent change.
WINDOWS = {"week_to_date": ("C", "D", "E"),
           "twenty_eight_day": ("F", "G", "H"),
           "year_to_date": ("I", "J", "K")}
# Long-run percent-change columns. The header text carries the vintage ("16 Year (2010)"),
# which shifts as years pass, so the key names are read off the sheet rather than hardcoded.
LONGRUN = {"L": "2_yr_pct", "M": "16_yr_pct", "N": "33_yr_pct"}


def patrol_boroughs():
    """Read the precinct-to-borough map out of the app so the two can't drift apart.

    A second hardcoded precinct list is how the 116th Precinct went unscraped for months.
    """
    src = (ROOT / "src" / "shared.js").read_text()
    body = re.search(r"const PATROL_BOROUGHS = \{(.*?)\n\};", src, re.S).group(1)
    out = {}
    for line in body.strip().splitlines():
        m = re.match(r"\s*'([^']+)':\s*\[([0-9,\s]+)\]", line)
        if m:
            out[m.group(1)] = [int(x) for x in m.group(2).split(",") if x.strip()]
    if not out:
        raise SystemExit("Could not parse PATROL_BOROUGHS out of src/shared.js.")
    return out


def ordinal(n):
    if n % 100 in (11, 12, 13):
        return f"{n}th Precinct"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix} Precinct"


def fetch(slug, tries=3):
    url = f"{BASE}/{slug}.xlsx"
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as exc:  # noqa: PERF203
            last = exc
    raise RuntimeError(f"{slug}: {last}")


def num(cell):
    """Coerce a workbook cell to a number, or None where it genuinely has no value.

    Two things to know about these sheets. Percent cells read '***.*' where a change is
    undefined (no prior-year count to divide by) — that is a real absence, so it stays None.
    But counts are sometimes stored as text rather than numbers: every zero in the additional-
    offense rows comes through as the string '0', about 2,200 of them across the 88 workbooks.
    Treating those as missing turns "no hate crimes this week" into "no data this week", so
    anything that parses as a number is taken as one.
    """
    if isinstance(cell, (int, float)):
        return cell
    if isinstance(cell, str):
        text = cell.strip().replace(",", "")
        try:
            return float(text) if "." in text else int(text)
        except ValueError:
            return None
    return None


def parse(blob, label):
    wb = openpyxl.load_workbook(BytesIO(blob), data_only=True, read_only=True)
    ws = wb["CompStat"]
    # read_only sheets don't support random cell access, so build a row/column grid first.
    grid = {}
    for row in ws.iter_rows(min_row=1, max_row=60):
        for c in row:
            if c.value not in (None, ""):
                grid.setdefault(c.row, {})[c.column_letter] = c.value

    period_raw = next((v for r in grid.values() for v in r.values()
                       if isinstance(v, str) and "Report Covering the Week" in v), None)
    if not period_raw:
        raise ValueError(f"{label}: no report period line")
    m = re.search(r"Week\s+(\S+)\s+Through\s+(\S+)", re.sub(r"\s+", " ", period_raw))
    if not m:
        raise ValueError(f"{label}: unparseable report period {period_raw!r}")

    # Long-run column headers carry their own vintage; prefer them over the defaults.
    longrun = dict(LONGRUN)
    for r in grid.values():
        for col, val in r.items():
            if col in LONGRUN and isinstance(val, str) and "Year" in val:
                yrs = re.search(r"(\d+)\s*Year", val)
                if yrs:
                    longrun[col] = f"{yrs.group(1)}_yr_pct"

    def metric(rownum):
        rec = {}
        for window, (cur, pri, pct) in WINDOWS.items():
            rec[window] = {"current_year": num(grid[rownum].get(cur)),
                           "prior_year": num(grid[rownum].get(pri)),
                           "pct_change": num(grid[rownum].get(pct))}
        rec["historical"] = {longrun[col]: num(grid[rownum].get(col)) for col in LONGRUN}
        return rec

    out = {"source": label, "report_period": {"raw": re.sub(r"\s+", " ", period_raw).split("Week ", 1)[1],
                                              "week_start": m.group(1), "week_end": m.group(2)},
           "seven_major_felonies": {}, "additional_stats": {}}
    for rownum in sorted(grid):
        name = grid[rownum].get("A")
        if not isinstance(name, str):
            continue
        name = name.strip()
        # The historical-perspective table below repeats these row labels against a
        # different set of columns, so stop reading at its header.
        if name.lower().startswith("historical"):
            break
        if name in MAJOR7:
            out["seven_major_felonies"][name] = metric(rownum)
        elif name in ADDITIONAL:
            out["additional_stats"][name] = metric(rownum)
        elif name.upper().startswith("TOTAL"):
            out["total_seven_major"] = metric(rownum)

    missing = [c for c in MAJOR7 if c not in out["seven_major_felonies"]]
    if missing or "total_seven_major" not in out:
        raise ValueError(f"{label}: missing rows {missing or ['TOTAL']}")
    return out


def ytd7(node):
    return (node.get("total_seven_major", {}).get("year_to_date", {}) or {}).get("current_year")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    ap.add_argument("--compare", metavar="URL", help="diff the result against another feed")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    pb = patrol_boroughs()
    precincts = sorted(n for nums in pb.values() for n in nums)
    jobs = ([("citywide", "cs-en-us-city")]
            + [(b, f"cs-en-us-{slug}") for b, slug in BOROUGH_FILES.items()]
            + [(ordinal(n), f"cs-en-us-{n:03d}pct") for n in precincts])
    print(f"{len(jobs)} workbooks: 1 citywide + {len(BOROUGH_FILES)} patrol boroughs "
          f"+ {len(precincts)} precincts", flush=True)

    if set(BOROUGH_FILES) != set(pb):
        raise SystemExit(f"Borough files {sorted(BOROUGH_FILES)} don't match the app's "
                         f"patrol boroughs {sorted(pb)} — one of them is out of date.")

    data, failed, done = {}, [], 0

    def run(job):
        label, slug = job
        return label, parse(fetch(slug), label)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for fut in [pool.submit(run, j) for j in jobs]:
            done += 1
            try:
                label, node = fut.result()
                data[label] = node
            except Exception as exc:                      # noqa: BLE001
                failed.append(str(exc)[:120])
            if done % 20 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} workbooks", flush=True)

    if failed:
        print(f"\n{len(failed)} workbook(s) failed:", file=sys.stderr)
        for f in failed[:10]:
            print(f"  {f}", file=sys.stderr)
        raise SystemExit("Refusing to write a partial scrape.")

    # ---- Guard 1: staleness. A retired workbook keeps answering 200 with old numbers. ----
    current = data["citywide"]["report_period"]["week_end"]
    stale = {g: n["report_period"]["week_end"] for g, n in data.items()
             if n["report_period"]["week_end"] != current}
    if stale:
        for g, w in sorted(stale.items()):
            print(f"  ! {g} covers week ending {w}, citywide covers {current}", file=sys.stderr)
        raise SystemExit(f"{len(stale)} workbook(s) lag the citywide report — refusing to write. "
                         "If the NYPD reorganized a command, update BOROUGH_FILES and "
                         "PATROL_BOROUGHS in src/shared.js.")

    # ---- Guard 2: the parts must account for the whole. ----
    city = ytd7(data["citywide"])
    boro_sum = sum(ytd7(data[b]) for b in BOROUGH_FILES)
    pct_sum = sum(ytd7(data[ordinal(n)]) for n in precincts)
    print(f"\n  Report covering the week ending {current}")
    print(f"  citywide 7-major YTD:     {city:,}")
    print(f"  patrol boroughs sum to:   {boro_sum:,}  ({boro_sum - city:+,})")
    print(f"  precincts sum to:         {pct_sum:,}  ({pct_sum - city:+,})")
    if boro_sum != city:
        print(f"  ! patrol boroughs don't reconcile to citywide — a command may be missing",
              file=sys.stderr)
    if pct_sum != city:
        # Known and expected: the NYPD counts some complaints for a borough command that it
        # charges to none of that borough's precincts. Reported, not treated as an error.
        print(f"  note: {city - pct_sum:,} complaints counted citywide but in no precinct file")

    if args.compare:
        with urllib.request.urlopen(urllib.request.Request(args.compare, headers=HEADERS)) as r:
            other = json.load(r)
        shared = sorted(set(data) & set(other))
        print(f"\n  comparing {len(shared)} shared geographies against {args.compare}")
        diffs = [(g, ytd7(other[g]), ytd7(data[g])) for g in shared
                 if ytd7(other[g]) != ytd7(data[g])]
        for g, a, b in diffs:
            print(f"    {g}: theirs {a:,} vs ours {b:,} ({b - a:+,})")
        print(f"    {len(shared) - len(diffs)}/{len(shared)} identical")
        for g in sorted(set(data) - set(other)):
            print(f"    only ours: {g} ({ytd7(data[g]):,})")
        for g in sorted(set(other) - set(data)):
            print(f"    only theirs: {g}")

    if args.dry_run:
        print("\n  --dry-run: nothing written")
        return

    OUT.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"\nWrote {OUT} ({OUT.stat().st_size:,} bytes, {len(data)} geographies)")

    # Keep a dated copy of every week as published. Revisions can only be measured against
    # what the NYPD said at the time, and that record exists nowhere else — the workbooks are
    # rewritten in place, so a week not archived on the day is gone.
    mm, dd, yyyy = current.split("/")
    stamp = f"{yyyy}-{int(mm):02d}-{int(dd):02d}"
    snap = ARCHIVE / f"{stamp}.json"
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    if snap.exists():
        print(f"  archive already holds {stamp}")
    else:
        snap.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True) + "\n")
        print(f"  archived {snap.relative_to(ROOT)}")
    index = sorted(({"date": f.stem, "path": f"archive/{f.name}"} for f in ARCHIVE.glob("*.json")),
                   key=lambda e: e["date"])
    INDEX.write_text(json.dumps(index, indent=1) + "\n")
    print(f"  index lists {len(index)} weekly snapshot(s)")


if __name__ == "__main__":
    main()
