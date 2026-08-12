import React, { useState, useMemo } from 'react';
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ScatterChart, Scatter } from 'recharts';
import { CW, MA_CW, PC, K7, CC, CL, ArrowLeft } from './shared';

/* ------------------------------------------------------------------ */
/* 30-YEAR HISTORIC VIEW                                               */
/* ------------------------------------------------------------------ */
export default function HistoricView({ onBack }) {
  const [xM, setXM] = useState('pov');
  const [yM, setYM] = useState('ta');

  const vp = useMemo(()=>{const vC=['FA','MU','RA','RO'],pC=['BU','GA','GL'];return CW.map(d=>({y:d.y,violent:vC.reduce((s,c)=>s+d[c],0),property:pC.reduce((s,c)=>s+d[c],0)}));},[]);
  const idx = useMemo(()=>{const b=CW[0];return CW.map(d=>{const o={y:d.y};K7.forEach(c=>{o[c]=d[c]/b[c]*100;});return o;});},[]);
  const assaultD = useMemo(()=>CW.filter(d=>d.y>=2000&&d.y<=2024).map(d=>{const ma=MA_CW[d.y]||0;return{y:d.y,fa:d.FA,ma,total:d.FA+ma,faPct:d.FA/(d.FA+ma)*100};}),[]);
  const sd = useMemo(()=>PC.filter(p=>p.n!=='14th').map(p=>({...p,x:p[xM],y:p[yM]})), [xM, yM]);
  const ms = [{k:'pov',l:'Poverty %'},{k:'ta',l:'Total assault'},{k:'fa',l:'Felony assault'},{k:'ma',l:'Misd. assault'},{k:'sh',l:'Shootings'},{k:'ha',l:'Harassment'},{k:'pl',l:'Petit larceny'},{k:'gl',l:'Grand larceny'},{k:'fs',l:'Felony share %'}];

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-20">

      {/* Header */}
      <div className="bg-[#050507] text-white pt-12 pb-16 px-5 sm:px-8">
         <div className="max-w-[1100px] mx-auto">
            <button onClick={onBack} className="text-gray-400 hover:text-white uppercase tracking-widest text-[11px] font-bold flex items-center gap-2 mb-8 transition-colors"><ArrowLeft size={14}/> Back to Live Dashboard</button>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-tight font-serif">The 30-Year Transformation of NYC Crime</h1>
            <p className="text-lg text-gray-400 font-serif max-w-3xl leading-relaxed">Beyond the weekly CompStat fluctuations lies a deeper story. Over three decades, the volume, composition, and geographic distribution of crime in New York City has fundamentally rewritten itself.</p>
         </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-5 sm:px-8 pt-12 space-y-24">

        {/* Section 1: The Macro Trend */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-center">
          <div className="lg:col-span-1 space-y-4">
             <div className="text-[#ff7c53] text-[10px] font-black uppercase tracking-widest">Macro Volume</div>
             <h2 className="text-2xl font-black leading-snug">The Great Decline & The Modern Rebound</h2>
             <p className="text-gray-600 text-[15px] leading-relaxed">From 1993 to 2019, major index crime collapsed. But the decline wasn't uniform. Violent crime leveled off around 2010, while property crime continued to fall. A post-2019 surge pushed violent crime upward through 2024, but murder has fallen every year since its 2021 spike and the broader violent index has begun declining.</p>
          </div>
          <div className="lg:col-span-2 h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vp.filter(d=>d.y>=2000)} margin={{top:5,right:5,left:10,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false}/>
                <XAxis dataKey="y" tick={{fontSize:10}} stroke="#999" axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10}} stroke="#999" tickFormatter={v=>`${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
                <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;return <div className="bg-white border border-gray-200 p-3 text-[11px] shadow-lg"><div className="font-bold mb-1">{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color}}>{p.name}: <strong className="text-black">{p.value.toLocaleString()}</strong></div>)}</div>;}}/>
                <Line type="monotone" dataKey="violent" name="Violent Index" stroke="#e7466d" strokeWidth={3} dot={false}/>
                <Line type="monotone" dataKey="property" name="Property Index" stroke="#394882" strokeWidth={3} dot={false}/>
                <Legend wrapperStyle={{fontSize:11}} iconType="circle"/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Section 2: Crime DNA (100% Stacked) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-center border-t border-gray-100 pt-16">
          <div className="lg:col-span-2 h-[350px] order-2 lg:order-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={CW} stackOffset="expand" margin={{top:5,right:0,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false}/>
                <XAxis dataKey="y" tick={{fontSize:10}} stroke="#999" axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10}} stroke="#999" tickFormatter={v=>`${(v*100).toFixed(0)}%`} axisLine={false} tickLine={false}/>
                <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;return <div className="bg-white border border-gray-200 p-3 text-[11px] shadow-lg"><div className="font-bold mb-2">{label} Profile</div>{[...payload].reverse().map((p,i)=><div key={i} className="flex justify-between gap-4"><span style={{color:p.color}}>{CL[p.dataKey]}</span><span className="font-bold text-black">{(p.value*100).toFixed(1)}%</span></div>)}</div>;}}/>
                {K7.map(c=><Area key={c} type="monotone" dataKey={c} stackId="1" fill={CC[c]} stroke={CC[c]} fillOpacity={0.9}/>)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="lg:col-span-1 space-y-4 order-1 lg:order-2">
             <div className="text-[#e7466d] text-[10px] font-black uppercase tracking-widest">Composition</div>
             <h2 className="text-2xl font-black leading-snug">The DNA of Crime Has Mutated</h2>
             <p className="text-gray-600 text-[15px] leading-relaxed">In 1993, Burglary and Auto Theft made up half of all major crime. Today, they account for barely a fifth. Meanwhile, Grand Larceny and Felony Assault have consumed the chart, now making up 64% of the entire index.</p>
             <div className="flex flex-wrap gap-x-3 gap-y-2 mt-4">
               {K7.map(c=><div key={c} className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wider"><div className="w-2 h-2 rounded-sm" style={{background:CC[c]}}/>{CL[c]}</div>)}
             </div>
          </div>
        </div>

        {/* Section 3: Divergence */}
        <div className="border-t border-gray-100 pt-16 space-y-6">
           <div className="max-w-3xl">
             <div className="text-[#394882] text-[10px] font-black uppercase tracking-widest">Divergence</div>
             <h2 className="text-2xl font-black leading-snug mb-3">Seven Crimes, Seven Trajectories</h2>
             <p className="text-gray-600 text-[15px] leading-relaxed">If we index all crimes to their 1993 levels (where 1993 = 100), the divergence is stark. Property crimes like auto theft collapsed by nearly 90%. Murder fell 84%. But felony assault dropped only 27% at its lowest point and has since climbed back to become the statistical outlier, plateauing near its pre-decline levels.</p>
           </div>
           <div className="h-[450px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={idx} margin={{top:5,right:5,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false}/>
                  <XAxis dataKey="y" tick={{fontSize:10}} stroke="#999" axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10}} stroke="#999" domain={[0,160]} axisLine={false} tickLine={false}/>
                  <ReferenceLine y={100} stroke="#050507" strokeDasharray="4 4" strokeOpacity={0.3}/>
                  <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;const s=[...payload].sort((a,b)=>b.value-a.value);return <div className="bg-white border border-gray-200 p-3 text-[11px] shadow-lg"><div className="font-bold mb-2">{label} (vs 1993)</div>{s.map((p,i)=><div key={i} className="flex justify-between gap-4"><span style={{color:p.color}}>{CL[p.dataKey]}</span><span className="font-bold text-black">{Number(p.value).toFixed(0)}</span></div>)}</div>;}}/>
                  {K7.map(c=><Line key={c} type="monotone" dataKey={c} stroke={CC[c]} strokeWidth={c==='FA'?4:1.5} strokeOpacity={c==='FA'?1:0.3} dot={false}/>)}
                </LineChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Section 4: The Assault Anomaly */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 border-t-[3px] border-black pt-16">
          <div className="space-y-4">
             <div className="text-[#050507] text-[10px] font-black uppercase tracking-widest">Classification Shift</div>
             <h2 className="text-2xl font-black leading-snug">The Assault Anomaly</h2>
             <p className="text-gray-600 text-[15px] leading-relaxed mb-4">While felony assault dominates headlines, misdemeanor assault outnumbers it 1.6 to 1. In 2015, misdemeanor assaults dropped 21% overnight while felonies didn't budge—a clear indicator of classification changes rather than behavioral shifts.</p>
             <p className="text-gray-600 text-[15px] leading-relaxed">From 2020 to 2024, both categories rose in lockstep for the first time in the dataset, suggesting a genuine increase in violent contact rather than just administrative drift. That parallel rise has since leveled off, with misdemeanor assaults declining in 2025.</p>
          </div>
          <div className="h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assaultD} margin={{top:5,right:5,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false}/>
                <XAxis dataKey="y" tick={{fontSize:10}} stroke="#999" axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10}} stroke="#999" tickFormatter={v=>`${(v/1000).toFixed(0)}K`} axisLine={false} tickLine={false}/>
                <Tooltip content={({active,payload})=>{if(!active||!payload?.length)return null;const d=payload[0]?.payload;return <div className="bg-white border border-gray-200 p-3 text-[11px] shadow-lg"><div className="font-bold mb-2">{d.y} Assaults</div><div className="text-[#ff7c53]">Misdemeanor: {d.ma.toLocaleString()}</div><div className="text-[#e7466d]">Felony: {d.fa.toLocaleString()}</div><div className="font-bold text-black mt-2 pt-2 border-t border-gray-100">Total: {d.total.toLocaleString()}</div></div>;}}/>
                <Bar dataKey="ma" stackId="a" fill="#ff7c53" fillOpacity={0.6} name="Misdemeanor" />
                <Bar dataKey="fa" stackId="a" fill="#e7466d" fillOpacity={0.9} name="Felony" />
                <Legend wrapperStyle={{fontSize:11}} iconType="circle"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Section 5: Precinct Scatter */}
        <div className="border-t border-gray-200 pt-16 space-y-8">
           <div className="flex flex-col md:flex-row justify-between md:items-end gap-6">
             <div className="max-w-2xl space-y-4">
               <div className="text-[#9b9fbc] text-[10px] font-black uppercase tracking-widest">Geographic Reality</div>
               <h2 className="text-2xl font-black leading-snug">The Complex Geography of Crime</h2>
               <p className="text-gray-600 text-[15px] leading-relaxed">Mapping the 76 standard precincts reveals distinct statistical clusters. In this specific dataset, poverty rates correlate strongly with violence (shootings, murder, felony assault). Conversely, theft (grand and petit larceny) shows virtually zero correlation with poverty, mapping closer to commercial density and foot traffic.</p>
             </div>

             {/* Controls */}
             <div className="flex flex-wrap gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200 self-start md:self-end">
               <div>
                 <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-1.5">X-Axis</label>
                 <select value={xM} onChange={e=>setXM(e.target.value)} className="bg-white border border-gray-300 text-xs py-1.5 px-2 rounded focus:outline-none focus:border-black">
                   {ms.map(m=><option key={m.k} value={m.k}>{m.l}</option>)}
                 </select>
               </div>
               <div>
                 <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-1.5">Y-Axis</label>
                 <select value={yM} onChange={e=>setYM(e.target.value)} className="bg-white border border-gray-300 text-xs py-1.5 px-2 rounded focus:outline-none focus:border-black">
                   {ms.map(m=><option key={m.k} value={m.k}>{m.l}</option>)}
                 </select>
               </div>
             </div>
           </div>

           <div className="h-[500px] w-full bg-white">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{top:10,right:10,left:10,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee"/>
                  <XAxis dataKey="x" type="number" tick={{fontSize:10}} stroke="#999" name={ms.find(m=>m.k===xM)?.l} label={{value:ms.find(m=>m.k===xM)?.l,position:'bottom',fontSize:11,fill:'#555',offset:-5, fontWeight:'bold'}}/>
                  <YAxis dataKey="y" type="number" tick={{fontSize:10}} stroke="#999" name={ms.find(m=>m.k===yM)?.l} label={{value:ms.find(m=>m.k===yM)?.l,angle:-90,position:'insideLeft',fontSize:11,fill:'#555', fontWeight:'bold'}}/>
                  <Tooltip content={({active,payload})=>{if(!active||!payload?.length)return null;const d=payload[0].payload;return <div className="bg-white border border-gray-200 p-3 text-[11px] shadow-lg"><div className="font-bold text-black mb-2 pb-2 border-b border-gray-100">{d.n} Precinct</div><div className="text-gray-600 mb-1">{ms.find(m=>m.k===xM)?.l}: <span className="font-bold text-black">{d.x}</span></div><div className="text-gray-600">{ms.find(m=>m.k===yM)?.l}: <span className="font-bold text-black">{d.y}</span></div></div>;}}/>
                  <Scatter data={sd} fill="#e7466d" fillOpacity={0.6} stroke="#e7466d" strokeOpacity={0.3}/>
                </ScatterChart>
              </ResponsiveContainer>
           </div>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="border-collapse text-[11px] w-full min-w-[680px]">
            <thead>
              <tr>
                <th className="text-left p-2 border-b-2 border-[#050507] text-[10px]">Quartile</th>
                <th className="text-center p-2 border-b-2 border-[#050507] text-[10px]">Poverty</th>
                <th className="text-center p-2 border-b-2 border-[#050507] text-[10px] text-[#e7466d]">Fel. Aslt (per 100k)</th>
                <th className="text-center p-2 border-b-2 border-[#050507] text-[10px] text-[#217ebe]">Grand Larc (per 100k)</th>
              </tr>
            </thead>
            <tbody>
              {[
                {q:'Q1: Lowest',pov:'8.4%',fa:180,gl:651},
                {q:'Q2: Low-mid',pov:'13.3%',fa:400,gl:948},
                {q:'Q3: Mid-high',pov:'19.0%',fa:353,gl:492},
                {q:'Q4: Highest',pov:'30.3%',fa:607,gl:653},
              ].map((q,i)=>(
                <tr key={i} className={`border-b border-gray-100 ${i===3 ? 'bg-red-50/50' : ''}`}>
                  <td className="p-2 font-semibold">{q.q}</td>
                  <td className="text-center p-2 font-bold">{q.pov}</td>
                  <td className="text-center p-2 font-bold text-[#e7466d]">{q.fa}</td>
                  <td className="text-center p-2 font-bold text-[#217ebe]">{q.gl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
