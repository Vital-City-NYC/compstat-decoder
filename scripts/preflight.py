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

from render_precinct_email import compute_precinct, render_precinct
from render_district_email import (MAJORS, ROOT, compute_district, dir_pct, load_council,
                                   neighborhoods, render_district, ordinal)

MAX_AGE_DAYS = 8          # feed staleness — same limit as check_freshness.py
SMALL_BASE = 30           # prior-year count below this = statistically volatile
WILD_SWING = 60           # |percent change| beyond this gets human eyes

def load_subscribers(path):
    rows = list(csv.DictReader(open(path)))
    for r in rows:
        r["DISTRICT"] = int(r["DISTRICT"]) if r.get("DISTRICT") else None
        r["PRECINCT"] = int(r["PRECINCT"]) if r.get("PRECINCT") else None
        r["GEO_TYPE"] = (r.get("GEO_TYPE") or "district").strip().lower()
    return rows

def load_subscribers_mailchimp():
    """Live audience pull. Members tagged internal-digest (staff who receive this
    report) are excluded from subscriber counts."""
    import base64, os, urllib.request
    key = os.environ.get("MAILCHIMP_API_KEY") or (ROOT / ".mailchimp_key").read_text().strip()
    dc = key.rsplit("-", 1)[1]
    rows, offset = [], 0
    while True:
        req = urllib.request.Request(
            f"https://{dc}.api.mailchimp.com/3.0/lists/bf42451be9/members"
            f"?count=1000&offset={offset}&status=subscribed"
            "&fields=members.email_address,members.merge_fields,members.tags,total_items")
        req.add_header("Authorization", "Basic " + base64.b64encode(f"anystring:{key}".encode()).decode())
        page = json.load(urllib.request.urlopen(req))
        for m in page["members"]:
            mf = m.get("merge_fields", {})
            # A reviewer (internal-digest tag) can ALSO be a real subscriber — Anthony is.
            # Exclude only pure reviewers: tagged AND districtless.
            if any(t["name"] == "internal-digest" for t in m.get("tags", [])) and mf.get("DISTRICT") in ("", None) and mf.get("PRECINCT") in ("", None):
                continue
            d, pr = mf.get("DISTRICT"), mf.get("PRECINCT")
            cadence = str(mf.get("CADENCE") or "monthly").strip().lower() or "monthly"
            precinct = int(pr) if pr not in ("", None) else None
            # Anyone who signed up before precincts existed has no GEO_TYPE — they are
            # district subscribers, and stay that way until they say otherwise.
            geo_type = "precinct" if (str(mf.get("GEO_TYPE") or "").strip().lower() == "precinct"
                                      and precinct) else "district"
            rows.append({"Email Address": m["email_address"],
                         "DISTRICT": int(d) if d not in ("", None) else None,
                         "PRECINCT": precinct,
                         "GEO_TYPE": geo_type,
                         "CADENCE": cadence})
        offset += 1000
        if offset >= page["total_items"]:
            break
    return rows

def vet_precinct(key, computed, flags):
    """Smell tests on one precinct's numbers. The per-offense rows are much smaller
    samples than a district's aggregates, so SMALL SAMPLE fires here far more often —
    that is the detector working, not a fault. Offences the email already suppresses
    with an asterisk are not flagged twice."""
    for r in computed["rows"]:
        pct, pri = r["pct"], r["pri"]
        label = f"{key} · {r['name']}"
        if pct is not None and pct < -100:
            flags.append(("IMPOSSIBLE", f"{label}: {pct:.1f}% — a count cannot fall more than 100%"))
        if r["small"]:
            continue          # shown as "*" in the email, with a note; not a surprise
        if pct is not None and abs(pct) > WILD_SWING:
            flags.append(("WILD SWING", f"{label}: {dir_pct(pct)[0].replace('&mdash;','—')} — verify before send"))
    # The renderer's asterisk threshold equals SMALL_BASE, so no individual row can
    # trip the usual small-sample flag. What IS worth Ted's eyes is a precinct so quiet
    # that most of its table is asterisks — the email carries little real information.
    suppressed = [r["name"] for r in computed["rows"] if r["small"]]
    if len(suppressed) >= 4:
        flags.append(("SMALL SAMPLE", f"{key}: {len(suppressed)} of {len(computed['rows'])} offences "
                                      f"too rare for a percentage ({', '.join(suppressed)}) — thin email"))
    for cat in ("all", "violent", "property"):
        if computed["agg"][cat]["pct"] is None:
            flags.append(("MISSING", f"{key}: {cat} figure could not be computed"))


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
    ap.add_argument("--subscribers", default=str(ROOT / "email_preview/subscribers_sample.csv"),
                    help="CSV path, or the word 'mailchimp' for the live audience")
    ap.add_argument("--note", default="", help="extra sentence for the digest header (e.g. send-job status)")
    ap.add_argument("--cadence", nargs="+", default=["monthly"], choices=["monthly", "quarterly"])
    ap.add_argument("--out", default=str(ROOT / "email_preview"))
    args = ap.parse_args()
    outdir = Path(args.out)
    outdir.mkdir(exist_ok=True)

    data = json.load(open(ROOT / "data/latest_compstat.json"))
    council = load_council()
    hoods = neighborhoods()
    template = (ROOT / "scripts/email_template.html").read_text()
    ptemplate = (ROOT / "scripts/precinct_email_template.html").read_text()

    # ---- pipeline-level guards (these FAIL the run: red + alarm issue) ----
    week_end = data["citywide"]["report_period"]["week_end"]
    age = (datetime.now(timezone.utc)
           - datetime.strptime(week_end, "%m/%d/%Y").replace(tzinfo=timezone.utc)).days
    if age > MAX_AGE_DAYS:
        sys.exit(f"STALE FEED: data through {week_end} ({age} days old) — refusing to prepare a send.")

    subs = (load_subscribers_mailchimp() if args.subscribers == "mailchimp"
            else load_subscribers(args.subscribers))
    psubs = [x for x in subs if x.get("GEO_TYPE") == "precinct" and x.get("PRECINCT") is not None]
    dsubs = [x for x in subs if x.get("GEO_TYPE") != "precinct" and x["DISTRICT"] is not None]
    no_district = [x for x in subs if x not in psubs and x not in dsubs]
    subs = dsubs

    flags = []
    # A subscriber with no geography receives nothing, forever, and has no way to
    # tell. That is exactly how the f_id bug hid for five days, so it is a CHECK now
    # rather than a footnote at the bottom of the digest.
    if no_district:
        who = ", ".join(sorted(x["Email Address"] for x in no_district)[:5])
        flags.append(("MISSING", f"{len(no_district)} subscriber(s) stored with no district and no precinct — "
                                 f"they receive nothing until it is fixed ({who}). Check the signup path is "
                                 f"still passing GEO_TYPE, DISTRICT and PRECINCT."))
    cadence_blocks = []   # one entry per cadence in this cycle
    other = {}
    for x in subs + psubs:
        if x["CADENCE"].lower() not in args.cadence:
            tag = (f"the {ordinal(x['PRECINCT'])} Precinct" if x.get("GEO_TYPE") == "precinct"
                   else f"district {x['DISTRICT']}")
            other[tag] = other.get(tag, 0) + 1
    skipped = [f"{t} ({c} subscriber{'s' if c != 1 else ''})" for t, c in sorted(other.items())]

    for cadence in args.cadence:
        by_district = {}
        for x in subs:
            if x["CADENCE"].lower() == cadence:
                by_district.setdefault(x["DISTRICT"], []).append(x)
        rendered = {}
        for n in sorted(by_district):
            d = council.get(n)
            if not d:
                flags.append(("MISSING", f"District {n} ({cadence}): subscribers exist but no crosswalk entry — cannot send"))
                continue
            computed = compute_district(d, data, hoods)
            if len(computed["rows"]) < len(d["precincts"]):
                missing = len(d["precincts"]) - len(computed["rows"])
                flags.append(("MISSING", f"District {n}: {missing} of its {len(d['precincts'])} precincts had no computable data"))
            vet_district(n, computed, flags)
            html_out = render_district(d, data, hoods, template, cadence, computed=computed)
            suffix = "" if cadence == "monthly" else f"_{cadence}"
            dst = outdir / f"district_{n:02d}{suffix}.html"
            dst.write_text(html_out)
            rendered[n] = {"file": dst.name, "subs": len(by_district[n]), "member": d.get("member", "")}
        by_precinct = {}
        for x in psubs:
            if x["CADENCE"].lower() == cadence:
                by_precinct.setdefault(x["PRECINCT"], []).append(x)
        prendered = {}
        for num in sorted(by_precinct):
            key = f"{ordinal(num)} Precinct"
            try:
                pcomputed = compute_precinct(key, data)
            except RuntimeError as e:
                flags.append(("MISSING", f"{key} ({cadence}): {e} — cannot send"))
                continue
            vet_precinct(key, pcomputed, flags)
            phtml = render_precinct(key, data, hoods, ptemplate, cadence, computed=pcomputed)
            psuffix = "" if cadence == "monthly" else f"_{cadence}"
            pdst = outdir / f"precinct_{num:03d}{psuffix}.html"
            pdst.write_text(phtml)
            prendered[num] = {"file": pdst.name, "subs": len(by_precinct[num]),
                              "member": hoods.get(key, "")}
        cadence_blocks.append({"cadence": cadence, "rendered": rendered, "prendered": prendered,
                               "subs": sum(v["subs"] for v in rendered.values())
                                       + sum(v["subs"] for v in prendered.values())})

    # ---- the digest ----
    today = datetime.now(timezone.utc).strftime("%A, %B %-d, %Y")
    sev_rank = {"IMPOSSIBLE": 0, "STALE": 0, "MISSING": 1, "WILD SWING": 2, "SMALL SAMPLE": 3}
    flags.sort(key=lambda f: sev_rank.get(f[0], 9))

    def geo_phrase(b):
        bits = []
        if b["rendered"]:
            bits.append(f"{len(b['rendered'])} district{'s' if len(b['rendered']) != 1 else ''}")
        if b["prendered"]:
            bits.append(f"{len(b['prendered'])} precinct{'s' if len(b['prendered']) != 1 else ''}")
        return " and ".join(bits) if bits else "no geographies"
    headline_parts = [f"the {b['cadence']} update goes out to {b['subs']} subscriber{'s' if b['subs'] != 1 else ''} "
                      f"in {geo_phrase(b)}" for b in cadence_blocks]
    headline = "Tomorrow " + " and ".join(headline_parts)

    flag_html = ("".join(
        f'<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:700;white-space:nowrap;'
        f'color:{"#c0392b" if sev_rank.get(kind, 9) < 2 else "#8a6d00"};">{kind}</td>'
        f'<td style="padding:6px 10px;border-bottom:1px solid #eee;">{html.escape(msg)}</td></tr>'
        for kind, msg in flags)
        or '<tr><td style="padding:6px 10px;color:#1f7a3a;font-weight:700;">ALL CLEAR</td>'
           '<td style="padding:6px 10px;">Every check passed — nothing needs your eyes.</td></tr>')

    sections = ""
    for b in cadence_blocks:
        rows_html = "".join(
            f'<tr><td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;">District {n}'
            f'{" — " + html.escape(v["member"]) if v["member"] else ""}</td>'
            f'<td align="right" style="padding:5px 10px;border-bottom:1px solid #f3f4f6;">{v["subs"]}</td>'
            f'<td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;"><a href="{v["file"]}">preview</a></td></tr>'
            for n, v in sorted(b["rendered"].items())) or             '<tr><td style="padding:5px 10px;color:#6b7280;" colspan="3">No subscribers this cycle.</td></tr>'
        sections += f"""
  <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;padding:18px 0 6px;">What goes out — {b['cadence']}</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><th align="left" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">District</th>
        <th align="right" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Subscribers</th>
        <th align="left" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Email</th></tr>
    {rows_html}
  </table>"""
        if b["prendered"]:
            prows = "".join(
                f'<tr><td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;">{ordinal(n)} Precinct'
                f'{" — " + html.escape(v["member"]) if v["member"] else ""}</td>'
                f'<td align="right" style="padding:5px 10px;border-bottom:1px solid #f3f4f6;">{v["subs"]}</td>'
                f'<td style="padding:5px 10px;border-bottom:1px solid #f3f4f6;"><a href="{v["file"]}">preview</a></td></tr>'
                for n, v in sorted(b["prendered"].items()))
            sections += f"""
  <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;padding:18px 0 6px;">What goes out — {b['cadence']}, by precinct</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><th align="left" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Precinct</th>
        <th align="right" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Subscribers</th>
        <th align="left" style="padding:5px 10px;border-bottom:2px solid #000;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Email</th></tr>
    {prows}
  </table>"""

    digest = f"""<meta charset="utf-8"><title>Pre-flight digest</title>
<body style="margin:0;background:#f4f4f4;font-family:-apple-system,'Hanken Grotesk',Arial,sans-serif;color:#111;">
<div style="max-width:640px;margin:24px auto;background:#fff;">
<div style="background:#000;color:#fff;padding:22px 28px;">
  <div style="font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#dde34c;">CompStat Decoder &middot; pre-flight</div>
  <div style="font-size:21px;font-weight:800;padding-top:6px;">{headline}</div>
  <div style="font-size:12px;color:#d1d5db;padding-top:8px;">Prepared {today} &middot; NYPD data through {week_end} ({age} days old) &middot; Nothing to do if this looks right &mdash; it sends tomorrow on its own. To STOP it: <a href="https://github.com/Vital-City-NYC/compstat-decoder/issues/new?title=HOLD" style="color:#dde34c;">click here</a> and press the green &ldquo;Submit new issue&rdquo; button on the page that opens &mdash; that posts a stop signal the sender checks first. (Or just tell Ted.)</div>
</div>
<div style="padding:20px 28px;">
  <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;padding-bottom:6px;">Checks</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">{flag_html}</table>
  {sections}
  {f'<p style="font-size:12px;color:#6b7280;">Waiting for a cycle not in this run: {", ".join(skipped)}.</p>' if skipped else ''}
  {f'<p style="font-size:12px;color:#6b7280;">{len(no_district)} subscriber{"s" if len(no_district) != 1 else ""} signed up without picking a geography yet — they receive nothing until they do.</p>' if no_district else ''}
  {f'<p style="font-size:12px;color:#8a6d00;font-weight:700;">{html.escape(args.note)}</p>' if args.note else ''}
</div></div></body>"""
    dst = outdir / "preflight_digest.html"
    dst.write_text(digest)
    print(f"digest: {dst}")
    for b in cadence_blocks:
        print(f"{b['cadence']}: {b['subs']} subscribers, {len(b['rendered'])} districts, {len(b['prendered'])} precincts")
    print(f"{len(flags)} flag(s)")
    for kind, msg in flags:
        print(f"  [{kind}] {msg}")

if __name__ == "__main__":
    main()
