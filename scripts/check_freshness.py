#!/usr/bin/env python3
"""Fail when WE are behind the NYPD. Stay quiet when the NYPD simply hasn't posted.

WHAT CHANGED AND WHY (2026-09-02). This guard used to ask "how old is the data?"
That question cannot tell the two situations apart, and they need opposite
responses:

    the NYPD published and we missed it   -> our bug, page someone
    the NYPD published nothing            -> a holiday, page no one

An age threshold conflates them, so it had to be set loose enough to survive
Labor Day and was therefore too loose to catch a real stall quickly. Worse, the
first Monday of September — the day the monthly email cycle keys off — is ALWAYS
Labor Day, so the fragile case recurs annually by construction.

The prober records what each source HAD against what we were SERVING, so the
honest question is answerable directly: are we behind, and for how long? Upstream
silence no longer trips anything here. It surfaces as the prober's `late` flag,
which files a notice rather than an alarm.

The old absolute-age gates are deliberately gone. Do not reintroduce them: the
workbook age resets every Monday, so a permanently dead feed never trips a test
written that way, which was the original hole this file was created to close.
The ledger closes it properly — a dead feed shows as `behind` forever.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# How long we tolerate being behind a source before calling it a failure. The
# prober runs hourly, so a normal catch-up is under an hour; this is slack for a
# delayed runner or a single dropped scheduled run, not for a broken pipeline.
BEHIND_GRACE_HOURS = 6

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "source_observations.jsonl"


def parse_t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    if not LEDGER.exists():
        print("No observation ledger yet — nothing to check. "
              "scripts/probe_sources.py creates it.")
        return 0
    rows = [json.loads(ln) for ln in LEDGER.read_text().splitlines() if ln.strip()]
    if not rows:
        print("Ledger is empty — nothing to check.")
        return 0

    now = datetime.now(timezone.utc)
    latest = rows[-1]
    print(f"workbooks  NYPD {latest['wb_avail']}   we serve {latest['wb_served']}")
    print(f"timeline   NYPD {latest['api_avail']}   we serve {latest['api_served']}")

    problems = []
    for label, avail_k, served_k in (("workbooks", "wb_avail", "wb_served"),
                                     ("rolling series", "api_avail", "api_served")):
        avail, served = latest.get(avail_k), latest.get(served_k)
        if not avail or avail == served:
            continue
        # How long has this exact gap stood? Walk back to the first row where the
        # source already had `avail` while we were not yet serving it.
        since = parse_t(latest["t"])
        for r in reversed(rows):
            if r.get(avail_k) == avail and r.get(served_k) != avail:
                since = parse_t(r["t"])
            else:
                break
        hours = (now - since).total_seconds() / 3600
        print(f"  ! {label}: behind since {since:%Y-%m-%d %H:%MZ} ({hours:.1f}h)")
        if hours > BEHIND_GRACE_HOURS:
            problems.append(f"{label}: the NYPD has {avail}, we serve {served}, "
                            f"unresolved for {hours:.1f}h (grace {BEHIND_GRACE_HOURS}h)")

    if problems:
        sys.exit("BEHIND THE NYPD:\n  " + "\n  ".join(problems) +
                 "\nThe data exists upstream and we are not serving it. This is ours.")
    print("in sync with both sources")
    return 0


if __name__ == "__main__":
    sys.exit(main())
