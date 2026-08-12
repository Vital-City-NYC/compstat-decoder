import React, { useState, useMemo } from 'react';
import crimeHistory from '../data/crime_history.json';
import {
  VC, VOLATILITY_THRESHOLD, offenseClass, expandCrimeTitle, dirPct, signedCount,
  getHistoricalContext, ContextSparkline, Download, ProvisionalNote, formatPeriodDateFull,
} from '../shared';

/* ------------------------------------------------------------------ */
/* CRIME NUMBERS TAB                                                   */
/* One table for every tracked offense: volume, trend and historical   */
/* context move together, and every column header sorts on click.      */
/* ------------------------------------------------------------------ */
const TREND_TOOLTIP = "Trend column shows the offense's annual citywide count back to the early 2010s. The blue band marks the 2017-2019 pre-pandemic range. Dot = current year, projected to a full-year equivalent from year-to-date data. Trends appear only for the 10 major offenses tracked in the 30-year history.";

// UCR Rape is the FBI's broader Uniform Crime Reporting definition of rape, distinct from
// the narrower NY penal-law "Rape" major-felony line; spell it out and explain on hover.
const UCR_RAPE_NOTE = "Rape counted under the FBI's broader Uniform Crime Reporting definition — wider than New York's penal-law \"Rape\" line, so the count runs higher.";
const displayName = (name) => name === 'UCR Rape*' ? 'Rape (UCR)' : expandCrimeTitle(name);

export default function CrimeNumbers({ parsedData, activeTab, activeGeo, isTouristPrecinct, contextData, rollingMeta, downloadCSV }) {
  const [sortBy, setSortBy] = useState('current');
  const [sortDir, setSortDir] = useState('desc');
  const [classFilter, setClassFilter] = useState('all'); // all | Person | Property

  const currentYear = parsedData.period?.week_end ? new Date(parsedData.period.week_end).getFullYear() : new Date().getFullYear();
  const isCitywide = activeGeo === 'citywide';
  const colYear = activeTab === 'ytd' ? `${currentYear} YTD`
    : activeTab === 'r52' ? 'Last 52 weeks'
    : `${currentYear} this wk`;
  const colPrior = activeTab === 'ytd' ? `${currentYear - 1} YTD`
    : activeTab === 'r52' ? 'prior 52 weeks'
    : `${currentYear - 1} same wk`;

  const rows = useMemo(() => {
    let r = parsedData.all;
    if (classFilter !== 'all') r = r.filter(o => offenseClass(o.name) === classFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (o) => {
      if (sortBy === 'name') return o.name.toLowerCase();
      if (sortBy === 'pct') return typeof o.pct === 'number' ? o.pct : -Infinity * dir;
      return o[sortBy] ?? 0;
    };
    return [...r].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [parsedData.all, classFilter, sortBy, sortDir]);

  const handleSort = (field, defaultDir = 'desc') => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir(defaultDir); }
  };

  const SortTh = ({ field, children, align = 'right', defaultDir = 'desc', title, thClass = '' }) => {
    const active = sortBy === field;
    return (
      <th className={`py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${thClass}`}>
        <button
          onClick={() => handleSort(field, defaultDir)}
          title={title || 'Click to sort'}
          className={`text-[10px] font-black uppercase tracking-widest cursor-pointer transition-colors ${active ? 'text-black' : 'text-gray-400 hover:text-black'}`}
        >
          {children}
        </button>
      </th>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center mb-4 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-gray-100 p-1 rounded border border-gray-200">
            {[['all', 'All'], ['Person', 'Person'], ['Property', 'Property']].map(([val, label]) => (
              <button key={val} onClick={() => setClassFilter(val)} className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${classFilter === val ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-black'}`}>{label}</button>
            ))}
          </div>
          <button
            onClick={() => {
              const header = ['Offense', 'Person/Property', colYear, colPrior, 'Year-on-year change (incidents)', 'Year-on-year change (%)', 'Rate per 100k', 'Citywide Rate per 100k'];
              const data = rows.map(r => [
                displayName(r.name),
                offenseClass(r.name) || '',
                r.current,
                r.prior,
                r.diff,
                typeof r.pct === 'number' ? r.pct.toFixed(2) : '',
                r.currentRate != null ? r.currentRate.toFixed(2) : '',
                parsedData.citywideRates?.[r.name] != null ? parsedData.citywideRates[r.name].toFixed(2) : '',
              ]);
              const geo = isCitywide ? 'citywide' : activeGeo.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
              const period = (parsedData.period?.week_end || 'period').replace(/[^a-z0-9]+/gi, '-');
              downloadCSV(`crime_numbers_${geo}_${activeTab}_${period}.csv`, [header, ...data]);
            }}
            title="Download this table as CSV"
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-black border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 transition-colors">
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-0 sm:min-w-[760px]">
          <thead>
            <tr className="border-b-2 border-black">
              <SortTh field="name" align="left" defaultDir="asc">Offense <span className="hidden sm:inline">(Crime type)</span></SortTh>
              <SortTh field="current">{colYear}</SortTh>
              <SortTh field="diff" thClass="hidden sm:table-cell">Year-on-year change</SortTh>
              <SortTh field="pct"><span className="sm:hidden">Change</span><span className="hidden sm:inline">Year-on-year change (%)</span></SortTh>
              {isCitywide && <th className="py-2 text-center hidden md:table-cell"><span className="text-[10px] font-black uppercase tracking-widest text-gray-400 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-[3px]" title={TREND_TOOLTIP}>Trend since {crimeHistory.citywide[0].y}</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(item => {
              const isVolatile = item.prior < VOLATILITY_THRESHOLD;
              const cls = offenseClass(item.name);
              const ctx = isCitywide ? getHistoricalContext(crimeHistory.citywide, item, currentYear) : null;
              return (
                <tr key={item.name} className="hover:bg-gray-50 transition-colors">
                  <td className="py-1 pr-2 sm:pr-8 font-bold text-[13px] sm:text-sm text-black whitespace-nowrap">
                    <span title={item.name === 'UCR Rape*' ? UCR_RAPE_NOTE : undefined} className={item.name === 'UCR Rape*' ? 'cursor-help decoration-dotted decoration-gray-300 underline underline-offset-[3px]' : undefined}>{displayName(item.name)}{isVolatile && <span className="ml-1 text-gray-400">*</span>}</span>
                    {cls && <span className="ml-1.5 text-[11px] font-semibold hidden sm:inline" style={{ color: cls === 'Person' ? VC.magenta : VC.indigo }}>({cls})</span>}
                  </td>
                  <td className={`py-1 pl-3 text-right tabular-nums text-sm font-black text-black ${isVolatile ? 'opacity-50' : ''}`}>{item.current.toLocaleString()}</td>
                  <td className={`py-1 pl-8 text-right tabular-nums text-sm hidden sm:table-cell ${isVolatile ? 'opacity-50' : ''}`}>
                    <span className={`font-bold ${item.diff > 0 ? 'text-[#d2232a]' : item.diff < 0 ? 'text-[#57aa4a]' : 'text-gray-500'}`}>{signedCount(item.diff)}</span>
                    <span className="text-gray-400 font-normal text-[12px]"> (from {item.prior.toLocaleString()} in {colPrior})</span>
                  </td>
                  <td className={`py-1 pl-3 sm:pl-8 text-right text-xs font-bold tabular-nums whitespace-nowrap ${item.pct > 0 ? 'text-[#d2232a]' : item.pct < 0 ? 'text-[#57aa4a]' : 'text-gray-500'}`}>
                    {dirPct(item.pct)}
                  </td>
                  {isCitywide && (
                    <td className="py-1 pl-6 text-right hidden md:table-cell">
                      {ctx
                        ? <ContextSparkline series={ctx.series} annualized={ctx.annualized} preLow={ctx.preLow} preHigh={ctx.preHigh} width={150} height={22} />
                        : <span className="text-gray-300 text-[11px]" title="No 30-year history for this category">—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 text-[11px] italic text-gray-500 border-t border-gray-100 pt-3">
        * Base sample under 30 (statistically volatile).
        <span className="mx-1.5 not-italic text-gray-300" aria-hidden>·</span>
        {activeTab === 'r52' && rollingMeta && (
          <span className="not-italic text-gray-400">{`52 weeks ending ${formatPeriodDateFull(rollingMeta.current_to) || rollingMeta.current_to}, against the 52 before them. `}</span>
        )}
        {/* Shown on every view, 52-week included — the tooltip carries the measured revision
            figures and the link that explains them. */}
        <ProvisionalNote year={currentYear} contextData={contextData} className="not-italic" />
        {activeTab === 'r52' && (
          <>
            <span className="mx-1.5 not-italic text-gray-300" aria-hidden>·</span>
            <span className="not-italic text-gray-400">Its newest weeks are still accruing, so the latest window reads slightly low.</span>
          </>
        )}
      </div>
    </div>
  );
}
