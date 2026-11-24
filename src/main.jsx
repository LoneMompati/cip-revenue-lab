import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import shipments from '../data/shipments.json';
import {baseCase,applyAction,balance,sumRows,statusText,parsePayment} from './ledger.js';
import InvoiceEvidence from './InvoiceEvidence.jsx';
import {queues,screeningQueue,screeningReason} from './ledger.js';
import './style.css';

const records=shipments.map(baseCase);
const linked=records.filter(r=>r.evidence).length;
const queueCounts = Object.fromEntries(Object.keys(queues).map(key=>[key,0]));
for (const row of records) queueCounts[screeningQueue(row)]++;
const count = n => n.toLocaleString('en-US');
const sessionKey='cip-open-recovery-events-v1';
const format=(cents,currency='USD')=> cents==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency}).format(cents/100);
function invoiceAmount(e) {
  if (e?.reason==='ambiguous_currency' && e.read!=null) return (e.read/100).toLocaleString('en-US',{minimumFractionDigits:2})+' $ (?)';
  return e?.currency ? format(e.read,e.currency) : '—';
}
const fields=[['potential','Potential duty gap','Invoice comparison'],['assessed','Extra duty assessed','Confirmed in the scenario'],['recovered','Cash recovered','Payments against extra duty'],['owed','Still owed','Assessed less recovered']];
const sorts={owed:r=>balance(r)??-1,potential:r=>r.potential??-1,declared:r=>r.declared};
function readEvents(){
  try {const value=JSON.parse(sessionStorage.getItem(sessionKey));return value && typeof value==='object'&&!Array.isArray(value)?value:{};} catch{return {};}
}
function Status({row}){return <span className={'status '+row.status}><i/>{statusText[row.status]}</span>}
function Modal({title,onClose,children}){
  const ref=useRef(null);
  useEffect(()=>{const d=ref.current;d.showModal();return ()=>d.close()},[]);
  return <dialog ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===ref.current){const b=ref.current.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose()}}}>
    <header className="dialoghead"><strong>{title}</strong><button aria-label="Close dialog" onClick={onClose}>Close ×</button></header>{children}</dialog>;
}
function Sources(){return <div className="dialogbody"><h2>Where the records come from</h2>
  <p>The 6,000 shipment IDs, commodity types and USD declaration amounts come from Ziya’s <a href="https://www.kaggle.com/datasets/ziya07/cross-border-trade-and-customs-delay-dataset">Cross-Border Trade &amp; Customs Delay Dataset</a> (CC0).</p>
  <p>The 6,000 distinct invoice excerpts come from the <a href="https://www.kaggle.com/datasets/mibrahimm/fatura-dataset">FATURA Kaggle dataset</a> used in the invoice project. Mahmoud Limam, Marwa Dhiaf and Yousri Kessentini created the generated invoices. The total line is enlarged for reading. Each page extract preserves selected invoice fields in their original positions and omits identity and contact details. <a href="https://zenodo.org/records/8261508">Original release</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
  <p>The datasets have no common transaction ID. The first 48 pilot pairings illustrate review and collection. The other 5,952 shipments each receive one unused invoice selected in repeatable hash order. Their frequency and amounts cannot measure real underpayment.</p>
  <p>Each page is checked during preparation. Where the annotation locates a total, Tesseract reads that crop. A missing total region, uncertain read or ambiguous dollar sign is routed to an officer. Both amount and currency must match the benchmark annotation. Only verified USD reads enter the comparison. The demo assumes the invoice total is comparable to the declared value and uses a flat 10% duty for illustration.</p>
  <p>Account aliases, original duty payments, assessments and collection entries are simulated. Actions you take apply to this browser tab’s session.</p></div>}
function CaseDetail({row,history,opening,post}){
  const [amount,setAmount]=useState(''),[message,setMessage]=useState('');
  const e=row.evidence,owed=balance(row);
  function record(){
    const cents=parsePayment(amount);
    if(!cents || cents>owed){setMessage('Enter a positive payment up to '+format(owed)+', using up to two decimal places.');return;}
    post({type:'receive',cents});setAmount('');setMessage('Recorded '+format(cents)+' against this assessment.');
  }
  return <div className="dialogbody"><div className="detailtitle"><div><small>{row.account??'Unpaired shipment'} · {row.commodity}</small><h2>{row.id}</h2></div><Status row={row}/></div>
    {e && <InvoiceEvidence evidence={e}/>}
    <div className="comparison"><div><small>Declared amount</small><b>{format(row.declared)}</b></div><div><small>Document reader</small><b>{invoiceAmount(e)}</b></div></div>
    <p className="note">{screeningReason(row)}</p>
    <dl>{[['Original duty paid',row.original],['Potential extra duty at 10%',row.potential],['Extra duty assessed',row.assessed],['Cash recovered',row.assessed===null?null:row.recovered],['Still owed',owed]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{format(value)}</dd></div>)}</dl>
    {e && <details className="history"><summary>Assessment and payment history</summary><ol>
      <li>Opening entry · original duty paid {format(opening.original)}</li>
      {opening.assessed>0 && <li>Opening entry · extra duty assessed {format(opening.assessed)}</li>}
      {opening.assessed===0 && <li>Opening entry · no additional duty due</li>}
      {opening.recovered>0 && <li>Opening entry · payment received {format(opening.recovered)}</li>}
      {history.map((a,i)=><li key={i}>{a.type==='receive'?'Payment received '+format(a.cents):a.type==='assess'?'Extra duty assessed '+format(row.potential):a.type==='refer'?'Referred for '+queues[screeningQueue(row)].toLowerCase().replace('check ','')+' review':'Review closed with no extra duty'}</li>)}
    </ol></details>}
    {row.status==='check' && <button className="primary" onClick={()=>{post({type:'refer'});setMessage('Referral recorded in this tab. The extra duty remains unassessed.')}}>{screeningQueue(row)==='currency'?'Refer for currency review':'Refer for document review'}</button>}
    {row.status==='review' && <div className="actions"><button className="primary" onClick={()=>{post({type:'assess'});setMessage('Extra duty assessed in this session.')}}>Assess {format(row.potential)}</button><button onClick={()=>{post({type:'clear'});setMessage('Review closed with no extra duty.')}}>Close with no extra duty</button></div>}
    {owed>0 && <form onSubmit={ev=>{ev.preventDefault();record()}}><label>Payment received (USD)<input inputMode="decimal" value={amount} placeholder="0.00" onChange={ev=>setAmount(ev.target.value)}/></label><button className="primary">Record payment</button></form>}
    <p role="status" className="message">{message}</p></div>
}
function App(){
  const [events,setEvents]=useState(readEvents),[queue,setQueue]=useState('all'),[minimum,setMinimum]=useState(''),[stage,setStage]=useState('all'),[query,setQuery]=useState(''),[sort,setSort]=useState('owed'),[page,setPage]=useState(0),[selected,setSelected]=useState(null),[sources,setSources]=useState(false);
  const rows=useMemo(()=>records.map(r=>Array.isArray(events[r.id])?events[r.id].reduce(applyAction,r):r),[events]);
  const filtered=useMemo(()=>{
    const term=query.trim().toLowerCase();
    return rows.filter(r=>(queue==='all'||screeningQueue(r)===queue)&&(!Number(minimum)||(r.potential??0)>=Math.round(Number(minimum)*100))&&(stage==='all'||r.status===stage)&&(!term||[r.id,r.commodity,r.account].some(s=>s?.toLowerCase().includes(term))))
      .sort((a,b)=>sorts[sort](b)-sorts[sort](a)||a.id.localeCompare(b.id));
  },[rows,queue,minimum,stage,query,sort]);
  const sums=sumRows(filtered),hasComparison=filtered.some(r=>r.potential!=null),hasAssessment=filtered.some(r=>r.assessed!=null),size=12,last=Math.max(0,Math.ceil(filtered.length/size)-1),current=Math.min(page,last);
  const active=selected?rows.find(r=>r.id===selected):null;
  function change(set,value){set(value);setPage(0)}
  function post(action){
    setEvents(previous=>{
      const log=Array.isArray(previous[selected])?previous[selected]:[];
      const record=records.find(r=>r.id===selected),cur=log.reduce(applyAction,record);
      if(applyAction(cur,action)===cur)return previous;
      const next={...previous,[selected]:[...log,action]};
      try{sessionStorage.setItem(sessionKey,JSON.stringify(next))}catch{}
      return next;
    });
  }
  return <><header className="mast"><div className="brand"><b className="mark">CIP</b><span>Customs Intelligence Platform</span></div><button onClick={()=>setSources(true)}>Data sources ↗</button></header>
  <main><header className="pagehead"><div><p className="overline">DECLARATION REVIEW</p><h1>Revenue recovery</h1><p>Compare declared values with invoice evidence and follow extra duty through to payment.</p></div><div className="coverage"><small>Evidence coverage</small><strong>{count(linked)} <span>/ {records.length.toLocaleString()}</span></strong><small>declarations screened in this batch</small></div></header>
  <section className="screening" aria-label="Screening outcomes"><div className="screenhead"><h2>Screening outcomes</h2><small>Whole batch · select a queue to open its declarations</small></div>
    <div className="queues">{Object.entries({all:'All screened',...queues}).map(([key,label])=><button key={key} aria-pressed={queue===key} onClick={()=>{setQueue(key);setStage('all');setQuery('');setMinimum('');setPage(0);setSort(key==='gap'?'potential':'owed')}}><span>{label}</span><b>{count(key==='all'?records.length:queueCounts[key])}</b></button>)}</div>
  </section>
  <section aria-label="Totals for filtered declarations" className="metrics">{fields.map(([key,label,note])=><article key={key} className={key}><small>{label}</small><strong>{format((key==='potential'?hasComparison:hasAssessment)?sums[key]:null)}</strong><span>{note}</span></article>)}</section>
  <section className="work"><div className="workhead"><div><h2>Recovery register</h2><p>Open a declaration to check its invoice and payment history.</p></div><span className="unit">USD · Coursework scenario</span></div>
  <div className="tools"><label>Search<input type="search" placeholder="Shipment, account or commodity" value={query} onChange={e=>change(setQuery,e.target.value)}/></label>
  <label>Minimum duty gap (USD)<input type="number" min="0" step="0.01" placeholder="Any amount" value={minimum} onChange={e=>change(setMinimum,e.target.value.startsWith('-')?'':e.target.value)}/></label>
  <label>Stage<select aria-label="Stage" value={stage} onChange={e=>change(setStage,e.target.value)}><option value="all">All stages</option>{Object.entries(statusText).filter(([k])=>k!=='unlinked').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label>Sort by<select aria-label="Sort by" value={sort} onChange={e=>change(setSort,e.target.value)}><option value="owed">Highest balance</option><option value="potential">Largest duty gap</option><option value="declared">Declared value</option></select></label></div>
  <div className="scroll" tabIndex="0" aria-label="Scrollable declaration register"><table><thead><tr>{['Declaration / account','Stage','Declared','Invoice total','Duty paid¹','Potential gap','Extra assessed','Recovered','Still owed'].map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{filtered.slice(current*size,(current+1)*size).map(r=><tr key={r.id}><td><button className="case" onClick={()=>setSelected(r.id)}>{r.id} ↗</button><small>{r.account??'—'} · {r.commodity}</small></td><td><Status row={r}/>{r.status==='check' && <small>{queues[screeningQueue(r)]}</small>}</td><td>{format(r.declared)}</td><td>{invoiceAmount(r.evidence)}</td><td>{format(r.original)}</td><td>{format(r.potential)}</td><td>{format(r.assessed)}</td><td className={r.recovered?'green':''}>{format(r.assessed===null?null:r.recovered)}</td><td className={balance(r)>0?'red':''}>{format(balance(r))}</td></tr>)}</tbody></table></div>
  {!filtered.length && <p className="empty">No declarations match these filters. <button onClick={()=>{setQuery('');setStage('all');setQueue('all');setMinimum('');setPage(0)}}>Clear filters</button></p>}
  <div className="pager"><small>{filtered.length?current*size+1:0}–{Math.min((current+1)*size,filtered.length)} of {filtered.length.toLocaleString()} declarations</small><div><button disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><button disabled={current===last} onClick={()=>setPage(current+1)}>Next</button></div></div></section>
  <footer>¹ Duty paid on the original declaration. The extra assessment, recoveries and balance relate only to the additional duty. A dash means the amount has not been established. Totals follow the filters above.</footer></main>
  {active&&<Modal title="Declaration details" onClose={()=>setSelected(null)}><CaseDetail key={active.id} row={active} opening={records.find(r=>r.id===active.id)} history={Array.isArray(events[active.id])?events[active.id]:[]} post={post}/></Modal>}
  {sources&&<Modal title="Data and calculations" onClose={()=>setSources(false)}><Sources/></Modal>}</>
}
createRoot(document.getElementById('root')).render(<App/>);
