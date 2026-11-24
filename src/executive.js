import {balance} from './ledger.js';

export const measures = [
  {key:'potential',label:'Potential duty gap',note:'Estimated extra duty',amount:r=>r.potential},
  {key:'assessed',label:'Extra duty assessed',note:'Recorded assessments',amount:r=>r.assessed},
  {key:'recovered',label:'Cash recovered',note:'Payments against extra duty',amount:r=>r.recovered},
  {key:'owed',label:'Still owed',note:'Assessed less recovered',amount:balance}
];

export function contributingRows(rows, key) {
  const measure = measures.find(m=>m.key===key);
  if (!measure) return rows;
  return rows.filter(r=>measure.amount(r)>0);
}
