import React from 'react';
import { ArrowLeft } from './shared';
import SubscribeBand from './tabs/Subscribe';
import councilData from './data/council_districts.json';
import vcLogo from './vitalcity-logo.png';

/* A standalone signup page: ?view=subscribe. The same band that sits under the
   Headlines and district pages, given a page of its own so it can be linked from
   tweets, emails and the Vital City site (embed it with &embed=1). No dashboard
   chrome — one job. */
export default function SubscribeView({ embed = false, onBack }) {
  return (
    <div className="min-h-screen pb-16 font-sans bg-white text-black text-[16px]">
      <div className="max-w-[760px] mx-auto px-5 sm:px-8">
        {!embed && (
          <div className="flex items-center justify-between py-3 border-b border-gray-200 mb-10">
            <a href="https://www.vitalcitynyc.org/" target="_blank" rel="noopener noreferrer" title="Vital City" className="flex items-center">
              <img src={vcLogo} alt="Vital City" className="h-[19px] w-auto" />
            </a>
            <button onClick={onBack}
              className="text-[11px] font-bold uppercase tracking-wider text-gray-400 hover:text-black flex items-center gap-1.5 transition-colors">
              <ArrowLeft size={13} /> NYC CompStat Decoder
            </button>
          </div>
        )}
        {embed && <div className="h-4" />}

        <div className="text-[10px] font-black uppercase tracking-[2px] text-gray-400 mb-2">Email updates</div>
        <h1 className="text-[30px] sm:text-[40px] font-black leading-[1.05] tracking-tight mb-4 font-serif">
          Crime trends where you live or work, in your inbox.
        </h1>
        <p className="text-[16px] sm:text-[17px] text-gray-700 leading-relaxed max-w-[620px] mb-8">
          Every week the NYPD publishes crime counts for each of the city&rsquo;s precincts. We turn them
          into a short, plain-English update on your City Council district or your precinct, sent
          monthly or quarterly.
        </p>

        <SubscribeBand standalone geoFirst districts={councilData.districts} />

      </div>
    </div>
  );
}
