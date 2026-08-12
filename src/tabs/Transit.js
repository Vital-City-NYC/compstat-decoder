import React, { useState, useEffect } from 'react';
import { pctColor, dirPct, signedCount, Download } from '../shared';

/* ------------------------------------------------------------------ */
/* TRANSIT TAB                                                         */
/* ------------------------------------------------------------------ */
const TRANSIT_OFFENSE_LABELS = {
  'GRAND LARCENY': 'Grand Larceny',
  'DANGEROUS WEAPONS': 'Dangerous Weapons',
  'CRIMINAL MISCHIEF & RELATED OF': 'Criminal Mischief',
  'FELONY ASSAULT': 'Felony Assault',
  'FORGERY': 'Forgery',
  'MISCELLANEOUS PENAL LAW': 'Misc. Penal Law',
  'DANGEROUS DRUGS': 'Dangerous Drugs',
  'ROBBERY': 'Robbery',
  'SEX CRIMES': 'Sex Crimes',
  'THEFT-FRAUD': 'Theft/Fraud',
  'POSSESSION OF STOLEN PROPERTY': 'Stolen Property',
  'BURGLARY': 'Burglary',
  'RAPE': 'Rape',
  'KIDNAPPING & RELATED OFFENSES': 'Kidnapping',
  'ARSON': 'Arson',
  'MURDER & NON-NEGL. MANSLAUGHTER': 'Murder',
};

// NYC Open Data offense descriptions arrive IN ALL CAPS; anything not in the label
// map above gets title-cased so no raw shouting reaches the table.
const titleCaseOffense = (s) => (s || '')
  .toLowerCase()
  .replace(/\b\w/g, c => c.toUpperCase())
  .replace(/\bOf\b/g, 'of')
  .replace(/\bAnd\b/g, 'and')
  .replace(/\b&\s/g, '& ');
const offenseLabel = (name) => TRANSIT_OFFENSE_LABELS[name] || titleCaseOffense(name);

// Transit-system homicides are NOT carried in the NYC Open Data complaint extract used
// for the by-offense table below: murder complaints are coded to the geographic patrol
// precinct, never to a transit_district, so they are structurally invisible to that
// query (verified: 0 of 382 citywide 2024 murders carry a transit_district code; 0 ever).
// The NYPD Transit Bureau tracks transit homicides separately. The figures below are the
// Transit Bureau / MTA full-year counts as reported by NYPD and contemporaneous coverage.
// Each is a hand-entered figure with a cited source, not a live feed.
const TRANSIT_HOMICIDES = {
  note: 'Homicides are tracked by the NYPD Transit Bureau, not coded to a transit district in the complaint-level extract, so they cannot appear in the table above.',
  history: [
    { year: 2022, count: 10 },
    { year: 2023, count: 5 },
    { year: 2024, count: 10 },
    { year: 2025, count: 4 },
  ],
  context: '2025 closed with 4 transit murders, down 60% from 2024 and the lowest in five years; the first quarter of 2025 saw none, the first time in seven years. From 1997 to 2019 the system averaged roughly one to two homicides per year.',
  sources: [
    { label: 'amNewYork (NYPD 2025 year-end transit crime)', url: 'https://www.amny.com/news/subway-crime-drop-2025-nypd/' },
    { label: 'Vital City, subway safety', url: 'https://www.vitalcitynyc.org/what-the-data-show-about-subway-safety/' },
    { label: 'NYPD 2024 year-end crime statistics', url: 'https://www.nyc.gov/site/nypd/news/pr001/crime-down-across-new-york-city-2024-3-662-fewer-crimes' },
  ],
};
const TH = TRANSIT_HOMICIDES.history;
const TH_LAST = TH[TH.length - 1];
const TH_PREV = TH[TH.length - 2];
const TH_CHG = Math.round((1 - TH_LAST.count / TH_PREV.count) * 100);
const TH_MAX = Math.max(...TH.map(h => h.count));

export default function Transit({ rawData, downloadCSV }) {
  const cw = rawData?.citywide;
  const transit = cw?.additional_stats?.Transit;

  const [breakdown, setBreakdown] = useState(null); // { year, priorYear, rows: [{name, cur, prior, pct}] }
  const [breakdownLoading, setBreakdownLoading] = useState(true);
  const [breakdownErr, setBreakdownErr] = useState(false);

  useEffect(() => {
    const fetchOne = (url) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(r.status));
    // Use the latest available date in the current dataset to define the YTD window,
    // then query the SAME calendar window in the prior year so comparisons are apples-to-apples.
    // Current dataset (5uac-w243) holds the active year; historic (qgea-i56i) holds 2006-2024 (or whichever years are now closed).
    const maxUrl = "https://data.cityofnewyork.us/resource/5uac-w243.json?$select=max(rpt_dt) AS max,min(rpt_dt) AS min";
    fetchOne(maxUrl).then(meta => {
      const maxDate = meta?.[0]?.max ? new Date(meta[0].max) : new Date();
      const minDate = meta?.[0]?.min ? new Date(meta[0].min) : new Date(maxDate.getFullYear(), 0, 1);
      let year = maxDate.getFullYear();
      let monthsCovered = (maxDate.getMonth() - minDate.getMonth() + 1);

      // If the current year only has a thin slice (<3 months), fall back one year so we compare two more-complete YTD windows.
      if (monthsCovered < 3 && minDate.getFullYear() === year) {
        year = year - 1;
      }

      const priorYear = year - 1;
      // YTD cutoff date — use maxDate's month/day if it falls in `year`, else Dec 31
      const cutoffMonth = (maxDate.getFullYear() === year) ? maxDate.getMonth() : 11;
      const cutoffDay = (maxDate.getFullYear() === year) ? maxDate.getDate() : 31;
      const monthStr = String(cutoffMonth + 1).padStart(2, '0');
      const dayStr = String(cutoffDay).padStart(2, '0');
      const periodLabel = monthsCovered >= 11 || maxDate.getFullYear() !== year ? 'Full year' : `Jan 1 to ${maxDate.toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;

      // Pick the right dataset for each year. 5uac-w243 may contain both years; qgea-i56i has older years.
      const buildQuery = (dataset, fromY, toY, m, d) => `https://data.cityofnewyork.us/resource/${dataset}.json?` +
        `$select=ofns_desc,count(*) AS n&$where=transit_district IS NOT NULL AND law_cat_cd='FELONY' ` +
        `AND rpt_dt>='${fromY}-01-01T00:00:00' AND rpt_dt<='${toY}-${m}-${d}T23:59:59'` +
        `&$group=ofns_desc&$order=n DESC&$limit=50`;

      // Try current year from 5uac-w243; prior year YTD from whichever dataset has it (try 5uac first, fall back to qgea)
      const curUrl = buildQuery('5uac-w243', year, year, monthStr, dayStr);
      const priorUrlA = buildQuery('5uac-w243', priorYear, priorYear, monthStr, dayStr);
      const priorUrlB = buildQuery('qgea-i56i', priorYear, priorYear, monthStr, dayStr);

      Promise.all([
        fetchOne(curUrl),
        fetchOne(priorUrlA).then(rows => rows.length > 0 ? rows : fetchOne(priorUrlB)).catch(() => fetchOne(priorUrlB)),
      ]).then(([rows, prior]) => {
        const curMap = {};
        rows.forEach(r => { curMap[r.ofns_desc] = parseInt(r.n, 10) || 0; });
        const priMap = {};
        prior.forEach(r => { priMap[r.ofns_desc] = parseInt(r.n, 10) || 0; });
        const names = new Set([...Object.keys(curMap), ...Object.keys(priMap)]);
        const combined = [];
        names.forEach(n => {
          const cur = curMap[n] || 0;
          const pri = priMap[n] || 0;
          const pct = pri > 0 ? ((cur - pri) / pri) * 100 : (cur > 0 ? 100 : 0);
          combined.push({ name: n, label: offenseLabel(n), cur, prior: pri, pct, diff: cur - pri });
        });
        combined.sort((a, b) => b.cur - a.cur);
        const totalCur = combined.reduce((s, r) => s + r.cur, 0);
        const totalPri = combined.reduce((s, r) => s + r.prior, 0);
        setBreakdown({ year, priorYear, rows: combined, totalCur, totalPri, periodLabel });
        setBreakdownLoading(false);
      }).catch(() => { setBreakdownErr(true); setBreakdownLoading(false); });
    }).catch(() => { setBreakdownErr(true); setBreakdownLoading(false); });
  }, []);

  const [sortBy, setSortBy] = useState('volume'); // volume | change | delta

  if (!transit) return <div className="text-sm text-gray-500 italic py-8">Transit CompStat data unavailable in this report.</div>;

  const period = cw?.report_period || {};
  const ytd = transit.year_to_date || {};
  const wtd = transit.week_to_date || {};
  const m28 = transit.twenty_eight_day || {};
  const hist = transit.historical || {};

  const endYear = period?.week_end ? new Date(period.week_end).getFullYear() : new Date().getFullYear();
  const yy = (y) => `’${String(y).slice(-2)}`;

  // Sort the offense rows
  const rowsAll = (breakdown?.rows || []).filter(r => r.cur > 0 || r.prior > 0);
  const sorted = [...rowsAll].sort((a, b) => {
    if (sortBy === 'volume') return b.cur - a.cur;
    if (sortBy === 'change') return (b.pct || 0) - (a.pct || 0);
    if (sortBy === 'delta') return b.diff - a.diff;
    return 0;
  });
  const maxVal = sorted.reduce((m, r) => Math.max(m, r.cur, r.prior), 1);

  const SortHeader = ({ field, children, align = 'right' }) => {
    const active = sortBy === field;
    return (
      <button
        onClick={() => setSortBy(field)}
        title="Click to sort"
        className={`text-[10px] font-black uppercase tracking-widest cursor-pointer transition-colors ${active ? 'text-black' : 'text-gray-500 hover:text-black'} ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        {children}
      </button>
    );
  };

  return (
    <div>
      {/* Headline on the left; a compact vertical table of the same figures on the right. */}
      <section className="mb-8 pb-6 border-b border-gray-200 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-x-12 gap-y-6 items-start">
        <h2 className="text-2xl sm:text-3xl font-black leading-[1.12] tracking-tight text-black">
          On subways and buses, <span style={{ color: (ytd.pct_change ?? 0) > 0 ? '#c2410c' : '#15803d' }}>major felony incidents are {(ytd.pct_change ?? 0) > 0 ? 'up' : 'down'} {Math.abs(ytd.pct_change ?? 0).toFixed(1).replace(/\.0$/, '')}%</span> year-to-date{typeof ytd.current_year === 'number' && typeof ytd.prior_year === 'number' ? ` (${ytd.current_year.toLocaleString()} in ${yy(endYear)} YTD vs ${ytd.prior_year.toLocaleString()} in ${yy(endYear - 1)} YTD)` : ''}.
        </h2>
        <div className="lg:min-w-[260px] p-4 bg-gray-50 rounded-sm border border-gray-200">
          <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Major felony incidents</div>
          <table className="w-full text-[13px] border-collapse">
            <tbody>
              {[
                { label: 'Last 28 days', count: m28.current_year, pct: m28.pct_change },
                { label: 'This week', count: wtd.current_year, pct: wtd.pct_change },
                { label: `Compared to ${endYear - 2} (YTD)`, count: null, pct: hist['2_yr_pct'] },
              ].map((r, i, arr) => (
                <tr key={r.label} className={i < arr.length - 1 ? 'border-b border-gray-200' : ''}>
                  <td className="py-1.5 pr-4 text-[12px] text-gray-600 whitespace-nowrap">{r.label}</td>
                  <td className="py-1.5 text-right tabular-nums font-black text-black">{typeof r.count === 'number' ? r.count.toLocaleString() : ''}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: pctColor(r.pct) }}>{dirPct(r.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* By offense type — always visible */}
      <section>
        {breakdownLoading && <div className="text-[13px] text-gray-400 italic py-4">Fetching per-offense breakdown from NYC Open Data…</div>}
        {breakdownErr && <div className="text-[13px] text-gray-400 italic py-4">Per-offense breakdown unavailable — NYC Open Data could not be reached.</div>}
        {breakdown && (
          <div>
            <div className="flex items-center gap-2 sm:gap-4 pb-2.5 mb-1 border-b border-gray-300 bg-gray-50 -mx-2 px-2 rounded-sm">
              <span className="w-36 sm:w-40 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Offense</span>
              <div className="hidden sm:flex flex-1 min-w-[120px] items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-[7px] bg-gray-900 rounded-sm" /> {breakdown.year}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-[7px] bg-gray-300 rounded-sm" /> {breakdown.priorYear}</span>
              </div>
              <span className="flex-1 sm:flex-none w-16 text-right"><SortHeader field="volume">{breakdown.year}</SortHeader></span>
              <span className="w-56 text-right hidden sm:inline-block"><SortHeader field="delta">YTD change</SortHeader></span>
              <span className="w-24 text-right"><SortHeader field="change">YTD change (%)</SortHeader></span>
            </div>
            {sorted.map(r => {
              // Bars below this threshold render as unreadable slivers; hide them entirely
              // and rely on the numeric columns so tiny offenses (Arson, Kidnapping, Rape) read cleanly.
              const BAR_VISIBILITY_THRESHOLD = 1; // percent of max
              const rawCurW = maxVal > 0 ? (r.cur / maxVal) * 100 : 0;
              const rawPriW = maxVal > 0 ? (r.prior / maxVal) * 100 : 0;
              const showCurBar = rawCurW >= BAR_VISIBILITY_THRESHOLD;
              const showPriBar = rawPriW >= BAR_VISIBILITY_THRESHOLD;
              // Minimum visible width for bars that DO render, so they aren't 1-pixel slivers.
              const curW = showCurBar ? Math.max(rawCurW, 2) : 0;
              const priW = showPriBar ? Math.max(rawPriW, 2) : 0;
              return (
                <div key={r.name} className="flex items-center gap-2 sm:gap-4 py-2 text-[14px] border-b border-gray-50 hover:bg-gray-50/60 -mx-2 px-2 rounded-sm transition-colors">
                  <span className="w-36 sm:w-40 flex-shrink-0 font-bold text-gray-800 truncate" title={r.label}>{r.label}</span>
                  <div className="hidden sm:block flex-1 min-w-[120px]">
                    <div className="relative h-[20px]">
                      {showCurBar && <div className="absolute top-0 left-0 h-[8px] rounded-sm bg-gray-900" style={{ width: `${curW}%` }} />}
                      {showPriBar && <div className="absolute top-[11px] left-0 h-[8px] rounded-sm bg-gray-300" style={{ width: `${priW}%` }} />}
                    </div>
                  </div>
                  <span className="flex-1 sm:flex-none w-16 text-right tabular-nums font-black text-black">{r.cur.toLocaleString()}</span>
                  <span className="w-56 text-right tabular-nums hidden sm:inline-block">
                    <span className="font-bold" style={{ color: pctColor(r.diff) }}>{signedCount(r.diff)}</span>
                    <span className="text-gray-400 font-normal text-[12px]"> (vs. {r.prior.toLocaleString()} in {yy(breakdown.priorYear)})</span>
                  </span>
                  <span className="w-24 text-right tabular-nums font-bold" style={{ color: pctColor(r.pct) }}>{dirPct(r.pct)}</span>
                </div>
              );
            })}
            {/* Period total + CSV below the table */}
            <div className="flex items-center justify-end gap-5 mt-3 pt-3 border-t-2 border-gray-300">
              {downloadCSV && (
                <button
                  onClick={() => {
                    const header = ['Offense', `${breakdown.year}`, `${breakdown.priorYear}`, 'YTD change (offenses)', 'YTD change (%)'];
                    const data = breakdown.rows.map(r => [r.label, r.cur, r.prior, r.diff, typeof r.pct === 'number' ? r.pct.toFixed(2) : '']);
                    downloadCSV(`transit_crime_${breakdown.year}_vs_${breakdown.priorYear}.csv`, [header, ...data]);
                  }}
                  title="Download this table as CSV"
                  className="text-[10px] font-bold text-gray-400 hover:text-black flex items-center gap-1 transition-colors"
                >
                  <Download size={11} /> CSV
                </button>
              )}
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{breakdown.periodLabel === 'Full year' ? 'Annual total' : 'Period total'}</span>
                <span className="text-[20px] font-black tabular-nums text-black leading-none">{breakdown.totalCur.toLocaleString()}</span>
                <span className="text-[12px] tabular-nums" style={{ color: pctColor(((breakdown.totalCur - breakdown.totalPri) / (breakdown.totalPri || 1)) * 100) }}>
                  {dirPct(((breakdown.totalCur - breakdown.totalPri) / (breakdown.totalPri || 1)) * 100)} vs {breakdown.totalPri.toLocaleString()} in {yy(breakdown.priorYear)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Transit homicides — sourced separately because murder is not coded to a transit
            district in the complaint extract and cannot appear in the table above. */}
        <div className="mt-8 p-5 bg-gray-50 border border-gray-200 rounded-sm">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-600">Transit homicides</span>
          <div className="mt-2 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-x-6 gap-y-4">
            <p className="text-[13px] text-gray-600 leading-relaxed max-w-md">
              Homicides are tracked separately by the NYPD Transit Bureau. Last year closed with {TH_LAST.count} transit murders, {TH_CHG >= 0 ? 'down' : 'up'} {Math.abs(TH_CHG)}% from {TH_PREV.year} and the lowest in five years.
            </p>
            <div className="flex items-end gap-5 flex-shrink-0">
              {TH.map(h => (
                <div key={h.year} className="flex flex-col items-center">
                  <span className="text-[13px] font-black tabular-nums text-black mb-1">{h.count}</span>
                  <div className="w-9 rounded-t-sm" style={{ height: `${Math.max(3, (h.count / TH_MAX) * 56)}px`, background: '#991b1b' }} />
                  <span className="text-[10px] font-bold text-gray-500 mt-1.5 pt-1 border-t border-gray-300 w-9 text-center">{h.year}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[12px] text-gray-400 mt-6 italic leading-relaxed max-w-3xl">
          CompStat live = weekly NYPD CompStat feed for Transit Bureau (all major felonies combined, through week ending {period.week_end || '?'}).
          By-offense totals = NYC Open Data complaint-level extract filtered to records with a transit-district code, most recent complete calendar year vs prior. The two sources use different counting rules, so the aggregates will not match exactly. Homicides do not carry a transit-district code in the complaint-level extract, so they are absent from the by-offense table — transit homicides are tracked separately by the NYPD Transit Bureau and shown above.
        </p>
      </section>
    </div>
  );
}
