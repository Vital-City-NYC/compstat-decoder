#!/usr/bin/env python3
"""How long after the NYPD published did we start serving it?

Reads data/source_observations.jsonl and separates the two lags that were
previously tangled together and therefore unmanageable:

    NYPD LAG  week ends Sunday -> the NYPD publishes it.   Not ours. Context only.
    OUR LAG   the NYPD publishes it  -> our feed serves it. OURS. The number to
                                                            drive toward zero.

Only OUR LAG is a performance figure. Reporting the two as one total is how a
holiday looks like a pipeline failure.

COLD START. A week already being served when the ledger opens is LEFT-CENSORED:
the first row proves we served it by then, not that we started then. Counting
that gap as our lag would invent a large fake number out of the ledger's own
birthday. Such weeks are marked (pre-existing) and excluded from the summary.

PRECISION, because the two sources are not equally knowable:
  * workbooks — exact. nyc.gov returns Last-Modified, which is the publication
    time itself, so our lag is a real measurement.
  * timeline API — an UPPER BOUND. No such header, so the earliest we can prove
    it existed is the first probe that saw it. True lag is up to one probe
    interval smaller, and the report labels it '<=' rather than pretending.

Usage:
    python3 scripts/lag_report.py            # table + summary
    python3 scripts/lag_report.py --json     # machine-readable, for the digest
"""
import argparse
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "source_observations.jsonl"


def parse_t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def humanise(delta):
    if delta is None:
        return "—"
    secs = delta.total_seconds()
    sign = "-" if secs < 0 else ""
    secs = abs(secs)
    d, rem = divmod(int(secs), 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{sign}{d}d {h}h"
    if h:
        return f"{sign}{h}h {m}m"
    return f"{sign}{m}m"


def transitions(rows, avail_key, served_key):
    """-> {week: {'avail_at':t, 'served_at':t}} first time each side reached a week."""
    seen = {}
    for r in rows:
        for kind, key in (("avail_at", avail_key), ("served_at", served_key)):
            wk = r.get(key)
            if wk:
                seen.setdefault(wk, {}).setdefault(kind, parse_t(r["t"]))
    return seen


def published_times(rows):
    """-> {workbook week: NYPD Last-Modified}, the exact publication instant."""
    out = {}
    for r in rows:
        wk, pub = r.get("wb_avail"), r.get("wb_published")
        if wk and pub:
            out.setdefault(wk, parse_t(pub))
    return out


def build(rows):
    wb = transitions(rows, "wb_avail", "wb_served")
    api = transitions(rows, "api_avail", "api_served")
    pub = published_times(rows)
    t0 = parse_t(rows[0]["t"])   # anything true at t0 was true for an unknown while
    weeks = sorted(set(wb) | set(api))
    recs = []
    for wk in weeks:
        week_end = datetime.strptime(wk, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        w, a = wb.get(wk, {}), api.get(wk, {})

        # Workbook: publication time is known exactly when we have the header.
        wb_pub = pub.get(wk) or w.get("avail_at")
        wb_exact = wk in pub
        wb_censored = w.get("served_at") == t0
        wb_ours = (None if wb_censored else
                   (w["served_at"] - wb_pub) if (w.get("served_at") and wb_pub) else None)

        # API: earliest provable existence is the first probe that saw it.
        api_seen = a.get("avail_at")
        api_censored = a.get("served_at") == t0
        api_ours = (None if api_censored else
                    (a["served_at"] - api_seen) if (a.get("served_at") and api_seen) else None)

        recs.append({
            "week_ending": wk,
            "wb_published": wb_pub, "wb_exact": wb_exact,
            "wb_nypd_lag": (wb_pub - week_end) if wb_pub else None,
            "wb_our_lag": wb_ours, "wb_censored": wb_censored,
            "api_first_seen": api_seen,
            "api_nypd_lag": (api_seen - week_end) if api_seen else None,
            "api_our_lag": api_ours, "api_censored": api_censored,
        })
    return recs


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not LEDGER.exists():
        print("No observations yet. The prober writes data/source_observations.jsonl; "
              "give it a few cycles.", file=sys.stderr)
        return 1
    rows = [json.loads(ln) for ln in LEDGER.read_text().splitlines() if ln.strip()]
    recs = build(rows)

    if args.json:
        print(json.dumps([{k: (humanise(v) if hasattr(v, "total_seconds")
                               else (v.isoformat().replace("+00:00", "Z")
                                     if isinstance(v, datetime) else v))
                           for k, v in r.items()} for r in recs], indent=2))
        return 0

    span = f"{rows[0]['t'][:10]} .. {rows[-1]['t'][:10]}" if rows else "—"
    print(f"CompStat pipeline lag — {len(rows)} observations, {span}\n")
    print(f"{'week ending':<13} {'NYPD posted wb':<17} {'our lag (wb)':<14} "
          f"{'API seen':<17} {'our lag (API)':<14}")
    print("-" * 78)
    for r in recs:
        pubs = (r["wb_published"].strftime("%a %m/%d %H:%MZ") if r["wb_published"] else "—")
        if r["wb_published"] and not r["wb_exact"]:
            pubs = "<=" + pubs
        seen = (r["api_first_seen"].strftime("%a %m/%d %H:%MZ") if r["api_first_seen"] else "—")
        wbl = "pre-existing" if r["wb_censored"] else humanise(r["wb_our_lag"])
        apl = ("pre-existing" if r["api_censored"] else
               "<=" + humanise(r["api_our_lag"]) if r["api_our_lag"] else "—")
        print(f"{r['week_ending']:<13} {pubs:<17} {wbl:<14} {seen:<17} {apl:<14}")

    def summarise(key, label, bound=""):
        vals = [r[key].total_seconds() for r in recs if r.get(key) is not None]
        if not vals:
            return None
        return (f"OUR lag, {label} (n={len(vals)}): median {bound}"
                f"{humanise(timedelta(seconds=statistics.median(vals)))}, "
                f"worst {bound}{humanise(timedelta(seconds=max(vals)))}")

    print()
    lines = [summarise("wb_our_lag", "workbooks"),
             summarise("api_our_lag", "timeline API", bound="<=")]
    if any(lines):
        for ln in lines:
            if ln:
                print(ln)
    else:
        print("No measured week yet: a week needs a publication AND a later serve "
              "observation, both inside the ledger. Accumulates from here.")

    nypd = [r["wb_nypd_lag"].total_seconds() for r in recs if r.get("wb_nypd_lag")]
    if nypd:
        print(f"NYPD's own lag, for context only (n={len(nypd)}): median "
              f"{humanise(timedelta(seconds=statistics.median(nypd)))} after the week "
              f"closes — theirs, not ours.")

    censored = [r["week_ending"] for r in recs if r["wb_censored"] or r["api_censored"]]
    if censored:
        print(f"Excluded as pre-existing at ledger start (lag unknowable): "
              f"{', '.join(censored)}")
    incomplete = [r["week_ending"] for r in recs if r["wb_our_lag"] is None
                  and not r["wb_censored"] and r["wb_published"] is not None]
    if incomplete:
        print(f"In flight (published, not yet served): {', '.join(incomplete)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
