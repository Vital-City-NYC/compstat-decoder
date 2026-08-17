#!/usr/bin/env python3
"""Email the pre-flight digest to the internal reviewers, via Mailchimp.

The digest is sent as a Mailchimp campaign targeted at audience members tagged
`internal-digest` — staff reviewers, not real subscribers (preflight.py excludes
that tag from every subscriber count). The district emails themselves are inlined
below the digest (capped, so a big cycle doesn't produce a monster email).

Usage:
  python3 scripts/send_digest.py --recipients talcorn@vitalcitynyc.org aesguerra@vitalcitynyc.org
  python3 scripts/send_digest.py --recipients talcorn@vitalcitynyc.org   # test to one person

Requires MAILCHIMP_API_KEY in the environment (GitHub secret) or .mailchimp_key
locally. Exits nonzero on any failure so the workflow's alarm step fires.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIST_ID = "bf42451be9"
TAG = "internal-digest"
MAX_INLINE = 8

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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recipients", nargs="+", required=True)
    ap.add_argument("--digest", default=str(ROOT / "email_preview/preflight_digest.html"))
    ap.add_argument("--previews-dir", default=str(ROOT / "email_preview"))
    args = ap.parse_args()

    key = os.environ.get("MAILCHIMP_API_KEY") or (ROOT / ".mailchimp_key").read_text().strip()

    # 1. make sure every reviewer is an audience member carrying the tag
    for email in args.recipients:
        h = hashlib.md5(email.lower().encode()).hexdigest()
        # upsert without touching fields — a reviewer may also be a real subscriber
        api(key, f"/lists/{LIST_ID}/members/{h}", "PUT",
            {"email_address": email, "status_if_new": "subscribed"})
        api(key, f"/lists/{LIST_ID}/members/{h}/tags", "POST",
            {"tags": [{"name": TAG, "status": "active"}]})

    # 2. the tag's static segment is the campaign target
    segs = api(key, f"/lists/{LIST_ID}/segments?count=200&type=static")
    seg = next((x for x in segs["segments"] if x["name"] == TAG), None)
    if not seg:
        sys.exit(f"tag segment '{TAG}' not found")

    # 3. digest + inlined district previews (anchor links inside the email)
    digest = Path(args.digest).read_text()
    previews = sorted(Path(args.previews_dir).glob("district_*.html"))
    referenced = set(re.findall(r'href="(district_\d+\.html)"', digest))
    inline = [p for p in previews if p.name in referenced][:MAX_INLINE]
    for p in inline:
        digest = digest.replace(f'href="{p.name}"', f'href="#{p.stem}"')
    over = len(referenced) - len(inline)
    parts = [digest]
    if inline:
        parts.append('<div style="max-width:640px;margin:0 auto;padding:18px 0;font-family:Arial,sans-serif;'
                     'font-size:12px;color:#6b7280;text-align:center;">The emails themselves, below'
                     + (f" (first {MAX_INLINE} of {len(referenced)} — the rest render the same way)" if over > 0 else "") + ".</div>")
    for p in inline:
        parts.append(f'<div id="{p.stem}" style="border-top:4px solid #000;margin-top:8px;"></div>')
        parts.append(p.read_text())
    footer = ('<div style="max-width:640px;margin:0 auto;padding:16px 0 30px;font-family:Arial,sans-serif;'
              'font-size:10px;color:#9ca3af;text-align:center;">Internal pre-flight report &middot; '
              'CompStat Decoder &middot; *|LIST:ADDRESSLINE|* &middot; <a href="*|UNSUB|*">Unsubscribe</a></div>')
    parts.append(footer)
    full_html = "\n".join(parts)

    # 4. create, fill, send
    stamp = datetime.now(timezone.utc).strftime("%b %-d, %Y")
    m = re.search(r"goes out to (\d+ subscriber[s]? in \d+ district[s]?)", digest)
    tail = m.group(1) if m else "see inside"
    camp = api(key, "/campaigns", "POST", {
        "type": "regular",
        "recipients": {"list_id": LIST_ID, "segment_opts": {"saved_segment_id": seg["id"]}},
        "settings": {"subject_line": f"Pre-flight: {tail} tomorrow",
                     "preview_text": "The Decoder's cycle report — review or hold before tomorrow's send.",
                     "title": f"preflight-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
                     "from_name": "CompStat Decoder",
                     "reply_to": "info@vitalcitynyc.org",
                     "auto_footer": False}})
    api(key, f"/campaigns/{camp['id']}/content", "PUT", {"html": full_html})
    api(key, f"/campaigns/{camp['id']}/actions/send", "POST")
    print(f"digest sent to tag '{TAG}' ({', '.join(args.recipients)}) — campaign {camp['id']}")

if __name__ == "__main__":
    main()
