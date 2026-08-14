WHAT'S IN THIS FOLDER — the district email pipeline, demonstrated
==================================================================

district_15.html, district_33.html, district_36.html, district_51.html
  Real output, generated today by scripts/render_district_email.py from the same
  live NYPD data the website reads. Open them in a browser. District 51 shows the
  quarterly wording; the others monthly. This is exactly what a subscriber would
  receive — design is the template Ted circulated in July.

subscribers_sample.csv
  A mock-up of what Mailchimp would hold for each subscriber (fake addresses).
  This is the full data model: email, district, cadence, a yes/no for the main
  Vital City newsletter, plus where and when they signed up. Nothing else is
  collected; an address typed to look up a district is never stored.

HOW THE PIECES CONNECT
----------------------
1. SIGNUP. The forms on the site post each signup into our Mailchimp audience as
   one row shaped like the CSV: DISTRICT and CADENCE as fields (fields, not tags,
   so subscribers can edit them later on Mailchimp's own preference page), plus
   the newsletter opt-in.

2. RENDER. On a schedule (monthly, and quarterly), GitHub runs
   scripts/render_district_email.py --all. It computes every district's numbers
   from the latest data and produces one HTML file per district — the files in
   this folder, regenerated fresh.

3. SEND. The same job hands each district's HTML to Mailchimp as a DRAFT campaign
   targeted at that district's subscribers at that cadence. A person reviews and
   clicks send. Nothing goes out automatically. Unsubscribe and preference links
   are Mailchimp's standard ones.

WHAT WE NEED FROM MAILCHIMP'S SIDE
-----------------------------------
- Which audience these contacts should live in, with the DISTRICT / CADENCE /
  VC_NEWSLETTER fields created on it.
- An API key (stored encrypted on GitHub; it's what steps 1 and 3 use).
- Sending address confirmed: info@vitalcitynyc.org, same as the newsletter.
