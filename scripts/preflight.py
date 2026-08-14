#!/usr/bin/env python3
"""Pre-flight for the district email cycle: render, vet, digest.

Runs the day the data lands (Monday). It works out who gets what tomorrow, renders
every needed district email, runs the smell tests, and writes a digest for the
humans — "tomorrow X subscribers in Y districts get their update, here's anything
that looks off." The send job (Tuesday) is a separate script; it proceeds unless a
hold is placed.

Subscribers come from --subscribers (a CSV shaped like email_preview/
subscribers_sample.csv) until Mailchimp is wired, at which point the same columns
come from the Mailchimp API instead. Everything else is production behavior.

Usage:
  python3 scripts/preflight.py                          # demo: sample CSV, monthly cycle
  python3 scripts/preflight.py --cadence quarterly
  python3 scripts/preflight.py --subscribers path.csv --out email_preview

Output:
  email_preview/district_NN.html   (one per district with subscribers)
  email_preview/preflight_digest.html
Exit status is 0 even with flags — flags are for humans; only a broken pipeline
(stale feed, uncomputable district) exits nonzero, which trips the repo's alarm.
"""
import argparse
import csv
import html
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from render_district_email import (MAJORS, ROOT, compute_district, dir_pct,
                                   neighborhoods, render_district)

MAX_AGE_DAYS = 8          # feed staleness — same limit as check_freshness.py
SMALL_BASE = 30           # prior-year count below this = statistically volatile
WILD_SWING = 60           # |percent change| beyond this gets human eyes

def load_subscribers(path):
    rows = list(csv.DictReader(open(path)))
    for r in rows:
        r["DISTRICT"] = int(r["DISTRICT"])
    return rows

def vet_district(n, computed, flags):
    """Smell tests on one district's computed numbers."""
    for r in computed["rows"]:
        for cat in ("all", "violent", "property"):
            pct, pri = r[cat]["pct"], r[cat]["pri"]
            label = f"District {n} · {r['key']} · {cat}"
            if pct is not None and pct < -100:
                flags.append(("IMPOSSIBLE", f"{label}: {pct:.1f}% — a count cannot fall more than 100%"))
            if pri < SMALL_BASE and pct is not None and abs(pct) >= 25:
                flags.append(("SMALL SAMPLE", f"{label}: {dir_pct(pct)[0].replace('&mdash;','—')} on a base of only {pri} incidents last year"))
            elif pct is not None and abs(pct) > WILD_SWING:
                flags.append(("WILD SWING", f"{label}: {dir_pct(pct)[0].replace('&mdash;','—')} — verify before send"))
    w = computed["weighted"]
    for cat in ("all", "violent", "property"):
        if w[cat] is None:
            flags.append(("MISSING", f"District {n}: weighted {cat} figure could not be computed"))
    if computed["driver"] is None:
        flags.append(("MISSING", f"District {n}: no driver crime could be computed — intro sentence will omit it"))
    expected = None  # crosswalk count checked by caller (needs district object)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subscribers", default=str(ROOT / "email_preview/subscribers_sample.csv"))
    ap.add_argument("--cadence", default="monthly", choices=["monthly", "quarterly"])
    ap.add_argument("--out", default=str(ROOT / "email_preview"))
    args = ap.parse_args()
    outdir = Path(args.out)
    outdir.mkdir(exist_ok=True)

    data = json.load(open(ROOT / "data/latest_compstat.json"))
    council = {d["district"]: d for d in json.load(open(ROOT / "src/data/council_districts.json"))["districts"]}
    hoods = neighborhoods()
    template = (ROOT / "scripts/email_template.html").read_text()

    # ---- pipeline-level guards (these FAIL the run: red + alarm issue) ----
    week_end = data["citywide"]["report_period"]["week_end"]
    age = (datetime.now(timezone.utc)
           - datetime.strptime(week_end, "%m/%d/%Y").replace(tzinfo=timezone.utc)).days
    if age > MAX_AGE_DAYS:
        sys.exit(f"STALE FEED: data through {week_end} ({age} days old) — refusing to prepare a send.")

    subs = load_subscribers(args.subscribers)
    cycle_subs = [s for s in subs if s["CADENCE"].lower() == args.cadence]
    by_district = {}
    for s in cycle_subs:
        by_district.setdefault(s["DISTRICT"], []).append(s)
    other = {}
    for s in subs:
        if s["CADENCE"].lower() != args.cadence and s["DISTRICT"] not in by_district:
            other[s["DISTRICT"]] = other.get(s["DISTRICT"], 0) + 1
    skipped = [f"{n} ({c} subscriber{'s' if c != 1 else ''})" for n, c in sorted(other.items())]

    # ---- render + vet each district that has subscribers this cycle ----
    flags = []
    rendered = {}
    for n in sorted(by_district):
        d = council.get(n)
        if not d:
            flags.append(("MISSING", f"District {n}: subscribers exist but no crosswalk entry — cannot send"))
            continue
        computed = compute_district(d, data, hoods)
        if len(computed["rows"]) < len(d["precincts"]):
            missing = len(d["precincts"]) - len(computed["rows"])
            flags.append(("MISSING", f"District {n}: {missing} of its {len(d['precincts'])} precincts had no computable data"))
        vet_district(n, computed, flags)
        html_out = render_district(d, data, hoods, template, args.cadence, computed=computed)
        dst = outdir / f"district_{n:02d}.html"
        dst.write_text(html_out)
        rendered[n] = {"file": dst.name, "subs": len(by_district[n]), "member": d.get("member", "")}

    # ---- the digest ----
    today = datetime.now(timezone.utc).strftime("%A, %B %-d, %Y")
    total_subs = sum(v["subs"] for v in rendered.values())
    sev_rank = {"IMPOSSIBLE": 0, "STALE": 0, "MISSING": 1, "WILD SWING": 2, "SMALL SAMPLE": 3}
    flags.sort(key=lambda f: sev_rank.get(f[0], 9))

    flag_html = ("".join(
        f'<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:700;white-space:nowrap;'
        f'color:{"#c0392b" if sev_rank.get(kind, 9) < 2 else "#8a6d00"};">{kind}</td>'
        f'<td style="padding:6px 10px;border-bottom:1px solid #eee;">{html.escape(msg)}</td></tr>'
        for kind, msg in flags)
        or '<tr><td style="padding:6px 10px;color:#1f7a3a;font-weight:700;">ALL CLEAR</td>'
           '<td style="padding:6px 10px;">Every check passed — nothing needs your eyes.</td></tr>')

    rows_html = "".join(
        f'<tr><td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;">District {n}'
        f'{" — " + html.escape(v["member"]) if v["member"] else ""}</td>'
        f'<td align="right" style="padding:5px 10px;border-bottom:1px solid #f3f4f6;">{v["subs"]}</td>'
        f'<td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;"><a href="{v["file"]}">preview</a></td></tr>'
        for n, v in sorted(rendered.items()))

    digest = f"""<meta charset="utf-8"><title>Pre-flight digest</title>
<body style="margin:0;background:#f4f4f4;font-family:-apple-system,'Hanken Grotesk',Arial,sans-serif;color:#111;">
<div style="max-width:640px;margin:24px auto;background:#fff;">
<div style="background:#000;color:#fff;padding:22px 28px;">
  <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#dde34c;">CompStat Decoder &middot; pre-flight</div>
  <div style="font-size:21px;font-weight:800;padding-top:6px;">Tomorrow the {args.cadence} update goes out to {total_subs} subscriber{'s' if total_subs != 1 else ''} in {len(rendered)} district{'s' if len(rendered) != 1 else ''}</div>
  <div style="font-size:12px;color:#d1d5db;padding-top:8px;">Prepared {today} &middot; NYPD data through {week_end} ({age} days old) &middot; Nothing to do if this looks right &mdash; it sends tomorrow on its own. To STOP it: <a href="https://github.com/Vital-City-NYC/compstat-decoder/issues/new?title=HOLD" style="color:#dde34c;">click here</a> and press the green &ldquo;Submit new issue&rdquo; button on the page that opens &mdash; that posts a stop signal the sender checks first. (Or just tell Ted.)</div>
</div>
<div style="padding:20px 28px;">
  <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;padding-bottom:6px;">Checks</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">{flag_html}</table>
  <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;padding:18px 0 6px;">What goes out</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><th align="left" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">District</th>
        <th align="right" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Subscribers</th>
        <th align="left" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Email</th></tr>
    {rows_html}
  </table>
  {f'<p style="font-size:12px;color:#6b7280;">Waiting for the {"quarterly" if args.cadence == "monthly" else "monthly"} cycle instead: district {", ".join(skipped)}.</p>' if skipped else ''}
</div></div></body>"""
    dst = outdir / "preflight_digest.html"
    dst.write_text(digest)
    print(f"digest: {dst}")
    print(f"{total_subs} subscribers, {len(rendered)} districts, {len(flags)} flag(s)")
    for kind, msg in flags:
        print(f"  [{kind}] {msg}")

if __name__ == "__main__":
    main()
