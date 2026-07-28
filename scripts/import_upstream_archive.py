#!/usr/bin/env python3
"""One-time import of the upstream scraper's weekly snapshot archive.

Revisions can only be measured against what the NYPD said at the time, and the workbooks are
rewritten in place — a week nobody captured is gone for good. We began archiving on
2026-07-26; the upstream scraper (joshgreenman1973/nypd-compstat-scraper) has been archiving
since 2026-03-01. Copying those earlier weeks in once is what lets us stop reading from it.

The snapshots are stored as published, deliberately untouched, with one exception. From
2026-05-24 on, the upstream archive carries a "Bronx" node holding the last combined Bronx
report (week ending 5/17/2026), because its scraper was still reading cs-en-us-pbbx.xlsx after
that command was retired. That figure is an artifact of a dead URL, not something the NYPD
published for those weeks, so a node whose own report period lags the citywide one is dropped.
Everything else is copied verbatim.

Weeks before the split keep their Bronx node — it was genuine then.

Bronx North, Bronx South and the 116th Precinct are absent from every imported week; the
upstream scraper never collected them. Their history starts with our own archive. They are
deliberately NOT synthesized from precinct counts: this directory is a record of what was
published, and that property is worth more than filling the gap.

Usage:  python3 scripts/import_upstream_archive.py [--dry-run]
"""

import argparse
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data" / "archive"
INDEX = ROOT / "data" / "index.json"
UPSTREAM = "joshgreenman1973/nypd-compstat-scraper"
BASE = f"https://raw.githubusercontent.com/{UPSTREAM}/main/data"
HEADERS = {"User-Agent": "compstat-decoder/archive-import"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ARCHIVE.mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in ARCHIVE.glob("*.json")}
    entries = sorted(fetch(f"{BASE}/index.json"), key=lambda e: e["date"])
    todo = [e for e in entries if e["date"] not in have]
    print(f"upstream has {len(entries)} snapshots; we already hold {len(have)}; "
          f"importing {len(todo)}")
    if not todo:
        return

    def one(e):
        return e["date"], fetch(f"{BASE}/{e['path']}")

    with ThreadPoolExecutor(max_workers=6) as pool:
        got = list(pool.map(one, todo))

    written = dropped = 0
    for date, snap in sorted(got):
        current = snap.get("citywide", {}).get("report_period", {}).get("week_end")
        if not current:
            print(f"  ! {date}: no citywide report period, skipping", file=sys.stderr)
            continue
        stale = [g for g, n in snap.items()
                 if isinstance(n, dict)
                 and n.get("report_period", {}).get("week_end") not in (None, current)]
        for g in stale:
            print(f"  {date}: dropping {g} "
                  f"(covers {snap[g]['report_period']['week_end']}, citywide {current})")
            del snap[g]
            dropped += 1
        if not args.dry_run:
            (ARCHIVE / f"{date}.json").write_text(
                json.dumps(snap, separators=(",", ":"), sort_keys=True) + "\n")
        written += 1

    if args.dry_run:
        print(f"\n--dry-run: would write {written} snapshots, dropping {dropped} stale nodes")
        return

    index = sorted(({"date": p.stem, "path": f"archive/{p.name}"}
                    for p in ARCHIVE.glob("*.json")), key=lambda e: e["date"])
    INDEX.write_text(json.dumps(index, indent=1) + "\n")
    print(f"\nImported {written} snapshots ({dropped} stale nodes dropped)")
    print(f"Archive now spans {index[0]['date']} .. {index[-1]['date']} ({len(index)} weeks)")


if __name__ == "__main__":
    main()
