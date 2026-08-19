#!/usr/bin/env python3
"""Fail loudly when the feed has gone stale.

The scraper already refuses to write when one workbook lags the rest. This guard
catches the quieter failure: the NYPD posts nothing at all, the scrape finds no
change, and the run stays green while the site serves old numbers indefinitely.

CompStat weeks end Sunday and the NYPD posts the workbooks on Mondays, so on any
given day the citywide week_end should be at most ~7 days old. Anything past
MAX_AGE_DAYS means either the NYPD is late (the Tuesday retry will usually heal
it) or the pipeline is broken (a red run + alarm issue is exactly right).

SECOND GUARD, added 2026-08-19: the site reads TWO NYPD sources. The workbooks
above drive the Week and YTD views; the rolling 52-week series in rolling.json
comes from the CompStat 2.0 timeline API, which publishes a week or so behind
them. On 8/17 the workbooks carried the week ending 8/16 while the timeline API
still ended at 8/09, so the site's DEFAULT view (Past year) silently served a
week-old window while every run stayed green. A lag of up to a week is normal:
on Monday the workbooks jump to the new week while the API is still on the last
one, and it catches up within a day or two. More than 8 days means the API has
missed an entire cycle, which is a real failure nobody would otherwise see.

Do NOT gate this on the workbook age instead: the workbooks advance every Monday,
so age resets to 1 each week and a permanently dead rolling feed would never trip
a test written that way.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_AGE_DAYS = 8
MAX_ROLLING_LAG_DAYS = 8   # one full cycle of grace for the timeline API

data = json.load(open(Path(__file__).resolve().parent.parent / "data/latest_compstat.json"))
week_end = data["citywide"]["report_period"]["week_end"]
age = (datetime.now(timezone.utc) - datetime.strptime(week_end, "%m/%d/%Y").replace(tzinfo=timezone.utc)).days
print(f"citywide data through {week_end} ({age} days old)")
if age > MAX_AGE_DAYS:
    sys.exit(f"STALE FEED: newest CompStat week ended {week_end}, {age} days ago "
             f"(limit {MAX_AGE_DAYS}). The NYPD has not posted, or the scrape is not landing.")
# --- the rolling feed must catch up to the workbooks ---
root = Path(__file__).resolve().parent.parent
rolling = json.load(open(root / "data/rolling.json"))["_rolling"]
rolling_to = datetime.strptime(rolling["current_to"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
workbook_to = datetime.strptime(week_end, "%m/%d/%Y").replace(tzinfo=timezone.utc)
lag = (workbook_to - rolling_to).days
print(f"rolling series through {rolling['current_to']}")
if lag > MAX_ROLLING_LAG_DAYS:
    sys.exit(f"ROLLING FEED BEHIND: workbooks are through {week_end}, rolling series ends "
             f"{rolling['current_to']}. Re-run scripts/archive_weekly_series.py.")
print("freshness OK")
