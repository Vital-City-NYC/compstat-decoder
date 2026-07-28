#!/usr/bin/env python3
"""Archive NYPD CompStat 2.0's weekly counts into data/weekly_series/.

The weekly CompStat workbooks the dashboard runs on carry only week-to-date, 28-day and
year-to-date snapshots — no week-by-week series. The CompStat 2.0 dashboard does have
one, behind an undocumented JSON API, and it is the only CompStat-sourced way to build
a rolling twelve-month view. This script pulls it and merges it into a master file.

Two request kinds per metric and geography:
    WTD_COMPLAINTS_<metric>       the trailing 53 weeks
    SPLYWTD_COMPLAINTS_<metric>   the 53 weeks before those

Together they give about two years of weekly counts in a single run, so a missed week is
recoverable rather than lost. The archive still matters: the endpoint only ever exposes
that trailing window, so anything older than ~106 weeks survives only if we kept it.

    python3 scripts/archive_weekly_series.py              # 7 majors + total, all geos
    python3 scripts/archive_weekly_series.py --all-metrics
    python3 scripts/archive_weekly_series.py --geos Citywide 075
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API = "https://compstat.nypdonline.org/api/reports/{rid}/data"
TIMELINE = "82155271-ff46-4ff5-aa97-26fb7ed5ba8f"   # "Timeline - 52 Week"
BOOK = "b805fa11-d5d2-43f7-8c23-1649f5d387f1"       # "CompStat Book" (metric list)

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Referer": "https://compstat.nypdonline.org/",
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
}

# The dashboard's own abbreviations. Defaults cover what the site actually plots.
CORE_METRICS = ["Murder", "Rape", "Robbery", "Fel. Assault", "Burglary", "Gr. Larceny",
                "G.L.A.", "TotalMajor7", "Sht. Inc.", "Sht. Vic."]
EXTRA_METRICS = ["PSB", "Transit", "Housing", "Rape 1", "Other Sex Crimes",
                 "Petit Larceny", "Misd. Assault", "Hate Crimes", "Total Fatalities"]

ROOT = Path(__file__).resolve().parent.parent
OUTDIR = ROOT / "data" / "weekly_series"
ROLLUP = ROOT / "data" / "rolling.json"

# The dashboard's metric names, keyed by the archive's.
MAJOR_MAP = {"Murder": "Murder", "Rape": "Rape", "Robbery": "Robbery",
             "Fel. Assault": "Fel. Assault", "Burglary": "Burglary",
             "Gr. Larceny": "Gr. Larceny", "G.L.A.": "G.L.A."}
ADDITIONAL_MAP = {"Transit": "Transit", "Housing": "Housing", "Petit Larceny": "Petit Larceny",
                  "Misd. Assault": "Misd. Assault", "Hate Crimes": "Hate Crimes",
                  "Other Sex Crimes": "Other Sex Crimes", "Rape 1": "UCR Rape*",
                  "Sht. Vic.": "Shooting Vic.", "Sht. Inc.": "Shooting Inc.",
                  "Total Fatalities": "Traffic Fatalities"}


def ordinal_precinct(n):
    if n % 100 in (11, 12, 13):
        return f"{n}th Precinct"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') } Precinct"


def patrol_boroughs():
    """Read the precinct-to-borough map out of the app rather than restating it here, so the
    two can't drift apart."""
    src = (ROOT / "src" / "shared.js").read_text()
    body = re.search(r"const PATROL_BOROUGHS = \{(.*?)\n\};", src, re.S).group(1)
    out = {}
    for line in body.strip().splitlines():
        m = re.match(r"\s*'([^']+)':\s*\[([0-9,\s]+)\]", line)
        if m:
            out[m.group(1)] = [int(x) for x in m.group(2).split(",") if x.strip()]
    if sum(len(v) for v in out.values()) != 77:
        raise SystemExit("Could not parse all 77 precincts out of PATROL_BOROUGHS.")
    return out


def write_rollup(master, coverage):
    """Precompute the 52-week window into a small file the browser can read instantly.

    The weekly archive is ~1.8MB, far too heavy for a view that now loads by default, and
    the page must never render year-to-date figures under a 52-week headline while it
    waits. Summing here means the browser fetches ~60KB of finished numbers instead."""
    dense = master.get("Citywide", {}).get("TotalMajor7", {})
    weeks = sorted(dense)
    if len(weeks) < 104:
        print(f"  only {len(weeks)} weeks — need 104 for a rolling comparison; skipping rollup")
        return
    cur_weeks, pri_weeks = weeks[-52:], weeks[-104:-52]

    def node(series):
        # A week missing inside the covered range had a count of zero; the API omits zeros.
        cur = sum(series.get(w, 0) for w in cur_weeks)
        pri = sum(series.get(w, 0) for w in pri_weeks)
        pct = round((cur - pri) / pri * 100, 3) if pri else None
        # Only year_to_date is read in the rolling view (the app routes every non-weekly
        # window through that node), so the other two are omitted rather than triplicated.
        return {"year_to_date": {"current_year": cur, "prior_year": pri, "pct_change": pct},
                "historical": {}}

    def build(metrics):
        rec = {"seven_major_felonies": {}, "additional_stats": {}}
        for metric, weekly in metrics.items():
            if metric in MAJOR_MAP:
                rec["seven_major_felonies"][MAJOR_MAP[metric]] = node(weekly)
            elif metric in ADDITIONAL_MAP:
                rec["additional_stats"][ADDITIONAL_MAP[metric]] = node(weekly)
            elif metric == "TotalMajor7":
                rec["total_seven_major"] = node(weekly)
        return rec

    out = {"_rolling": {"current_from": cur_weeks[0], "current_to": cur_weeks[-1],
                        "prior_from": pri_weeks[0], "prior_to": pri_weeks[-1],
                        "weeks": len(cur_weeks), "coverage": coverage}}
    for archive_key, metrics in master.items():
        geo = "citywide" if archive_key == "Citywide" else ordinal_precinct(int(archive_key))
        out[geo] = build(metrics)

    # Boroughs are exactly the union of their precincts — verified against NYPD's own
    # borough files, and the reason this view is immune to a stale borough workbook.
    for boro, nums in patrol_boroughs().items():
        acc = {}
        for n in nums:
            for metric, weekly in master.get(f"{n:03d}", {}).items():
                tally = acc.setdefault(metric, {})
                for w, v in weekly.items():
                    tally[w] = tally.get(w, 0) + v
        out[boro] = build(acc)

    ROLLUP.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True) + "\n")
    cw = out["citywide"]["total_seven_major"]["year_to_date"]
    print(f"\nWrote {ROLLUP} ({ROLLUP.stat().st_size:,} bytes)")
    print(f"  citywide 7-major: {cw['current_year']:,} vs {cw['prior_year']:,} "
          f"({cw['pct_change']:+.2f}%)  [{cur_weeks[0]}..{cur_weeks[-1]}]")


def post(rid, body, tries=4):
    data = json.dumps(body).encode()
    for attempt in range(tries):
        try:
            req = urllib.request.Request(API.format(rid=rid), data=data, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    return []


def body_for(precinct, record_id):
    return [
        {"key": "PRECINCTKey", "values": [precinct]},
        {"key": "BOROKey", "values": ["Citywide"]},
        {"key": "RECORDID", "values": [record_id]},
    ]


def iso_week(label):
    """'07/19/26' -> '2026-07-19'. The API's MM/DD/YY labels sort wrongly as strings, and
    the archive spans three calendar years, so keys are normalised on the way in."""
    try:
        m, d, y = label.split("/")
        return f"20{int(y):02d}-{int(m):02d}-{int(d):02d}"
    except (ValueError, AttributeError):
        return None


def series(precinct, record_id):
    """-> {week_ending_iso: count}. Values arrive in itemValue; metric is always null."""
    rows = post(TIMELINE, body_for(precinct, record_id))
    out = {}
    for r in rows:
        week, val = iso_week(r.get("categoryLabel")), r.get("itemValue")
        if week and isinstance(val, (int, float)):
            out[week] = val
    return out


def all_precinct_keys():
    """Precinct keys are zero-padded to three digits ('075', never '75')."""
    from_book = post(BOOK, body_for("Citywide", None))
    if not from_book:
        raise SystemExit("CompStat Book returned nothing — the API contract may have changed.")
    nums = [1, 5, 6, 7, 9, 10, 13, 14, 17, 18, 19, 20, 22, 23, 24, 25, 26, 28, 30, 32, 33,
            34, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 60, 61, 62, 63, 66, 67, 68,
            69, 70, 71, 72, 73, 75, 76, 77, 78, 79, 81, 83, 84, 88, 90, 94, 100, 101, 102,
            103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 120, 121, 122, 123]
    return ["Citywide"] + [f"{n:03d}" for n in nums]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all-metrics", action="store_true", help="include the 9 secondary metrics")
    ap.add_argument("--geos", nargs="*", help="limit to these precinct keys (e.g. Citywide 075)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    metrics = CORE_METRICS + (EXTRA_METRICS if args.all_metrics else [])
    geos = args.geos or all_precinct_keys()
    jobs = [(g, m, pre) for g in geos for m in metrics for pre in ("WTD", "SPLYWTD")]
    print(f"{len(geos)} geographies x {len(metrics)} metrics x 2 windows = {len(jobs)} requests",
          flush=True)

    OUTDIR.mkdir(parents=True, exist_ok=True)
    master_path = OUTDIR / "master.json"
    if master_path.exists():
        loaded = json.loads(master_path.read_text())
        master = loaded.get("series", {})
        coverage = loaded.get("coverage", {})
    else:
        master, coverage = {}, {}
    before = sum(len(v) for g in master.values() for v in g.values())

    fresh, failed, done = {}, [], 0

    def run(job):
        geo, metric, prefix = job
        return job, series(geo, f"{prefix}_COMPLAINTS_{metric}")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run, j): j for j in jobs}
        for fut in as_completed(futures):
            done += 1
            try:
                (geo, metric, _), data = fut.result()
            except Exception as exc:                      # noqa: BLE001 - report and continue
                failed.append((futures[fut], str(exc)[:80]))
                continue
            if data:
                fresh.setdefault(geo, {}).setdefault(metric, {}).update(data)
            if done % 100 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} requests", flush=True)

    if failed:
        print(f"\n{len(failed)} request(s) failed:", file=sys.stderr)
        for job, err in failed[:10]:
            print(f"  {job}: {err}", file=sys.stderr)

    # Refuse to overwrite a good archive with a broken scrape.
    if len(fresh) < len(geos) * 0.8:
        sys.exit(f"Only {len(fresh)}/{len(geos)} geographies returned data — "
                 f"not merging. Check whether the API contract changed.")

    for geo, metrics_got in fresh.items():
        for metric, weeks in metrics_got.items():
            master.setdefault(geo, {}).setdefault(metric, {}).update(weeks)

    for geo in master:
        for metric in master[geo]:
            master[geo][metric] = dict(sorted(master[geo][metric].items()))

    # The API omits weeks with a count of zero rather than returning 0, so a missing week
    # inside the covered range means "none that week" while one outside it means "never
    # pulled". Only this range makes the two distinguishable, so it has to be recorded.
    dense = master.get("Citywide", {}).get("TotalMajor7", {})
    if dense:
        weeks = sorted(dense)
        coverage = {
            "from": min(weeks[0], coverage.get("from", weeks[0])),
            "to": max(weeks[-1], coverage.get("to", weeks[-1])),
            "note": ("Weeks absent from a series inside this range had a count of zero; "
                     "the API omits zero weeks. Weeks outside it were never collected."),
        }

    master_path.write_text(json.dumps(
        {"coverage": coverage, "series": master}, separators=(",", ":"), sort_keys=True) + "\n")
    after = sum(len(v) for g in master.values() for v in g.values())

    print(f"\nWrote {master_path} ({master_path.stat().st_size:,} bytes)")
    print(f"  {before:,} -> {after:,} geo-metric-week observations (+{after - before:,})")
    print(f"  coverage: {coverage.get('from')} .. {coverage.get('to')}")
    if dense:
        print(f"  citywide TotalMajor7: {len(dense)} weeks (dense series)")

    write_rollup(master, coverage)


if __name__ == "__main__":
    main()
