#!/usr/bin/env python3
"""Ask both NYPD sources what they have, cheaply, and write down the answer.

WHY THIS EXISTS. The pipeline used to fire on a guess about the NYPD's schedule —
Monday 2pm for the workbooks, and slots that never once caught the timeline API.
A guess cannot survive Labor Day, and it produced no evidence about how late we
actually were. This probe replaces the guess with a measurement: it costs one
HEAD, one 27KB GET and one API POST, so it can run hourly, and every run records
what each source HAD against what we were SERVING at that moment.

That ledger (data/source_observations.jsonl) is the whole point. From it,
scripts/lag_report.py derives the number worth managing:

    OUR LAG = when our data started serving week W
            - when the NYPD published week W

not the NYPD's own lag, which we do not control. The workbook side is measured
exactly, because nyc.gov returns a Last-Modified header that IS the publication
time (verified 2026-08-31: Mon 16:38:11 GMT for the week ending 8/30). The API
side has no such header, so it is bracketed by the probe interval and reported
as an upper bound.

Two flags come out of this, and keeping them apart is the design:

    behind=1   the source has a week we are not serving. OUR problem, actionable.
    late=1     the source itself has published nothing new in a long time. The
               NYPD's problem — a holiday, usually. Not a pipeline failure, and
               it must not page anyone as if it were.

Exit status is always 0 unless the probe itself broke. A probe that cannot tell
you what it found is the only real failure here.
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "source_observations.jsonl"

WORKBOOK = ("https://www.nyc.gov/assets/nypd/downloads/excel/crime_statistics/"
            "cs-en-us-city.xlsx")
API = "https://compstat.nypdonline.org/api/reports/{rid}/data"
TIMELINE = "82155271-ff46-4ff5-aa97-26fb7ed5ba8f"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Referer": "https://compstat.nypdonline.org/",
    # nyc.gov 403s a bare urllib UA, so both hosts get a browser string.
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
}

# A heartbeat row lands even when nothing moved, so a silent prober is visible in
# the ledger as a gap rather than as an indistinguishable run of quiet days.
HEARTBEAT_HOURS = 24

# How long a source may go without publishing before we say the NYPD is late.
# Deliberately generous: a normal week is 7 days end-to-end, Labor Day and the
# Thanksgiving/Christmas weeks push past 8, and none of that is a pipeline fault.
LATE_AFTER_DAYS = 11


def iso(mdy):
    """'8/30/2026' or '08/30/26' -> '2026-08-30'."""
    if not mdy:
        return None
    m, d, y = str(mdy).strip().split("/")
    y = int(y)
    return f"{2000 + y if y < 100 else y:04d}-{int(m):02d}-{int(d):02d}"


def workbook_state():
    """-> (week_end_iso, published_utc_iso). Last-Modified is the NYPD's own clock."""
    req = urllib.request.Request(WORKBOOK, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        lastmod = r.headers.get("Last-Modified")
    published = None
    if lastmod:
        try:
            published = (datetime.strptime(lastmod, "%a, %d %b %Y %H:%M:%S %Z")
                         .replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"))
        except ValueError:
            published = None
    ws = openpyxl.load_workbook(io.BytesIO(raw), data_only=True).worksheets[0]
    for row in ws.iter_rows(max_row=12, values_only=True):
        for v in row:
            if isinstance(v, str) and "Report Covering the Week" in v:
                m = re.search(r"Week\s+(\S+)\s+Through\s+(\S+)", re.sub(r"\s+", " ", v))
                if m:
                    return iso(m.group(2)), published
    raise ValueError("citywide workbook: no report period line")


def api_state():
    """-> newest week ending in the timeline API, ISO."""
    body = [{"key": "PRECINCTKey", "values": ["Citywide"]},
            {"key": "BOROKey", "values": ["Citywide"]},
            {"key": "RECORDID", "values": ["WTD_COMPLAINTS_TotalMajor7"]}]
    req = urllib.request.Request(API.format(rid=TIMELINE),
                                 data=json.dumps(body).encode(), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as r:
        rows = json.load(r)
    weeks = sorted(w for w in (iso(x.get("categoryLabel")) for x in rows) if w)
    return weeks[-1] if weeks else None


def served_state():
    """-> (workbook week we serve, rolling week we serve), from the committed feed."""
    wb = json.loads((ROOT / "data/latest_compstat.json").read_text())
    wb_week = iso(wb["citywide"]["report_period"]["week_end"])
    roll = json.loads((ROOT / "data/rolling.json").read_text())["_rolling"]["current_to"]
    return wb_week, roll


def read_ledger():
    if not LEDGER.exists():
        return []
    return [json.loads(ln) for ln in LEDGER.read_text().splitlines() if ln.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interval-hours", type=float, default=1.0,
                    help="probe cadence, recorded so lag_report can state its resolution")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    wb_avail, wb_published = workbook_state()
    api_avail = api_state()
    wb_served, api_served = served_state()

    row = {"t": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
           "wb_avail": wb_avail, "wb_published": wb_published, "wb_served": wb_served,
           "api_avail": api_avail, "api_served": api_served,
           "probe_h": args.interval_hours}

    print(f"workbooks  NYPD has {wb_avail}  (posted {wb_published or 'unknown'})   we serve {wb_served}")
    print(f"timeline   NYPD has {api_avail}                            we serve {api_served}")

    behind = (wb_avail and wb_avail != wb_served) or (api_avail and api_avail != api_served)

    # "Late" is about the SOURCE, not about us: nothing new upstream for a long time.
    newest = max(d for d in (wb_avail, api_avail) if d)
    source_age = (now - datetime.strptime(newest, "%Y-%m-%d").replace(tzinfo=timezone.utc)).days
    late = source_age > LATE_AFTER_DAYS

    if behind:
        print(f"  -> BEHIND: a source has moved on and we have not. Running the pipeline.")
    else:
        print("  -> in sync with both sources.")
    if late:
        print(f"  -> NYPD LATE: newest week anywhere is {newest}, {source_age} days old "
              f"(limit {LATE_AFTER_DAYS}). Upstream, not us.")

    prior = read_ledger()
    last = prior[-1] if prior else None
    changed = last is None or any(last.get(k) != row.get(k) for k in
                                  ("wb_avail", "wb_published", "wb_served",
                                   "api_avail", "api_served"))
    stale_heartbeat = last is not None and (
        now - datetime.fromisoformat(last["t"].replace("Z", "+00:00"))
    ) >= timedelta(hours=HEARTBEAT_HOURS)

    if (changed or stale_heartbeat) and not args.dry_run:
        row["why"] = "change" if changed else "heartbeat"
        with LEDGER.open("a") as fh:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")
        print(f"  ledger += 1 row ({row['why']}); {len(prior) + 1} total")
    else:
        print("  ledger unchanged (no movement, heartbeat not due)")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(f"behind={'1' if behind else '0'}\n")
            fh.write(f"late={'1' if late else '0'}\n")
            fh.write(f"newest={newest}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
