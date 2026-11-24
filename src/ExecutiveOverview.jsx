import React from 'react';
import {sumRows} from './ledger.js';
import {measures,contributingRows} from './executive.js';

export default function ExecutiveOverview({rows,format,shared}) {
  const totals=sumRows(rows);
  const rate=totals.assessed ? totals.recovered/totals.assessed*100 : null;
  return <section aria-label="Executive overview">
    <header className="pagehead"><div><p className="overline">EXECUTIVE OVERVIEW</p><h1>Revenue recovery</h1>
      <p>All {rows.length.toLocaleString('en-US')} shipments · USD · Coursework register</p></div></header>
    <section className="metrics executive-cards" aria-label="Register totals">{measures.map(m=>{
      const n=contributingRows(rows,m.key).length;
      return <a key={m.key} href={'#screening/'+m.key} className={m.key} aria-label={'Open declarations for '+m.label}>
        <small>{m.label}</small><strong>{format(totals[m.key])}</strong><span>{m.note}</span><b>{n.toLocaleString('en-US')} {n===1?'declaration':'declarations'} ↗</b>
      </a>;
    })}</section>
    <section className="exec-progress"><h2>Collection progress</h2>
      <p>{rate==null?'No additional duty assessed yet.':<><strong>{rate.toFixed(1)}%</strong> of assessed extra duty collected</>}</p>
      {rate!=null && <progress max="100" value={rate} aria-label="Share of assessed extra duty collected"/>}
      <p>{format(totals.recovered)} collected of {format(totals.assessed)} assessed. <a href="#screening/owed">View outstanding declarations ↗</a></p>
    </section>
    <footer>Totals update when you assess a case or record a payment. {shared?'Changes are saved in this browser and shared across its open CIP tabs.':'This browser is using tab-session storage.'}</footer>
  </section>;
}
