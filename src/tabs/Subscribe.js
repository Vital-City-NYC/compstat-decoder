import React, { useState, useRef, useEffect } from 'react';
import vcLogo from '../vitalcity-logo.png';
import precinctGeoJSON from '../data/nyc_precincts.json';
import { VC, pctColor, dirPct, expandCrime, formatPeriodDate, PRECINCT_NEIGHBORHOODS, useSettled} from '../shared';

/* ------------------------------------------------------------------ */
/* SUBSCRIBE BAND + EMAIL PREVIEW                                      */
/* Full-width band at the foot of the Council Districts tab, styled    */
/* after the vitalcitynyc.org newsletter box (citron #dde44c, white    */
/* inputs, black button). Collects email, cadence and district, then   */
/* shows a mock-up of the email built from the district's live         */
/* numbers. Signups write to the "CompStat Decoder Subscribers"        */
/* audience in Mailchimp via its public form endpoint (JSONP — the     */
/* private API key never touches the browser). Report delivery is the  */
/* send job, wired separately.                                         */
/* ------------------------------------------------------------------ */

const VC_CITRON = '#dde44c'; // newsletter-box background from the VC site stylesheet

/* Address → district: NYC Planning's free GeoSearch API geocodes the
   address; the district is found by point-in-polygon against the same
   boundary file the map renders. Planar ray-casting is used (not
   d3.geoContains) so polygon winding order can't flip the result.     */
export const GEOSEARCH_URL = 'https://geosearch.planninglabs.nyc/v2/autocomplete?text=';

const pointInRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const pointInGeometry = (pt, geom) => {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some(rings => pointInRing(pt, rings[0]) && !rings.slice(1).some(hole => pointInRing(pt, hole)));
};
export const districtForPoint = (pt, districts) => districts.find(d => pointInGeometry(pt, d.geometry)) || null;

/* Precincts, for subscribers who want one precinct rather than a whole district.
   Same point-in-polygon as districts, against the boundary file the maps render. */
const ordinal = (n) => n + (n % 100 >= 10 && n % 100 <= 20 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
export const PRECINCTS = precinctGeoJSON.features
  .map(ft => ({ num: parseInt(ft.properties.precinct, 10), geometry: ft.geometry }))
  .map(p => ({ ...p, key: `${ordinal(p.num)} Precinct`, hood: PRECINCT_NEIGHBORHOODS[`${ordinal(p.num)} Precinct`] || '' }))
  .sort((a, b) => a.num - b.num);
export const precinctForPoint = (pt) => PRECINCTS.find(p => pointInGeometry(pt, p.geometry)) || null;
/* A bare number is a precinct; a number followed by words is a street address. */
const isAddressish = (q) => /\d/.test(q) && /[a-z]/i.test(q) && q.trim().length >= 5;

const CADENCES = ['Quarterly', 'Monthly']; // the product ships these two; Mailchimp's CADENCE field enforces it

/* Mailchimp signup via the audience's public form endpoint — the same IDs every
   embedded Mailchimp form exposes, so nothing secret ships to the browser. post-json
   returns JSONP, which gives an inline success/error with no backend of our own. */
const MC_HOST = 'https://vitalcitynyc.us5.list-manage.com';
const MC_U = '2feddb33cbe9c2118e75fdc1c';
const MC_ID = 'bf42451be9';
// NO f_id. It was added because this list once 404'd without it, but the embedded
// form it points at only carries EMAIL and CADENCE — and post-json silently DROPS
// every merge field the named form omits, which is how DISTRICT/GEO_TYPE/PRECINCT
// were being thrown away. Probed both ways 2026-08-19: without f_id all five fields
// land; with it, only CADENCE does. Do not reintroduce it without re-probing.
const mcSubscribe = ({ email, district, precinct, cadence, vcNews }) => new Promise((resolve, reject) => {
  const cb = 'mcJsonp' + Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    u: MC_U, id: MC_ID, EMAIL: email, CADENCE: cadence.toLowerCase(),
    VC_NEWS: vcNews ? 'yes' : 'no', c: cb,
    GEO_TYPE: precinct != null ? 'precinct' : 'district',
  });
  if (precinct != null) params.set('PRECINCT', String(precinct));
  // Send DISTRICT too whenever we know it, even in precinct mode. GEO_TYPE is what
  // the send job reads, so this changes nothing normally — but Mailchimp's form
  // endpoint silently drops merge fields that aren't enabled on the embedded form,
  // and if that ever happens again this leaves the subscriber on the district list
  // rather than on no list at all.
  if (district != null) params.set('DISTRICT', String(district));
  const script = document.createElement('script');
  const cleanup = () => { clearTimeout(timer); delete window[cb]; script.remove(); };
  const timer = setTimeout(() => { cleanup(); reject(new Error('The signup service did not respond — please try again.')); }, 15000);
  window[cb] = (resp) => {
    cleanup();
    const msg = String(resp.msg || '').replace(/<[^>]*>/g, '');
    if (resp.result === 'success' || /already subscribed/i.test(msg)) resolve(msg);
    else reject(new Error(msg || 'Signup failed — please try again.'));
  };
  script.onerror = () => { cleanup(); reject(new Error('The signup service could not be reached — please try again.')); };
  script.src = `${MC_HOST}/subscribe/post-json?${params.toString()}`;
  document.body.appendChild(script);
});

/* ------------------------------------------------------------------ */
/* Mock email, in Vital City's house style: black rules, serif body,   */
/* the site wordmark, and the dashboard's own red/green change colors. */
/* ------------------------------------------------------------------ */
const EmailPreview = ({ email, cadence, district, f, rows, period }) => {
  const n = district.district;
  const dir = (v) => (typeof v === 'number' ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : null);
  const headline = f.districtAll.pct != null
    ? `Crime is ${dir(f.districtAll.pct)} ${Math.abs(f.districtAll.pct).toFixed(1)}% this year in your district`
    : `How crime is changing in your district`;
  const subject = `Crime in Council District ${n}: your ${cadence.toLowerCase()} update`;

  const statCell = (label, t) => (
    <div className="flex-1 min-w-[90px]">
      <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">{label}</div>
      <div className="text-[22px] font-black tabular-nums" style={{ color: pctColor(t.pct) }}>
        {typeof t.pct === 'number' ? dirPct(t.pct) : '—'}
      </div>
      <div className="text-[10px] text-gray-400">{t.cur != null ? `${t.cur} offenses YTD` : ''}</div>
    </div>
  );

  return (
    <div className="mt-4 border border-gray-300 rounded-sm shadow-sm overflow-hidden max-w-xl bg-white">
      {/* Email-client chrome */}
      <div className="bg-gray-100 border-b border-gray-300 px-4 py-2.5 text-[11px] text-gray-600 space-y-0.5">
        <div><span className="font-bold text-gray-500">From:</span> Vital City &lt;info@vitalcitynyc.org&gt;</div>
        <div><span className="font-bold text-gray-500">To:</span> {email}</div>
        <div className="text-[12px] text-black font-bold">{subject}</div>
      </div>

      {/* Email body */}
      <div className="bg-white px-6 py-6">
        <div className="flex items-end justify-between border-b-[3px] border-black pb-3 mb-4">
          <img src={vcLogo} alt="Vital City" style={{ height: '19px', width: 'auto' }} />
          <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">
            District {n} · {cadence} update
          </div>
        </div>

        <h3 className="text-[22px] font-black leading-snug mb-1" style={{ fontFamily: 'Georgia, serif' }}>{headline}</h3>
        <p className="text-[11px] text-gray-500 mb-4">
          Council District {n}{district.member ? ` · Council Member ${district.member}` : ''} · CompStat data through {formatPeriodDate(period?.week_end) || period?.week_end || '—'}
        </p>

        <div className="flex gap-4 flex-wrap border-y border-gray-200 py-3 mb-4">
          {statCell('All major crime', f.districtAll)}
          {statCell('Violent', f.districtVio)}
          {statCell('Property', f.districtProp)}
        </div>

        <div className="text-[14px] leading-relaxed text-gray-700 space-y-2 mb-5" style={{ fontFamily: 'Georgia, serif' }}>
          {f.upCount + f.downCount > 0 && (
            <p>
              Crime is {f.downShare >= f.upShare ? 'down' : 'up'} in{' '}
              {f.downShare >= f.upShare ? f.downCount : f.upCount} of the {f.nP} precincts that make up the
              district, compared with the same period last year. Citywide, major crime is{' '}
              {dir(f.cwAll.pct)} {typeof f.cwAll.pct === 'number' ? Math.abs(f.cwAll.pct).toFixed(1) + '%' : ''}.
            </p>
          )}
          {f.driver && (
            <p>The biggest factor: {expandCrime(f.driver.name)} is {dir(f.driver.pct)}{' '}
              {Math.abs(f.driver.pct).toFixed(1)}% on average across the district's precincts.</p>
          )}
        </div>

        {/* Per-precinct mini table */}
        <table className="w-full text-left border-collapse mb-5">
          <thead>
            <tr className="text-[9px] font-black uppercase tracking-widest text-gray-400 border-b-2 border-black">
              <th className="py-1.5">Precinct</th>
              <th className="py-1.5 text-right">All</th>
              <th className="py-1.5 text-right">Violent</th>
              <th className="py-1.5 text-right">Property</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.precinct}>
                <td className="py-1.5 text-[12px] font-bold">{r.geoKey.replace(' Precinct', ' Pct')}
                  {r.hoods && <span className="font-normal text-gray-500"> · {r.hoods}</span>}
                </td>
                {[r.all, r.violent, r.property].map((t, i) => (
                  <td key={i} className="py-1.5 text-right tabular-nums text-[12px] font-bold" style={{ color: pctColor(t.pct) }}>
                    {typeof t.pct === 'number' ? dirPct(t.pct) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <a href={`?district=${n}`} onClick={(e) => e.preventDefault()}
          className="inline-block text-[12px] font-black uppercase tracking-widest text-white px-4 py-2.5 rounded-sm"
          style={{ background: VC.green }}>
          Explore your district →
        </a>

        <div className="border-t border-gray-200 mt-6 pt-3 text-[10px] text-gray-400 leading-relaxed">
          You're receiving this because you signed up for {cadence.toLowerCase()} updates on Council District {n} at
          the NYC CompStat Decoder. <span className="underline">Unsubscribe</span> · <span className="underline">Manage preferences</span>
          <br />Vital City · vitalcitynyc.org
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* The signup band itself                                              */
/* ------------------------------------------------------------------ */
export default function SubscribeBand({ district, districts, f, rows, period, compact = false, standalone = false }) {
  const [email, setEmail] = useState('');
  const [cadence, setCadence] = useState('Quarterly');
  const [chosenDistrict, setChosenDistrict] = useState(null); // null = follow the district being viewed
  const [addressMode, setAddressMode] = useState(standalone);
  const [address, setAddress] = useState('');
  const [suggestion, setSuggestion] = useState(null); // { label, district }
  const [lookupState, setLookupState] = useState('idle'); // idle | searching | done | error
  const [signedUp, setSignedUp] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skippedDistrict, setSkippedDistrict] = useState(false);
  const [vcNews, setVcNews] = useState(true); // opt-out: newsletter box starts checked (Ted's call, 2026-08-17)
  // Precinct-only signup (Josh's ask, 2026-08-19). Council district stays the default:
  // this box starts UNCHECKED, and choosing a precinct REPLACES the district, never adds.
  const [precinctMode, setPrecinctMode] = useState(false);
  const [chosenPrecinct, setChosenPrecinct] = useState(null);
  const [precinctQuery, setPrecinctQuery] = useState('');
  const [precinctOpen, setPrecinctOpen] = useState(false);
  const [precinctHits, setPrecinctHits] = useState([]);   // [{ label, precinct }]
  const [precinctLookup, setPrecinctLookup] = useState('idle');
  const precinctDebounce = useRef(null);
  const [mcState, setMcState] = useState('idle'); // idle | sending | error
  const [mcError, setMcError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const debounce = useRef(null);

  const addressSettled = useSettled(address);
  const precinctSettled = useSettled(precinctQuery);
  const effective = chosenDistrict || district;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Geocode as the user types, then locate the point in a district polygon.
  useEffect(() => {
    if (!addressMode || address.trim().length < 6) { setSuggestion(null); setLookupState('idle'); return; }
    setLookupState('searching');
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetch(GEOSEARCH_URL + encodeURIComponent(address))
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(gj => {
          const hit = (gj.features || []).find(ft => {
            const d = districtForPoint(ft.geometry.coordinates, districts);
            if (d) { setSuggestion({ label: ft.properties?.label || address, district: d }); return true; }
            return false;
          });
          if (!hit) setSuggestion(null);
          setLookupState('done');
        })
        .catch(() => { setSuggestion(null); setLookupState('error'); });
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [address, addressMode, districts]);

  // An address typed into the precinct picker is OFFERED as a list of matching
  // addresses to choose from. It is never resolved for you: a house number alone
  // matches half of Brooklyn, so picking the first hit would be a guess.
  useEffect(() => {
    const q = precinctQuery.trim();
    if (!precinctMode || !isAddressish(q)) { setPrecinctHits([]); setPrecinctLookup('idle'); return undefined; }
    setPrecinctLookup('searching');
    clearTimeout(precinctDebounce.current);
    precinctDebounce.current = setTimeout(() => {
      fetch(GEOSEARCH_URL + encodeURIComponent(q))
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(gj => {
          const seen = new Set();
          const hits = [];
          for (const ft of gj.features || []) {
            const pr = precinctForPoint(ft.geometry.coordinates);
            const label = ft.properties?.label || '';
            if (!pr || !label || seen.has(label)) continue;
            seen.add(label);
            hits.push({ label, precinct: pr });
            if (hits.length >= 6) break;
          }
          setPrecinctHits(hits); setPrecinctLookup('done');
        })
        .catch(() => { setPrecinctHits([]); setPrecinctLookup('done'); });
    }, 350);
    return () => clearTimeout(precinctDebounce.current);
  }, [precinctQuery, precinctMode]);

  const finalize = (district) => {
    setMcState('sending'); setMcError('');
    const precinct = precinctMode && chosenPrecinct ? chosenPrecinct.num : null;
    return mcSubscribe({ email, district, precinct, cadence, vcNews })
      .then(() => setMcState('idle'))
      .catch((err) => { setMcState('error'); setMcError(err.message); throw err; });
  };
  const submit = (e) => {
    e.preventDefault();
    if (!emailOk || mcState === 'sending') return;
    if (precinctMode && !chosenPrecinct) return;          // the picker is still waiting on a choice
    if (!precinctMode && !standalone && !effective) return;
    // A chosen precinct is a complete signup on its own — no district step needed.
    if (standalone && !(precinctMode && chosenPrecinct)) { setSignedUp(true); return; }
    finalize(effective ? effective.district : null).then(() => setSignedUp(true)).catch(() => {});
  };

  // One combobox: type an address OR a district number / member name, or open it and
  // scroll the district list. Shown on the standalone band's post-signup step.
  const districtPicker = () => {
        const q = address.trim().toLowerCase();
        const num = parseInt(q.replace(/^district\s*/, ''), 10);
        const matches = q
          ? districts.filter(d => d.district === num || (d.member || '').toLowerCase().includes(q))
          : districts;
        const pick = (d) => {
          setChosenDistrict(d); setAddressMode(false); setAddress(''); setPickerOpen(false);
          finalize(d.district).catch(() => {});
        };
        return (
          <div className="mb-4 max-w-md relative">
            <input type="text" value={address}
              onChange={(e) => { setAddress(e.target.value); setPickerOpen(true); }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              placeholder="Enter your address, or pick your Council district"
              className="w-full border border-gray-800 bg-white px-3 py-2 text-[13px] focus:outline-none" />
            {pickerOpen && (
              <div className="absolute z-20 left-0 right-0 bg-white border border-gray-800 border-t-0 max-h-52 overflow-y-auto">
                {lookupState === 'searching' && <div className="px-3 py-2 text-[11px] text-black/60">Looking up address&hellip;</div>}
                {suggestion && (
                  <button type="button" onMouseDown={() => pick(suggestion.district)}
                    className="w-full text-left px-3 py-2 text-[12px] hover:bg-black/5 border-b border-gray-200">
                    <span className="font-black">{suggestion.label}</span> &rarr; District {suggestion.district.district}
                    {suggestion.district.member ? ` (${suggestion.district.member})` : ''}
                  </button>
                )}
                {matches.map(d => (
                  <button key={d.district} type="button" onMouseDown={() => pick(d)}
                    className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-black/5">
                    <span className="font-bold">District {d.district}</span>{d.member ? ` — ${d.member}` : ''}
                  </button>
                ))}
                {!suggestion && matches.length === 0 && lookupState !== 'searching' && (
                  <div className="px-3 py-2 text-[11px] text-black/60">Keep typing your address&hellip;</div>
                )}
              </div>
            )}
          </div>
        );
  };

  if (signedUp) {
    return (
      <div className={`rounded-sm ${compact ? 'p-3' : 'mt-10 p-6'}`} style={{ background: VC_CITRON }}>
        <div className={`${compact ? 'text-[15px]' : 'text-[18px]'} font-black text-black`}>
          {effective ? `You're set: ${cadence.toLowerCase()} updates on Council District ${effective.district}.`
            : skippedDistrict ? `You're set: ${cadence.toLowerCase()} updates.`
            : 'You\u2019re in \u2014 which Council district should we watch for you?'}
        </div>
        {mcState === 'error' && (
          <p className="text-[12px] font-bold mt-1" style={{ color: '#c0392b' }}>{mcError}</p>
        )}
        {!effective && !skippedDistrict && (
          <div className="mt-3">
            {districtPicker()}
            <button type="button" onClick={() => { setSkippedDistrict(true); finalize(null).catch(() => {}); }}
              className="text-[12px] underline text-black/70 hover:opacity-70 -mt-2 block">
              Skip for now
            </button>
          </div>
        )}
        {!effective && skippedDistrict && (
          <p className="text-[12px] text-black/70 mt-1">You can pick a district any time on the By Council District page.</p>
        )}
        {effective && (<>
        <p className="text-[12px] text-black/70 mt-1 mb-3">Email delivery is coming soon — here's a preview of what you'll receive.</p>
        {(f && rows) ? (!showPreview ? (
          <button onClick={() => setShowPreview(true)}
            className="text-[11px] font-black uppercase tracking-widest text-white bg-black px-4 py-2.5">
            Preview the email
          </button>
        ) : (
          <EmailPreview email={email} cadence={cadence} district={effective}
            f={f} rows={rows} period={period} />
        )) : (
          <a href={`?tab=council&district=${effective.district}`}
            className="text-[11px] font-black uppercase tracking-widest text-white bg-black px-4 py-2.5 inline-block no-underline">
            See your district&rsquo;s page
          </a>
        )}
        </>)}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`rounded-sm ${compact ? 'p-3' : 'mt-10 p-6'}`} style={{ background: VC_CITRON }}>
      {/* Title row: bold title + address link in parentheses */}
      <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${compact ? 'mb-1.5' : 'mb-4'}`}>
        <h4 className={`${compact ? 'text-[13px]' : 'text-[16px] sm:text-[19px]'} font-black text-black leading-tight`}>
          Subscribe for updates on crime trends in {effective ? `Council District ${effective.district}` : 'your City Council district'}
        </h4>
        {!addressMode && !standalone && (
          <span className="text-[12px] text-black/70">
            (not your district?{' '}
            <button type="button" onClick={() => setAddressMode(true)} className="underline font-bold hover:opacity-70">
              Enter your address
            </button>)
          </span>
        )}
        {standalone && chosenDistrict && (
          <span className="text-[12px] text-black/70">
            ({chosenDistrict.member || 'chosen'} &middot;{' '}
            <button type="button" onClick={() => { setChosenDistrict(null); setAddressMode(true); }} className="underline font-bold hover:opacity-70">change</button>)
          </span>
        )}
      </div>

      {/* Address lookup, shown only when requested (council-tab band) */}
      {addressMode && !standalone && (
        <div className="mb-4 max-w-md">
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} autoFocus
            placeholder="Your address (e.g. 100 Gold St, Manhattan)"
            className="w-full border border-gray-800 bg-white px-3 py-2 text-[13px] focus:outline-none" />
          {lookupState === 'searching' && <div className="text-[11px] text-black/60 mt-1">Looking up…</div>}
          {suggestion && (
            <div className="text-[12px] text-black mt-1">
              {suggestion.label} → District {suggestion.district.district}
              {suggestion.district.member ? ` (${suggestion.district.member})` : ''}{' '}
              <button type="button" className="font-black underline"
                onClick={() => { setChosenDistrict(suggestion.district); setAddressMode(false); setAddress(''); }}>
                Use this district
              </button>
            </div>
          )}
          {lookupState === 'done' && !suggestion && address.trim().length >= 6 && addressSettled && (
            <div className="text-[11px] text-black/60 mt-1">No NYC match found — keep typing or pick a district on the map above.</div>
          )}
        </div>
      )}


      {/* Input row: email, cadence segmented control, sign up. On mobile each control
          fills the citron box edge-to-edge (equal left/right margins); inline on desktop. */}
      <div className={`flex flex-wrap items-stretch ${compact ? 'gap-x-2 gap-y-1.5' : 'gap-x-3 gap-y-2'}`}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email address"
          className={`w-full border border-gray-800 bg-white focus:outline-none ${compact ? 'sm:w-[150px] px-2 py-1.5 text-[12px]' : 'sm:w-[240px] px-3 py-2 text-[13px]'}`} />
        <div className="flex w-full sm:w-auto border border-gray-800 bg-white">
          {CADENCES.map(c => (
            <button key={c} type="button" onClick={() => setCadence(c)}
              className={`flex-1 sm:flex-none font-black uppercase tracking-widest ${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-[11px]'} ${cadence === c ? 'bg-black text-white' : 'text-black hover:bg-black/5'}`}>
              {c}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!emailOk || (!standalone && !effective) || mcState === 'sending'}
          className={`w-full sm:w-auto font-black uppercase tracking-widest text-white bg-black disabled:opacity-40 ${compact ? 'px-3 py-1.5 text-[10px]' : 'px-5 py-2.5 text-[11px]'}`}>
          {mcState === 'sending' ? 'Signing up\u2026' : 'Sign up'}
        </button>
      </div>
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-1.5 ${compact ? 'mt-1.5' : 'mt-2.5'}`}>
        <label className="flex items-center gap-1.5 text-[12px] text-black/80 cursor-pointer font-bold">
          <input type="checkbox" checked={precinctMode}
            onChange={(e) => { setPrecinctMode(e.target.checked); if (!e.target.checked) { setChosenPrecinct(null); setPrecinctQuery(''); } }} />
          Send updates on just my police precinct
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-black/80 cursor-pointer">
          <input type="checkbox" checked={vcNews} onChange={(e) => setVcNews(e.target.checked)} />
          Also send me Vital City&rsquo;s newsletter
        </label>
      </div>
      {precinctMode && (
        <div className="mt-3.5 pt-3.5 border-t border-black/20 max-w-[360px] relative">
          <div className="text-[11px] font-black uppercase tracking-widest text-black mb-1.5">Pick a precinct</div>
          {chosenPrecinct ? (
            <div className="text-[13px] text-black">
              <span className="font-black">{chosenPrecinct.key}</span>
              {chosenPrecinct.hood ? ` \u00b7 ${chosenPrecinct.hood}` : ''}{' '}
              <button type="button" className="underline font-bold text-[12px] hover:opacity-70"
                onClick={() => { setChosenPrecinct(null); setPrecinctOpen(true); }}>change</button>
            </div>
          ) : (<>
            <input type="text" value={precinctQuery}
              onChange={(e) => { setPrecinctQuery(e.target.value); setPrecinctOpen(true); }}
              onFocus={() => setPrecinctOpen(true)}
              onBlur={() => setTimeout(() => setPrecinctOpen(false), 150)}
              placeholder="Enter address, precinct number, or neighborhood"
              className="w-full border border-gray-800 bg-white px-3 py-2 text-[13px] focus:outline-none" />
            {precinctOpen && (
              <div className="absolute z-20 left-0 right-0 bg-white border border-gray-800 border-t-0 max-h-52 overflow-y-auto">
                {(() => {
                  const raw = precinctQuery.trim();
                  const q = raw.toLowerCase();
                  const choose = (pr) => { setChosenPrecinct(pr); setPrecinctQuery(''); setPrecinctOpen(false); setPrecinctHits([]); };

                  // An address query offers the matching addresses to pick from.
                  if (isAddressish(raw)) {
                    if (precinctLookup === 'searching' && !precinctHits.length) {
                      return <div className="px-3 py-2 text-[11px] text-black/60">Looking up address&hellip;</div>;
                    }
                    if (!precinctHits.length) {
                      return precinctSettled
                        ? <div className="px-3 py-2 text-[11px] text-black/60">No NYC address found.</div>
                        : <div className="px-3 py-2 text-[11px] text-black/60">Looking up address&hellip;</div>;
                    }
                    return precinctHits.map(h => (
                      <button key={h.label} type="button" onMouseDown={() => choose(h.precinct)}
                        className="w-full text-left px-3 py-2 text-[12px] hover:bg-black/5 border-b border-gray-100 last:border-b-0">
                        <div className="font-bold">{h.label}</div>
                        <div className="text-black/55">{h.precinct.key}{h.precinct.hood ? ` \u00b7 ${h.precinct.hood}` : ''}</div>
                      </button>
                    ));
                  }

                  // Otherwise: a bare number is a precinct, words are a neighbourhood.
                  const digits = q.replace(/\D/g, '');
                  const list = !q ? PRECINCTS
                    : digits ? PRECINCTS.filter(pr => String(pr.num).startsWith(digits))
                    : PRECINCTS.filter(pr => pr.hood.toLowerCase().includes(q));
                  if (!list.length) {
                    return precinctSettled
                      ? <div className="px-3 py-2 text-[11px] text-black/60">No match &mdash; try a precinct number, a neighbourhood, or your address.</div>
                      : null;
                  }
                  return list.map(pr => (
                    <button key={pr.num} type="button" onMouseDown={() => choose(pr)}
                      className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-black/5 flex justify-between gap-3">
                      <span className="font-bold">{pr.key}</span>
                      <span className="text-black/55">{pr.hood}</span>
                    </button>
                  ));
                })()}
              </div>
            )}
          </>)}
        </div>
      )}
      {mcState === 'error' && (
        <p className="text-[12px] font-bold mt-1.5" style={{ color: '#c0392b' }}>{mcError}</p>
      )}
    </form>
  );
}
