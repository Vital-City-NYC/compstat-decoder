#!/usr/bin/env python3
"""Send the district emails to subscribers — the Tuesday job.

For every district with at least one subscriber at the given cadence, this renders
the district's email from the live data and sends it through Mailchimp to exactly
those subscribers (a per-run static segment — no humans, no drafts).

THE BRAKE: before doing anything it checks the repo for an open issue titled HOLD.
If one exists, it stops and sends nothing. That is the one-click stop advertised in
the pre-flight digest.

Usage:
  python3 scripts/send_cycle.py --cadence monthly
  python3 scripts/send_cycle.py --cadence monthly --dry-run     # render + plan, no send
Requires MAILCHIMP_API_KEY (GitHub secret) or .mailchimp_key locally.
"""
import argparse
import base64
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

from preflight import load_subscribers_mailchimp
from render_district_email import ROOT, compute_district, neighborhoods, render_district

LIST_ID = "bf42451be9"
REPO = "Vital-City-NYC/compstat-decoder"

def api(key, path, method="GET", body=None):
    dc = key.rsplit("-", 1)[1]
    req = urllib.request.Request(f"https://{dc}.api.mailchimp.com/3.0{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"anystring:{key}".encode()).decode())
    req.add_header("Content-Type", "application/json")
    try:
        raw = urllib.request.urlopen(req).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"Mailchimp {method} {path} -> {e.code}: {e.read().decode()[:300]}")

def hold_is_set():
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/issues?state=open&per_page=50")
    try:
        issues = json.load(urllib.request.urlopen(req))
    except Exception as e:
        sys.exit(f"could not check for a HOLD issue ({e}) — refusing to send blind")
    return any(i["title"].strip().upper() == "HOLD" for i in issues)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cadence", required=True, choices=["monthly", "quarterly"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    key = os.environ.get("MAILCHIMP_API_KEY") or (ROOT / ".mailchimp_key").read_text().strip()

    if hold_is_set():
        print("HOLD issue is open — standing down, nothing sent.")
        return

    subs = [s for s in load_subscribers_mailchimp()
            if s["CADENCE"] == args.cadence and s["DISTRICT"] is not None]
    by_district = {}
    for s in subs:
        by_district.setdefault(s["DISTRICT"], []).append(s["Email Address"])
    if not by_district:
        print(f"no {args.cadence} subscribers with districts — nothing to send")
        return

    data = json.load(open(ROOT / "data/latest_compstat.json"))
    council = {d["district"]: d for d in json.load(open(ROOT / "src/data/council_districts.json"))["districts"]}
    hoods = neighborhoods()
    template = (ROOT / "scripts/email_template.html").read_text()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    sent = 0
    for n, emails in sorted(by_district.items()):
        d = council.get(n)
        if not d:
            print(f"  SKIP district {n}: no crosswalk entry ({len(emails)} subscriber(s) unreached)")
            continue
        html = render_district(d, data, hoods, template, args.cadence, computed=compute_district(d, data, hoods))
        if args.dry_run:
            print(f"  DRY RUN district {n}: would send to {len(emails)} subscriber(s)")
            continue
        seg = api(key, f"/lists/{LIST_ID}/segments", "POST",
                  {"name": f"send-{args.cadence}-d{n}-{stamp}", "static_segment": emails})
        camp = api(key, "/campaigns", "POST", {
            "type": "regular",
            "recipients": {"list_id": LIST_ID, "segment_opts": {"saved_segment_id": seg["id"]}},
            "settings": {"subject_line": f"Crime in Council District {n}: your {args.cadence} update",
                         "preview_text": "How each precinct in your district is trending, from the NYPD's own data.",
                         "title": f"decoder-{args.cadence}-d{n}-{stamp}",
                         "from_name": "Vital City",
                         "reply_to": "info@vitalcitynyc.org",
                         "auto_footer": False}})
        api(key, f"/campaigns/{camp['id']}/content", "PUT", {"html": html})
        api(key, f"/campaigns/{camp['id']}/actions/send", "POST")
        print(f"  sent district {n} to {len(emails)} subscriber(s) — campaign {camp['id']}")
        sent += 1
    print(f"cycle complete: {sent} district campaign(s), {sum(len(e) for e in by_district.values())} subscriber(s)")

if __name__ == "__main__":
    main()
