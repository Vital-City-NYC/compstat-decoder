#!/usr/bin/env python3
"""Decide whether today's scheduled pre-flight or send should run, and slide the
cycle a day when the NYPD has not posted.

The monthly cycle keys off the first Monday of the month: pre-flight Monday, send
Tuesday. When the week that ended on Sunday has not arrived by the time the Monday
pre-flight runs, the whole cycle slides one day: pre-flight Tuesday, send Wednesday.
Labor Day is ALWAYS the first Monday of September; Jan 1 and Jul 4 land there some
years; and the NYPD is occasionally just late. The test is therefore the data, not
a holiday calendar: "is the week ending yesterday being served?"

The send only ever runs the day after a digest was mailed, and only against the same
week of data the reviewers saw. data/cycle_state.json carries that handshake; the
pre-flight job commits it after mailing.

Usage — each mode prints KEY=value lines for $GITHUB_ENV and exits 0:
  cycle_gate.py preflight      -> ACTION=run|defer|skip  CYCLE_DAY=1|2  WHY=...
  cycle_gate.py send           -> ACTION=run|skip  WHY=...
  cycle_gate.py record --cadence monthly [quarterly]
                               -> writes data/cycle_state.json after a digest is mailed
  cycle_gate.py defer-notice   -> writes email_preview/preflight_digest.html, the short
                                  "sliding a day" note the reviewers get instead
  --today YYYY-MM-DD overrides the clock (Eastern) for testing any mode.
"""
import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "data" / "cycle_state.json"
ET = ZoneInfo("America/New_York")


def today_et(override=None):
    return date.fromisoformat(override) if override else datetime.now(ET).date()


def served_week_end():
    """The week the emails would be built from: the citywide workbook's week_end."""
    data = json.load(open(ROOT / "data" / "latest_compstat.json"))
    return datetime.strptime(data["citywide"]["report_period"]["week_end"], "%m/%d/%Y").date()


def read_state():
    if not STATE.exists():
        return {}
    try:
        return json.load(open(STATE))
    except json.JSONDecodeError:
        return {}


def cycle_of(d):
    return d.strftime("%Y-%m")


def emit(**kv):
    for k, v in kv.items():
        print(f"{k}={v}")


def gate_preflight(today):
    cycle = cycle_of(today)
    first_monday = today.weekday() == 0 and today.day <= 7
    day_after = today.weekday() == 1 and 2 <= today.day <= 8
    if first_monday:
        expected = today - timedelta(days=1)          # the Sunday the week ended
        have = served_week_end()
        if have >= expected:
            emit(ACTION="run", CYCLE_DAY=1, WHY=f"first Monday; serving week ending {have}")
        else:
            emit(ACTION="defer", CYCLE_DAY=1,
                 WHY=f"first Monday, but the week ending {expected} has not arrived "
                     f"(newest is {have}) — holiday or late post; cycle slides to Tuesday/Wednesday")
        return
    if day_after:
        st = read_state()
        if st.get("cycle") == cycle and st.get("preflight_mailed"):
            emit(ACTION="skip", CYCLE_DAY=2, WHY=f"digest already mailed {st['preflight_mailed']} this cycle")
        else:
            emit(ACTION="run", CYCLE_DAY=2,
                 WHY="Tuesday after a first Monday with no digest mailed — the slid cycle")
        return
    emit(ACTION="skip", CYCLE_DAY=0, WHY="not a cycle day")


def gate_send(today):
    st = read_state()
    yesterday = (today - timedelta(days=1)).isoformat()
    if not st:
        emit(ACTION="skip", WHY="no cycle_state.json — no digest has been mailed by the pipeline")
    elif st.get("cycle") != cycle_of(today):
        emit(ACTION="skip", WHY=f"last digest belongs to cycle {st.get('cycle')}, not {cycle_of(today)}")
    elif st.get("preflight_mailed") != yesterday:
        emit(ACTION="skip", WHY=f"digest was mailed {st.get('preflight_mailed')}, not yesterday ({yesterday})")
    else:
        emit(ACTION="run", WHY=f"digest mailed yesterday on data through {st.get('data_week_end')}")


def record(today, cadences, cycle_day):
    st = {"cycle": cycle_of(today),
          "preflight_mailed": today.isoformat(),
          "cycle_day": cycle_day,
          "data_week_end": served_week_end().isoformat(),
          "cadences": cadences}
    STATE.write_text(json.dumps(st, indent=2) + "\n")
    emit(STATE=json.dumps(st))


def defer_notice(today):
    expected = today - timedelta(days=1)
    have = served_week_end()
    tomorrow = today + timedelta(days=1)
    html = f"""<meta charset="utf-8"><title>Pre-flight digest</title>
<body style="margin:0;background:#f4f4f4;font-family:-apple-system,'Hanken Grotesk',Arial,sans-serif;color:#111;">
<div style="max-width:640px;margin:24px auto;background:#fff;">
<div style="background:#000;color:#fff;padding:22px 28px;">
  <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#dde34c;">CompStat Decoder &middot; pre-flight</div>
  <div style="font-size:21px;font-weight:800;padding-top:6px;">This month&rsquo;s update slides one day &mdash; the NYPD has not posted yet</div>
  <div style="font-size:12px;color:#d1d5db;padding-top:8px;">Prepared {today.strftime('%A, %B %-d, %Y')} &middot; newest NYPD data ends {have.strftime('%-m/%-d/%Y')}; the week ending {expected.strftime('%-m/%-d/%Y')} has not been published.</div>
</div>
<div style="padding:20px 28px;font-size:13px;line-height:1.5;">
  <p style="margin:0 0 10px;">Nothing is wrong with the pipeline, and nothing is needed from you. The first Monday of the month is a holiday or the NYPD is simply late, so the cycle moves back a day:</p>
  <ul style="margin:0 0 12px 18px;padding:0;">
    <li>Pre-flight digest: <b>{tomorrow.strftime('%A %-m/%-d')}, 3pm ET</b> &mdash; you will get the usual report then, built from whatever the NYPD has posted by that point.</li>
    <li>Subscriber emails: <b>{(tomorrow + timedelta(days=1)).strftime('%A %-m/%-d')}, noon ET</b>, unless a HOLD is filed after tomorrow&rsquo;s digest.</li>
  </ul>
  <p style="margin:0;color:#6b7280;font-size:12px;">If the NYPD still has not posted by tomorrow&rsquo;s pre-flight, the digest will carry an OLD DATA flag and the send goes ahead on the older week unless held.</p>
</div></div></body>"""
    out = ROOT / "email_preview" / "preflight_digest.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    emit(NOTICE=str(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["preflight", "send", "record", "defer-notice"])
    ap.add_argument("--today", help="YYYY-MM-DD, Eastern; overrides the clock for testing")
    ap.add_argument("--cadence", nargs="+", default=["monthly"], choices=["monthly", "quarterly"])
    ap.add_argument("--cycle-day", type=int, default=1)
    args = ap.parse_args()
    today = today_et(args.today)
    if args.mode == "preflight":
        gate_preflight(today)
    elif args.mode == "send":
        gate_send(today)
    elif args.mode == "record":
        record(today, args.cadence, args.cycle_day)
    else:
        defer_notice(today)


if __name__ == "__main__":
    main()
