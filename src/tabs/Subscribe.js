import React, { useState, useRef, useEffect } from 'react';
import vcLogo from '../vitalcity-logo.png';
import { VC, pctColor, dirPct, expandCrime, formatPeriodDate } from '../shared';

/* ------------------------------------------------------------------ */
/* SUBSCRIBE BAND + MOCK EMAIL PREVIEW                                 */
/* Full-width band at the foot of the Council Districts tab, styled    */
/* after the vitalcitynyc.org newsletter box (citron #dde44c, white    */
/* inputs, black button). Collects email, cadence and district, then   */
/* shows a mock-up of the email built from the district's live         */
/* numbers. No email service is connected yet: the signup is stored    */
/* locally and the success state says delivery is coming soon.         */
/* ------------------------------------------------------------------ */

const VC_CITRON = '#dde44c'; // newsletter-box background from the VC site stylesheet

/* Address → district: NYC Planning's free GeoSearch API geocodes the
   address; the district is found by point-in-polygon against the same
   boundary file the map renders. Planar ray-casting is used (not
   d3.geoContains) so polygon winding order can't flip the result.     */
const GEOSEARCH_URL = 'https://geosearch.planninglabs.nyc/v2/autocomplete?text=';

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
const districtForPoint = (pt, districts) => districts.find(d => pointInGeometry(pt, d.geometry)) || null;

const CADENCES = ['Quarterly', 'Monthly', 'Weekly'];

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
        <div><span className="font-bold text-gray-500">From:</span> Vital City &lt;hello@vitalcitynyc.org&gt;</div>
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
export default function SubscribeBand({ district, districts, f, rows, period, compact = false }) {
  const [email, setEmail] = useState('');
  const [cadence, setCadence] = useState('Quarterly');
  const [chosenDistrict, setChosenDistrict] = useState(null); // null = follow the district being viewed
  const [addressMode, setAddressMode] = useState(false);
  const [address, setAddress] = useState('');
  const [suggestion, setSuggestion] = useState(null); // { label, district }
  const [lookupState, setLookupState] = useState('idle'); // idle | searching | done | error
  const [signedUp, setSignedUp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const debounce = useRef(null);

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

  const submit = (e) => {
    e.preventDefault();
    if (!emailOk) return;
    try {
      localStorage.setItem('cd_subscribe_mock', JSON.stringify({ email, cadence, district: effective.district }));
    } catch {}
    setSignedUp(true);
  };

  if (signedUp) {
    return (
      <div className={`rounded-sm ${compact ? 'p-3' : 'mt-10 p-6'}`} style={{ background: VC_CITRON }}>
        <div className={`${compact ? 'text-[15px]' : 'text-[18px]'} font-black text-black`}>
          You're set: {cadence.toLowerCase()} updates on Council District {effective.district}.
        </div>
        <p className="text-[12px] text-black/70 mt-1 mb-3">Email delivery is coming soon — here's a preview of what you'll receive.</p>
        {!showPreview ? (
          <button onClick={() => setShowPreview(true)}
            className="text-[11px] font-black uppercase tracking-widest text-white bg-black px-4 py-2.5">
            Preview the email
          </button>
        ) : (
          <EmailPreview email={email} cadence={cadence} district={effective}
            f={f} rows={rows} period={period} />
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`rounded-sm ${compact ? 'p-3' : 'mt-10 p-6'}`} style={{ background: VC_CITRON }}>
      {/* Title row: bold title + address link in parentheses */}
      <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${compact ? 'mb-1.5' : 'mb-4'}`}>
        <h4 className={`${compact ? 'text-[13px]' : 'text-[16px] sm:text-[19px]'} font-black text-black leading-tight`}>
          Subscribe for updates on crime trends in Council District {effective.district}
        </h4>
        {!addressMode && (
          <span className="text-[12px] text-black/70">
            (not your district?{' '}
            <button type="button" onClick={() => setAddressMode(true)} className="underline font-bold hover:opacity-70">
              Enter your address
            </button>)
          </span>
        )}
      </div>

      {/* Address lookup, shown only when requested */}
      {addressMode && (
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
          {lookupState === 'done' && !suggestion && address.trim().length >= 6 && (
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
        <button type="submit" disabled={!emailOk}
          className={`w-full sm:w-auto font-black uppercase tracking-widest text-white bg-black disabled:opacity-40 ${compact ? 'px-3 py-1.5 text-[10px]' : 'px-5 py-2.5 text-[11px]'}`}>
          Sign up
        </button>
      </div>
    </form>
  );
}
