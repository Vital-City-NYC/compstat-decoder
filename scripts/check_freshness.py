#!/usr/bin/env python3
"""Fail loudly when the feed has gone stale.

The scraper already refuses to write when one workbook lags the rest. This guard
catches the quieter failure: the NYPD posts nothing at all, the scrape finds no
change, and the run stays green while the site serves old numbers indefinitely.

CompStat weeks end Sunday and the NYPD posts the workbooks on Mondays, so on any
given day the citywide week_end should be at most ~7 days old. Anything past
MAX_AGE_DAYS means either the NYPD is late (the Tuesday retry will usually heal
it) or the pipeline is broken (a red run + alarm issue is exactly right).
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_AGE_DAYS = 8

data = json.load(open(Path(__file__).resolve().parent.parent / "data/latest_compstat.json"))
week_end = data["citywide"]["report_period"]["week_end"]
age = (datetime.now(timezone.utc) - datetime.strptime(week_end, "%m/%d/%Y").replace(tzinfo=timezone.utc)).days
print(f"citywide data through {week_end} ({age} days old)")
if age > MAX_AGE_DAYS:
    sys.exit(f"STALE FEED: newest CompStat week ended {week_end}, {age} days ago "
             f"(limit {MAX_AGE_DAYS}). The NYPD has not posted, or the scrape is not landing.")
print("freshness OK")
