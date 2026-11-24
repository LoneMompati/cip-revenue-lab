// Keep punctuation and leading zeros: the digits alone do not identify an invoice.
export const referenceKey = ref => (ref ?? '').trim().toUpperCase();

export function indexInvoices(shipments, references) {
  const index = new Map();
  for (const {evidence} of shipments) {
    const printed = references[evidence.document];
    const key = referenceKey(printed);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({evidence, printed});
  }
  return index;
}

export function matchDeclaration(declaration, index) {
  const key = referenceKey(declaration.invoiceRef);
  const candidates = index.get(key) ?? [];
  const status = !key ? 'missing' : candidates.length === 0 ? 'not_found'
    : candidates.length > 1 ? 'ambiguous' : 'matched';
  return {
    ...declaration,
    match: {status, candidates: candidates.map(({printed,evidence})=>({printed,document:evidence.document}))},
    evidence: status==='matched' ? candidates[0].evidence : null
  };
}
export const matchLabels = {matched:'Unique reference match',missing:'Missing reference',not_found:'Reference not found',ambiguous:'Multiple reference matches'};
