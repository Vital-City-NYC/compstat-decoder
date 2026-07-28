#!/usr/bin/env python3
"""Compare our feed against the upstream scraper's — a canary, never a gate.

We read the NYPD's workbooks ourselves now, so nothing depends on this. But a second
independent parse of the same source is a cheap way to notice that something moved: a changed
column layout, a renamed file, a workbook the NYPD reformatted. When two scrapers written
months apart by different people still agree to the digit, both are probably reading it right.
When they stop agreeing, one of them is wrong and it's worth knowing which.

Only geographies present in both are compared, and only when both feeds cover the same week —
the two run on different days, so a mismatched report period means "not comparable", not
"broken". Differences we already understand are listed and excused: the upstream feed has no
Bronx North, Bronx South or 116th Precinct, and carries a "Bronx" node frozen at the last
pre-split report.

Exit status is 0 unless --strict is passed, so this can run in CI without ever blocking a
data update on somebody else's pipeline.

Usage:  python3 scripts/crosscheck_upstream.py [--strict]
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OURS = ROOT / "data" / "latest_compstat.json"
UPSTREAM_URL = ("https://raw.githubusercontent.com/joshgreenman1973/"
                "nypd-compstat-scraper/main/data/latest_compstat.json")
HEADERS = {"User-Agent": "compstat-decoder/crosscheck"}

# Coverage gaps we already understand, so they read as known rather than as drift. The
# upstream scraper closed all of these in July 2026, so both sets are normally empty now;
# they stay listed because a gap reopening is worth recognising rather than re-diagnosing.
EXPECTED_ONLY_OURS = {"Bronx North", "Bronx South", "116th Precinct"}
EXPECTED_ONLY_THEIRS = {"Bronx"}

WINDOWS = ["week_to_date", "twenty_eight_day", "year_to_date"]


def values(node):
    """Flatten a geography into {(group, offense, window, field): value} for comparison."""
    out = {}
    for group in ("seven_major_felonies", "additional_stats"):
        for offense, metric in (node.get(group) or {}).items():
            for window in WINDOWS:
                for field in ("current_year", "prior_year"):
                    out[(group, offense, window, field)] = (metric.get(window) or {}).get(field)
    for window in WINDOWS:
        for field in ("current_year", "prior_year"):
            out[("total", "TOTAL", window, field)] = (
                (node.get("total_seven_major") or {}).get(window) or {}).get(field)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero if the feeds disagree on a shared geography")
    args = ap.parse_args()

    if not OURS.exists():
        raise SystemExit(f"{OURS} not found — run scripts/scrape_compstat.py first.")
    ours = json.loads(OURS.read_text())
    try:
        with urllib.request.urlopen(
                urllib.request.Request(UPSTREAM_URL, headers=HEADERS), timeout=60) as r:
            theirs = json.load(r)
    except Exception as exc:                              # noqa: BLE001
        print(f"Upstream feed unreachable ({str(exc)[:100]}) — nothing to compare against.")
        return 0

    our_week = ours["citywide"]["report_period"]["week_end"]
    their_week = theirs.get("citywide", {}).get("report_period", {}).get("week_end")
    print(f"ours covers week ending {our_week}; upstream covers {their_week}")
    if our_week != their_week:
        print("Different weeks — the two pipelines run on different days. Not comparable; "
              "no conclusion drawn.")
        return 0

    shared = sorted(set(ours) & set(theirs))
    drift = []
    for geo in shared:
        a, b = values(theirs[geo]), values(ours[geo])
        bad = [k for k in set(a) & set(b) if a[k] != b[k]]
        if bad:
            drift.append((geo, len(bad), sorted(bad)[:3], a, b))

    print(f"compared {len(shared)} shared geographies across "
          f"{len(values(ours['citywide']))} figures each")

    only_ours = set(ours) - set(theirs)
    only_theirs = set(theirs) - set(ours)
    for label, got, known in (("only ours", only_ours, EXPECTED_ONLY_OURS),
                              ("only upstream", only_theirs, EXPECTED_ONLY_THEIRS)):
        if not got:
            print(f"  {label}: none — both feeds cover the same geographies")
        elif got <= known:
            print(f"  {label}: {sorted(got)} (known gap)")
        else:
            print(f"  ! {label}: {sorted(got)} — {sorted(got - known)} is new and unexplained")

    if not drift:
        print("\nNo drift: every shared figure matches to the digit.")
        return 0

    print(f"\n! {len(drift)} geograph{'y' if len(drift) == 1 else 'ies'} disagree:",
          file=sys.stderr)
    for geo, n, sample, a, b in drift[:10]:
        print(f"  {geo}: {n} figure(s) differ", file=sys.stderr)
        for k in sample:
            print(f"    {'/'.join(map(str, k))}: upstream {a[k]!r} vs ours {b[k]!r}",
                  file=sys.stderr)
    print("\nBoth read the same NYPD workbooks, so one of the two parses is wrong — or the "
          "NYPD revised the files between the two runs. Check before trusting either.",
          file=sys.stderr)
    return 1 if args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
