import React from 'react';
import { expandCrime, expandCrimeTitle } from '../shared';

/* ------------------------------------------------------------------ */
/* ABOUT TAB                                                           */
/* Full accounting of every data source the dashboard uses, live or    */
/* embedded, and the methodology applied to each.                      */
/* ------------------------------------------------------------------ */

const H = ({ children }) => (
  <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3 mt-10 first:mt-0">{children}</h3>
);
const P = ({ children }) => (
  <p className="font-serif text-[15px] leading-relaxed text-gray-700 mb-3">{children}</p>
);
const A = ({ href, children }) => (
  <a href={href} className="underline hover:text-black" target="_blank" rel="noopener noreferrer">{children}</a>
);
const Code = ({ children }) => <code className="text-[12px]">{children}</code>;

export default function About({ contextData, parsedData, fetchError }) {
  const ctx = contextData;
  const rev = ctx?.revisions;
  const expand = (n) => (expandCrime(n) || String(n || '').toLowerCase());
  const expandTitle = (n) => expandCrimeTitle(n);

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-black font-serif mb-6">About this project</h2>

      <P>
        {/* VC mention hidden pre-publication — to restore, put this sentence back at the start of the paragraph:
            Published by <A href="https://vitalcitynyc.org/">Vital City</A>, an independent New York policy journal. */}
        NYC CompStat Decoder reads the NYPD&rsquo;s weekly CompStat report and puts the week&rsquo;s numbers in
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
        crimes and housing totals. Nothing sits between those files and this page.
      </P>
      <P>
        Reading the NYPD&rsquo;s files has one trap worth naming, since it caught this dashboard. When a command
        is retired, its workbook is not always removed. The NYPD divided Patrol Borough Bronx into Bronx North
        (the 46th, 47th, 48th, 49th, 50th and 52nd precincts) and Bronx South (the 40th through 45th) on
        May 20, 2026, and now publishes a workbook for each &mdash; but the old combined file is still sitting at
        its old address, still answering successfully, still serving the last report it ever carried, for the week
        ending May 17, 2026. A pipeline that only checks whether a file is missing will read those numbers and
        present them as current. So every workbook is now checked against the citywide report period, and a
        lagging file stops the update rather than passing through it.
      </P>
      <P>
        Because precinct boundaries did not change, the NYPD restated both Bronx commands across the whole
        period rather than starting them in May, back through the historical tables to 1990. The figures here
        cover the full span, including the weeks before the split.
      </P>
      <P>
        One figure does not reconcile, and it is the NYPD&rsquo;s, not ours. Bronx South&rsquo;s workbook counts
        87 more complaints year to date than its six precincts do, and that same 87 is the entire difference
        between the citywide workbook and the sum of all 78 precinct files. Bronx North matches its precincts
        exactly, as did the old combined Bronx file. The gap appears only in 2025 and 2026 &mdash; the 1990, 1993,
        1998 and 2001 rows all match to the digit. The workbooks do not say what it represents.
      </P>
      <P>
        Nearly every count and % change on the dashboard comes from this report. If the live feed is
        unreachable, the site falls back to an embedded snapshot of a recent week and says so in the footer below.
      </P>

      <H>Why the current year&rsquo;s numbers keep changing</H>
      <P>
        CompStat counts are, in the NYPD&rsquo;s own words on every report, &ldquo;preliminary and subject to
        further analysis and revision.&rdquo; A complaint is classified when it is reported and reclassified as
        evidence arrives: a hospital exam reveals a broken jaw and a misdemeanor assault becomes a felony; a
        medical examiner rules weeks later that a death was a homicide; a car reported stolen turns out to have
        been towed. Corrections run overwhelmingly in one direction, because underclassifying a crime causes
        real operational harm and gets caught, while the reverse mostly does not. John Hall documented the
        pattern in <A href="https://www.vitalcitynyc.org/real-crime-numbers-nyc-nypd/">The Real Crime
        Numbers</A>, finding that every one of 95 monthly totals he examined was later revised upward.
      </P>
      <P>
        We measure the effect on this dashboard&rsquo;s own feed, and recompute it every week so the
        figures below never go stale. An archive of weekly snapshots lets each week&rsquo;s year-to-date
        total be compared against what it should have been given only the week just added; anything left
        over is backfill into weeks already published.{rev ? (
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
          <table className="text-[13px] font-serif text-gray-700 w-full max-w-lg">
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
        So: treat the current year as provisional and the prior-year comparison as settled. Small declines
        early in the year are the least reliable numbers on this site, and a change of a few percentage points may not
        survive revision.
      </P>

      <H>Historical series, 1993&ndash;2025</H>
      <P>
        Annual counts of the seven major felonies and shooting incidents, citywide and by precinct, drive the
        &ldquo;trend since 1993&rdquo; sparklines and the long-run context throughout the dashboard. These come
        from the NYPD&rsquo;s <A href="https://www.nyc.gov/site/nypd/stats/crime-statistics/historical.page">Historical
        New York City Crime Data</A>, which the department updates each year. They can differ slightly from FBI
        Uniform Crime Reporting figures for the same years.
      </P>

      <H>NYC Open Data</H>
      <P>
        Two live queries go to the city&rsquo;s open data portal, each for a specific feature:
      </P>
      <P>
        <strong>Shooting incidents.</strong> The map under By Council District plots the NYPD Shooting
        Incident Data, year to date (<Code>5ucz-vwe8</Code>), at the incident level. The latitude and
        longitude fields are transposed in the source dataset; the site corrects for this.
      </P>
      <P>
        <strong>Precinct locator.</strong> The &ldquo;locate me&rdquo; button checks the visitor&rsquo;s
        position against the police precinct boundary file (<Code>78dh-3ptz</Code>) to select a precinct.
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
        Per-100,000 rates use 2020 decennial Census populations, allocated to precincts
        via <A href="https://github.com/jkeefe/census-by-precincts">John Keefe&rsquo;s census-by-precincts
        crosswalk</A>; patrol borough populations are sums of their precincts, and the citywide figure is
        8,804,190. Rates reflect residential population. The three &ldquo;tourist hub&rdquo; precincts
        (14th, 18th and 22nd) have daytime populations far above their residential ones, most extremely
        the 22nd (Central Park, 129 residents), so their rates carry a hatch overlay as a warning; %
        changes are unaffected.
      </P>

      <H>Council districts</H>
      <P>
        District boundaries are the official 2023 City Council lines from NYC Open Data, and member names
        come from <A href="https://council.nyc.gov/districts/">council.nyc.gov</A>. Because the NYPD reports
        by precinct, not by district, each district&rsquo;s figures are built by weighting its precincts&rsquo;
        year-to-date CompStat counts by the share of the district&rsquo;s land area falling in each precinct
        (overlaps under 2% are dropped as boundary slivers). This is an approximation: it assumes
        crime is spread evenly within a precinct. District figures are always year to date, since weekly
        counts are too small at that geography to be meaningful.
      </P>

      <H>The 30-year page</H>
      <P>
        The &ldquo;30-Year Transformation&rdquo; page draws on the same historical series, plus citywide
        misdemeanor assault counts for 2000&ndash;2024 from the NYPD&rsquo;s historical misdemeanor tables.
        {/* VC mention hidden pre-publication — to restore, revert to original wording:
            "...per-100,000 offense rates; Vital City has not independently verified those underlying figures, and they should be read as illustrative." */}
        Its precinct scatterplot pairs precinct poverty rates against per-100,000 offense rates; those underlying
        figures have not been independently verified, and should be read as illustrative.
      </P>

      <H>Methodology notes</H>
      <ul className="space-y-1.5 leading-snug text-[13px] text-gray-600 mb-3">
        <li>&ldquo;Year-to-date&rdquo; follows the CompStat week, which ends on Sunday, compared against the same period a year earlier.</li>
        <li>The pre-pandemic baseline is the mean and range of the 2017&ndash;2019 annual totals.</li>
        <li>The current-year dot on trend sparklines is an annualized projection: <Code>current_ytd / (prior_year_ytd / prior_year_full)</Code>.</li>
        <li>Precinct-level pattern callouts require at least 5 incidents in the prior period, to avoid volatile small-sample swings.</li>
        <li>&ldquo;Rape (UCR)&rdquo; uses the FBI&rsquo;s broader Uniform Crime Reporting definition, which runs higher than New York&rsquo;s penal-law rape count.</li>
      </ul>

      <div className="mt-10 pt-6 border-t border-gray-200 text-[13px] text-gray-500 leading-snug">
        <p className="mb-2">
          Updated {(parsedData.period?.week_end || '—').replace(/\/20(\d\d)$/, '/$1')} (CompStat week ending). Page rendered {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.{fetchError && ' Live fetch unavailable — showing embedded data.'}
        </p>
        <p><a href="https://github.com/tedalcorn/compstat-decoder" className="underline hover:text-black" target="_blank" rel="noopener noreferrer">View source on GitHub →</a></p>
      </div>
    </div>
  );
}
