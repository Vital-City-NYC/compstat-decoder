#!/usr/bin/env python3
"""Render the per-precinct subscriber email from live CompStat data.

The precinct counterpart to render_district_email.py, for subscribers who chose a
single police precinct instead of a council district. Because there is only one
geography to report, the space a district email spends on a precinct-by-precinct
breakdown goes to crime TYPE instead: the seven major felonies and how each moved.

Structure (Ted's, 2026-08-19):
  How crime is trending   -> seven major felonies, then precinct vs. citywide trend
  How this precinct compares -> rate per 100,000 as a column chart vs. borough and city

Usage:
  python3 scripts/render_precinct_email.py --precinct 71
  python3 scripts/render_precinct_email.py --precinct 71 --cadence quarterly
  python3 scripts/render_precinct_email.py --all
Output: email_preview/precinct_NNN.html

Every number comes from data/latest_compstat.json — the same file the website reads.
Nothing is invented; a precinct whose data cannot be computed is skipped loudly.
"""
import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from render_district_email import (
    ROOT, MAJORS, MAJOR_VIOLENT, MAJOR_PROPERTY, CRIME_EXPAND, GREEN, RED, GRAY,
    SITE, TOURIST, ordinal, dir_pct, populations, neighborhoods, ytd,
)

# Below this prior-year count a percentage change is noise, so we print an asterisk
# instead. Same threshold the site's Crime Numbers tab uses to gray a volatile row.
MIN_BASE = 30
# Patrol boroughs are halves ("Brooklyn North"); subscribers think in whole boroughs.
REAL_BOROUGH = {"Bronx North": "the Bronx", "Bronx South": "the Bronx",
                "Brooklyn North": "Brooklyn", "Brooklyn South": "Brooklyn",
                "Manhattan North": "Manhattan", "Manhattan South": "Manhattan",
                "Queens North": "Queens", "Queens South": "Queens",
                "Staten Island": "Staten Island"}


def pnum(key):
    """71st Precinct -> 71."""
    return int("".join(ch for ch in key if ch.isdigit()))


def and_list(items):
    items = list(items)
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f" and {items[-1]}"   # VC style: no serial comma


def name_td(text, bold=True):
    return ('<td style="padding:9px 0;border-bottom:1px solid #f3f4f6;'
            "font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;font-size:12px;"
            f'font-weight:{"700" if bold else "400"};color:#111;">{text}</td>')


def num_td(text, color="#111", weight="400"):
    return ('<td align="right" style="padding:9px 0 9px 10px;border-bottom:1px solid #f3f4f6;'
            "font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;font-size:13px;"
            f'font-weight:{weight};white-space:nowrap;color:{color};">{text}</td>')


def compute_precinct(key, data):
    """One precinct's numbers: per-offense YTD rows plus the three aggregates.
    Shared by the renderer and by preflight.py's vet checks."""
    geo = data.get(key)
    if not geo:
        raise RuntimeError(f"{key}: not in the feed")
    rows = []
    for name in MAJORS:
        y = geo.get("seven_major_felonies", {}).get(name, {}).get("year_to_date", {})
        cur, pri = y.get("current_year"), y.get("prior_year")
        if not isinstance(cur, (int, float)) or not isinstance(pri, (int, float)):
            raise RuntimeError(f"{key}: {name} has no usable year-to-date figures")
        rows.append({"name": name, "cur": cur, "pri": pri,
                     "pct": ((cur - pri) / pri * 100) if pri > 0 else None,
                     "small": pri < MIN_BASE})
    agg = {cat: ytd(geo, names) for cat, names in
           [("all", MAJORS), ("violent", MAJOR_VIOLENT), ("property", MAJOR_PROPERTY)]}
    if any(v is None for v in agg.values()):
        raise RuntimeError(f"{key}: aggregate year-to-date figures are incomplete")
    return {"key": key, "rows": rows, "agg": agg}


def borough_rate(boro_label, boro_of, pops, data):
    """Whole-borough rate per 100k: every precinct in both patrol halves, summed.
    Tourist precincts and any without a population are left out of both sides."""
    cur = pop = 0
    for num, patrol in boro_of.items():
        if REAL_BOROUGH.get(patrol) != boro_label:
            continue
        key = f"{ordinal(num)} Precinct"
        if key in TOURIST or not pops.get(key):
            continue
        stats = ytd(data.get(key) or {}, MAJORS)
        if stats:
            cur += stats["cur"]
            pop += pops[key]
    return (cur / pop * 100000) if pop else None


def trend_clause(mine, city):
    """How one category moved here versus citywide, in plain words."""
    if mine is None or city is None:
        return None
    if mine > 0 and city <= 0:
        return "risen while citywide it has fallen"
    if mine < 0 and city >= 0:
        return "fallen while citywide it has risen"
    if mine < 0:
        return ("fallen more than in the city as a whole" if mine < city
                else "fallen, but less than in the city as a whole")
    if mine > 0:
        return ("risen more than in the city as a whole" if mine > city
                else "risen, but less than in the city as a whole")
    return "held flat"


def small_base_note(smalls):
    """Ted's wording when the suppressed offenses all moved the same way; a neutral
    line when they didn't. Named offenses vary by precinct, so this is generated."""
    if not smalls:
        return ""
    names = and_list(CRIME_EXPAND[r["name"]] + "s" for r in smalls)
    ups = [r for r in smalls if r["cur"] > r["pri"]]
    downs = [r for r in smalls if r["cur"] < r["pri"]]
    either = "either" if len(smalls) == 2 else ("them" if len(smalls) > 2 else "it")
    if ups and not downs:
        text = (f"More {names} have been reported so far this year than last, but there are "
                f"too few of {either} to calculate a reliable percentage change.")
    elif downs and not ups:
        text = (f"Fewer {names} have been reported so far this year than last, but there are "
                f"too few of {either} to calculate a reliable percentage change.")
    else:
        text = (f"Counts of {names} are too small in this precinct to calculate a reliable "
                f"percentage change.")
    return ("  <p style=\"margin:0 0 12px 0;font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;"
            "font-size:11px;line-height:1.5;color:#6b7280;font-style:italic;\">* "
            f"{text}</p>\n")


def rate_chart(bars):
    """A column chart built from nested tables with bgcolor — the one charting
    technique that survives Gmail, Outlook and Apple Mail. Zero baseline always."""
    max_h, max_v = 96, max(v for _, v in bars)
    vals = tops = labs = ""
    for i, (label, value) in enumerate(bars):
        height = max(2, round(value / max_v * max_h))
        color = "#050507" if i == 0 else "#d1d5db"
        vals += (f'<td align="center" width="118" style="padding:0 6px 5px 6px;'
                 f"font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;font-size:15px;"
                 f'font-weight:800;color:#111;">{value:,.0f}</td>')
        tops += (f'<td align="center" valign="bottom" width="118" style="padding:0 6px;">'
                 f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>'
                 f'<td width="56" height="{height}" bgcolor="{color}" style="width:56px;height:{height}px;'
                 f'background:{color};font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td>')
        labs += (f'<td align="center" width="118" style="padding:7px 6px 0 6px;border-top:1px solid #000;'
                 f"font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;font-size:11px;"
                 f'font-weight:700;color:#374151;">{label}</td>')
    return ('  <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" '
            'style="margin:4px auto 0 auto;">\n'
            f'  <tr>{vals}</tr>\n  <tr>{tops}</tr>\n  <tr>{labs}</tr>\n  </table>\n'
            "  <p style=\"margin:8px 0 0 0;font-family:'Hanken Grotesk',Arial,Helvetica,sans-serif;"
            'font-size:10px;line-height:1.5;color:#9ca3af;text-align:center;">Major crimes per '
            "100,000 residents, year-to-date.</p>\n")


def render_precinct(key, data, hoods, template, cadence, computed=None):
    c = computed or compute_precinct(key, data)
    rows, agg = c["rows"], c["agg"]
    pops, boro_of, citywide_pop = populations()
    city = data["citywide"]
    city_agg = {cat: ytd(city, names) for cat, names in
                [("all", MAJORS), ("violent", MAJOR_VIOLENT), ("property", MAJOR_PROPERTY)]}

    week_end = city["report_period"]["week_end"]
    through = datetime.strptime(week_end, "%m/%d/%Y").strftime("%B %-d, %Y")
    year_cur = datetime.strptime(week_end, "%m/%d/%Y").year

    # ---- headline ----
    label, _ = dir_pct(agg["all"]["pct"])
    headline = (f"Year-to-date, crime in the {key} is {label.lower()} compared with last year."
                if agg["all"]["pct"] else
                f"Year-to-date, crime in the {key} is unchanged from last year.")

    # ---- intro: the release, then which offenses moved which way ----
    named = [r for r in rows if not r["small"] and r["pct"] is not None]
    # biggest mover first — that is the one worth reading
    by_move = sorted(named, key=lambda r: -abs(r["cur"] - r["pri"]))
    ups = [CRIME_EXPAND[r["name"]] for r in by_move if r["pct"] > 0]
    downs = [CRIME_EXPAND[r["name"]] for r in by_move if r["pct"] < 0]
    lead = f"NYPD released data on criminal complaints through {through}."
    if ups and downs:
        movement = (f" {and_list(ups).capitalize()} {'is' if len(ups) == 1 else 'are'} up compared "
                    f"with last year at this time, whereas {and_list(downs)} "
                    f"{'is' if len(downs) == 1 else 'are'} down.")
    elif ups:
        movement = f" {and_list(ups).capitalize()} {'is' if len(ups) == 1 else 'are'} up compared with last year at this time."
    elif downs:
        movement = f" {and_list(downs).capitalize()} {'is' if len(downs) == 1 else 'are'} down compared with last year at this time."
    else:
        movement = " No offense in this precinct is reported often enough to show a reliable year-over-year change."
    intro = lead + movement

    # ---- crime-type table ----
    crime_rows = []
    for r in rows:
        if r["small"]:
            change = num_td("*", color="#9ca3af", weight="700")
        else:
            text, color = dir_pct(r["pct"])
            change = num_td(text, color=color, weight="700")
        crime_rows.append("  <tr>" + name_td(CRIME_EXPAND[r["name"]].capitalize())
                          + num_td(f"{r['cur']:,}") + num_td(f"{r['pri']:,}", color="#6b7280")
                          + change + "</tr>")
    total_text, total_color = dir_pct(agg["all"]["pct"])
    crime_rows.append("  <tr>" + name_td("<b>All major crime</b>")
                      + num_td(f"{agg['all']['cur']:,}", weight="700")
                      + num_td(f"{agg['all']['pri']:,}", color="#6b7280", weight="700")
                      + num_td(total_text, color=total_color, weight="700") + "</tr>")

    # ---- precinct vs. citywide trend ----
    v_clause = trend_clause(agg["violent"]["pct"], city_agg["violent"]["pct"])
    p_clause = trend_clause(agg["property"]["pct"], city_agg["property"]["pct"])
    same_way = (agg["violent"]["pct"] or 0) * (agg["property"]["pct"] or 0) > 0
    joiner = "and" if same_way else "whereas"
    trend_intro = (f"Overall, violent crime in the {key} has {v_clause}, {joiner} property crime "
                   f"here has {p_clause}.")
    trend_rows = []
    for label_txt, source in [(key, agg), ("Citywide", city_agg)]:
        cells = ""
        for cat in ("all", "violent", "property"):
            text, color = dir_pct(source[cat]["pct"])
            cells += num_td(text, color=color, weight="700")
        trend_rows.append("  <tr>" + name_td(label_txt) + cells + "</tr>")

    # ---- rate comparison ----
    pop = pops.get(key)
    boro_label = REAL_BOROUGH.get(boro_of.get(pnum(key)))
    city_rate = city_agg["all"]["cur"] / citywide_pop * 100000
    if key in TOURIST or not pop:
        reason = ("draws so much daytime traffic that a rate per resident cannot be compared "
                  "with the borough or the city" if key in TOURIST else
                  "has no published population figure, so a rate per resident cannot be computed")
        rate_intro = (f"The {key} {reason}. Citywide, the rate of total major crimes is "
                      f"{city_rate:,.0f} per 100,000 residents, year-to-date.")
        chart = ""
    else:
        rate = agg["all"]["cur"] / pop * 100000
        b_rate = borough_rate(boro_label, boro_of, pops, data) if boro_label else None
        parts = []
        if b_rate:
            d = (rate / b_rate - 1) * 100
            parts.append(f"about <strong>{abs(d):.0f}% {'above' if d > 0 else 'below'} "
                         f"{boro_label}&rsquo;s rate</strong>" if abs(d) >= 1 else
                         f"<strong>about the same as {boro_label}&rsquo;s rate</strong>")
        dc = (rate / city_rate - 1) * 100
        parts.append(f"<strong>{abs(dc):.0f}% {'above' if dc > 0 else 'below'} the citywide rate</strong>"
                     if abs(dc) >= 1 else "<strong>about the same as the citywide rate</strong>")
        rate_intro = (f"The {key}&rsquo;s major-crime rate is {rate:,.0f} per 100,000 residents this "
                      f"year &mdash; {', and '.join(parts)} of {city_rate:,.0f}.")
        bars = [(key, rate)]
        if b_rate:
            bars.append((boro_label.replace("the ", ""), b_rate))
        bars.append(("Citywide", city_rate))
        chart = rate_chart(bars)

    hood = hoods.get(key, "")
    out = template
    for token, value in {
        "{{PRECINCT}}": key,
        "{{NEIGHBORHOOD_LINE}}": f" &middot; {hood}" if hood else "",
        "{{CADENCE}}": cadence.capitalize(),
        "{{CADENCE_LOWER}}": cadence.lower(),
        "{{HEADLINE}}": headline,
        "{{INTRO}}": intro,
        "{{SMALL_BASE_NOTE}}": small_base_note([r for r in rows if r["small"]]),
        "{{CRIME_ROWS}}": "\n".join(crime_rows),
        "{{TREND_INTRO}}": trend_intro,
        "{{TREND_ROWS}}": "\n".join(trend_rows),
        "{{RATE_INTRO}}": rate_intro,
        "{{RATE_CHART}}": chart,
        "{{LINK}}": f"{SITE}?geo={key.replace(' ', '+')}&range=ytd",
        "{{THROUGH_DATE}}": through,
        "{{YEAR_CUR}}": str(year_cur),
        "{{YEAR_PRI}}": str(year_cur - 1),
    }.items():
        out = out.replace(token, value)
    leftover = re.findall(r"\{\{[A-Z_]+\}\}", out)
    if leftover:
        raise RuntimeError(f"{key}: unfilled template tokens {sorted(set(leftover))}")
    return out


def all_precinct_keys(data):
    return sorted((k for k in data if k.endswith(" Precinct")), key=pnum)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--precinct", nargs="+", type=int, help="precinct numbers, e.g. 71 78")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--cadence", default="monthly", choices=["monthly", "quarterly"])
    ap.add_argument("--out", default=str(ROOT / "email_preview"))
    args = ap.parse_args()
    if not args.precinct and not args.all:
        ap.error("pass --precinct N [N ...] or --all")

    data = json.load(open(ROOT / "data/latest_compstat.json"))
    hoods = neighborhoods()
    template = (ROOT / "scripts/precinct_email_template.html").read_text()
    keys = all_precinct_keys(data) if args.all else [f"{ordinal(n)} Precinct" for n in args.precinct]

    outdir = Path(args.out)
    outdir.mkdir(exist_ok=True)
    for key in keys:
        try:
            html_out = render_precinct(key, data, hoods, template, args.cadence)
        except RuntimeError as e:
            print(f"  SKIP {e}")
            continue
        num = pnum(key)
        suffix = "" if args.cadence == "monthly" else f"_{args.cadence}"
        dst = outdir / f"precinct_{num:03d}{suffix}.html"
        dst.write_text(html_out)
        print(f"wrote {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
