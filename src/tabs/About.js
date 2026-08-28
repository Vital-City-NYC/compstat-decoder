import React from 'react';
import { expandCrime, expandCrimeTitle } from '../shared';

/* ------------------------------------------------------------------ */
/* ABOUT TAB                                                           */
/* Ordered by importance: what this is, where every number comes from, */
/* then how to interpret them. Methodology lives inline with the       */
/* source or figure it concerns, not in a trailing list.               */
/* ------------------------------------------------------------------ */

const H = ({ children }) => (
  <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3 mt-10 first:mt-0">{children}</h3>
);
const P = ({ children }) => (
  <p className="text-[15px] leading-relaxed text-gray-700 mb-3">{children}</p>
);
const A = ({ href, children }) => (
  <a href={href} className="underline hover:text-black" target="_blank" rel="noopener noreferrer">{children}</a>
);
const Code = ({ children }) => <code className="text-[12px]">{children}</code>;

export default function About({ contextData, parsedData, feedWeekEnd, fetchError }) {
  const ctx = contextData;
  const rev = ctx?.revisions;
  const expand = (n) => (expandCrime(n) || String(n || '').toLowerCase());
  const expandTitle = (n) => expandCrimeTitle(n);

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-black font-serif mb-6">About this project</h2>

      <P>
        Published by <A href="https://vitalcitynyc.org/">Vital City</A>, an independent New York policy
        journal. NYC CompStat Decoder reads the NYPD&rsquo;s weekly CompStat report and puts the week&rsquo;s numbers in
        longer-run and geographic context. The project is open source. Everything on this site traces to one of
        the sources described below; each note says what the data covers, where it comes from, and what was done to it.
      </P>

      <H>The CompStat report</H>
      <P>
        The core source is the NYPD&rsquo;s weekly CompStat report, downloaded directly from the department&rsquo;s
        published <A href="https://www.nyc.gov/site/nypd/stats/crime-statistics/compstat.page">CompStat
        workbooks</A> each Monday after the NYPD posts them &mdash; 88 spreadsheets covering the city as a whole,
        the nine patrol boroughs, and all 78 precincts, with week, 28-day, and year-to-date comparisons against
        the same period a year earlier, plus shootings, misdemeanor assault, petit larceny, retail theft, hate
        crimes and housing totals. &ldquo;Year-to-date&rdquo; follows the CompStat week, which ends on Sunday.
        &ldquo;Rape (UCR)&rdquo; uses the FBI&rsquo;s broader Uniform Crime Reporting definition, which runs
        higher than New York&rsquo;s penal-law rape count.
      </P>

      <H>Historical series, 1993&ndash;2025</H>
      <P>
        Annual counts of the seven major felonies and shooting incidents, citywide and by precinct, drive the
        &ldquo;trend since 1993&rdquo; sparklines, the pre-pandemic baseline (the mean and range of the
        2017&ndash;2019 annual totals) and the optional 2019 comparison. These come
        from the NYPD&rsquo;s <A href="https://www.nyc.gov/site/nypd/stats/crime-statistics/historical.page">Historical
        New York City Crime Data</A>, which the department updates each year, and can differ slightly from FBI
        Uniform Crime Reporting figures. The current-year dot on the sparklines is an annualized
        projection: <Code>current_ytd / (prior_year_ytd / prior_year_full)</Code>.
      </P>

      <H>NYC Open Data</H>
      <P>
        Two live queries go to the city&rsquo;s open data portal, each for a specific feature:
      </P>
      <P>
        <strong>Shooting incidents.</strong> The map under By Council District plots the NYPD Shooting
        Incident Data, year to date (<Code>5ucz-vwe8</Code>), at the incident level. The latitude and
        longitude fields are transposed in the source dataset; the site corrects for this. Every
        incident with coordinates is plotted. NYPD geocodes incidents to street-segment midpoints and
        intersections rather than exact addresses, and when it cannot locate an address at all it
        defaults the coordinates to the precinct stationhouse &mdash; historically a small share of
        records, roughly 1 in 35.
      </P>
      <P>
        <strong>Precinct locator.</strong> The &ldquo;locate me&rdquo; button checks the visitor&rsquo;s
        position against the police precinct boundary file (<Code>y76i-bdw7</Code>) to select a precinct.
        Location is used for that lookup only and is not stored.
      </P>

      <H>Peer cities</H>
      <P>
        The city comparison on the home page uses the <A href="https://realtimecrimeindex.com/">Real-Time
        Crime Index</A> by AH Datalytics, a monthly compilation of open crime data from several hundred U.S.
        cities. Rates per 100,000 use the population figures RTCI publishes. Cities that have not yet
        reported for the displayed period are excluded rather than shown as zero. If the live file is
        unreachable, an embedded snapshot is shown with its date noted.
      </P>

      <H>Populations and rates</H>
      <P>
        Per-100,000 rates use 2020 decennial Census populations. We allocate them ourselves: every
        one of New York City&rsquo;s 37,984 census blocks is assigned to the precinct containing it, using
        block counts and boundaries from the Census Bureau&rsquo;s
        <A href="https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_apps.html">TIGERweb</A> service, and
        the blocks are summed. The block total reconciles to the published city figure of 8,804,190 exactly.
        Patrol borough populations are sums of their precincts. Doing this ourselves rather than relying on
        a published crosswalk matters because precinct boundaries change: the 116th Precinct opened in
        December 2024 out of the 105th and 113th, and a static file cannot know that. Block-level population
        is published only in the decennial count, so these figures are fixed at 2020 and do not reflect
        housing built since. Rates reflect residential population. The three &ldquo;tourist hub&rdquo; precincts
        (14th, 18th and 22nd) have daytime populations far above their residential ones, most extremely
        the 22nd (Central Park, 129 residents), so their rates carry a hatch overlay as a warning; %
        changes are unaffected.
      </P>

      {/* WEIGHTED-AVG HIDDEN 2026-08-28 (Liz's call): no combined district figure is published,
          so the methodology explaining how one was derived came out with it. The weighting is
          still computed (src/data/district_crosswalk.json, scripts/build_populations.py). The
          paragraph that ran here until 2026-08-28, to restore alongside the figures:

          "...by precinct, not by district, each district's figures are built from its precincts'
          year-to-date CompStat counts. Each precinct contributes the share of its crime matching
          the share of ITS residents who live inside the district, measured by summing 2020 census
          blocks. Add those pieces together and they total the crime estimated to have occurred in
          the district; divide by the district's residents and you have its rate. This is still an
          approximation, and the assumption is explicit: crime is taken to be spread evenly across
          a precinct's residents. It replaces an earlier method that weighted by land area, which
          assumed crime was spread evenly across a precinct's acreage and so gave enormous weight
          to places where nobody lives - the 113th Precinct is 43% of District 31 by area and holds
          two residents, being mostly JFK. Every overlap now counts, however small, since a sliver
          carries few residents and little weight on its own."
      */}
      <H>Council districts</H>
      <P>
        District boundaries are the official 2023 City Council lines from NYC Open Data, and member names
        come from <A href="https://council.nyc.gov/districts/">council.nyc.gov</A>. Because the NYPD reports
        by precinct, not by district, we show each overlapping precinct on its own rather than
        combining them into a single district figure. A precinct is listed when any of the
        district&rsquo;s residents live in it, and the share shown is the share of the district&rsquo;s
        population living in that precinct&rsquo;s part, measured by summing 2020 census blocks. Where a
        precinct is described as up or down &ldquo;on average across the district&rsquo;s precincts,&rdquo;
        that is a plain average in which each precinct counts once. District figures are always year to
        date, since weekly counts are too small at that geography to be meaningful.
      </P>

      <H>Why the current year&rsquo;s numbers keep changing</H>
      <P>
        CompStat counts are, in the NYPD&rsquo;s own words on every report, &ldquo;preliminary and subject to
        further analysis and revision.&rdquo; A complaint is classified when it is reported and reclassified as
        evidence arrives, and corrections run overwhelmingly upward, because underclassifying a crime causes
        real operational harm and gets caught, while the reverse mostly does not. John Hall documented the
        pattern in <A href="https://www.vitalcitynyc.org/real-crime-numbers-nyc-nypd/">The Real Crime
        Numbers</A>, finding that every one of 95 monthly totals he examined was later revised upward.
      </P>
      <P>
        We measure the effect on this site&rsquo;s own feed and recompute it every week. An archive of weekly
        snapshots lets each week&rsquo;s year-to-date total be compared against what it should have been given
        only the week just added; anything left over is backfill into weeks already published.{rev ? (
          <>
            {' '}Across {ctx.n_snapshots} snapshots ({ctx.window_start} to {ctx.window_end}), citywide
            current-year counts ran <strong>{rev.citywide_pct}% above</strong> the sum of the weeks
            reported, concentrated in {expand(rev.largest_upward)} and felony assault. Over the same span
            the prior-year comparison figures moved <strong>{rev.prior_year_pct}%</strong>.
            {rev.only_downward?.length === 1 && <> {expandTitle(rev.only_downward[0])} was the only category to revise downward.</>}
          </>
        ) : ' Those figures load with the site; if the panel below is empty the measurement file could not be reached.'}
      </P>
      {rev && (
        <div className="overflow-x-auto mb-4">
          <table className="text-[13px] text-gray-700 w-full max-w-lg">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-200">
                <th className="text-left py-1.5">Offense</th>
                <th className="text-right py-1.5">Added</th>
                <th className="text-right py-1.5">Backfill</th>
                <th className="text-right py-1.5">Revised</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rev.by_offense)
                .sort((a, b) => (b[1].pct ?? 0) - (a[1].pct ?? 0))
                .map(([name, v]) => (
                  <tr key={name} className="border-b border-gray-100">
                    <td className="py-1">{expandTitle(name)}</td>
                    <td className="py-1 text-right tabular-nums">{v.added.toLocaleString()}</td>
                    <td className="py-1 text-right tabular-nums">{v.backfill.toLocaleString()}</td>
                    <td className="py-1 text-right tabular-nums font-bold">{v.pct > 0 ? '+' : ''}{v.pct}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <P>
        Treat the current year as provisional and the prior-year comparison as settled. Small declines
        early in the year are the least reliable numbers on this site, and a change of a few percentage points may not
        survive revision.
      </P>
      <P>
        The same drift affects the rolling 52-week view. Its newest weeks are still accruing revisions while
        the comparison window has already settled, so the 52-week figures run slightly low &mdash; overstating
        declines and understating increases. Measured against revision-adjusted figures, the gap came
        to about a third of a percentage point: a raw 52-week decline of 3.8% corresponded to roughly 3.4%.
        The effect is smaller than the same bias in year-to-date comparisons, which is one reason the 52-week
        window is this site&rsquo;s default.
      </P>

      <H>Fine print</H>
      <P>
        The NYPD divided Patrol Borough Bronx into Bronx North and Bronx South on May 20, 2026, and restated
        both commands back through the historical tables to 1990; the figures here cover the full span. One
        figure in the NYPD&rsquo;s files does not reconcile: Bronx South&rsquo;s workbook counts 87 more
        complaints year to date than its six precincts do, and that same 87 is the entire difference between
        the citywide workbook and the sum of all 78 precinct files. The gap appears only in 2025 and 2026, and
        the workbooks do not say what it represents.
      </P>
      <P>
        Small samples are handled conservatively: precinct-level pattern callouts require at least 5 incidents
        in the prior period, and table rows with a prior-year base under 30 are marked volatile and muted.
      </P>

      <div className="mt-10 pt-6 border-t border-gray-200 text-[13px] text-gray-500 leading-snug">
        <p className="mb-2">
          {(feedWeekEnd || parsedData.period?.week_end)
            ? `Data through the CompStat week ending ${(feedWeekEnd || parsedData.period.week_end).replace(/\/20(\d\d)$/, '/$1')}.`
            : 'Data date unavailable.'} Page rendered {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.{fetchError && ' The live feed could not be reached — figures shown are an embedded snapshot from that older week.'}
        </p>
        <p><a href="https://github.com/Vital-City-NYC/compstat-decoder" className="underline hover:text-black" target="_blank" rel="noopener noreferrer">View source on GitHub →</a></p>
      </div>
    </div>
  );
}
