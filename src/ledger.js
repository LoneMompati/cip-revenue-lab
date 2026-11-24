// Monetary amounts are integer cents. The demonstration uses a flat 10% duty.
export const duty = cents => Math.round(cents / 10);
export const statusText = {
  referred: 'Referred', no_gap: 'No positive gap', unlinked: 'No invoice', check: 'Check evidence', review: 'To review', clear: 'No extra duty',
  unpaid: 'Payment due', partial: 'Part paid', paid: 'Recovered'
};

export function baseCase(row) {
  const e = row.evidence;
  const base = { ...row, original: e ? duty(row.declared) : null, potential: null, assessed: null, recovered: 0 };
  if (!e) return { ...base, status: 'unlinked' };
  if (!e.checked || e.currency !== 'USD') return { ...base, status: 'check' };
  const potential = Math.max(0, duty(e.read) - base.original);
  if (row.example == null) return { ...base, potential, status: potential ? 'review' : 'no_gap' };
  if (!potential) return { ...base, potential, assessed: 0, status: 'clear' };
  // Deterministic opening examples of officer decisions and posted payments.
  const phase = row.example % 4;
  const assessed = phase === 0 ? null : potential;
  const recovered = phase === 2 ? Math.floor(potential / 2) : phase === 3 ? potential : 0;
  return { ...base, potential, assessed, recovered,
    status: ['review','unpaid','partial','paid'][phase] };
}

export function applyAction(row, action) {
  if (action?.type === 'refer' && row.status === 'check')
    return { ...row, status: 'referred' };
  if (action?.type === 'assess' && row.status === 'review')
    return { ...row, assessed: row.potential, status: 'unpaid' };
  if (action?.type === 'clear' && row.status === 'review')
    return { ...row, assessed: 0, status: 'clear' };
  if (action?.type === 'receive' && row.assessed > 0 && Number.isSafeInteger(action.cents)
      && action.cents > 0 && action.cents <= row.assessed - row.recovered) {
    const recovered = row.recovered + action.cents;
    return { ...row, recovered, status: recovered === row.assessed ? 'paid' : 'partial' };
  }
  return row;
}
export const balance = r => r.assessed === null ? null : r.assessed - r.recovered;
export function sumRows(rows) {
  return rows.reduce((s,r) => ({
    potential:s.potential+(r.potential??0), assessed:s.assessed+(r.assessed??0),
    recovered:s.recovered+r.recovered, owed:s.owed+(balance(r)??0)
  }), {potential:0,assessed:0,recovered:0,owed:0});
}
export function parsePayment(text) {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null;
  const [whole, fraction=''] = text.trim().split('.');
  const value = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(value) && value>0 ? value : null;
}

// A screening outcome stays fixed when an officer assesses the case or records a payment.
export const queues = {
  gap: 'Positive duty gap',
  no_gap: 'No positive gap',
  currency: 'Check currency',
  reading: 'Check document'
};
export function screeningQueue(row) {
  const e = row.evidence;
  if (e?.reason === 'ambiguous_currency' || (e?.checked && e.currency !== 'USD')) return 'currency';
  if (!e?.checked) return 'reading';
  return row.potential > 0 ? 'gap' : 'no_gap';
}
export function screeningReason(row) {
  const e = row.evidence;
  if (!e) return 'No supporting invoice is attached.';
  if (e.reason === 'no_total') return 'The public annotation has no final-total region for the reader. An officer needs to locate the payable amount.';
  if (e.reason === 'ambiguous_currency') return 'The total uses a dollar sign without a currency code. An officer must confirm which dollar the invoice uses.';
  if (!e.checked) return 'The reader could not verify the amount and currency against the source label. An officer must check the document.';
  if (e.currency !== 'USD') return 'The invoice is in '+e.currency+' and the declaration is in USD. A documented exchange rate is needed before comparing them.';
  return row.potential > 0 ? 'The verified USD invoice gives a higher duty amount at the illustrative rate. Check the basis of valuation before assessing the difference.' : 'At the illustrative rate the verified USD invoice gives no positive duty gap for this pair.';
}
