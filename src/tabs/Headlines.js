import React, { useState, useEffect, useMemo } from 'react';
import { geoPath, geoMercator } from 'd3-geo';
import crimeHistory from '../data/crime_history.json';
import precinctGeoJSON from '../data/nyc_precincts.json';
import {
  VC, MAJOR_VIOLENT, MAJOR_PROPERTY, PATROL_BOROUGH_NAMES, PRECINCT_NEIGHBORHOODS,
  formatPop, formatRate, formatGeoName, geoWithArticle, expandCrime, expandCrimeTitle, toOrdinalPrecinct,
  getPrePandemicRecovery, precinctHistorySeries, precinctPatrolBorough, numWord,
  calcPct, dirPct, ProvisionalNote, ytdVolatility, volatilitySentence, VOLATILITY_LABEL, formatPeriodDateFull, staleGeo,
  RTCI_GROUPS, RTCI_FALLBACK, RTCI_FALLBACK_PERIOD, RTCI_FALLBACK_UPDATED, rtciRate,
  Download,
} from '../shared';

/* ------------------------------------------------------------------ */
/* LOCATOR MAP — small orientation inset for the Headlines right rail.  */
/* Shows the whole city; fills the selected borough or precinct so a    */
/* reader browsing a sub-geography can see where it sits.               */
/* ------------------------------------------------------------------ */
const LocatorMap = ({ activeGeo, onSelectGeo, width = 190, height = 150 }) => {
  const [hover, setHover] = useState(null);
  const pathFn = useMemo(() => {
    const projection = geoMercator().fitSize([width, height], precinctGeoJSON);
    return geoPath().projection(projection);
  }, [width, height]);

  const isPrecinct = activeGeo.includes('Precinct');
  const isBorough = PATROL_BOROUGH_NAMES.includes(activeGeo);
  const activeNum = isPrecinct ? parseInt(activeGeo, 10) : null;
  const activeBoro = isBorough ? activeGeo : (activeNum ? precinctPatrolBorough(activeGeo) : null);

  const isCitywide = activeGeo === 'citywide';
  const label = isCitywide ? 'New York City'
    : isBorough ? activeGeo
    : `${activeGeo}${PRECINCT_NEIGHBORHOODS[activeGeo] ? ` · ${PRECINCT_NEIGHBORHOODS[activeGeo]}` : ''}`;

  return (
    <div className="p-4 bg-gray-50 rounded-sm border border-gray-200">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {precinctGeoJSON.features.map(f => {
          const num = parseInt(f.properties.precinct, 10);
          const boro = precinctPatrolBorough(String(num));
          let fill = '#e5e7eb';
          if (isCitywide) fill = VC.magenta;                                  // whole city lit by default
          else if (activeNum && num === activeNum) fill = VC.magenta;         // the selected precinct
          else if (activeBoro && boro === activeBoro) fill = activeNum ? '#f4c4d3' : VC.magenta; // its borough
          return (
            <path
              key={num}
              d={pathFn(f)}
              fill={fill}
              stroke={hover === num ? '#111' : '#fff'}
              strokeWidth={hover === num ? 0.9 : 0.4}
              onClick={onSelectGeo ? () => onSelectGeo(toOrdinalPrecinct(num)) : undefined}
              onMouseEnter={onSelectGeo ? () => setHover(num) : undefined}
              onMouseLeave={onSelectGeo ? () => setHover(null) : undefined}
              style={onSelectGeo ? { cursor: 'pointer', filter: hover === num ? 'brightness(0.82)' : 'none' } : undefined}
            />
          );
        })}
      </svg>
      <p className="text-[11px] font-bold text-gray-700 mt-1.5 leading-tight">{label}</p>
    </div>
  );
};

/* Render a patterns bullet: **bold** spans plus [[Nth Precinct]] click-through links. */
const renderBullet = (text, onPrecinct) => {
  const boldParts = text.split(/(\*\*.*?\*\*)/g);
  return boldParts.map((part, i) => {
    const isBold = part.startsWith('**') && part.endsWith('**');
    const inner = isBold ? part.slice(2, -2) : part;
    const segs = inner.split(/(\[\[.*?\]\])/g).map((seg, j) => {
      if (seg.startsWith('[[') && seg.endsWith(']]')) {
        const name = seg.slice(2, -2);
        return (
          <button key={j} type="button" onClick={() => onPrecinct(name)}
            className="inline text-left underline decoration-dotted decoration-gray-400 underline-offset-2 hover:text-[#ff7c53] hover:decoration-[#ff7c53] transition-colors">
            {name}
          </button>
        );
      }
      return <React.Fragment key={j}>{seg}</React.Fragment>;
    });
    return isBold ? <strong key={i} className="text-black">{segs}</strong> : <React.Fragment key={i}>{segs}</React.Fragment>;
  });
};

/* ------------------------------------------------------------------ */
/* NATIONAL COMPARISON SIDEBAR — Real-Time Crime Index                 */
/* Compact version of the old full-width "National" section.           */
/* ------------------------------------------------------------------ */
const NationalSidebar = ({ rtciData, downloadCSV }) => {
  const metrics = [
    { key: 'murder', label: 'Murder' },
    { key: 'violent', label: 'Violent' },
    { key: 'property', label: 'Property' },
  ];
  const [activeMetric, setActiveMetric] = useState(() => {
    try { return localStorage.getItem('rtci_metric') || 'murder'; } catch { return 'murder'; }
  });
  const [activeGroup, setActiveGroup] = useState(() => {
    try {
      const saved = localStorage.getItem('rtci_group');
      return RTCI_GROUPS.some(g => g.key === saved) ? saved : 'largest10';
    } catch { return 'largest10'; }
  });
  useEffect(() => { try { localStorage.setItem('rtci_metric', activeMetric); } catch {} }, [activeMetric]);
  useEffect(() => { try { localStorage.setItem('rtci_group', activeGroup); } catch {} }, [activeGroup]);
  const group = RTCI_GROUPS.find(g => g.key === activeGroup) || RTCI_GROUPS[0];

  const allCities = rtciData?.cities || {};
  const period = rtciData?.period || RTCI_FALLBACK_PERIOD;
  const updated = rtciData?.updated || RTCI_FALLBACK_UPDATED;

  const citiesForGroup = group.cities.map(name => {
    if (allCities[name]) return allCities[name];
    const fb = RTCI_FALLBACK.find(c => c.city === name);
    return fb || null;
  }).filter(Boolean);

  if (!citiesForGroup.find(c => c.isNYC)) {
    const nyc = allCities['New York City'] || RTCI_FALLBACK.find(c => c.isNYC);
    if (nyc) citiesForGroup.unshift(nyc);
  }

  // A zero for the active metric means the city hasn't reported data to RTCI for this
  // window (e.g. Jacksonville) — ranking it would show it as the safest big city in
  // America. Park those cities at the bottom as "awaiting updated data" instead.
  const reporting = citiesForGroup.filter(c => c[activeMetric] > 0);
  const missing = citiesForGroup.filter(c => !(c[activeMetric] > 0));

  const ranked = reporting.map(c => ({ ...c, rate: rtciRate(c[activeMetric], c.pop) }))
    .sort((a, b) => a.rate - b.rate);
  const maxRate = ranked.length > 0 ? ranked[ranked.length - 1].rate : 1;

  return (
    <aside className="p-5 bg-gray-50 rounded-sm border border-gray-200 h-full">
      <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">How NYC Compares</h3>
      <p className="text-[12px] font-serif text-gray-600 mt-0.5 mb-3">12-month rolling rate per 100k residents</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {metrics.map(m => (
          <button key={m.key} onClick={() => setActiveMetric(m.key)}
            className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wide rounded-sm border ${activeMetric === m.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:text-gray-800'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {RTCI_GROUPS.map(g => (
          <button key={g.key} onClick={() => setActiveGroup(g.key)}
            className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-sm ${activeGroup === g.key ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-600'}`}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {ranked.map(c => {
          const barW = maxRate > 0 ? (c.rate / maxRate) * 100 : 0;
          const isNYC = c.isNYC;
          return (
            <div key={c.city} className="flex items-center gap-2">
              <span className={`w-[86px] text-right text-[11px] leading-tight truncate ${isNYC ? 'font-black text-gray-900' : 'font-medium text-gray-500'}`} title={c.city}>
                {c.city === 'New York City' ? 'New York' : c.city}
              </span>
              <div className="flex-1 h-3.5 bg-gray-200 rounded-sm overflow-hidden">
                <div className={`h-full rounded-sm ${isNYC ? 'bg-[#e7466d]' : 'bg-[#217ebe]'}`} style={{ width: `${barW}%` }} />
              </div>
              <span className={`w-12 text-[11px] tabular-nums ${isNYC ? 'font-black text-gray-900' : 'font-medium text-gray-500'}`}>
                {formatRate(c.rate)}
              </span>
            </div>
          );
        })}
        {missing.map(c => (
          <div key={c.city} className="flex items-center gap-2 opacity-70">
            <span className="w-[86px] text-right text-[11px] leading-tight truncate font-medium text-gray-400" title={c.city}>{c.city}</span>
            <span className="flex-1 text-[10px] italic text-gray-400">Awaiting updated data</span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2.5 border-t border-gray-200 flex flex-col gap-1.5">
        <p className="text-[9px] text-gray-400 leading-snug">Data through {period} · Updated {updated} · UCR Part I offenses</p>
        <div className="flex items-center gap-2.5">
          <a href="https://realtimecrimeindex.com/" target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-bold text-[#ff7c53] hover:text-black hover:underline">
            Real-Time Crime Index ↗
          </a>
          {downloadCSV && (
            <button
              onClick={() => {
                const header = ['City', 'Population', 'Murder', 'Violent Crime', 'Property Crime', 'Murder per 100k', 'Violent per 100k', 'Property per 100k'];
                const data = ranked.map(c => [c.city, c.pop, c.murder, c.violent, c.property, rtciRate(c.murder, c.pop), rtciRate(c.violent, c.pop), rtciRate(c.property, c.pop)]);
                downloadCSV(`city_comparison_${activeMetric}_${activeGroup}.csv`, [header, ...data]);
              }}
              title="Download city comparison as CSV"
              className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-black border border-gray-300 rounded px-1.5 py-0.5 hover:bg-white transition-colors flex items-center gap-1">
              <Download size={9} /> CSV
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

/* ------------------------------------------------------------------ */
/* PATTERNS & OUTLIERS — geography-aware rules                         */
/* 1. Inequality: citywide and boroughs only.                          */
/* 2. Biggest contributor to this geography's change: everywhere.      */
/* 3. Crime types above pre-pandemic baseline: citywide + precincts    */
/*    (no borough-level history exists).                               */
/* 4. Sharpest local decline / improvement: citywide and boroughs      */
/*    (scoped to the borough's precincts upstream).                    */
/* 5. Precincts only: what's most out of keeping with the citywide     */
/*    average, flagged when it also bucks the borough-wide trend.      */
/* ------------------------------------------------------------------ */
function buildBullets({ parsedData, hotspots, rawData, activeGeo, activeTab, isTouristPrecinct }) {
  const { totals, felonies, all, driver, localAnomaly, localBrightSpot } = parsedData;
  const isCitywide = activeGeo === 'citywide';
  const isBorough = PATROL_BOROUGH_NAMES.includes(activeGeo);
  const isPrecinct = activeGeo.includes('Precinct');
  const periodWord = activeTab === 'ytd' ? 'YTD' : activeTab === 'r52' ? 'in the last 52 weeks compared to the year before' : 'this week';
  // The rolling window compares two 52-week spans, neither of which is "last year", so
  // every bullet that names the baseline has to say which spans it means.
  const vsPriorPeriod = activeTab === 'r52' ? 'in the last 52 weeks than the year before' : 'than last year';
  const hereWord = isCitywide ? 'citywide' : isBorough ? `across ${activeGeo}` : 'here';
  const bullets = [];

  // 1. Geographic concentration — citywide and boroughs.
  const ineq = hotspots?.inequality;
  if ((isCitywide || isBorough) && ineq) {
    bullets.push(`**Crime is concentrated geographically:** the ${numWord(ineq.topCount)} highest-crime precincts${isBorough ? ` in ${activeGeo}` : ''} (${formatPop(ineq.topPop)} residents) match the violent crime total of the ${numWord(ineq.bottomCount)} safest (${formatPop(ineq.bottomPop)} residents).`);
  }

  // 2. Biggest contributor to this geography's change — everywhere.
  // A single offense can move more than the index's *net* change when other offenses move
  // the opposite way; in that case "X% of the change" would read above 100% and confuse, so
  // switch to a "biggest mover" framing that explains the offset.
  if (driver && driver.name && Math.abs(driver.share) >= 5) {
    const direction = totals.diff > 0 ? 'increase' : 'decline';
    const absShare = Math.abs(driver.share);
    const dCrime = expandCrime(driver.name);
    const dAbs = Math.abs(driver.diff).toLocaleString();
    if (absShare <= 100) {
      bullets.push(`**The biggest driver of the ${direction} ${hereWord} is ${dCrime}:** it accounts for ${Math.round(absShare)}% of the net ${direction} in the major-crime index (${dAbs} ${driver.diff < 0 ? 'fewer' : 'more'} cases ${vsPriorPeriod}).`);
    } else {
      bullets.push(`**The biggest mover ${hereWord} is ${dCrime}:** it ${driver.diff < 0 ? 'fell' : 'rose'} by ${dAbs} cases — more than the index's net ${direction} of ${Math.abs(totals.diff).toLocaleString()}, because other offenses moved the opposite way over the same period.`);
    }
  }

  // 3. Crime types above pre-pandemic baseline — citywide + precincts.
  const history = isCitywide ? crimeHistory.citywide
    : isPrecinct ? precinctHistorySeries(crimeHistory.precincts?.[activeGeo])
    : null;
  const recovery = history ? getPrePandemicRecovery(felonies, history) : null;
  if (recovery && recovery.total > 0) {
    if (recovery.above.length === 0) {
      bullets.push(`**All ${numWord(recovery.total)} major felonies are tracking at or below their pre-pandemic baseline (2017-2019 average)**${isPrecinct ? ' in this precinct' : ''}, projected to full year.`);
    } else {
      const names = recovery.above.map(a => expandCrimeTitle(a.name));
      const joined = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      bullets.push(`**${numWord(names.length, true)} crime ${names.length === 1 ? 'type is' : 'types are'} still tracking above the pre-pandemic baseline (2017-2019 average):** ${joined}.`);
    }
  }

  // 4. Sharpest local decline / improvement — citywide and boroughs.
  if (isCitywide || isBorough) {
    const spike = hotspots?.topPctSpike;
    if (spike && typeof spike.pct === 'number' && spike.pct >= 25) {
      bullets.push(`**The sharpest local increase is ${expandCrime(spike.crime)} in the [[${toOrdinalPrecinct(spike.precinct)}]]:** up ${Math.round(spike.pct)}% ${periodWord}, from ${spike.prior.toLocaleString()} to ${spike.current.toLocaleString()}.`);
    }
    const drop = hotspots?.topPctDrop;
    if (drop && typeof drop.pct === 'number' && drop.pct <= -25) {
      bullets.push(`**The sharpest local improvement is ${expandCrime(drop.crime)} in the [[${toOrdinalPrecinct(drop.precinct)}]]:** down ${Math.round(Math.abs(drop.pct))}% ${periodWord}, from ${drop.prior.toLocaleString()} to ${drop.current.toLocaleString()}.`);
    }
  }

  // 5. Precincts only: most out of keeping with the citywide average, with a note
  //    when the same crime is also moving against the borough-wide trend.
  if (isPrecinct && !isTouristPrecinct) {
    const borough = precinctPatrolBorough(activeGeo);
    const boroughData = borough ? rawData?.[borough] : null;
    const buckNote = (crimeName) => {
      if (!boroughData) return '';
      const stats = boroughData.seven_major_felonies?.[crimeName] || boroughData.additional_stats?.[crimeName];
      const bPct = activeTab === 'ytd' ? stats?.year_to_date?.pct_change : stats?.week_to_date?.pct_change;
      const local = all.find(o => o.name === crimeName);
      const lPct = local ? calcPct(local.current, local.prior) : null;
      if (typeof bPct !== 'number' || typeof lPct !== 'number') return '';
      if (Math.sign(bPct) !== Math.sign(lPct) && Math.abs(bPct) >= 1 && Math.abs(lPct) >= 1) {
        return ` It also bucks the borough-wide trend: ${expandCrime(crimeName)} is ${lPct > 0 ? 'up' : 'down'} ${Math.abs(lPct).toFixed(0)}% here but ${bPct > 0 ? 'up' : 'down'} ${Math.abs(bPct).toFixed(0)}% across ${borough}.`;
      }
      return '';
    };
    if (localAnomaly) {
      bullets.push(`**The most elevated crime vs. the citywide average is ${expandCrime(localAnomaly.name)}:** ${formatRate(localAnomaly.localRate)} per 100k residents here, ${localAnomaly.ratio.toFixed(1)}x the citywide rate (${formatRate(localAnomaly.cityRate)}).${buckNote(localAnomaly.name)}`);
    }
    if (localBrightSpot) {
      bullets.push(`**The brightest spot vs. the citywide average is ${expandCrime(localBrightSpot.name)}:** the rate here sits ${Math.round((1 - localBrightSpot.ratio) * 100)}% below the citywide rate.${buckNote(localBrightSpot.name)}`);
    }
  }

  return bullets;
}

/* ------------------------------------------------------------------ */
/* HEADLINES TAB                                                       */
/* ------------------------------------------------------------------ */
export default function Headlines({ parsedData, hotspots, rawData, activeTab, activeGeo, isTouristPrecinct, activePop, rtciData, contextData, rollingMeta, rollingState, downloadCSV, onSelectGeo }) {
  const { totals, felonies, period } = parsedData;

  // Violent / property subsets of the 7-felony major index.
  const subset = (names) => {
    let cur = 0, pri = 0;
    felonies.forEach(f => { if (names.includes(f.name)) { cur += f.current; pri += f.prior; } });
    return { cur, pri, pct: calcPct(cur, pri) };
  };
  const violent = subset(MAJOR_VIOLENT);
  const property = subset(MAJOR_PROPERTY);

  const endYear = period?.week_end ? new Date(period.week_end).getFullYear() : new Date().getFullYear();
  const yy = (y) => `’${String(y).slice(-2)}`;
  const periodWord = activeTab === 'ytd' ? 'YTD' : activeTab === 'r52' ? 'last 52 weeks' : 'this week';

  const statLines = [
    { label: 'Major crime index', sub: 'All 7 major felonies', cur: totals.mCur, pri: totals.mPri, pct: totals.mPct },
    { label: 'Violent index', sub: 'Murder, rape, robbery, felony assault', cur: violent.cur, pri: violent.pri, pct: violent.pct },
    { label: 'Property index', sub: 'Burglary, grand larceny, auto theft', cur: property.cur, pri: property.pri, pct: property.pct },
  ];

  // Optional 2019 (pre-pandemic) comparison for the year-to-date view. 2019 is that
  // calendar year's actual; the current year is projected to a full-year equivalent from
  // its YTD pace (cur ÷ pri × prior full year), so both sides are full-year quantities —
  // we have no weekly 2019 series to do a true same-period comparison. Offered only where
  // the 30-year history covers the geography (citywide and most precincts; not boroughs).
  const [vs2019, setVs2019] = useState(false);
  const cmp2019 = (() => {
    if (activeTab !== 'ytd') return null;
    let rows = null;
    if (activeGeo === 'citywide') rows = crimeHistory.citywide;
    else if (crimeHistory.precincts[activeGeo]) rows = Object.entries(crimeHistory.precincts[activeGeo]).map(([y, o]) => ({ y: +y, ...o }));
    if (!rows) return null;
    const byYear = {};
    rows.forEach(r => { byYear[r.y] = r; });
    const r2019 = byYear[2019], rPri = byYear[endYear - 1];
    if (!r2019 || !rPri) return null;
    const sum = (row, names) => (names.every(n => typeof row[n] === 'number') ? names.reduce((a, n) => a + row[n], 0) : null);
    const make = (names, s) => {
      const y2019 = sum(r2019, names), priFull = sum(rPri, names);
      if (y2019 == null || y2019 === 0 || !priFull || !s.pri) return null;
      const proj = Math.round(s.cur * (priFull / s.pri));
      return { y2019, proj, pct: calcPct(proj, y2019) };
    };
    const sets = [[...MAJOR_VIOLENT, ...MAJOR_PROPERTY], MAJOR_VIOLENT, MAJOR_PROPERTY];
    const out = statLines.map((s, i) => make(sets[i], s));
    return out.every(Boolean) ? out : null;
  })();
  const show2019 = vs2019 && !!cmp2019;

  const bullets = buildBullets({ parsedData, hotspots, rawData, activeGeo, activeTab, isTouristPrecinct });

  // Year-to-date volatility applies only to the year-to-date view; the weekly toggle shows a
  // fixed-length window, which doesn't have this problem.
  const volatilityKey = activeGeo === 'citywide' ? 'citywide' : activeGeo;
  const volatility = activeTab === 'ytd' ? ytdVolatility(contextData, volatilityKey) : null;
  const rollingUnavailable = activeTab === 'r52' && rollingState === 'error';
  // 52wk is summed from precinct series, so it isn't exposed to a stale borough workbook.
  const stale = activeTab === 'r52' ? null : staleGeo(rawData, activeGeo);
  const volatilityNoun = activeGeo === 'citywide' ? 'city' : PATROL_BOROUGH_NAMES.includes(activeGeo) ? 'borough' : 'precinct';

  return (
    <div>
      {isTouristPrecinct && <div className="mb-6 p-4 bg-gray-50 border-l-4 border-gray-400 text-sm font-serif italic text-gray-700"><strong>Context Note:</strong> {formatGeoName(activeGeo)} is a high-traffic hub with few residents; crime rates primarily reflect commercial/visitor density.</div>}

      {stale && (
        <div className="mb-6 p-4 border-l-4 text-sm font-serif text-gray-800" style={{ backgroundColor: 'rgba(221, 228, 76, 0.30)', borderColor: '#dde44c' }}>
          <strong className="font-black">These figures are out of date.</strong> The NYPD publishes a separate
          weekly file for each geography, and the one for {formatGeoName(activeGeo)} was last updated for the week
          ending {stale.asOf} — {stale.weeksBehind} {stale.weeksBehind === 1 ? 'week' : 'weeks'} behind the rest of
          the city, which is current through {stale.current}. Precinct-level figures for this area are up to date.
        </div>
      )}
      {['Bronx North', 'Bronx South'].includes(activeGeo) && (
        <div className="mb-6 p-4 border-l-4 text-sm font-serif text-gray-800" style={{ backgroundColor: 'rgba(221, 228, 76, 0.30)', borderColor: '#dde44c' }}>
          <strong className="font-black">A new command.</strong> The NYPD divided Patrol Borough Bronx into
          Bronx North and Bronx South on May 20, 2026. Precinct boundaries did not change, so the department
          restated both commands across the whole period rather than starting them in May: the figures here cover
          the full span, including the weeks before the split and the 52-week window that straddles it.
        </div>
      )}
      {rollingUnavailable && (
        <div className="mb-6 p-4 bg-gray-50 border-l-4 border-gray-400 text-sm font-serif text-gray-700">
          The weekly series behind the 52-week view couldn't be loaded, so these figures are still year-to-date.
        </div>
      )}
      <div className="mb-7">
        <p className="font-serif text-[17px] lg:text-[18px] leading-relaxed text-gray-700 font-medium text-justify sm:text-left hyphens-auto">
          Every week the New York City Police Department updates data on reported crime in precincts across the city, in a process known as CompStat. This page decodes that data so that no matter where you are in the city, you can understand how crime is changing near you.
        </p>
      </div>
      <h1 className="text-[22px] sm:text-[26px] lg:text-[29px] font-black leading-[1.15] tracking-tight mb-5 text-black">
        <span style={{ color: totals.diff > 0 ? '#d2232a' : '#57aa4a' }}>Major index offenses are {totals.diff > 0 ? 'up' : 'down'} {Math.abs(totals.mPct).toFixed(1).replace(/\.0$/, '')}%</span> {activeTab === 'ytd' ? 'year-to-date' : activeTab === 'r52' ? 'over the last 52 weeks' : 'this week'} {activeGeo === 'citywide' ? '' : `in ${geoWithArticle(activeGeo)} `}compared to {activeTab === 'r52' ? 'the 52 weeks before that' : 'last year'}.
      </h1>

      {/* Topline trends (left) with the locator map aligned to the top of the table (right) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 items-start">
        <div className="lg:col-span-2 relative">
          <div className="divide-y divide-gray-100 border-y border-gray-200">
            {statLines.map((s, i) => {
              // In 2019-comparison mode the row swaps to full-year quantities: 2019 actual
              // vs the current year projected from its YTD pace.
              const c19 = show2019 ? cmp2019[i] : null;
              const pct = c19 ? c19.pct : s.pct;
              return (
              <div key={s.label} className="flex items-baseline flex-wrap gap-x-4 sm:gap-x-6 gap-y-1 py-2.5">
                {/* Descriptor sits light under the term so it reads as its definition */}
                <div className="w-36 sm:w-40 flex-shrink-0">
                  <div className={i === 0 ? 'text-[15px] font-black leading-tight' : 'text-[13px] font-bold text-gray-700 leading-tight'}>{s.label}</div>
                  <div className="text-[11px] text-gray-400 leading-tight mt-0.5">{s.sub}</div>
                </div>
                <span className={`tabular-nums font-black ml-auto sm:ml-0 text-right sm:text-left w-24 sm:w-32 whitespace-nowrap ${i === 0 ? 'text-[16px] sm:text-[20px]' : 'text-[16px]'}`} style={{ color: (pct ?? 0) > 0 ? '#d2232a' : (pct ?? 0) < 0 ? '#57aa4a' : '#374151' }}>
                  {dirPct(pct)}
                </span>
                <span className="text-[12px] sm:text-[11px] text-gray-600 tabular-nums basis-full sm:basis-auto sm:whitespace-nowrap">
                  {c19 ? <>{c19.y2019.toLocaleString()} in 2019</>
                    : <>{s.pri.toLocaleString()} in {activeTab === 'r52' ? 'the year before' : <>{yy(endYear - 1)} {periodWord}</>}</>}
                  <span className="mx-1.5 font-bold" style={{ color: (pct ?? 0) > 0 ? '#d2232a' : (pct ?? 0) < 0 ? '#57aa4a' : '#6b7280' }} aria-label={(pct ?? 0) > 0 ? 'rose to' : 'fell to'}>
                    {(pct ?? 0) > 0 ? '↗' : (pct ?? 0) < 0 ? '↘' : '→'}
                  </span>
                  <strong className="font-black text-gray-900">
                    {c19 ? <>{c19.proj.toLocaleString()} projected for {yy(endYear)}</>
                      : <>{s.cur.toLocaleString()} in {activeTab === 'r52' ? 'the last 52 weeks' : <>{yy(endYear)} {periodWord}</>}</>}
                  </strong>
                </span>
              </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-[12px] text-gray-400">
            <span>{activeTab === 'ytd' ? `Year-to-date through ${period?.week_end || '—'}`
              : activeTab === 'r52' ? (rollingMeta ? `52 weeks ending ${formatPeriodDateFull(rollingMeta.current_to)}, vs the 52 ending ${formatPeriodDateFull(rollingMeta.prior_to)}` : 'Loading the weekly series…')
              : `Week of ${period?.week_start || '—'} to ${period?.week_end || '—'}`}</span>
            <span className="text-gray-300" aria-hidden>·</span>
            {/* The provisional note belongs on every view — it carries the measured revision
                figures in its tooltip and the link explaining them. The 52-week window adds a
                consequence the other views don't have, so it says both. */}
            <ProvisionalNote year={endYear} contextData={contextData} />
            {activeTab === 'r52' && (
              <>
                <span className="text-gray-300" aria-hidden>·</span>
                <span className="text-gray-400">Its newest weeks are still accruing, so the last 52 weeks read slightly low against the 52 before them.</span>
              </>
            )}
          </div>
          {/* Discreet 2019 toggle, below the metadata note (Josh's request). */}
          {activeTab === 'ytd' && cmp2019 && (
            <div className="mt-1 text-[12px] text-gray-400">
              <button type="button" onClick={() => setVs2019(v => !v)}
                className="underline decoration-dotted underline-offset-2 hover:text-black">
                {show2019 ? 'Compare to last year instead' : 'Compare to the 2019 (pre-pandemic) trend'}
              </button>
              {show2019 && (
                <span className="ml-2">2019 is that year&rsquo;s actual; {yy(endYear)} is projected from its year-to-date pace.</span>
              )}
            </div>
          )}
        </div>
        <LocatorMap activeGeo={activeGeo} onSelectGeo={onSelectGeo} />
      </section>

      {/* Notable patterns + national comparison — equal-height boxes so their bottoms align */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        <div className="lg:col-span-2 p-6 bg-white rounded-sm border border-gray-200">
          <h2 className="text-[11px] font-black uppercase tracking-[0.15em] text-gray-400 mb-4">Patterns and outliers</h2>
          {bullets.length === 0 && !volatility ? (
            <p className="font-serif text-[15px] text-gray-500 italic">Nothing unusual stands out in this period's data.</p>
          ) : (
            <ul className="space-y-3.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-3 font-serif text-[15px] leading-relaxed text-gray-700">
                  <span className="text-gray-300 flex-shrink-0 mt-[1px]">▪</span>
                  <span>{renderBullet(b, onSelectGeo || (() => {}))}</span>
                </li>
              ))}
              {/* How much the figure above has already moved this year. Set off in amber so it
                  reads as a caveat about the measure rather than another finding about crime. */}
              {volatility && (
                <li className="font-serif text-[15px] leading-relaxed text-gray-700 rounded-sm px-3 py-2 mt-1"
                    style={{ backgroundColor: 'rgba(221, 228, 76, 0.30)' }}>
                  <strong className="font-black">{VOLATILITY_LABEL}</strong>{' '}
                  {volatilitySentence(volatility, volatilityNoun)}
                </li>
              )}
            </ul>
          )}
        </div>
        <NationalSidebar rtciData={rtciData} downloadCSV={downloadCSV} />
      </section>
    </div>
  );
}
