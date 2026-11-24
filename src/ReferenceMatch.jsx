import React from 'react';
import {matchLabels} from './matching.js';

export default function ReferenceMatch({row}) {
  const {match,invoiceRef}=row;
  const first=match.candidates[0];
  const reasons={
    matched:'Exactly one indexed invoice has this reference. The lookup ignores letter case and outer spaces and keeps punctuation and leading zeros.',
    missing:'This declaration has no invoice reference. Request the supporting reference from the declarant.',
    not_found:'No indexed invoice has this reference. Check the entry or request the corresponding invoice.',
    ambiguous:'More than one invoice carries this number. Obtain another identifier from the supporting documents before choosing an invoice.'
  };
  return <section className="refmatch" aria-label="Reference match evidence">
    <h3>{matchLabels[match.status]}</h3>
    <dl><div><dt>Declaration reference</dt><dd>{invoiceRef||'Missing'}</dd></div>
      {match.status==='matched' && <div><dt>Printed invoice reference</dt><dd>{first.printed}</dd></div>}
    </dl><p>{reasons[match.status]}</p>
    {match.status==='ambiguous' && <ul>{match.candidates.map(c=><li key={c.document}>{c.document} · {c.printed}</li>)}</ul>}
  </section>;
}
