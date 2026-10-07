"""Add Decoder subscribers who ticked the newsletter box to Vital City's newsletter audience.

The signup form records the answer as the merge field VC_NEWS (yes|no) on the Decoder
audience, but until now nothing acted on it. This closes that gap.

Rules:
  - Only Decoder members who are subscribed AND have VC_NEWS = yes.
  - Someone already in the newsletter audience in ANY state (subscribed, unsubscribed,
    cleaned, archived) is left exactly as they are. An unsubscribe from the newsletter
    must never be undone by a checkbox on another form.
  - Someone new is added as subscribed, tagged "CompStat Decoder signup" so the audience
    team can see where they came from.
  - Either way the Decoder member is then tagged "newsletter-synced" and skipped on
    every later run, so the job costs one list read once everyone is handled.

Runs on every pass of update-data.yml with continue-on-error: a Mailchimp hiccup here
must never hold up the data.

Usage:
  python3 scripts/sync_newsletter.py            # do it
  python3 scripts/sync_newsletter.py --dry-run  # report only
"""
import argparse, base64, hashlib, json, os, sys, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DC = "us5"
DECODER_LIST = "bf42451be9"     # CompStat Decoder Subscribers
NEWSLETTER_LIST = "ec30bf0c4b"  # Vital City Newsletter Contacts
SOURCE_TAG = "CompStat Decoder signup"
DONE_TAG = "newsletter-synced"

KEY = os.environ.get("MAILCHIMP_API_KEY") or (ROOT / ".mailchimp_key").read_text().strip()


def api(method, path, body=None):
    req = urllib.request.Request(f"https://{DC}.api.mailchimp.com/3.0{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"x:{KEY}".encode()).decode())
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def wanting_newsletter():
    out, offset = [], 0
    while True:
        st, d = api("GET", f"/lists/{DECODER_LIST}/members?status=subscribed&count=500&offset={offset}"
                           "&fields=members.email_address,members.merge_fields.VC_NEWS,members.tags,total_items")
        if st != 200:
            sys.exit(f"could not read the Decoder audience: {st} {d.get('detail')}")
        for m in d["members"]:
            tags = {t["name"] for t in m.get("tags", [])}
            if m["merge_fields"].get("VC_NEWS") == "yes" and DONE_TAG not in tags:
                out.append(m["email_address"])
        offset += 500
        if offset >= d["total_items"]:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    todo = wanting_newsletter()
    print(f"{len(todo)} Decoder subscriber(s) want the newsletter and haven't been handled yet")
    added = present = failed = 0
    for email in todo:
        h = hashlib.md5(email.lower().encode()).hexdigest()
        st, m = api("GET", f"/lists/{NEWSLETTER_LIST}/members/{h}?fields=status")
        if st == 200:
            print(f"  already in the newsletter audience ({m['status']}), left alone: {email}")
            present += 1
        elif st == 404:
            if args.dry_run:
                print(f"  would add: {email}")
                continue
            st, m = api("POST", f"/lists/{NEWSLETTER_LIST}/members",
                        {"email_address": email, "status": "subscribed", "tags": [SOURCE_TAG]})
            if st != 200:
                print(f"  ! could not add {email}: {st} {m.get('title')} {m.get('detail')}")
                failed += 1
                continue
            print(f"  added: {email}")
            added += 1
        else:
            print(f"  ! could not look up {email}: {st} {m.get('detail')}")
            failed += 1
            continue
        if not args.dry_run:
            api("POST", f"/lists/{DECODER_LIST}/members/{h}/tags",
                {"tags": [{"name": DONE_TAG, "status": "active"}]})
    print(f"done: {added} added, {present} already there, {failed} failed"
          + (" (dry run, nothing changed)" if args.dry_run else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
