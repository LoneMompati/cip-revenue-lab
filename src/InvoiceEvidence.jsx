import React, {useEffect, useState} from 'react';

// Only fetch the evidence pack when a visitor opens a declaration.
function PackedEvidence({evidence}) {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let pageUrl;
    async function load() {
      const response = await fetch('./evidence-batches/' + evidence.batch + '.json', {signal:controller.signal});
      if (!response.ok) throw new Error('Missing evidence pack');
      const item = (await response.json())[evidence.document];
      const bytes = Uint8Array.from(atob(item.page), ch => ch.charCodeAt(0));
      if (!active) return;
      pageUrl = URL.createObjectURL(new Blob([bytes], {type:'image/png'}));
      setAssets({page:pageUrl,line:item.line ? 'data:image/png;base64,'+item.line : null});
    }
    load().catch(() => {if (active) setError(true)});
    return () => {active=false;controller.abort();if(pageUrl) URL.revokeObjectURL(pageUrl)};
  }, [evidence.batch,evidence.document,attempt]);
  if (error) return <p role="status">Invoice image could not load. <button onClick={()=>{setError(false);setAttempt(n=>n+1)}}>Retry</button></p>;
  if (!assets) return <p role="status">Loading invoice evidence…</p>;
  return <EvidenceLinks document={evidence.document} {...assets}/>;
}

function EvidenceLinks({document,line,page}) {
  return <>{line ? <img src={line} alt={'Invoice total line from '+document}/> :
    <p>This page has no labelled final-total region. The screening process retained it for manual review.</p>}
    <a className="documentLink" href={page} target="_blank" rel="noreferrer">Open invoice page extract ↗</a></>;
}
export default function InvoiceEvidence({evidence}) {
  return <figure><figcaption>Invoice evidence <span>FATURA · {evidence.document} · page 1</span></figcaption>
    {evidence.batch == null ? <EvidenceLinks document={evidence.document} line={'./evidence/'+evidence.document+'.png'} page={'./evidence/'+evidence.document+'-page.png'}/> : <PackedEvidence evidence={evidence}/>}</figure>;
}
