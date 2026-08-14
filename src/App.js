import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FALLBACK_DATA, GITHUB_USER, REPO_NAME, REPO_SELF, CITYWIDE_POPULATION, VOLATILITY_THRESHOLD,
  GEO_POPULATIONS, PRECINCT_NEIGHBORHOODS, TOURIST_PRECINCTS, VIOLENT_CRIMES, PROPERTY_CRIMES,
  safeNum, calcPct, formatGeoName, toOrdinalPrecinct, precinctPatrolBorough, PATROL_BOROUGH_NAMES,
  SearchIcon, Navigation, RefreshCw,
  RTCI_CSV_URL, parseRTCIcsv, RTCI_FALLBACK, RTCI_FALLBACK_PERIOD, RTCI_FALLBACK_UPDATED,
  ROLLING_URL,
} from './shared';
import vcLogo from './vitalcity-logo.png';
import NEIGHBORHOODS from './data/neighborhoods.json';
import HistoricView from './HistoricView';
import Headlines from './tabs/Headlines';
import CrimeNumbers from './tabs/CrimeNumbers';
import ByPrecinct from './tabs/ByPrecinct';
import Transit from './tabs/Transit';
import CouncilDistricts from './tabs/CouncilDistricts';
import About from './tabs/About';

// The brand itself is the lead ("headlines") page, so it isn't listed as a tab.
const MAIN_TABS = [
  ['numbers', 'Crime Types'],
  ['precincts', 'By Precinct'],
  ['council', 'By Council District'],
  // TRANSIT-REMOVED (2026-07-10, per Paul Reeping): the "In Transit" tab was dropped because its
  // figures aren't from CompStat and don't map to a locality. To restore, uncomment this one line —
  // the <Transit> component, its import, and its render branch below are all left intact.
  // Full change set + restore steps: TRANSIT_REMOVAL.md at the repo root.
  // ['transit', 'In Transit'],
  ['about', 'About'],
];
const TAB_KEYS = ['headlines', ...MAIN_TABS.map(t => t[0])];
// The geography selector used to be greyed out on the map tabs, on the reasoning that
// changing geography did nothing there. But a search box is where people look for a precinct,
// and being on the precinct map is exactly when they want one — so it stays live everywhere
// and selectGeo() carries them to that precinct's Headlines, which is what they were after.
// Kept as a list because a genuinely citywide-only tab may want it back.
const GEO_INERT_TABS = [];
// Weekly counts are too small to read at these geographies. The 52-week window is not —
// it pools a year, so it is available wherever year-to-date is, except on transit.
const NO_WEEKLY_TABS = ['transit', 'council'];
const NO_ROLLING_TABS = ['transit'];

/* ------------------------------------------------------------------ */
/* MAIN APP — TABBED DASHBOARD                                        */
/* ------------------------------------------------------------------ */
export default function App() {
  // Initialize state from URL query string so deep-links work on first load.
  // Subsequent state changes write back to the URL via replaceState (no history clutter).
  const initialParams = (typeof window !== 'undefined') ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [appView, setAppView] = useState(initialParams.get('view') || 'live');
  const [mainTab, setMainTab] = useState(TAB_KEYS.includes(initialParams.get('tab')) ? initialParams.get('tab') : 'headlines');
  // 52 weeks is the default: it's the only window that means the same thing all year.
  const [activeTab, setActiveTab] = useState(
    ['wtd', 'ytd'].includes(initialParams.get('range')) ? initialParams.get('range') : 'r52'); // r52 | ytd | wtd
  const [activeGeo, setActiveGeo] = useState(initialParams.get('geo') || 'citywide');
  const [districtNum, setDistrictNum] = useState(() => {
    const d = parseInt(initialParams.get('district'), 10);
    return d >= 1 && d <= 51 ? d : 15;
  });
  const [rawData, setRawData] = useState(FALLBACK_DATA);
  const [geoFocused, setGeoFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fetchError, setFetchError] = useState(false);
  const [rtciData, setRtciData] = useState(null);
  const [contextData, setContextData] = useState(null);
  const [rollingData, setRollingData] = useState(null);
  const [rollingState, setRollingState] = useState('idle'); // idle | loading | ready | error
  const [isLocating, setIsLocating] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = () => {
    const url = window.location.href;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).catch(fallback); else fallback();
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1600);
  };

  // Map state ('volume' was retired as a map mode; normalize legacy links to 'rate')
  const [mapCrime, setMapCrime] = useState(initialParams.get('mapCrime') || 'all');
  const [mapMode, setMapMode] = useState(['rate', 'change'].includes(initialParams.get('mapMode')) ? initialParams.get('mapMode') : 'rate');

  const loadReport = useCallback(async () => {
    setFetchError(false);
    const RAW_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/data/latest_compstat.json`;
    try {
      const resp = await fetch(`${RAW_URL}?t=${Date.now()}`);
      const json = await resp.json();
      if (json && json.citywide) { setRawData(json); return; }
    } catch (e1) {
      setFetchError(true);
    }
  }, []);

  useEffect(() => { loadReport(); }, [loadReport]);

  // Sync state to URL whenever any deep-linkable state changes — uses replaceState
  // so toggles don't pollute the browser's back stack.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (appView !== 'live') params.set('view', appView);
    if (mainTab !== 'headlines') params.set('tab', mainTab);
    if (activeTab !== 'r52') params.set('range', activeTab);
    if (activeGeo !== 'citywide') params.set('geo', activeGeo);
    if (mapMode !== 'rate') params.set('mapMode', mapMode);
    if (mapCrime !== 'all') params.set('mapCrime', mapCrime);
    // On the council tab, always pin the district in the URL (including 15) so sharing the
    // page always deep-links to the district on screen — no district is the "empty" default.
    if (mainTab === 'council') params.set('district', String(districtNum));
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [appView, mainTab, activeTab, activeGeo, mapMode, mapCrime, districtNum]);

  // Weekly counts don't apply on the transit and council tabs — snap back to YTD there.
  useEffect(() => {
    if (NO_WEEKLY_TABS.includes(mainTab) && activeTab === 'wtd') setActiveTab('ytd');
    if (NO_ROLLING_TABS.includes(mainTab) && activeTab === 'r52') setActiveTab('ytd');
  }, [mainTab, activeTab]);

  // Generic CSV download helper. Takes a filename and an array of arrays (header + rows).
  const downloadCSV = useCallback((filename, rows) => {
    const escapeCell = (c) => {
      const s = c == null ? '' : String(c);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = rows.map(r => r.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // Fetch RTCI city comparison data
  useEffect(() => {
    fetch(RTCI_CSV_URL)
      .then(r => r.ok ? r.text() : Promise.reject('fetch failed'))
      .then(csv => {
        const parsed = parseRTCIcsv(csv);
        if (parsed) setRtciData(parsed);
      })
      .catch(() => {
        const fallbackMap = {};
        RTCI_FALLBACK.forEach(c => { fallbackMap[c.city] = c; });
        setRtciData({ cities: fallbackMap, period: RTCI_FALLBACK_PERIOD, updated: RTCI_FALLBACK_UPDATED });
      });
  }, []);

  // Revision magnitudes and year-to-date volatility ranges, regenerated weekly by
  // scripts/build_context.py from the snapshot archive. Fetched live rather than bundled
  // so the figures the site quotes about its own reliability can't go stale between builds.
  useEffect(() => {
    fetch(`https://raw.githubusercontent.com/tedalcorn/${REPO_SELF}/main/data/context.json?t=${Date.now()}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('no context')))
      .then(setContextData)
      .catch(() => setContextData(null));
  }, []);

  // The 52-week windows are summed by scripts/archive_weekly_series.py, so this is a small
  // file of finished numbers rather than the ~1.8MB weekly archive it derives from.
  useEffect(() => {
    if (activeTab !== 'r52' || rollingState !== 'idle') return;
    setRollingState('loading');
    fetch(`${ROLLING_URL}?t=${Date.now()}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('no rolling data')))
      .then(j => { setRollingData(j); setRollingState('ready'); })
      .catch(() => setRollingState('error'));
  }, [activeTab, rollingState]);

  // Everything downstream reads one feed. In the 52-week view that feed is the rolling
  // window reshaped to look like CompStat's; until it loads, the live feed stands in so the
  // page never blanks.
  const effectiveRaw = (activeTab === 'r52' && rollingData) ? rollingData : rawData;
  const rollingMeta = rollingData?._rolling || null;
  // About is plain prose and never shows a count, so it shouldn't wait on the data.
  const rollingPending = activeTab === 'r52' && !rollingData && rollingState !== 'error'
    && mainTab !== 'about';

  // Selecting a geography routes to a tab that can actually show it.
  const selectGeo = (geo) => {
    setActiveGeo(geo);
    if (!['headlines', 'numbers'].includes(mainTab)) setMainTab('headlines');
  };
  const selectPrecinctForNumbers = (geoKey) => {
    setActiveGeo(geoKey);
    setMainTab('numbers');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  // Used by precinct hyperlinks in Headlines patterns: focus that precinct's overview.
  const goToGeoHeadlines = (geoKey) => {
    setActiveGeo(geoKey);
    setMainTab('headlines');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  const handleLocateUser = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        // Police Precincts on NYC Open Data. The previous id (78dh-3ptz) was retired and now
        // 404s, which silently sent every locate-me request to the citywide fallback.
        const res = await fetch(`https://data.cityofnewyork.us/resource/y76i-bdw7.json?$where=intersects(the_geom, 'POINT(${longitude} ${latitude})')`);
        const data = await res.json();
        if (data && data.length > 0) {
          const pName = toOrdinalPrecinct(data[0].precinct);
          selectGeo(rawData[pName] ? pName : 'citywide');
        } else {
          // Accepted location but not inside any NYPD precinct (outside NYC) — show citywide.
          selectGeo('citywide');
        }
      } catch (err) { selectGeo('citywide'); }
      finally { setIsLocating(false); }
    }, () => setIsLocating(false));
  };

  const boroughs = useMemo(() => {
    return Object.keys(rawData).filter(k => k !== 'citywide' && !k.includes('Precinct')).sort();
  }, [rawData]);

  const geoSearchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    // Collapse case, hyphens and punctuation so "bedford stuyvesant", "Bed-Stuy" and
    // "bedstuy" all match the same entries.
    const norm = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const nq = norm(q);
    const matchedBoroughs = boroughs.filter(b => !q || norm(b).includes(nq));
    const matchedPrecincts = Object.entries(PRECINCT_NEIGHBORHOODS)
      .filter(([pct, hoods]) => !q || pct.toLowerCase().includes(q) || norm(hoods).includes(nq))
      .map(([pct, hoods]) => ({ pct, hoods }));
    // NTA crosswalk: search the official 2020 neighborhood names too, and surface each
    // precinct the neighborhood overlaps (share of the neighborhood's area, largest first).
    if (nq.length >= 2) {
      // Several matching neighborhoods can point at the same precinct (Bed-Stuy East and
      // West both touch the 79th) — keep whichever gives the precinct its largest share.
      const best = {};
      NEIGHBORHOODS.filter(n => norm(n.name).includes(nq)).forEach(n => {
        n.precincts.forEach(({ p, share }) => {
          if (!best[p] || share > best[p].share) best[p] = { name: n.name, share };
        });
      });
      const already = new Set(matchedPrecincts.map(r => r.pct));
      Object.entries(best)
        .sort((a, b) => b[1].share - a[1].share)
        .forEach(([p, via]) => {
          if (already.has(p)) return;
          matchedPrecincts.push({ pct: p, hoods: PRECINCT_NEIGHBORHOODS[p] || '', via });
        });
    }
    return { boroughs: matchedBoroughs, precincts: matchedPrecincts, showCitywide: !q || 'citywide'.includes(q) };
  }, [searchQuery, boroughs]);

  const parsedData = useMemo(() => {
    const geoData = effectiveRaw[activeGeo] || effectiveRaw['citywide'];
    const citywideData = effectiveRaw['citywide'];
    const pop = activeGeo === 'citywide' ? CITYWIDE_POPULATION : (GEO_POPULATIONS[activeGeo] || null);
    const extract = (obj) => Object.entries(obj || {}).map(([name, stats]) => {
      const current = activeTab !== 'wtd' ? stats?.year_to_date?.current_year : stats?.week_to_date?.current_year;
      const prior = activeTab !== 'wtd' ? stats?.year_to_date?.prior_year : stats?.week_to_date?.prior_year;
      const pct = activeTab !== 'wtd' ? stats?.year_to_date?.pct_change : stats?.week_to_date?.pct_change;
      const c = safeNum(current); const p = safeNum(prior);
      return { name, current: c, prior: p, pct, diff: c - p, hist: stats?.historical || {}, currentRate: pop ? (c / pop) * 100000 : null };
    });
    const felonies = extract(geoData.seven_major_felonies).sort((a, b) => b.current - a.current);
    // TRANSIT-REMOVED (2026-07-10): drop the system-wide "Transit" bureau line so it never leaks
    // into the Crime Types table or the Headlines pattern callouts. Delete the .filter() to restore.
    // See TRANSIT_REMOVAL.md.
    const minors = extract(geoData.additional_stats)
      .filter(m => m.name !== 'Transit')
      .sort((a, b) => b.current - a.current);
    const all = [...felonies, ...minors].sort((a, b) => b.current - a.current);

    let mCur = 0, mPri = 0, pCur = 0, vCur = 0, murder = 0, shootingVic = 0;
    felonies.forEach(f => {
      mCur += f.current; mPri += f.prior;
      if (f.name === 'Murder') murder = f.current;
      if (PROPERTY_CRIMES.includes(f.name)) pCur += f.current;
      if (VIOLENT_CRIMES.includes(f.name)) vCur += f.current;
    });
    minors.forEach(m => { if (m.name === 'Shooting Vic.') shootingVic = m.current; });

    const citywideRates = {};
    let cwMCur = 0;
    if (citywideData) {
      const cwFelonies = citywideData.seven_major_felonies || {};
      const cwAddl = citywideData.additional_stats || {};
      const cwAll = { ...cwFelonies, ...cwAddl };

      Object.entries(cwAll).forEach(([n, s]) => {
        const c = activeTab !== 'wtd' ? s?.year_to_date?.current_year : s?.week_to_date?.current_year;
        citywideRates[n] = (safeNum(c) / CITYWIDE_POPULATION) * 100000;
      });

      Object.values(cwFelonies).forEach(stats => {
        const c = activeTab !== 'wtd' ? stats?.year_to_date?.current_year : stats?.week_to_date?.current_year;
        cwMCur += safeNum(c);
      });
    }

    const mDiff = mCur - mPri;
    let driverObj = null;
    if (mDiff !== 0 && felonies.length > 0) {
      const d = felonies.reduce((p, c) => (Math.abs(c.diff) > Math.abs(p.diff) && Math.sign(c.diff) === Math.sign(mDiff)) ? c : p, {diff: 0});
      if (d && d.name) driverObj = { name: d.name, diff: d.diff, share: Math.abs((d.diff / mDiff) * 100) };
    }

    let topSurge = null, topDrop = null;
    felonies.forEach(f => {
      if (f.prior >= VOLATILITY_THRESHOLD) {
        if (f.pct > 0 && (!topSurge || f.pct > topSurge.pct)) topSurge = f;
        if (f.pct < 0 && (!topDrop || f.pct < topDrop.pct)) topDrop = f;
      }
    });

    let localAnomaly = null, localBrightSpot = null;
    const isTourist = TOURIST_PRECINCTS.includes(activeGeo);
    if (activeGeo !== 'citywide' && pop && citywideData && !isTourist) {
      let maxRatio = 0, minRatio = Infinity;
      all.forEach(item => {
        if (item.currentRate !== null && citywideRates[item.name] && item.current >= 5) {
          const ratio = item.currentRate / citywideRates[item.name];
          if (ratio > maxRatio && ratio > 1.25) { maxRatio = ratio; localAnomaly = { name: item.name, localRate: item.currentRate, cityRate: citywideRates[item.name], ratio }; }
        }
      });
      felonies.forEach(item => {
        if (item.currentRate !== null && citywideRates[item.name] && item.prior >= 5) {
          const ratio = item.currentRate / citywideRates[item.name];
          if (ratio < minRatio && ratio < 0.75) { minRatio = ratio; localBrightSpot = { name: item.name, localRate: item.currentRate, cityRate: citywideRates[item.name], ratio }; }
        }
      });
    }

    return {
      period: geoData.report_period || {},
      felonies, minors, all, driver: driverObj, citywideRates, localAnomaly, localBrightSpot, topSurge, topDrop,
      totals: {
        mCur, mPri, pCur, vCur,
        mPct: calcPct(mCur, mPri) ?? 0,
        diff: mDiff,
        murder,
        shootingVic,
        citywideRate: (cwMCur / CITYWIDE_POPULATION) * 100000,
        lethalityRatio: murder > 0 ? (shootingVic / murder) : 0
      }
    };
  }, [effectiveRaw, activeTab, activeGeo]);

  // Dynamic <title> so browser tabs and social previews carry the latest reporting period.
  useEffect(() => {
    if (parsedData?.period?.week_end) {
      const fmt = (s) => {
        try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
        catch { return s; }
      };
      const end = fmt(parsedData.period.week_end);
      // The embedded fallback snapshot can be months old; claiming "Updated <date>" from
      // it presents stale data as current (a crawler with fetch blocked sees exactly that).
      document.title = rawData === FALLBACK_DATA ? 'NYC CompStat Decoder' : `NYC CompStat Decoder · Updated ${end}`;
    }
  }, [parsedData.period?.week_end, parsedData.period?.week_start, rawData]);

  const hotspots = useMemo(() => {
    // Scope the pattern-detection pool: citywide looks across all precincts; a borough
    // looks only at its own precincts. (Precinct views use their own vs-citywide rules.)
    const isBorough = PATROL_BOROUGH_NAMES.includes(activeGeo);
    const keys = Object.keys(effectiveRaw).filter(k => k !== 'citywide' && k.includes('Precinct'))
      .filter(k => !isBorough || precinctPatrolBorough(k) === activeGeo);
    const topCount = isBorough ? 3 : 5;
    let volumes = [], allPrecinctCrimes = [];
    keys.forEach(pct => {
      const data = effectiveRaw[pct]; let vSum = 0;
      Object.entries(data.seven_major_felonies || {}).forEach(([crime, stats]) => {
        const c = safeNum(activeTab !== 'wtd' ? stats?.year_to_date?.current_year : stats?.week_to_date?.current_year);
        const p = safeNum(activeTab !== 'wtd' ? stats?.year_to_date?.prior_year : stats?.week_to_date?.prior_year);
        if (VIOLENT_CRIMES.includes(crime)) vSum += c;
        if (p >= VOLATILITY_THRESHOLD) allPrecinctCrimes.push({ precinct: pct, crime, pct: ((c - p) / p) * 100, current: c, prior: p });
      });
      volumes.push({ precinct: pct, violent: vSum });
    });
    const sortedV = [...volumes].filter(v => v.violent > 0).sort((a,b) => b.violent - a.violent);
    let inequality = null;
    if (sortedV.length > topCount * 2) {
      const top = sortedV.slice(0, topCount); const topSum = top.reduce((s, p) => s + p.violent, 0); const topPop = top.reduce((s, p) => s + (GEO_POPULATIONS[p.precinct] || 0), 0);
      let bottomSum = 0, bottomCount = 0, bottomPop = 0;
      for (let i = sortedV.length - 1; i >= 0 && bottomSum < topSum; i--) { bottomSum += sortedV[i].violent; bottomCount++; bottomPop += (GEO_POPULATIONS[sortedV[i].precinct] || 0); }
      if (bottomCount > topCount) inequality = { topCount, topSum, topPop, bottomCount, bottomPop };
    }
    allPrecinctCrimes.sort((a, b) => b.pct - a.pct);
    return { inequality, topPctSpike: allPrecinctCrimes[0], topPctDrop: allPrecinctCrimes[allPrecinctCrimes.length - 1] };
  }, [effectiveRaw, activeTab, activeGeo]);

  const isTouristPrecinct = TOURIST_PRECINCTS.includes(activeGeo);
  const activePop = GEO_POPULATIONS[activeGeo] || (activeGeo === 'citywide' ? CITYWIDE_POPULATION : null);
  const geoInert = GEO_INERT_TABS.includes(mainTab); // geography selector does nothing here
  const weeklyOff = NO_WEEKLY_TABS.includes(mainTab);    // weekly counts too small here
  const rollingOff = NO_ROLLING_TABS.includes(mainTab);  // no weekly series for this view

  // Compute per-100k rates for all precincts (for map + ranking bars)
  const precinctRates = useMemo(() => {
    const precinctKeys = Object.keys(effectiveRaw).filter(k => k.includes('Precinct'));
    return precinctKeys.map(pct => {
      const pop = GEO_POPULATIONS[pct];
      const d = effectiveRaw[pct];
      const felonies = d.seven_major_felonies || {};
      const addl = d.additional_stats || {};
      let count = 0, priorCount = 0;
      const getCurrent = (stats) => safeNum(activeTab !== 'wtd' ? stats?.year_to_date?.current_year : stats?.week_to_date?.current_year);
      const getPrior = (stats) => safeNum(activeTab !== 'wtd' ? stats?.year_to_date?.prior_year : stats?.week_to_date?.prior_year);
      if (mapCrime === 'all') {
        Object.values(felonies).forEach(s => { count += getCurrent(s); priorCount += getPrior(s); });
      } else if (mapCrime === 'violent') {
        ['Murder', 'Rape', 'Robbery', 'Fel. Assault'].forEach(c => { if (felonies[c]) { count += getCurrent(felonies[c]); priorCount += getPrior(felonies[c]); } });
      } else if (mapCrime === 'property') {
        ['Burglary', 'Gr. Larceny', 'G.L.A.'].forEach(c => { if (felonies[c]) { count += getCurrent(felonies[c]); priorCount += getPrior(felonies[c]); } });
      } else {
        const all = { ...felonies, ...addl };
        if (all[mapCrime]) { count = getCurrent(all[mapCrime]); priorCount = getPrior(all[mapCrime]); }
      }
      const precinctNum = pct.replace(/\D+/g, '').replace(/^0+/, '');
      const pctChange = priorCount > 0 ? ((count - priorCount) / priorCount) * 100 : null;
      return { precinct: pct, precinctNum, rate: pop ? (count / pop) * 100000 : null, count, priorCount, pctChange, isTourist: TOURIST_PRECINCTS.includes(pct) };
    });
  }, [effectiveRaw, activeTab, mapCrime]);

  // ==========================================
  // HISTORIC VIEW
  // ==========================================
  if (appView === 'historic') {
    return <HistoricView onBack={() => setAppView('live')} />;
  }

  // ==========================================
  // LIVE COMPSTAT DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen pb-12 font-sans bg-white text-black text-[16px]">
      <div className="max-w-[1100px] mx-auto px-5 sm:px-8">

        {/* Single-row navigation: brand, section tabs, geography, period toggle */}
        <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200 -mx-5 sm:-mx-8 px-5 sm:px-8 mb-8 py-2 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-2 gap-y-1.5 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center gap-y-0.5 sm:gap-1 w-full sm:w-auto min-w-0">
          <div className="flex items-center gap-2 self-start flex-shrink-0 sm:mr-2">
            {/* Wordmark at 19px tall (~91px wide) per brand minimum of 90px on web */}
            <a href="https://www.vitalcitynyc.org/" target="_blank" rel="noopener noreferrer" title="Vital City" className="flex-shrink-0 flex items-center">
              <img src={vcLogo} alt="Vital City" className="h-[19px] w-auto" />
            </a>
            <span className="w-px h-4 bg-gray-300 flex-shrink-0" />
            <button
              onClick={() => { setActiveGeo('citywide'); setMainTab('headlines'); }}
              aria-pressed={mainTab === 'headlines'}
              title="Home — citywide headlines"
              className={`text-[11px] font-black uppercase tracking-wider flex-shrink-0 py-1.5 border-b-2 transition-colors ${mainTab === 'headlines' ? 'border-black text-black' : 'border-transparent text-black hover:text-[#ff7c53]'}`}>
              NYC CompStat Decoder
            </button>
          </div>
          <nav className="flex items-center justify-between sm:justify-start w-full sm:w-auto" aria-label="Sections">
            {MAIN_TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMainTab(key)}
                aria-pressed={mainTab === key}
                className={`text-[11px] sm:text-[12.5px] font-bold px-0.5 sm:px-1.5 py-1.5 border-b-2 transition-colors flex-shrink-0 whitespace-nowrap ${mainTab === key ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'}`}
              >
                {label}
              </button>
            ))}
          </nav>
          </div>
          <div className="flex items-center gap-1.5 sm:ml-auto w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-1.5">
            <button
              onClick={handleLocateUser}
              disabled={geoInert || isLocating}
              title={geoInert ? 'Location applies to Headlines and Crime Numbers' : 'Find my precinct from my location'}
              aria-label="Find my precinct from my location"
              className={`flex items-center justify-center h-[30px] w-8 border rounded flex-shrink-0 transition-colors ${geoInert ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed' : 'bg-white border-gray-300 text-gray-500 hover:text-black hover:border-gray-400'}`}>
              {isLocating ? <RefreshCw size={13} className="animate-spin" /> : <Navigation size={13} />}
            </button>
            <div className="relative w-36">
              <SearchIcon size={13} className={`absolute left-2.5 top-[9px] pointer-events-none ${geoInert ? 'text-gray-300' : 'text-gray-400'}`} />
              <input
                type="text"
                disabled={geoInert}
                title={geoInert ? 'Geography selection applies to Headlines and Crime Numbers' : undefined}
                placeholder={geoFocused ? "Neighborhood or precinct..." : ""}
                value={geoFocused ? searchQuery : (activeGeo === 'citywide' ? 'Citywide' : formatGeoName(activeGeo))}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={e => { if (geoInert) return; setGeoFocused(true); setSearchQuery(''); e.target.value = ''; }}
                onBlur={() => setTimeout(() => { setGeoFocused(false); setSearchQuery(''); }, 200)}
                className={`w-full text-[11px] font-bold py-1.5 pl-8 pr-2 rounded border focus:outline-none truncate ${geoInert ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed' : geoFocused ? 'bg-white border-[#ff7c53]' : 'bg-white border-gray-300'}`}
              />
              {geoFocused && !geoInert && (
                <div className="absolute top-full left-0 sm:left-auto sm:right-0 w-64 sm:w-72 mt-1 bg-white border border-gray-200 shadow-xl rounded z-50 max-h-72 overflow-y-auto">
                  {geoSearchResults.showCitywide && (
                    <button onMouseDown={() => { selectGeo('citywide'); setGeoFocused(false); setSearchQuery(''); }} className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-100 ${activeGeo === 'citywide' ? 'bg-gray-50 font-black' : ''}`}>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-black">Citywide</div>
                    </button>
                  )}
                  {geoSearchResults.boroughs.length > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-gray-400">Boroughs</div>
                      {geoSearchResults.boroughs.map(b => (
                        <button key={b} onMouseDown={() => { selectGeo(b); setGeoFocused(false); setSearchQuery(''); }} className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${activeGeo === b ? 'bg-gray-50 font-black' : ''}`}>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-black">{b}</div>
                        </button>
                      ))}
                    </>
                  )}
                  {geoSearchResults.precincts.length > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-gray-400 border-t border-gray-100">Precincts</div>
                      {geoSearchResults.precincts.map(r => (
                        <button key={r.pct} onMouseDown={() => { selectGeo(r.pct); setGeoFocused(false); setSearchQuery(''); }} className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${activeGeo === r.pct ? 'bg-gray-50' : ''}`}>
                          <div className="text-[12px] font-bold text-black">{r.pct}</div>
                          <div className="text-[10px] text-gray-500">{r.via
                            ? <>{r.via.name}{r.via.share < 0.85 ? ` (${Math.round(r.via.share * 100)}% of the neighborhood)` : ''}{r.hoods ? ` · ${r.hoods}` : ''}</>
                            : r.hoods}</div>
                        </button>
                      ))}
                    </>
                  )}
                  {!geoSearchResults.showCitywide && geoSearchResults.boroughs.length === 0 && geoSearchResults.precincts.length === 0 && (
                    <div className="px-3 py-3 text-sm text-gray-500">No matches found.</div>
                  )}
                </div>
              )}
            </div>
            </div>
            <div className="flex items-center gap-2.5">
            <div className="flex border border-gray-300 rounded overflow-hidden shrink-0">
              <button onClick={() => !weeklyOff && setActiveTab('wtd')} disabled={weeklyOff} aria-pressed={activeTab === 'wtd'} title={weeklyOff ? 'Weekly data is not available on this view' : 'This CompStat week vs the same week last year'} className={`px-2 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${weeklyOff ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : activeTab === 'wtd' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:text-black'}`}>Week</button>
              <button onClick={() => setActiveTab('ytd')} aria-pressed={activeTab === 'ytd'} title="Year-to-date vs the same period last year" className={`px-2 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${activeTab === 'ytd' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:text-black'}`}>YTD</button>
              <button onClick={() => !rollingOff && setActiveTab('r52')} disabled={rollingOff} aria-pressed={activeTab === 'r52'} title={rollingOff ? 'The rolling window is not available on this view' : 'The last 52 weeks vs the 52 weeks before them — a window that never changes length'} className={`px-2 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${rollingOff ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : activeTab === 'r52' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:text-black'}`}>Past year</button>
            </div>
            <button onClick={copyLink} title="Copy a link to exactly this view — geography and time window included" className="text-[11px] font-bold text-gray-400 hover:text-black transition-colors flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              {linkCopied ? 'Copied \u2713' : 'Copy link'}
            </button>
            </div>
          </div>
        </div>

        {/* Active tab content */}
        {rollingPending ? (
          <div className="py-24 text-center text-[15px] text-gray-400">Loading the 52-week window&hellip;</div>
        ) : (<>
        {mainTab === 'headlines' && (
          <Headlines
            parsedData={parsedData}
            hotspots={hotspots}
            rawData={effectiveRaw}
            activeTab={activeTab}
            activeGeo={activeGeo}
            isTouristPrecinct={isTouristPrecinct}
            activePop={activePop}
            rtciData={rtciData}
            contextData={contextData}
            rollingMeta={rollingMeta}
            rollingState={rollingState}
            downloadCSV={downloadCSV}
            onSelectGeo={goToGeoHeadlines}
          />
        )}
        {mainTab === 'numbers' && (
          <CrimeNumbers
            parsedData={parsedData}
            activeTab={activeTab}
            activeGeo={activeGeo}
            isTouristPrecinct={isTouristPrecinct}
            contextData={contextData}
            rollingMeta={rollingMeta}
            downloadCSV={downloadCSV}
          />
        )}
        {mainTab === 'precincts' && (
          <ByPrecinct
            precinctRates={precinctRates}
            mapMode={mapMode}
            setMapMode={setMapMode}
            mapCrime={mapCrime}
            setMapCrime={setMapCrime}
            onSelectPrecinct={selectPrecinctForNumbers}
          />
        )}
        {/* TRANSIT-REMOVED (2026-07-10): 'transit' is no longer in MAIN_TABS, so this branch is
            currently unreachable. Kept intact (with the import above) for a one-line restore. */}
        {mainTab === 'transit' && (
          <Transit rawData={rawData} downloadCSV={downloadCSV} />
        )}
        {mainTab === 'council' && (
          <CouncilDistricts
            rawData={effectiveRaw}
            activeTab={activeTab}
            districtNum={districtNum}
            setDistrictNum={setDistrictNum}
            contextData={contextData}
            onSelectPrecinct={selectPrecinctForNumbers}
            downloadCSV={downloadCSV}
          />
        )}
        {mainTab === 'about' && (
          <About contextData={contextData} parsedData={parsedData} feedWeekEnd={rawData?.citywide?.report_period?.week_end} fetchError={fetchError} />
        )}
        </>)}
      </div>
    </div>
  );
}
