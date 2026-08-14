#!/usr/bin/env python3
"""Render the per-district subscriber email from live CompStat data.

This is the production renderer for the Decoder's district updates, runnable today
in demo mode (writes HTML files) with the Mailchimp step stubbed until we have an
API key. Layout is the template Ted approved 2026-07-22 (scripts/email_template.html
is the parameterized version).

Usage:
  python3 scripts/render_district_email.py --district 15 33          # specific districts
  python3 scripts/render_district_email.py --all                     # all 51
  python3 scripts/render_district_email.py --district 15 --cadence quarterly
Output: email_preview/district_NN.html

Every number is computed from data/latest_compstat.json (the same file the website
reads) exactly as the site's By Council District tab computes it: each precinct's
year-to-date current/prior counts, weighted by the precinct's share of the district's
area from src/data/council_districts.json. Nothing is invented; a district whose data
can't be computed is skipped loudly.
"""
import argparse
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAJOR_VIOLENT = ["Murder", "Rape", "Robbery", "Fel. Assault"]
MAJOR_PROPERTY = ["Burglary", "Gr. Larceny", "G.L.A."]
MAJORS = MAJOR_VIOLENT + MAJOR_PROPERTY
CRIME_EXPAND = {
    "Murder": "murder", "Rape": "rape", "Robbery": "robbery",
    "Fel. Assault": "felony assault", "Burglary": "burglary",
    "Gr. Larceny": "grand larceny", "G.L.A.": "grand larceny auto",
}
NUM_WORD = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
            6: "six", 7: "seven", 8: "eight", 9: "nine"}
GREEN, RED, GRAY = "#1f7a3a", "#c0392b", "#6b7280"
SITE = "https://vital-city-nyc.github.io/compstat-decoder/"

def ordinal(n):
    suf = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"

def dir_pct(v):
    if v is None:
        return "&mdash;", GRAY
    if v == 0:
        return "No change", GRAY
    n = f"{abs(v):.1f}".rstrip("0").rstrip(".")
    return (f"Up {n}%", RED) if v > 0 else (f"Down {n}%", GREEN)

def neighborhoods():
    s = (ROOT / "src/shared.js").read_text()
    block = re.search(r"PRECINCT_NEIGHBORHOODS\s*=\s*\{(.*?)\};", s, re.S).group(1)
    return dict(re.findall(r'"(\d+\w+ Precinct)":\s*"([^"]+)"', block))

def ytd(geo, names):
    fel = geo.get("seven_major_felonies", {})
    cur = pri = 0
    for n in names:
        y = fel.get(n, {}).get("year_to_date", {})
        c, p = y.get("current_year"), y.get("prior_year")
        if not isinstance(c, (int, float)) or not isinstance(p, (int, float)):
            return None
        cur += c
        pri += p
    return {"cur": cur, "pri": pri, "pct": ((cur - pri) / pri * 100) if pri > 0 else None}

def pct_cell(v, right_pad="9px 0 9px 10px", weight="700"):
    label, color = dir_pct(v)
    return (f'<td align="right" style="padding:{right_pad};border-bottom:1px solid #f3f4f6;'
            f"font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;font-size:13px;"
            f'font-weight:{weight};white-space:nowrap;color:{color};">{label}</td>')

def compute_district(d, data, hoods):
    """All of a district's numbers: per-precinct rows, weighted aggregate, driver.
    Shared by the renderer and by preflight.py's vet checks."""
    rows_data = []
    for o in sorted(d["precincts"], key=lambda x: -x["share"]):
        key = f"{ordinal(o['precinct'])} Precinct"
        geo = data.get(key)
        if not geo:
            continue
        stats = {cat: ytd(geo, names) for cat, names in
                 [("all", MAJORS), ("violent", MAJOR_VIOLENT), ("property", MAJOR_PROPERTY)]}
        if any(v is None for v in stats.values()):
            continue
        rows_data.append({"key": key, "share": o["share"], "hood": hoods.get(key, ""), **stats})
    if not rows_data:
        raise RuntimeError(f"district {d['district']}: no computable precincts")

    # weighted district aggregate + per-crime driver, same math as the website
    w = {}
    for cat in ("all", "violent", "property"):
        cur = sum(r["share"] * r[cat]["cur"] for r in rows_data)
        pri = sum(r["share"] * r[cat]["pri"] for r in rows_data)
        w[cat] = ((cur - pri) / pri * 100) if pri > 0 else None
    net_sign = 1 if (w["all"] or 0) > 0 else -1
    driver = None
    for name in MAJORS:
        cur = pri = 0
        ok = True
        for r in rows_data:
            geo = data[r["key"]]
            y = geo["seven_major_felonies"].get(name, {}).get("year_to_date", {})
            c, p = y.get("current_year"), y.get("prior_year")
            if not isinstance(c, (int, float)) or not isinstance(p, (int, float)):
                ok = False
                break
            cur += r["share"] * c
            pri += r["share"] * p
        if not ok or pri <= 0:
            continue
        diff = cur - pri
        if (diff > 0) == (net_sign > 0) and (driver is None or abs(diff) > abs(driver["diff"])):
            driver = {"name": name, "diff": diff, "pct": (cur - pri) / pri * 100}

    return {"rows": rows_data, "weighted": w, "driver": driver}

def render_district(d, data, hoods, template, cadence, computed=None):
    n = d["district"]
    c = computed or compute_district(d, data, hoods)
    rows_data, w, driver = c["rows"], c["weighted"], c["driver"]
    down = sum(1 for r in rows_data if (r["all"]["pct"] or 0) < 0)
    total = len(rows_data)
    if down * 2 >= total:
        headline = f"Crime is down in {down} of the {total} precincts that make up your district"
    else:
        up = sum(1 for r in rows_data if (r["all"]["pct"] or 0) > 0)
        headline = f"Crime is up in {up} of the {total} precincts that make up your district"

    week_end = data["citywide"]["report_period"]["week_end"]
    through = datetime.strptime(week_end, "%m/%d/%Y").strftime("%B %-d, %Y")
    year_cur = datetime.strptime(week_end, "%m/%d/%Y").year
    cw = {cat: ytd(data["citywide"], names)["pct"] for cat, names in
          [("all", MAJORS), ("violent", MAJOR_VIOLENT), ("property", MAJOR_PROPERTY)]}

    count_word = NUM_WORD.get(total, str(total))
    if driver:
        dlabel, _ = dir_pct(driver["pct"])
        driver_clause = (f", with the biggest single factor being {CRIME_EXPAND[driver['name']]}, "
                         f"{dlabel.lower()} on average across the district&rsquo;s precincts")
    else:
        driver_clause = ""
    intro = (f"NYPD reports crime by police precinct, and {count_word} precinct{'s' if total != 1 else ''} "
             f"overlap{'s' if total == 1 else ''} Council District {n}. Here is how each is trending{driver_clause}.")

    precinct_rows = []
    for r in rows_data:
        num_label = r["key"].replace(" Precinct", " Pct")
        hood = f' <span style="font-weight:400;color:#6b7280;">&middot; {r["hood"].split(",")[0]}</span>' if r["hood"] else ""
        precinct_rows.append(
            "<tr>\n"
            f'  <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-family:\'Hanken Grotesk\','
            f'Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#111;">{num_label}{hood}</td>\n'
            f'  <td align="right" style="padding:8px 0 8px 10px;border-bottom:1px solid #f3f4f6;'
            f"font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;\">"
            f'{round(r["share"] * 100)}%</td>\n'
            + "\n".join(pct_cell(r[cat]["pct"], right_pad="8px 0 8px 10px") for cat in ("all", "violent", "property"))
            + "\n</tr>")

    member = f" &middot; Council Member {d['member']}" if d.get("member") else ""
    link = f"{SITE}?tab=council&district={n}"
    out = template
    for token, value in {
        "{{DISTRICT}}": str(n),
        "{{CADENCE}}": cadence.capitalize(),
        "{{CADENCE_LOWER}}": cadence.lower(),
        "{{HEADLINE}}": headline,
        "{{MEMBER_LINE}}": member,
        "{{THROUGH_DATE}}": through,
        "{{YEAR_CUR}}": str(year_cur),
        "{{YEAR_PRI}}": str(year_cur - 1),
        "{{INTRO}}": intro,
        "{{PRECINCT_ROWS}}": "\n".join(precinct_rows),
        "{{DISTRICT_ALL}}": pct_cell(w["all"]),
        "{{DISTRICT_VIOLENT}}": pct_cell(w["violent"]),
        "{{DISTRICT_PROPERTY}}": pct_cell(w["property"]),
        "{{CITYWIDE_ALL}}": pct_cell(cw["all"]),
        "{{CITYWIDE_VIOLENT}}": pct_cell(cw["violent"]),
        "{{CITYWIDE_PROPERTY}}": pct_cell(cw["property"]),
        "{{LINK}}": link,
        "{{WEEK_END}}": through,
    }.items():
        out = out.replace(token, value)
    leftover = re.findall(r"\{\{[A-Z_]+\}\}", out)
    if leftover:
        raise RuntimeError(f"unfilled tokens: {leftover}")
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--district", type=int, nargs="*", default=[])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--cadence", default="monthly", choices=["monthly", "quarterly"])
    args = ap.parse_args()

    data = json.load(open(ROOT / "data/latest_compstat.json"))
    council = json.load(open(ROOT / "src/data/council_districts.json"))["districts"]
    hoods = neighborhoods()
    template = (ROOT / "scripts/email_template.html").read_text()
    outdir = ROOT / "email_preview"
    outdir.mkdir(exist_ok=True)

    targets = council if args.all else [d for d in council if d["district"] in args.district]
    if not targets:
        raise SystemExit("no districts selected — use --district N or --all")
    for d in targets:
        html = render_district(d, data, hoods, template, args.cadence)
        dst = outdir / f"district_{d['district']:02d}.html"
        dst.write_text(html)
        print(f"wrote {dst.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
