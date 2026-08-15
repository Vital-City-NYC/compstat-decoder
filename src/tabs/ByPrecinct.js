import React, { useState, useMemo, useRef } from 'react';
import { geoPath, geoMercator } from 'd3-geo';
import precinctGeoJSON from '../data/nyc_precincts.json';
import bigParks from '../data/big_parks.json';
import {
  GEO_POPULATIONS, PRECINCT_NEIGHBORHOODS, VC,
  crimeColor, changeColor, formatRate, TrendingUp, TrendingDown,
} from '../shared';

/* ------------------------------------------------------------------ */
/* PRECINCT CHOROPLETH MAP                                             */
/* ------------------------------------------------------------------ */
// Tooltip footprint, used to decide which side of the cursor it can sit on.
const TOOLTIP_W = 240, TOOLTIP_H = 150, GAP = 14;

const PrecinctMap = ({ precinctRates, onSelect, mapMode = 'rate', width = 520, height = 520, externalHovered = null, onHover }) => {
  const [hovered, setHovered] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);

  const { pathFn, rateMap, minRate, maxRate, maxAbsChange } = useMemo(() => {
    const projection = geoMercator().fitSize([width, height], precinctGeoJSON);
    const pathFn = geoPath().projection(projection);
    const rateMap = {};
    let minR = Infinity, maxR = 0, maxAbs = 0;
    precinctRates.forEach(p => {
      p.countDelta = (p.count != null && p.priorCount != null) ? (p.count - p.priorCount) : null;
      rateMap[p.precinctNum] = p;
      if (!p.isTourist) {
        if (p.rate != null) {
          if (p.rate < minR) minR = p.rate;
          if (p.rate > maxR) maxR = p.rate;
        }
        if (p.pctChange != null) maxAbs = Math.max(maxAbs, Math.abs(p.pctChange));
      }
    });
    if (minR === Infinity) minR = 0;
    if (maxAbs > 100) maxAbs = 100;
    return { pathFn, rateMap, minRate: minR, maxRate: maxR, maxAbsChange: maxAbs };
  }, [precinctRates, width, height]);

  const handleMouse = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Record the rendered size too: the SVG scales to its container, so viewBox units and
    // on-screen pixels are not the same and can't be mixed when placing the tooltip.
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height });
  };

  const activeHover = hovered != null ? hovered : externalHovered;
  const hoveredData = hovered ? rateMap[hovered] : null;

  // Compute rank among non-tourist precincts (by rate, highest = rank 1)
  const rateRanks = useMemo(() => {
    const rankable = precinctRates.filter(p => !p.isTourist && p.rate != null).sort((a, b) => b.rate - a.rate);
    const map = {};
    rankable.forEach((p, i) => { map[p.precinctNum] = { rank: i + 1, total: rankable.length }; });
    return map;
  }, [precinctRates]);

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: 'max(440px, calc(100vh - 285px))', display: 'block', marginInline: 'auto' }} onMouseMove={handleMouse}>
        <defs>
          <pattern id="tourist-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#1f2937" strokeOpacity="0.5" strokeWidth="1" />
          </pattern>
          <pattern id="park-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="#3d6b47" strokeOpacity="0.45" strokeWidth="0.9" />
          </pattern>
        </defs>
        {[...precinctGeoJSON.features]
          .sort((a, b) => (a.properties.precinct === activeHover ? 1 : 0) - (b.properties.precinct === activeHover ? 1 : 0))
          .map(feature => {
          const pNum = feature.properties.precinct;
          const pData = rateMap[pNum];
          // Central Park (22nd), Midtown South (14th) and Midtown North (18th) have daytime
          // populations many times their residential ones, so a per-resident rate there is
          // not a comparable quantity — colouring it invites exactly the comparison it can't
          // support. In rate mode they stay grey, hatched to mark deliberate exclusion rather
          // than missing data, and the tooltip still gives the figure. Percent change is NOT
          // distorted by daytime population, so in change mode they colour normally.
          const rateUncomparable = mapMode === 'rate' && pData?.isTourist;
          const fill = mapMode === 'change' ? changeColor(pData?.pctChange, maxAbsChange)
            : rateUncomparable ? '#e5e7eb'
            : crimeColor(pData?.rate, minRate, maxRate);
          const isActive = activeHover === pNum;
          return (
            <g key={pNum}>
              <path
                d={pathFn(feature)}
                fill={fill}
                stroke={isActive ? '#111827' : '#fff'}
                strokeWidth={isActive ? 2 : 0.5}
                style={{ cursor: 'pointer', transition: 'fill 0.15s, stroke 0.15s' }}
                onMouseEnter={() => { setHovered(pNum); onHover && onHover(pNum); }}
                onMouseLeave={() => { setHovered(null); onHover && onHover(null); }}
                onClick={() => pData && onSelect(pData.precinct)}
              />
              {rateUncomparable && (
                <path d={pathFn(feature)} fill="url(#tourist-hatch)" stroke="none" pointerEvents="none" />
              )}
            </g>
          );
        })}
        {/* Major parks: texture only — nobody lives there, and their acreage visually
            inflates the precincts they sit in. Non-interactive by design. */}
        {bigParks.features.map((f, i) => (
          <path key={`park-${i}`} d={pathFn(f)} fill="url(#park-hatch)"
            stroke="#3d6b47" strokeOpacity="0.35" strokeWidth="0.5" pointerEvents="none" />
        ))}
      </svg>
      {hoveredData && (() => {
        const pop = GEO_POPULATIONS[hoveredData.precinct];
        const rankInfo = rateRanks[hoveredData.precinctNum];
        // Sit beside the cursor, and flip to whichever side has room, so the box never
        // covers the precinct being pointed at.
        const boxW = mousePos.w || 0, boxH = mousePos.h || 0;
        const fitsRight = !boxW || mousePos.x + GAP + TOOLTIP_W <= boxW;
        const left = fitsRight ? mousePos.x + GAP : Math.max(0, mousePos.x - GAP - TOOLTIP_W);
        const top = boxH ? Math.max(0, Math.min(mousePos.y - 10, boxH - TOOLTIP_H)) : mousePos.y - 10;
        const tooltipPos = { left, top };
        return (
          <div
            className="absolute pointer-events-none bg-white border border-gray-200 shadow-xl rounded p-3 z-50 text-[11px]"
            style={{ ...tooltipPos, minWidth: 200, maxWidth: TOOLTIP_W }}
          >
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className="font-black text-black text-[12px]">{hoveredData.precinct}</span>
              {hoveredData.isTourist && <span className="text-[8px] font-bold uppercase tracking-wide px-1 py-[1px] rounded-sm bg-gray-800 text-white">Tourist hub</span>}
            </div>
            {PRECINCT_NEIGHBORHOODS[hoveredData.precinct] && <div className="text-gray-500 mb-2">{PRECINCT_NEIGHBORHOODS[hoveredData.precinct]}</div>}
            <div className="font-bold text-black">{hoveredData.count.toLocaleString()} incidents</div>
            {hoveredData.rate != null && (
              <div className="text-gray-600">
                {formatRate(hoveredData.rate)} per 100k
                {hoveredData.isTourist ? <span className="text-gray-400 italic"> (residents only — not comparable)</span> : rankInfo ? ` · Rank ${rankInfo.rank} of ${rankInfo.total}` : ''}
              </div>
            )}
            {hoveredData.countDelta != null && (
              <div className="font-medium mt-1" style={{ color: hoveredData.countDelta > 0 ? '#d2232a' : hoveredData.countDelta < 0 ? '#57aa4a' : '#333' }}>
                {hoveredData.countDelta > 0 ? '+' : ''}{hoveredData.countDelta.toLocaleString()} incidents vs last year
                {hoveredData.pctChange != null && <span className="text-gray-500 font-normal"> ({hoveredData.pctChange > 0 ? '+' : ''}{hoveredData.pctChange.toFixed(1)}%)</span>}
              </div>
            )}
            {hoveredData.priorCount != null && <div className="text-gray-400 text-[10px]">{hoveredData.priorCount.toLocaleString()} prior year</div>}
            {pop && <div className="text-gray-400 mt-1">Pop. {pop.toLocaleString()}{hoveredData.isTourist && <span className="italic"> · residents only</span>}</div>}
          </div>
        );
      })()}
      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500">
        {mapMode === 'change' ? (
          <>
            <span>Decrease</span>
            <div className="flex-1 h-2 rounded" style={{ background: `linear-gradient(to right, rgb(45,160,55), rgb(140,210,140), rgb(240,240,240), rgb(210,140,135), rgb(190,70,65))` }} />
            <span>Increase</span>
          </>
        ) : (
          <>
            <span>Low</span>
            <div className="flex-1 h-2 rounded" style={{ background: `linear-gradient(to right, rgb(240,240,240), rgb(255,213,189), rgb(255,124,83), rgb(231,70,109), rgb(57,72,130))` }} />
            <span>High</span>
          </>
        )}
        <span className="ml-3 pl-3 border-l border-gray-300 flex items-center gap-1" title="Major parks (400+ acres) are textured: nobody lives there, so they add area but not crime rate.">
          <span className="inline-block w-3 h-3" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(61,107,71,0.5) 2px, rgba(61,107,71,0.5) 3px)' }} />
          Major parks
        </span>
        <span className="ml-3 pl-3 border-l border-gray-300 flex items-center gap-1" title="Tourist/commercial precincts: per-100k rates use residential population only and are not comparable. % change is not distorted.">
          <span className="inline-block w-3 h-3" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(31,41,55,0.5) 2px, rgba(31,41,55,0.5) 3px)' }} />
          Tourist hubs: 14th, 18th, 22nd {mapMode === 'rate'
            ? <span className="italic text-gray-400">(few residents — no comparable rate)</span>
            : <span className="italic text-gray-400">(% change is comparable)</span>}
        </span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* PRECINCT RANKING BARS                                               */
/* ------------------------------------------------------------------ */
const PrecinctRankingBars = ({ precinctRates, onSelect, mapMode = 'rate', hoveredPrecinctNum = null, onHover }) => {
  const { top5, bottom5 } = useMemo(() => {
    // Tourist precincts (Times Square / Midtown South) have distorted per-capita rates
    // but their % change is not distorted by daytime population, so we include them in
    // change rankings and only exclude them from the rate-mode ranking.
    if (mapMode === 'change') {
      const valid = precinctRates.filter(p => p.pctChange != null && p.priorCount > 5).sort((a, b) => b.pctChange - a.pctChange);
      return { top5: valid.slice(0, 5), bottom5: valid.slice(-5).reverse() };
    }
    const valid = precinctRates.filter(p => p.rate != null && !p.isTourist).sort((a, b) => b.rate - a.rate);
    // Lowest-rate list reads top-to-bottom from 5th-lowest down to the very lowest (descending),
    // mirroring the highest list which runs highest → 5th-highest.
    return { top5: valid.slice(0, 5), bottom5: valid.slice(-5) };
  }, [precinctRates, mapMode]);

  // Arrow-shaped bars: increases point right (anchored left), decreases point left
  // (anchored right), so the two lists mirror each other around a center gutter.
  const RIGHT_ARROW = 'polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%)';
  const LEFT_ARROW = 'polygon(100% 0, 7px 0, 0 50%, 7px 100%, 100% 100%)';

  const renderRow = (item, color, maxVal, dir) => {
    const val = mapMode === 'change' ? Math.abs(item.pctChange) : item.rate;
    const barPct = Math.max(3, (val / (maxVal || 1)) * 100);
    const hood = PRECINCT_NEIGHBORHOODS[item.precinct];
    const label = hood ? `${item.precinct.replace(' Precinct', '')} (${hood.split(',')[0]})` : item.precinct.replace(' Precinct', '');
    const displayVal = mapMode === 'change' ? `${Math.abs(item.pctChange).toFixed(1).replace(/\.0$/, '')}%` : formatRate(item.rate);
    const isActive = hoveredPrecinctNum === item.precinctNum;
    const nameEl = (
      <span className="text-[11px] font-bold text-gray-800 w-28 truncate flex-shrink-0 flex items-center gap-1" title={item.precinct}>
        {label}
        {item.isTourist && <span className="text-[7px] font-black uppercase tracking-wide px-1 rounded-sm bg-gray-800 text-white" title="Tourist hub">T</span>}
      </span>
    );
    const valueEl = <span className="text-[11px] font-bold tabular-nums whitespace-nowrap w-12 flex-shrink-0" style={{ color, textAlign: dir === 'down' ? 'left' : 'right' }}>{displayVal}</span>;
    const barEl = (
      <div className={`flex-1 flex items-center min-w-0 ${dir === 'down' ? 'justify-end' : ''}`}>
        <div className="h-[15px]" style={{ width: `${barPct}%`, minWidth: 14, background: color, clipPath: dir === 'down' ? LEFT_ARROW : RIGHT_ARROW }} />
      </div>
    );
    return (
      <div
        key={item.precinct}
        className={`flex items-center gap-2 py-1 cursor-pointer -mx-2 px-2 rounded transition-colors ${isActive ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
        onClick={() => onSelect(item.precinct)}
        onMouseEnter={() => onHover && onHover(item.precinctNum)}
        onMouseLeave={() => onHover && onHover(null)}
      >
        {dir === 'up' ? <>{nameEl}{barEl}{valueEl}</> : <>{valueEl}{barEl}{nameEl}</>}
      </div>
    );
  };

  const topMax = mapMode === 'change' ? Math.abs(top5[0]?.pctChange || 1) : (top5[0]?.rate || 1);
  const botMax = mapMode === 'change' ? Math.abs(bottom5[0]?.pctChange || 1) : (top5[0]?.rate || 1);

  return (
    <div className="flex flex-col justify-between h-full gap-6 py-2">
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1" style={{ color: VC.magenta }}>
          <TrendingUp size={12} /> {mapMode === 'change' ? 'Biggest % increases' : 'Highest rate (per 100k)'}
        </div>
        {top5.map(item => renderRow(item, VC.magenta, topMax, 'up'))}
      </div>
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1" style={{ color: VC.green }}>
          <TrendingDown size={12} /> {mapMode === 'change' ? 'Biggest % decreases' : 'Lowest rate (per 100k)'}
        </div>
        {bottom5.map(item => renderRow(item, VC.green, botMax, 'down'))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* BY PRECINCT TAB                                                     */
/* ------------------------------------------------------------------ */
const CATEGORY_PILLS = [['all', 'All Major'], ['violent', 'Violent'], ['property', 'Property']];
const OFFENSE_PILLS = [
  ['Murder', 'Murder'], ['Rape', 'Rape'], ['Robbery', 'Robbery'], ['Fel. Assault', 'Fel. Assault'],
  ['Burglary', 'Burglary'], ['Gr. Larceny', 'Gr. Larceny'], ['G.L.A.', 'G.L.A.'],
  ['Petit Larceny', 'Petit Larceny'], ['Misd. Assault', 'Misd. Assault'],
];

export default function ByPrecinct({ precinctRates, mapMode, setMapMode, mapCrime, setMapCrime, onSelectPrecinct }) {
  const [hoveredPrecinctNum, setHoveredPrecinctNum] = useState(null);

  return (
    <div>
      {/* Controls — measure toggle (pill) sits left of the crime categories on one line,
          with the individual offenses in lighter pills below. No page title; the nav
          shows where you are. */}
      <div className="flex flex-col gap-1.5 mb-6">
        {/* Every control row spans the full width with equal margins on both sides;
            buttons flex to fill so the rows read as neat, aligned bands. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {/* Measure — binary toggle, pill-shaped */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-full border border-gray-200 w-full sm:flex-1">
            {[['rate', 'Rate per 100k'], ['change', '% Change']].map(([val, label]) => (
              <button key={val} onClick={() => setMapMode(val)} className={`flex-1 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full transition-colors ${mapMode === val ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-black'}`}>{label}</button>
            ))}
          </div>
          {/* Crime categories — square pills, stretched to fill their half of the row */}
          <div className="flex gap-2 w-full sm:flex-1">
            {CATEGORY_PILLS.map(([val, label]) => (
              <button key={val} onClick={() => setMapCrime(val)} className={`flex-1 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-sm border transition-colors ${mapCrime === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-100 text-gray-600 border-gray-200 hover:text-black'}`}>{label}</button>
            ))}
          </div>
        </div>
        {/* Individual offenses below in lighter type — 3-up grid on mobile, one even row on desktop */}
        <div className="grid grid-cols-3 sm:flex gap-1">
          {OFFENSE_PILLS.map(([val, label]) => (
            <button key={val} onClick={() => setMapCrime(val)} className={`sm:flex-1 px-2.5 py-1 text-[10px] font-medium normal-case rounded-sm border transition-colors ${mapCrime === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:text-black hover:border-gray-400'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[2.2fr_1fr] gap-6 items-stretch">
        <PrecinctMap precinctRates={precinctRates} onSelect={onSelectPrecinct} mapMode={mapMode} externalHovered={hoveredPrecinctNum} onHover={setHoveredPrecinctNum} />
        <PrecinctRankingBars precinctRates={precinctRates} onSelect={onSelectPrecinct} mapMode={mapMode} hoveredPrecinctNum={hoveredPrecinctNum} onHover={setHoveredPrecinctNum} />
      </div>
    </div>
  );
}
