import React, { useMemo, useState, useEffect, useRef } from 'react';
import { geoPath, geoMercator, geoContains } from 'd3-geo';
import precinctGeoJSON from '../data/nyc_precincts.json';
import councilData from '../data/council_districts.json';
import crosswalk from '../data/district_crosswalk.json';
import vcLogo from '../vitalcity-logo.png';
import SubscribeBand, { GEOSEARCH_URL, districtForPoint } from './Subscribe';
import {
  PRECINCT_NEIGHBORHOODS, MAJOR_VIOLENT, MAJOR_PROPERTY, VOLATILITY_THRESHOLD,
  safeNum, pctColor, dirPct, signedCount, expandCrime,
  toOrdinalPrecinct, SearchIcon, ChevronDown, Download,
  ytdVolatility, volatilitySentence, VOLATILITY_LABEL, useSettled } from '../shared';

const MAJORS = ['Murder', 'Rape', 'Robbery', 'Fel. Assault', 'Burglary', 'Gr. Larceny', 'G.L.A.'];

/* ------------------------------------------------------------------ */
/* SHOOTINGS — NYPD Shooting Incident Data (Year To Date), NYC Open    */
/* Data 5ucz-vwe8. Street-level lat/lng per incident. NOTE: this       */
/* dataset's latitude/longitude FIELD NAMES ARE SWAPPED, so we read    */
/* `latitude` as lng and `longitude` as lat. Fetched once, cached.     */
/* ------------------------------------------------------------------ */
/* Precinct weights come from the 2020 Census block crosswalk, not from land area.
   residentShare = the fraction of THAT PRECINCT's residents living in this district;
   slice its crime by that and the pieces sum to the crime inside the district. It is
   what the weighted figures below are built on.
   share = the fraction of THIS DISTRICT's residents living in that precinct's part.
   It sums to 1, so it is what reads sensibly as "share of district" in the table.
   Area weighting used to fill both roles and misweighted districts holding large
   uninhabited ground — the 113th is 43% of District 31 by acreage and holds two
   residents (Jamaica Bay and JFK). No minimum-share cutoff: a sliver carries almost
   no residents, so it now weighs almost nothing on its own. */
const DISTRICTS = councilData.districts.map((d) => {
  const cw = crosswalk.districts[String(d.district)];
  if (!cw) return d;
  return {
    ...d,
    population: cw.population,
    precincts: cw.precincts.map((r) => ({
      precinct: r.precinct,
      share: r.populationShare,
      labelPoint: r.labelPoint,
      residentShare: r.residentShare,
      residents: r.residents,
    })),
  };
});

// Fetch ALL YTD incidents (not just geocoded ones) so we can report what share have a
// mapped location. For 2026 the coordinates are true street-level — verified 137 of 138
// distinct points at 6–8 decimal precision, not precinct centroids.
const SHOOTINGS_URL = "https://data.cityofnewyork.us/resource/5ucz-vwe8.json?" +
  "$select=incident_key,occur_date,occur_time,boro,precinct,loc_of_occur_desc,loc_classfctn_desc,location_desc,latitude,longitude" +
  "&$where=occur_date>='2026-01-01'&$order=occur_date&$limit=5000";
let _shootingsPromise = null;
const fetchShootings = () => {
  if (_shootingsPromise) return _shootingsPromise;
  _shootingsPromise = fetch(SHOOTINGS_URL)
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(rows => {
      const points = rows.map(r => ({
        key: r.incident_key,
        lng: parseFloat(r.latitude),  // field names are swapped in this dataset
        lat: parseFloat(r.longitude),
        date: r.occur_date ? r.occur_date.slice(0, 10) : '',
        time: r.occur_time || '',
        boro: r.boro || '',
        precinct: r.precinct || '',
        locationDesc: r.location_desc || '',
        locClass: r.loc_classfctn_desc || '',
        locOccur: r.loc_of_occur_desc || '',
      })).filter(s => isFinite(s.lng) && isFinite(s.lat));
      return { points, total: rows.length, located: points.length };
    })
    .catch(() => { _shootingsPromise = null; return { points: [], total: 0, located: 0 }; });
  return _shootingsPromise;
};

// Format "09:30:00" → "9:30 AM"
const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':');
  let hr = parseInt(h, 10); const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${m} ${ap}`;
};
const fmtDate = (d) => {
  if (!d) return '';
  const [y, mo, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
// Map NYPD's terse location codes to readable phrases. (The YTD feed has no victim details,
// so the popup describes the setting instead.)
const LOC_DESC_FRIENDLY = {
  'MULTI DWELL - PUBLIC HOUS': 'a public-housing building',
  'MULTI DWELL - APT BUILD': 'an apartment building',
  'PVT HOUSE': 'a private house',
  'BAR/NIGHT CLUB': 'a bar or club',
  'GROCERY/BODEGA': 'a bodega',
  'RESTAURANT/DINER': 'a restaurant',
  'FAST FOOD': 'a fast-food spot',
  'GAS STATION': 'a gas station',
  'BEAUTY/NAIL SALON': 'a salon',
  'DRY CLEANER/LAUNDRY': 'a laundromat',
  'SUPERMARKET': 'a supermarket',
  'LIQUOR STORE': 'a liquor store',
  'SMALL MERCHANT': 'a store',
  'DEPT STORE': 'a store',
  'COMMERCIAL BLDG': 'a commercial building',
  'HOSPITAL': 'a hospital',
  'HOTEL/MOTEL': 'a hotel',
  'SOCIAL CLUB/POLICY': 'a social club',
  'CHAIN STORE': 'a store',
};
const describeShooting = (s) => {
  const loc = (s.locationDesc || '').trim().toUpperCase();
  if (LOC_DESC_FRIENDLY[loc]) return `Shooting at ${LOC_DESC_FRIENDLY[loc]}`;
  const cls = (s.locClass || '').trim().toUpperCase();
  if (cls === 'STREET') return 'Shooting on the street';
  if (cls === 'HOUSING') return 'Shooting in public housing';
  if (cls === 'DWELLING' || cls === 'RESIDENTIAL') return 'Shooting at a residence';
  if (cls === 'COMMERCIAL') return 'Shooting at a business';
  if (cls === 'TRANSIT') return 'Shooting in the transit system';
  if (cls === 'PLAYGROUND') return 'Shooting at a playground';
  if (loc && loc !== 'NONE') return `Shooting at ${loc.toLowerCase()}`;
  return 'Shooting';
};
const titleCaseBoro = (b) => (b || '').charAt(0) + (b || '').slice(1).toLowerCase();

const MIN_DRIVER_BASE = 30;   // below this a precinct's percentage change is noise
// Auto-generated top-line findings for a council district, from its precincts' YTD data
// weighted by each precinct's share of the district's area.
function computeCouncilFindings(district, rawData) {
  const cwAll = tallyGeo(rawData?.citywide, null);
  const cwVio = tallyGeo(rawData?.citywide, MAJOR_VIOLENT);

  let wAllCur = 0, wAllPri = 0, wVioCur = 0, wVioPri = 0, wPropCur = 0, wPropPri = 0;
  let upShare = 0, downShare = 0, upCount = 0, downCount = 0;
  const perCrime = {}, perCrimePct = {};
  MAJORS.forEach(n => { perCrime[n] = { cur: 0, pri: 0 }; });
  const pcChanges = []; // per precinct × crime, for sharpest movers

  district.precincts.forEach(o => {
    const geoKey = toOrdinalPrecinct(o.precinct);
    const d = rawData?.[geoKey];
    const s = o.residentShare;   // apportion this precinct's crime by its residents here
    const a = tallyGeo(d, null), v = tallyGeo(d, MAJOR_VIOLENT), p = tallyGeo(d, MAJOR_PROPERTY);
    if (a.cur != null) { wAllCur += s * a.cur; wAllPri += s * a.pri; }
    if (v.cur != null) { wVioCur += s * v.cur; wVioPri += s * v.pri; }
    if (p.cur != null) { wPropCur += s * p.cur; wPropPri += s * p.pri; }
    if (typeof a.pct === 'number') {
      // "how much of the district is trending up" is a share OF THE DISTRICT, so it
      // uses the population share (which sums to 1), not the apportionment factor.
      if (a.pct > 0) { upShare += o.share; upCount++; } else if (a.pct < 0) { downShare += o.share; downCount++; }
    }
    const fel = d?.seven_major_felonies || {};
    MAJORS.forEach(n => {
      const stat = fel[n];
      const cur = safeNum(stat?.year_to_date?.current_year);
      const pri = safeNum(stat?.year_to_date?.prior_year);
      perCrime[n].cur += s * cur; perCrime[n].pri += s * pri;
      // Each precinct's OWN percentage change, unweighted — the driver averages these.
      if (pri >= MIN_DRIVER_BASE) (perCrimePct[n] = perCrimePct[n] || []).push(((cur - pri) / pri) * 100);
      if (pri >= VOLATILITY_THRESHOLD) pcChanges.push({ precinct: geoKey, crime: n, pct: ((cur - pri) / pri) * 100 });
    });
  });

  const pctOf = (cur, pri) => (pri > 0 ? ((cur - pri) / pri) * 100 : null);
  const mk = (cur, pri) => ({ cur, pri, pct: pctOf(cur, pri), diff: cur - pri });
  const districtAll = mk(wAllCur, wAllPri), districtVio = mk(wVioCur, wVioPri), districtProp = mk(wPropCur, wPropPri);

  /* WEIGHTED-AVG HIDDEN 2026-08-28: the driver is now a TRUE average of the district's
     precincts — each precinct counts once and its own percentage change is averaged, so no
     district-share weighting enters and it survives the removal of the weighted row.
     Precincts whose prior-year count for the offence is under MIN_DRIVER_BASE sit out; at
     that size a percentage is noise and murder wins on two incidents. Share-weighted
     original preserved:
  const netSign = Math.sign(districtAll.diff);
  let driver = null;
  MAJORS.forEach(n => {
    const diff = perCrime[n].cur - perCrime[n].pri;
    if (Math.sign(diff) === netSign && diff !== 0 && (!driver || Math.abs(diff) > Math.abs(driver.diff))) {
      driver = { name: n, diff, pct: pctOf(perCrime[n].cur, perCrime[n].pri) };
    }
  });
  */
  let driver = null;
  MAJORS.forEach(n => {
    const ps = perCrimePct[n];
    if (!ps || !ps.length) return;
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
    if (!driver || Math.abs(mean) > Math.abs(driver.pct)) {
      driver = { name: n, diff: perCrime[n].cur - perCrime[n].pri, pct: mean, nPrecincts: ps.length };
    }
  });

  let sharpUp = null, sharpDown = null;
  pcChanges.forEach(x => {
    if (x.pct > 0 && (!sharpUp || x.pct > sharpUp.pct)) sharpUp = x;
    if (x.pct < 0 && (!sharpDown || x.pct < sharpDown.pct)) sharpDown = x;
  });

  return { cwAll, cwVio, districtAll, districtVio, districtProp, upShare, downShare, upCount, downCount, nP: district.precincts.length, driver, sharpUp, sharpDown };
}

// "down 6.3%" (lowercase, for mid-sentence prose)
const lowDir = (v) => dirPct(v).toLowerCase();

// Directional phrases in the findings get bolded and colored — red for rising crime,
// green for falling. {up:..} / {dn:..} tokens are expanded by renderFinding.
const UP_COLOR = '#d2232a', DN_COLOR = '#57aa4a';
const upTok = (t) => `{up:${t}}`;
const dnTok = (t) => `{dn:${t}}`;
// eslint-disable-next-line no-unused-vars -- kept for the WEIGHTED-AVG HIDDEN bullet
const cPct = (pct) => (pct > 0 ? upTok : dnTok)(lowDir(pct)); // "down 7.6%", colored by sign
const cWrap = (text, pct) => (pct > 0 ? upTok : dnTok)(text); // color a whole phrase by a pct's sign
const renderFinding = (text) => {
  const parts = text.split(/(\{up:.*?\}|\{dn:.*?\}|\*\*.*?\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('{up:')) return <strong key={i} style={{ color: UP_COLOR }}>{p.slice(4, -1)}</strong>;
    if (p.startsWith('{dn:')) return <strong key={i} style={{ color: DN_COLOR }}>{p.slice(4, -1)}</strong>;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="text-black">{p.slice(2, -2)}</strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
};

/* ------------------------------------------------------------------ */
/* COUNCIL DISTRICTS TAB                                               */
/* For each of the 51 Council districts: which NYPD precincts serve    */
/* it (with each precinct's share of the district's area, computed     */
/* from official boundary files) and how crime is trending in each,    */
/* against the citywide average. Year-to-date or rolling 52-week —     */
/* weekly counts are too small at this geography to be meaningful.     */
/* Modeled on the D15 precinct-overlap map.                            */
/* ------------------------------------------------------------------ */

// Categorical pastels for the overlapping precincts, echoing the D15 model map.
const PRECINCT_COLORS = ['#aac4e4', '#f9c99b', '#f2a79e', '#b5d9a8', '#cfcbe6', '#eab8cf', '#dbd3a4', '#a5d8d3'];

// Every precinct that holds any of the district's residents gets a label. There used to
// be a 4% floor, which silently hid real overlaps once weighting moved to population
// (District 2's 17th and 14th are ~2% each and were unlabelled).
const MIN_LABEL_SHARE = 0;

// District geographies are too small for weekly counts, so this tab reads the year_to_date
// node — which in the 52-week view holds the rolling window (see buildRollingData).
// Sum a set of major-felony offenses over one CompStat geography record.
const tallyGeo = (geoRecord, names) => {
  if (!geoRecord?.seven_major_felonies) return { cur: null, pri: null, pct: null, diff: null };
  let cur = 0, pri = 0;
  Object.entries(geoRecord.seven_major_felonies).forEach(([name, s]) => {
    if (names && !names.includes(name)) return;
    cur += safeNum(s?.year_to_date?.current_year);
    pri += safeNum(s?.year_to_date?.prior_year);
  });
  return { cur, pri, pct: pri > 0 ? ((cur - pri) / pri) * 100 : null, diff: cur - pri };
};

const DistrictMap = ({ district, onSelectPrecinct, shootings, showShootings, setShowShootings, shootingsLoaded, coverageLabel = '', printMode = false, width = 560, height = 520 }) => {
  const [hoverKey, setHoverKey] = useState(null); // dot enlarged on hover
  const [active, setActive] = useState(null);     // clicked dot → pinned popover
  const svgRef = useRef(null);
  useEffect(() => { setActive(null); setHoverKey(null); }, [district, showShootings]);

  const { pathFn, projection, districtFeature, shareByPrecinct, colorByPrecinct, labelByPrecinct } = useMemo(() => {
    const districtFeature = { type: 'Feature', properties: {}, geometry: district.geometry };
    const projection = geoMercator().fitExtent([[36, 36], [width - 36, height - 36]], districtFeature);
    const pathFn = geoPath().projection(projection);
    const shareByPrecinct = {};
    const colorByPrecinct = {};
    const labelByPrecinct = {};
    district.precincts.forEach((o, i) => {
      shareByPrecinct[o.precinct] = o.share;
      colorByPrecinct[o.precinct] = PRECINCT_COLORS[i % PRECINCT_COLORS.length];
      labelByPrecinct[o.precinct] = o.labelPoint;
    });
    return { pathFn, projection, districtFeature, shareByPrecinct, colorByPrecinct, labelByPrecinct };
  }, [district, width, height]);

  // Shootings inside this district's boundary, projected to the map's coordinate space.
  const districtShootings = useMemo(() => {
    if (!shootings || !shootings.length) return [];
    return shootings
      .filter(s => geoContains(districtFeature, [s.lng, s.lat]))
      .map(s => { const p = projection([s.lng, s.lat]); return p ? { ...s, x: p[0], y: p[1] } : null; })
      .filter(Boolean);
  }, [shootings, districtFeature, projection]);


  return (
    <div className={`relative ${printMode ? 'h-full' : 'w-full h-[400px] lg:h-[600px]'}`}>
      {/* Shootings toggle (hidden in the print one-pager) */}
      {!printMode && (
        <button
          onClick={() => setShowShootings(v => !v)}
          disabled={!shootingsLoaded}
          title="Plot this year's shooting incidents inside the district"
          className={`absolute top-2 left-2 z-10 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded border shadow-sm transition-colors ${!shootingsLoaded ? 'bg-white/90 text-gray-300 border-gray-200 cursor-wait' : showShootings ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/95 text-gray-700 border-gray-300 hover:border-gray-500'}`}
        >
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#c0143c' }} />
          {showShootings ? 'Hide' : 'Show'} Shootings ({coverageLabel}){shootingsLoaded ? ` · ${districtShootings.length}` : ' …'}
        </button>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full bg-gray-50 rounded-sm border border-gray-200">
        {/* Context: every precinct, gray */}
        {precinctGeoJSON.features.map(f => {
          const pNum = parseInt(f.properties.precinct, 10);
          const inDistrict = shareByPrecinct[pNum] != null;
          return (
            <path
              key={`base-${f.properties.precinct}`}
              d={pathFn(f)}
              fill={inDistrict ? colorByPrecinct[pNum] : '#ebebeb'}
              fillOpacity={inDistrict ? 0.55 : 1}
              stroke="#fff"
              strokeWidth={0.75}
              style={{ cursor: inDistrict ? 'pointer' : 'default' }}
              onClick={() => inDistrict && onSelectPrecinct(toOrdinalPrecinct(pNum))}
            />
          );
        })}
        {/* District outline on top */}
        <path d={pathFn(districtFeature)} fill="none" stroke="#111" strokeWidth={2.5} strokeLinejoin="round" pointerEvents="none" />
        {/* Labels for the overlapping precincts. Placed biggest-share first, and a label
            that would land on one already placed is nudged downward — two thin slivers can
            sit side by side (District 2's 14th and 17th) and would otherwise overprint. */}
        {(() => { const placed = []; return precinctGeoJSON.features
          .slice()
          .sort((a, b) => (shareByPrecinct[parseInt(b.properties.precinct, 10)] || 0)
                        - (shareByPrecinct[parseInt(a.properties.precinct, 10)] || 0))
          .map(f => {
          const pNum = parseInt(f.properties.precinct, 10);
          const share = shareByPrecinct[pNum];
          if (share == null || share < MIN_LABEL_SHARE) return null;
          /* Label the precinct where a reader looks for it: the middle of the precinct
             itself. The map draws neighbouring precincts too, so that point is usually on
             canvas even when most of the precinct lies outside the district. Only when it
             is not do we fall back to a point inside the sliver of overlap (precomputed in
             build_populations.py) — that keeps a label like District 45's 66th on the map,
             but placing a thin sliver's point FIRST put it on the district outline, away
             from the precinct's own colour, which read as mislabelled. */
          const own = pathFn.centroid(f);
          if (!isFinite(own[0]) || !isFinite(own[1])) return null;
          const slice = labelByPrecinct[pNum] ? projection(labelByPrecinct[pNum]) : null;
          /* If the precinct's own centre sits off-canvas (most of the precinct lies outside
             this district's view), slide it back to the nearest edge rather than jumping to
             the sliver of overlap. The sliver's point hugs the district outline and reads as
             belonging to the neighbour — District 45's 66th sat on the boundary line. The
             clamp keeps the label's vertical position, so it stays over the precinct's own
             visible colour. */
          const margin = 46;
          const onFrame = (q) => q && q[0] > margin && q[0] < width - margin && q[1] > 18 && q[1] < height - 18;
          let cx, cy;
          if (onFrame(own)) {
            [cx, cy] = own;                       // the precinct's own centre is visible: use it
          } else if (share >= 0.03 && onFrame(slice)) {
            [cx, cy] = slice;                     // a real chunk of the district: centre it on that chunk
          } else {
            // A sliver whose precinct lies mostly off-view. The slice point hugs the district
            // outline and reads as the neighbour's, so slide the precinct's own centre to the
            // nearest edge instead — it keeps the label on the precinct's own colour.
            cx = Math.min(Math.max(own[0], margin), width - margin);
            cy = Math.min(Math.max(own[1], 18), height - 18);
          }
          if (own[0] < -2 * width || own[0] > 3 * width || own[1] < -2 * height || own[1] > 3 * height) return null;
          // A thin sliver gets a compact one-line label — it is far narrower, so two
          // adjacent slivers usually both fit without being moved at all.
          const compact = share < 0.05;
          const halfW = compact ? 42 : 78;
          const step = compact ? 16 : 30;
          // Nudge UP first: a small overlap sits at the district's edge, so up keeps the
          // label beside its own sliver, while down drops it into the neighbour's colour.
          for (const dir of [-1, 1]) {
            let y = cy;
            let ok = true;
            for (let guard = 0; guard < 5; guard++) {
              const yy = y;
              if (!placed.some(q => Math.abs(q[0] - cx) < halfW + q[2] && Math.abs(q[1] - yy) < step)) { ok = true; break; }
              y += dir * step;
              ok = false;
            }
            if (ok && y > 8 && y < height - 8) { cy = y; break; }
          }
          if (cy < 0 || cy > height) return null;
          placed.push([cx, cy, halfW]);
          const short = toOrdinalPrecinct(pNum).replace(' Precinct', '');
          return (
            <g key={`label-${pNum}`} pointerEvents="none">
              {compact ? (
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1f2937" stroke="#fff" strokeWidth="3" paintOrder="stroke">
                  {short} Pct &middot; {share < 0.005 ? '<1' : Math.round(share * 100)}%
                </text>
              ) : (<>
                <text x={cx} y={cy - 3} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1f2937" stroke="#fff" strokeWidth="3" paintOrder="stroke">{short} Pct</text>
                <text x={cx} y={cy + 11} textAnchor="middle" fontSize="11" fontWeight="600" fill="#4b5563" stroke="#fff" strokeWidth="3" paintOrder="stroke">{share < 0.005 ? '<1' : Math.round(share * 100)}% of pop.</text>
              </>)}
            </g>
          );
        }); })()}
        {/* Shooting incidents — click a dot to pin its details */}
        {showShootings && districtShootings.map(s => (
          <circle
            key={s.key}
            cx={s.x} cy={s.y} r={active?.key === s.key ? 7 : hoverKey === s.key ? 6 : 4.5}
            fill="#c0143c" fillOpacity={active?.key === s.key ? 1 : 0.85} stroke="#fff" strokeWidth={1.25}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoverKey(s.key)}
            onMouseLeave={() => setHoverKey(null)}
            onClick={() => setActive(a => (a?.key === s.key ? null : s))}
          />
        ))}
      </svg>

      {/* Pinned popover for the clicked shooting */}
      {showShootings && active && (() => {
        const leftPct = (active.x / width) * 100;
        const topPct = (active.y / height) * 100;
        return (
          <div
            className="absolute bg-white border border-gray-200 shadow-xl rounded p-3 z-50 text-[11px] w-56"
            style={{ left: `${Math.min(leftPct, 55)}%`, top: `calc(${topPct}% + 12px)` }}
          >
            <button onClick={() => setActive(null)} aria-label="Close" className="absolute top-1 right-2 text-gray-400 hover:text-black text-[15px] leading-none">×</button>
            <div className="font-black text-black text-[13px] pr-4 leading-tight">{describeShooting(active)}</div>
            <div className="text-gray-600 mt-1">{fmtTime(active.time)}{active.time && active.date ? ' · ' : ''}{fmtDate(active.date)}</div>
            <div className="text-gray-500">{toOrdinalPrecinct(active.precinct)} · {titleCaseBoro(active.boro)}</div>
            <div className="text-gray-400 text-[10px] mt-1.5 pt-1.5 border-t border-gray-100">
              Source: <a href="https://data.cityofnewyork.us/Public-Safety/NYPD-Shooting-Incident-Data-Year-To-Date-/5ucz-vwe8" target="_blank" rel="noopener noreferrer" className="underline hover:text-black">NYPD Open Data</a>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

/* The district selector doubles as the page title. Closed, it shows the district
   number and member as a heading; clicking it opens a type-to-search picker
   (matching district number or member name) — the flat 51-item dropdown was unwieldy. */
const DistrictTitleSelector = ({ districts, district, setDistrictNum }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const querySettled = useSettled(query);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return districts;
    return districts.filter(d =>
      String(d.district) === q ||
      String(d.district).startsWith(q) ||
      (d.member || '').toLowerCase().includes(q)
    );
  }, [query, districts]);

  if (open) {
    return (
      <div className="relative w-80 max-w-full">
        <SearchIcon size={14} className="absolute left-2.5 top-[11px] pointer-events-none text-gray-400" />
        <input
          type="text"
          autoFocus
          placeholder="District number or member name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 200)}
          className="w-full text-[14px] font-bold py-2 pl-8 pr-2 rounded border bg-white focus:outline-none border-[#ff7c53]"
        />
        <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 shadow-xl rounded z-50 max-h-80 overflow-y-auto">
          {results.length === 0 && querySettled && <div className="px-3 py-3 text-sm text-gray-500">No matches.</div>}
          {results.map(d => (
            <button
              key={d.district}
              onMouseDown={() => { setDistrictNum(d.district); setOpen(false); setQuery(''); }}
              className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${d.district === district.district ? 'bg-gray-50' : ''}`}
            >
              <span className="text-[13px] font-black text-black">District {d.district}</span>
              {d.member && <span className="text-[13px] text-gray-500"> — {d.member}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => { setOpen(true); setQuery(''); }} title="Change district" className="text-left group min-w-0">
      <div className="flex items-center gap-2">
        <h2 className="text-xl sm:text-2xl font-black font-serif group-hover:text-[#ff7c53] transition-colors whitespace-nowrap">Council District {district.district}</h2>
        <ChevronDown size={18} className="text-gray-400 group-hover:text-[#ff7c53] flex-shrink-0" />
      </div>
      <div className="flex items-baseline flex-wrap gap-x-2 mt-0.5">
        {district.member && <span className="text-[13px] sm:text-[14px] font-serif text-gray-600">Council Member {district.member}</span>}
        <span className="text-[12px] text-gray-400">· {district.precincts.length} precincts</span>
      </div>
    </button>
  );
};

/* Landing state for the council tab when no district is in the URL: pick, don't presume.
   The box takes an address too — geocoded with the same lookup the subscribe flow uses. */
function DistrictChooser({ districts, setDistrictNum }) {
  const [q, setQ] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [lookupState, setLookupState] = useState('idle');
  const debounce = useRef(null);
  const norm = q.trim().toLowerCase();
  const num = parseInt(norm.replace(/^district\s*/, ''), 10);
  const matches = norm
    ? districts.filter(d => d.district === num || (d.member || '').toLowerCase().includes(norm))
    : districts;
  useEffect(() => {
    const t = q.trim();
    // only geocode input that reads like an address, not a number or a name fragment
    if (t.length < 6 || !/\d/.test(t) || /^district\s*\d*$/i.test(t) || /^\d+$/.test(t)) {
      setSuggestion(null); setLookupState('idle'); return;
    }
    setLookupState('searching');
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetch(GEOSEARCH_URL + encodeURIComponent(t))
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(gj => {
          const hit = (gj.features || []).map(ft => ({ ft, d: districtForPoint(ft.geometry.coordinates, districts) })).find(x => x.d);
          setSuggestion(hit ? { label: hit.ft.properties?.label || t, district: hit.d } : null);
          setLookupState('done');
        })
        .catch(() => { setSuggestion(null); setLookupState('error'); });
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [q, districts]);
  const settled = useSettled(q);
  return (
    <div className="max-w-xl">
      <div className="bg-gray-50 rounded-sm border border-gray-200 p-5">
        <h2 className="text-xl sm:text-2xl font-black font-serif mb-1">Which Council district?</h2>
        <p className="text-[13px] text-gray-600 mb-3">Type your address and we&rsquo;ll find it &mdash; or a district number or Council member&rsquo;s name, or pick from the list.</p>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="Your address, district number or Council member&hellip;"
          className="w-full border border-gray-300 rounded bg-white px-3 py-2 text-[14px] font-bold focus:outline-none focus:border-gray-500 mb-2" />
        {lookupState === 'searching' && <div className="text-[11px] text-gray-500 mb-1">Looking up address&hellip;</div>}
        {suggestion && (
          <button onClick={() => setDistrictNum(suggestion.district.district)}
            className="w-full text-left px-3 py-2 mb-2 bg-white border border-gray-800 rounded-sm hover:bg-gray-50">
            <span className="text-[12px] text-gray-500">{suggestion.label} &rarr; </span>
            <span className="text-[13px] font-black text-black">District {suggestion.district.district}</span>
            {suggestion.district.member && <span className="text-[13px] text-gray-500"> — {suggestion.district.member}</span>}
          </button>
        )}
        <div className="max-h-72 overflow-y-auto border border-gray-200 bg-white rounded-sm">
          {matches.map(d => (
            <button key={d.district} onClick={() => setDistrictNum(d.district)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
              <span className="text-[13px] font-black text-black">District {d.district}</span>
              {d.member && <span className="text-[13px] text-gray-500"> — {d.member}</span>}
            </button>
          ))}
          {matches.length === 0 && !suggestion && lookupState !== 'searching' && settled && (
            <div className="px-3 py-3 text-[13px] text-gray-500">No match — try a number 1&ndash;51 or a member&rsquo;s name.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CouncilDistricts({ rawData, activeTab, districtNum, setDistrictNum, contextData, onSelectPrecinct, downloadCSV }) {
  const districts = DISTRICTS;
  const chosen = districts.find(d => d.district === districtNum) || null;
  const district = chosen || districts[0]; // placeholder for computations; render is gated on `chosen`

  // YTD shooting incidents (fetched once, cached across district switches).
  const [shootings, setShootings] = useState(null);
  const [showShootings, setShowShootings] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchShootings().then(d => { if (alive) setShootings(d); });
    return () => { alive = false; };
  }, []);
  // Date span + coverage of the shootings, for an honest note.
  const shootingWindow = useMemo(() => {
    if (!shootings || !shootings.points.length) return null;
    const dates = shootings.points.map(s => s.date).filter(Boolean).sort();
    return { from: dates[0], to: dates[dates.length - 1], located: shootings.located, total: shootings.total };
  }, [shootings]);

  // The Past year tab swaps rawData for rolling.json, whose entries carry no report_period —
  // that date lives in the file's top-level _rolling block instead.
  const period = rawData?.citywide?.report_period
    || (rawData?._rolling?.current_to ? { week_end: rawData._rolling.current_to } : {});
  const endYear = period?.week_end ? new Date(period.week_end).getFullYear() : new Date().getFullYear();
  const yy = (y) => `’${String(y).slice(-2)}`;

  // How much of the year the shooting feed covers, phrased as quarters: Q1, Q1-2, Q1-3,
  // or just the year once all four quarters are in. Derived from the latest incident date.
  const coverageLabel = useMemo(() => {
    const to = shootingWindow?.to;
    if (!to) return `Q1 ${endYear}`;
    const q = Math.ceil(Number(to.slice(5, 7)) / 3); // 1..4 from the month
    return q >= 4 ? `${endYear}` : q === 1 ? `Q1 ${endYear}` : `Q1-${q} ${endYear}`;
  }, [shootingWindow, endYear]);

  // Each overlapping precinct's YTD major-index totals, split into violent / property subsets.
  const rows = useMemo(() => {
    return district.precincts.map((o, i) => {
      const geoKey = toOrdinalPrecinct(o.precinct);
      const d = rawData?.[geoKey];
      return {
        precinct: o.precinct,
        geoKey,
        share: o.share,
        color: PRECINCT_COLORS[i % PRECINCT_COLORS.length],
        hoods: PRECINCT_NEIGHBORHOODS[geoKey] || '',
        all: tallyGeo(d, null),
        violent: tallyGeo(d, MAJOR_VIOLENT),
        property: tallyGeo(d, MAJOR_PROPERTY),
      };
    });
  }, [district, rawData]);

  // Citywide reference — the same three measures, as a comparison line.
  const citywide = useMemo(() => {
    const cw = rawData?.citywide;
    return {
      all: tallyGeo(cw, null),
      violent: tallyGeo(cw, MAJOR_VIOLENT),
      property: tallyGeo(cw, MAJOR_PROPERTY),
    };
  }, [rawData]);

  const f = useMemo(() => computeCouncilFindings(district, rawData), [district, rawData]);

  // The share-weighted precinct average — a crude estimate of the district as a whole.
  // Still computed, kept for the WEIGHTED-AVG HIDDEN blocks below (table row, PDF row,
  // CSV export). Delete nothing here.
  // eslint-disable-next-line no-unused-vars
  const precinctAvg = { all: f.districtAll, violent: f.districtVio, property: f.districtProp };

  // How much this district's weighted year-to-date figure has itself moved across the
  // snapshot archive. Districts run steadier than their precincts — pooling several
  // precincts enlarges the sample — but the range is still worth stating.
  const districtVolatility = activeTab === 'r52'
    ? null
    : ytdVolatility(contextData, String(districtNum), 'council');

  // Build the auto-generated top-line findings as bolded prose bullets.
  const findings = useMemo(() => {
    const out = [];
    const dName = `Council District ${district.district}`;
    // 1. Direction the majority of the district's PEOPLE fall under (population share,
    //    which is what upShare/downShare sum — it said "area" until 2026-08-28).
    if (f.upCount + f.downCount > 0) {
      const majDown = f.downShare >= f.upShare;
      const dir = majDown ? 'down' : 'up';
      const cnt = majDown ? f.downCount : f.upCount;
      const shr = Math.round((majDown ? f.downShare : f.upShare) * 100);
      out.push(`Crime is ${cWrap(`${dir} in ${cnt} of the ${f.nP} precincts`, dir === 'up' ? 1 : -1)} that make up ${dName}, that together constitute **${shr}%** of its population.`);
    }
    /* WEIGHTED-AVG HIDDEN 2026-08-28 (Liz's call): the district-level weighted average is no
       longer shown. computeCouncilFindings still returns districtAll/districtVio/districtProp,
       so restoring this bullet is just un-commenting it.
    // 2. Weighted average change vs citywide.
    if (f.districtAll.pct != null) {
      out.push(`Across its precincts, ${cWrap(`total crime is ${lowDir(f.districtAll.pct)}`, f.districtAll.pct)} and ${cWrap(`violent crime ${lowDir(f.districtVio.pct)}`, f.districtVio.pct)} (weighted by the share of each precinct's population that lives within the district) — vs. citywide ${cPct(f.cwAll.pct)} and ${cPct(f.cwVio.pct)}.`);
    }
    */
    // 3. Biggest driver crime type.
    if (f.driver) {
      out.push(`The biggest factor is that ${cWrap(`${expandCrime(f.driver.name)} is ${lowDir(f.driver.pct)}`, f.driver.pct)} on average across the district's precincts.`);
    }
    // 4 / 5. Sharpest single precinct×crime movers.
    if (f.sharpUp) {
      out.push(`The sharpest increase was a ${upTok(Math.round(f.sharpUp.pct) + '% rise in ' + expandCrime(f.sharpUp.crime))} in the **${f.sharpUp.precinct}**.`);
    }
    if (f.sharpDown) {
      out.push(`The sharpest decline was a ${dnTok(Math.round(Math.abs(f.sharpDown.pct)) + '% drop in ' + expandCrime(f.sharpDown.crime))} in the **${f.sharpDown.precinct}**.`);
    }
    return out;
  }, [f, district]);

  // On narrow phones the full "Up 11.9%" phrasing plus the count subline is too wide to keep
  // all three measures, so we fall back to a compact signed "+11.9%" and drop the subline.
  const pctCompact = (v) => (v > 0 ? '+' : '') + v.toFixed(1).replace(/\.0$/, '') + '%';
  const changeCell = (t, key = '') => (
    <td key={key} className="py-2.5 pl-2 sm:pl-3 text-right tabular-nums text-[13px] font-bold whitespace-nowrap" style={{ color: pctColor(t.pct) }}>
      {typeof t.pct === 'number'
        ? (<><span className="sm:hidden">{pctCompact(t.pct)}</span><span className="hidden sm:inline">{dirPct(t.pct)}</span></>)
        : '—'}
      {t.diff != null && <div className="hidden sm:block text-[10px] font-normal text-gray-400">{signedCount(t.diff)}</div>}
    </td>
  );

  const pdfCell = (t) => (
    <td className="text-right py-[3px] pl-1 whitespace-nowrap" style={{ color: pctColor(t.pct) }}>
      <span className="text-[8px] font-bold">{typeof t.pct === 'number' ? dirPct(t.pct) : '\u2014'}</span>
    </td>
  );

  if (!chosen) {
    return <DistrictChooser districts={districts} setDistrictNum={setDistrictNum} />;
  }

  return (
    <>
      <div className="print:hidden">
      {/* The district selector is the page title. Arrows pin to the row edges (title
          absorbs the slack) so they never shift as member-name length changes. */}
      {/* District header merged into the top-lines card: the selector + arrows are the
          card's header row, with the bullets under a hairline — one box instead of a
          separate title row, so the content below starts higher on the screen. */}
      <div className="mb-6 bg-gray-50 rounded-sm border border-gray-200">
        <div className="flex items-start gap-1.5 sm:gap-3 px-4 sm:px-5 pt-3.5 pb-3">
          <button
            onClick={() => setDistrictNum(district.district <= 1 ? 51 : district.district - 1)}
            className="px-2 sm:px-2.5 py-1.5 sm:py-2 text-[13px] font-black border border-gray-300 rounded bg-white hover:bg-gray-100 flex-shrink-0 mt-1" aria-label="Previous district">←</button>
          <div className="w-[440px] max-w-full"><DistrictTitleSelector districts={districts} district={district} setDistrictNum={setDistrictNum} /></div>
          <button
            onClick={() => setDistrictNum(district.district >= 51 ? 1 : district.district + 1)}
            className="px-2 sm:px-2.5 py-1.5 sm:py-2 text-[13px] font-black border border-gray-300 rounded bg-white hover:bg-gray-100 flex-shrink-0 mt-1" aria-label="Next district">→</button>
        </div>

      {/* Auto-generated top-line findings */}
      {findings.length > 0 && (
        <div className="border-t border-gray-200 px-4 sm:px-5 pt-3 pb-4">
          <ul className="space-y-2.5">
            {findings.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-gray-700">
                <span className="text-gray-300 flex-shrink-0 mt-[1px]">▪</span>
                <span>{renderFinding(b)}</span>
              </li>
            ))}
            {/* Same caveat the Headlines page carries, computed on the district's own weighted
                figure rather than any single precinct's. Set off in amber so it reads as a note
                about the measure, not another finding. */}
            {districtVolatility && (
              <li className="text-[15px] leading-relaxed text-gray-700 rounded-sm px-3 py-2 mt-1"
                  style={{ backgroundColor: 'rgba(221, 228, 76, 0.30)' }}>
                <strong className="font-black">{VOLATILITY_LABEL}</strong>{' '}
                {volatilitySentence(districtVolatility, 'district')}
              </li>
            )}
          </ul>
        </div>
      )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-8 items-start">
        <DistrictMap
          district={district}
          onSelectPrecinct={onSelectPrecinct}
          shootings={shootings?.points}
          showShootings={showShootings}
          setShowShootings={setShowShootings}
          shootingsLoaded={shootings != null}
          coverageLabel={coverageLabel}
        />

        {/* Fixed min-height (matches the map) keeps the row height constant across
            districts, so the content below never bounces as precinct counts change. */}
        <div className="lg:min-h-[600px]">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-500 leading-tight">Major felonies by precinct<br /><span className="text-gray-400">{activeTab === 'r52' ? 'Change over the last 52 weeks' : 'Year-on-year change (YTD)'}</span></h4>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  // The browser's Save-as-PDF uses document.title as the default filename.
                  const prev = document.title;
                  document.title = `NYC CompStat Decoder - CD${district.district}`;
                  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
                  window.addEventListener('afterprint', restore);
                  window.print();
                }}
                title="Download a one-page PDF summary of this district"
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-black border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50 transition-colors">
                <Download size={11} /> PDF
              </button>
            <button
              onClick={() => {
                const header = ['Precinct', 'Neighborhoods', 'Share of district population',
                  `All ${yy(endYear)}`, `All ${yy(endYear - 1)}`, 'All change (%)',
                  `Violent ${yy(endYear)}`, `Violent ${yy(endYear - 1)}`, 'Violent change (%)',
                  `Property ${yy(endYear)}`, `Property ${yy(endYear - 1)}`, 'Property change (%)'];
                const line = (label, share, m) => [label, '', share,
                  m.all.cur ?? '', m.all.pri ?? '', typeof m.all.pct === 'number' ? m.all.pct.toFixed(2) : '',
                  m.violent.cur ?? '', m.violent.pri ?? '', typeof m.violent.pct === 'number' ? m.violent.pct.toFixed(2) : '',
                  m.property.cur ?? '', m.property.pri ?? '', typeof m.property.pct === 'number' ? m.property.pct.toFixed(2) : ''];
                const data = rows.map(r => { const l = line(r.geoKey, (r.share * 100).toFixed(1) + '%', r); l[1] = r.hoods; return l; });
                // WEIGHTED-AVG HIDDEN 2026-08-28 — restore by un-commenting:
                // data.push(line('Precinct average (weighted by share)', '', precinctAvg));
                data.push(line('Citywide', '100%', citywide));
                downloadCSV(`council_district_${district.district}_precincts.csv`, [header, ...data]);
              }}
              title="Download this table as CSV"
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-black border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50 transition-colors">
              <Download size={11} /> CSV
            </button>
            </div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-0 sm:min-w-[520px]">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b-2 border-black">
                <th className="py-2">Precinct</th>
                <th className="py-2 text-right leading-tight">Share of district<br className="sm:hidden" /> population</th>
                <th className="py-2 text-right">All</th>
                <th className="py-2 text-right">Violent</th>
                <th className="py-2 text-right">Property</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.precinct} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => onSelectPrecinct(r.geoKey)}>
                  <td className="py-2.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: r.color }} />
                      <div>
                        <div className="text-[13px] font-bold text-black leading-tight">{r.geoKey.replace(' Precinct', ' Pct')}</div>
                        {r.hoods && <div className="text-[11px] text-gray-500 leading-tight">{r.hoods}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-[13px] font-bold text-gray-700">{Math.round(r.share * 100)}%</td>
                  {changeCell(r.all, 'all')}
                  {changeCell(r.violent, 'violent')}
                  {changeCell(r.property, 'property')}
                </tr>
              ))}
              {/* Citywide comparison line. WEIGHTED-AVG HIDDEN 2026-08-28 (Liz's call): the
                  "Precinct average" row above it is no longer shown. `precinctAvg` is still
                  computed, so restoring it is just un-commenting this block:

              <tr className="border-t-2 border-gray-400 bg-gray-100">
                <td className="py-2.5 pr-2">
                  <div className="text-[13px] font-black text-black uppercase tracking-wide">Precinct average</div>
                  <div className="text-[11px] text-gray-500 whitespace-nowrap">Weighted by pop. share within district</div>
                </td>
                <td className="py-2.5 text-right tabular-nums text-[13px] text-gray-400">&mdash;</td>
                {changeCell(precinctAvg.all, 'pa-all')}
                {changeCell(precinctAvg.violent, 'pa-violent')}
                {changeCell(precinctAvg.property, 'pa-property')}
              </tr>
              */}
              <tr className="border-t-2 border-gray-400 bg-gray-50/60">
                <td className="py-2.5 pr-2">
                  <div className="text-[13px] font-black text-black uppercase tracking-wide">Citywide</div>
                  <div className="text-[11px] text-gray-500">Average for comparison</div>
                </td>
                <td className="py-2.5 text-right tabular-nums text-[13px] text-gray-400">—</td>
                {changeCell(citywide.all, 'cw-all')}
                {changeCell(citywide.violent, 'cw-violent')}
                {changeCell(citywide.property, 'cw-property')}
              </tr>
            </tbody>
          </table>
          </div>

          {activeTab === 'wtd' && (
            <p className="mt-3 text-[11px] italic text-gray-500 leading-snug">
              Council-district figures are year-to-date or rolling 52-week — weekly counts are too small at this geography to read reliably.
            </p>
          )}
          {activeTab === 'r52' && (
            <p className="mt-3 text-[11px] italic text-gray-500 leading-snug">
              The last 52 weeks compared with the 52 weeks before them. Recent weeks are still being revised upward, so the latest window is slightly understated.
            </p>
          )}
        </div>
      </div>

      {/* Shootings coverage note (below the grid, so toggling never resizes the map) */}
      {showShootings && shootingWindow && (
        <p className="mt-4 text-[11px] italic text-gray-500 leading-snug max-w-3xl">
          {shootingWindow.total} shooting incidents were reported citywide {fmtDate(shootingWindow.from)} to {fmtDate(shootingWindow.to)}{shootingWindow.located < shootingWindow.total
            ? `, ${shootingWindow.located} of them (${Math.round((shootingWindow.located / shootingWindow.total) * 100)}%) with a mapped location — the rest lacked coordinates`
            : ', every one with a mapped location'}. NYPD geocodes incidents to street-segment midpoints and intersections rather than exact addresses. Dots show the {shootingWindow.located} mapped incidents; click one for details. Source: NYPD Open Data, refreshed quarterly, so the most recent weeks aren't shown yet.
        </p>
      )}

      {/* Email-updates signup (mock: no delivery service connected yet) */}
      <SubscribeBand district={district} districts={districts} f={f} rows={rows} period={period} />
      </div>

      {/* Print-only one-page district report (Download PDF -> browser Save as PDF) */}
      <div className="hidden print:flex print:flex-col text-black leading-tight" style={{ height: '9.55in', overflow: 'hidden' }}>
        <div className="flex justify-between items-end border-b-[3px] border-black pb-2 mb-3 flex-shrink-0">
          <div className="flex items-end gap-3">
            <img src={vcLogo} alt="Vital City" style={{ height: '20px', width: 'auto', marginBottom: '4px' }} />
            <span style={{ width: '1px', height: '26px', background: '#000', marginBottom: '2px' }} />
            <div className="text-[26px] font-black tracking-tight leading-none" style={{ fontFamily: 'system-ui, sans-serif' }}>NYC CompStat Decoder</div>
          </div>
          <div className="text-right leading-none" style={{ fontFamily: 'system-ui, sans-serif' }}>
            <div className="text-[8px] font-black uppercase tracking-widest text-gray-500 mb-0.5">Crime data through</div>
            <div className="text-[19px] font-black tabular-nums">{period.week_end ? new Date(period.week_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
          </div>
        </div>
        <p className="text-[13.5px] leading-relaxed text-gray-700 mb-4 flex-shrink-0" style={{ fontFamily: 'Georgia, serif' }}>
          Every week the New York City Police Department updates data on crime reported in the city&rsquo;s precincts, in a process known as CompStat. This page decodes that data so that no matter where you are in the city, you can understand how crime is changing near you.
        </p>
        <div className="mb-5 flex-shrink-0">
          <div className="text-[34px] font-black leading-none" style={{ fontFamily: 'system-ui, sans-serif' }}>Council District {district.district}</div>
          <div className="text-[14px] text-gray-600 mt-1" style={{ fontFamily: 'Georgia, serif' }}>{district.member ? `Council Member ${district.member} · ` : ''}{district.precincts.length} precincts</div>
        </div>
        <div className="mb-4 p-4 bg-gray-50 border border-gray-300 rounded flex-shrink-0 overflow-hidden" style={{ height: '2.75in' }}>
          <div className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-500 mb-2.5" style={{ fontFamily: 'system-ui, sans-serif' }}>Top-lines</div>
          <ul className="space-y-2" style={{ fontFamily: 'Georgia, serif' }}>
            {findings.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-800">
                <span className="text-gray-400">▪</span><span>{renderFinding(b)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-[1fr_1fr] gap-5 items-stretch flex-1 min-h-0">
          <div className="flex flex-col min-h-0">
            <div className="flex-1 min-h-0">
              <DistrictMap district={district} onSelectPrecinct={() => {}} shootings={shootings?.points} showShootings={true} setShowShootings={() => {}} shootingsLoaded={shootings != null} printMode />
            </div>
            <p className="flex items-center gap-1.5 text-[8px] text-gray-500 mt-1.5 leading-tight flex-shrink-0" style={{ fontFamily: 'system-ui, sans-serif' }}>
              <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#c0143c' }} />
              <span>Shooting incident{shootingWindow ? ` ${fmtDate(shootingWindow.from)} to ${fmtDate(shootingWindow.to)}` : ''}. Source: NYPD Open Data.</span>
            </p>
          </div>
          <div className="flex flex-col min-h-0" style={{ fontFamily: 'system-ui, sans-serif' }}>
            <div className="text-[9px] font-black uppercase tracking-[0.12em] text-gray-500 mb-2 leading-tight flex-shrink-0">Major felonies by precinct<br />{activeTab === 'r52' ? 'Change over the last 52 weeks' : 'Year-on-year change (YTD)'}</div>
            <table className="w-full border-collapse flex-1" style={{ height: '100%' }}>
              <thead>
                <tr className="text-[7px] font-black uppercase tracking-wide text-gray-400 border-b-2 border-black">
                  <th className="text-left py-1 align-bottom">Precinct</th>
                  <th className="text-right py-1 align-bottom leading-tight">Share of district<br />population</th>
                  <th className="text-right py-1 pl-1.5 align-bottom">All</th>
                  <th className="text-right py-1 pl-1.5 align-bottom">Violent</th>
                  <th className="text-right py-1 pl-1.5 align-bottom">Property</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.precinct} className="border-b border-gray-100">
                    <td className="py-[5px] pr-1"><div className="text-[10px] font-bold text-black leading-tight">{r.geoKey.replace(' Precinct', ' Pct')}</div><div className="text-[8px] text-gray-500 leading-tight">{(r.hoods || '').split(',')[0]}</div></td>
                    <td className="text-right text-[10px] font-bold text-gray-700">{Math.round(r.share * 100)}%</td>
                    {pdfCell(r.all)}{pdfCell(r.violent)}{pdfCell(r.property)}
                  </tr>
                ))}
                {/* WEIGHTED-AVG HIDDEN 2026-08-28 (Liz's call) — printable report, same as
                    the on-screen table. Restore by un-commenting:
                <tr className="border-t-2 border-gray-400 bg-gray-100">
                  <td className="py-[5px] pr-1 text-[9.5px] font-black uppercase">Precinct avg</td>
                  <td className="text-right text-[10px] text-gray-400">&mdash;</td>
                  {pdfCell(precinctAvg.all)}{pdfCell(precinctAvg.violent)}{pdfCell(precinctAvg.property)}
                </tr>
                */}
                <tr className="border-t-2 border-gray-400 bg-gray-50">
                  <td className="py-[5px] pr-1 text-[9.5px] font-black uppercase">Citywide</td>
                  <td className="text-right text-[10px] text-gray-400">—</td>
                  {pdfCell(citywide.all)}{pdfCell(citywide.violent)}{pdfCell(citywide.property)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-gray-300 flex justify-between gap-4 text-[8px] text-gray-400 flex-shrink-0" style={{ fontFamily: 'system-ui, sans-serif' }}>
          <span>Sources: NYPD CompStat weekly report; NYC Open Data (complaint &amp; shooting data). Precinct figures are weighted by each precinct's share of the district — a crude approximation, since precincts extend beyond district lines.</span>
          <span className="whitespace-nowrap">Published by Vital City · vitalcitynyc.org</span>
        </div>
      </div>
    </>
  );
}
