import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {baseCase, applyAction, sumRows, balance, parsePayment, screeningQueue, queues} from './ledger.js';
const input = JSON.parse(fs.readFileSync(new URL('../data/shipments.json', import.meta.url)));
import {indexInvoices,matchDeclaration,referenceKey} from './matching.js';
const fixture=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name+'.json',import.meta.url)));
const index=indexInvoices(input,fixture('invoice-references'));
const rows = input.map(r=>baseCase(matchDeclaration(r,index)));
test('sample, evidence attachments and distinct keys reconcile', () => {
  assert.equal(rows.length,6000);
  assert.equal(new Set(rows.map(r=>r.id)).size,6000);
  const docs=input.filter(r=>r.evidence);
  assert.equal(docs.length, 6000);
  assert.equal(new Set(docs.map(r=>r.evidence.document)).size,6000);
  const packs = new Map();
  for (const {evidence:e} of docs) {
    if(e.batch==null) {
      for(const suffix of ['.png','-page.png']) assert.ok(fs.existsSync(new URL('../public/evidence/'+e.document+suffix,import.meta.url)));
      continue;
    }
    if(!packs.has(e.batch)) packs.set(e.batch,JSON.parse(fs.readFileSync(new URL('../public/evidence-batches/'+e.batch+'.json',import.meta.url))));
    const entry=packs.get(e.batch)[e.document];
    for(const image of e.reason==='no_total' ? [entry.page] : [entry.page,entry.line]) {
      assert.equal(Buffer.from(image,'base64').subarray(1,4).toString(),'PNG');
    }
  }
});
test('unlinked, uncertain and foreign currency cannot generate debt', () => {
  for(const e of [null,{read:50000,currency:'EUR',checked:true},{read:50000,currency:'USD',checked:false}]) {
    const r=baseCase({declared:10000,evidence:e});
    assert.equal(r.potential,null);assert.equal(r.assessed,null);
    assert.equal(applyAction(r,{type:'assess'}),r);
  }
});
test('worked example and partial receipts reconcile to the cent', () => {
  let r=baseCase({declared:200000,example:0,evidence:{read:1200000,currency:'USD',checked:true}});
  assert.equal(r.original,20000);assert.equal(r.potential,100000);assert.equal(balance(r),null);
  r=applyAction(r,{type:'assess'});r=applyAction(r,{type:'receive',cents:25000});
  assert.equal(balance(r),75000);assert.equal(r.status,'partial');
  assert.equal(applyAction(r,{type:'receive',cents:75001}),r);
  assert.equal(applyAction(r,{type:'receive',cents:75000}).status,'paid');
  assert.equal(applyAction(r,{type:'clear'}),r);
});
test('reported assessments reconcile and payments reject invalid precision', () => {
  const s=sumRows(rows);assert.equal(s.owed,s.assessed-s.recovered);
  assert.ok(s.owed>0 && s.potential>s.assessed);
  for(const v of ['0','1.001','-5','NaN','1e2']) assert.equal(parsePayment(v),null);
  assert.equal(parsePayment('3.09'),309);
});

test('screening partitions the whole batch and referrals cannot create money', () => {
  const tally=Object.fromEntries(Object.keys(queues).map(k=>[k,0]));
  for (const r of rows) {
    const key=screeningQueue(r);
    tally[key]++;
    if (key==='currency'||key==='reading'||key==='match') {
      const referred=applyAction(r,{type:'refer'});
      assert.equal(referred.status,'referred');
      assert.equal(screeningQueue(referred),key);
      assert.equal(referred.potential,null);
      assert.equal(applyAction(referred,{type:'assess'}),referred);
      assert.equal(applyAction(referred,{type:'receive',cents:1}),referred);
    }
  }
  assert.equal(Object.values(tally).reduce((a,b)=>a+b),6000);
  assert.ok(Object.values(tally).every(n=>n>0));
  const fresh=baseCase({declared:10000,evidence:{checked:true,currency:'USD',read:20000}});
  assert.equal(fresh.status,'review');assert.equal(fresh.assessed,null);
});

const scenarios=fixture('matching-declarations').map(d=>baseCase(matchDeclaration(d,index)));

test('lookup uses printed references, preserving punctuation and leading zeros',()=>{
  assert.equal(referenceKey(' inv-001 '),'INV-001');
  const [first]=scenarios;
  assert.equal(first.match.candidates[0].printed,'INV63316293');
  assert.equal(first.evidence.document,'Template22_Instance76');
  assert.equal(matchDeclaration({...first,invoiceRef:'INV-63316293'},index).evidence,null);
  assert.equal(first.potential,15000);
  const assessed=applyAction(first,{type:'assess'});
  const paid=applyAction(assessed,{type:'receive',cents:15000});
  assert.equal(paid.status,'paid');assert.equal(balance(paid),0);
});
test('missing, unknown and ambiguous references never receive a comparison or assessment',()=>{
  assert.deepEqual(scenarios.slice(4).map(r=>r.match.status),['not_found','ambiguous','missing']);
  assert.equal(scenarios[5].match.candidates.length,2);
  for(const r of scenarios.slice(4)){
    assert.equal(r.evidence,null);assert.equal(r.potential,null);assert.equal(screeningQueue(r),'match');
    for(const action of [{type:'assess'},{type:'receive',cents:1},{type:'confirm_fx'}]) assert.equal(applyAction(r,action),r);
    assert.equal(applyAction(r,{type:'refer'}).status,'referred');
  }
});
test('currency must be confirmed and converted before assessment; settled example reconciles',()=>{
  const fx=scenarios[1];assert.equal(fx.potential,null);assert.equal(applyAction(fx,{type:'assess'}),fx);
  const checked=applyAction(fx,{type:'confirm_fx'});assert.equal(checked.converted,119786);
  assert.equal(checked.potential,1997);assert.equal(checked.assessed,null);
  assert.equal(applyAction(checked,{type:'confirm_fx'}),checked);
  const partial=scenarios[2].openingEvents.reduce(applyAction,scenarios[2]);
  assert.equal(partial.assessed,10000);assert.equal(partial.recovered,6000);assert.equal(balance(partial),4000);
  assert.equal(scenarios[3].potential,0);
});

test('main register resolves submitted references before computing recovery',()=>{
  const counts = {};
  for(const r of rows){
    counts[r.match.status]=(counts[r.match.status]??0)+1;
    if (r.match.status!=='matched'){
      assert.equal(r.evidence,null);assert.equal(r.potential,null);assert.equal(r.assessed,null);assert.equal(r.recovered,0);
    } else assert.equal(referenceKey(r.invoiceRef),referenceKey(r.match.candidates[0].printed));
  }
  assert.deepEqual(counts,{matched:5296,missing:702,ambiguous:2});
  const source=input.find(r=>r.id==='SHP004167');
  const rec=rows.find(r=>r.id===source.id);
  assert.equal(rec.match.candidates[0].printed,'INV/40-85/952');
  assert.equal(rec.potential,3405);assert.equal(rec.recovered,1702);assert.equal(balance(rec),1703);
  const altered=baseCase(matchDeclaration({...source,invoiceRef:'UNRESOLVED'},index));
  assert.equal(altered.match.status,'not_found');assert.equal(altered.evidence,null);assert.equal(altered.assessed,null);
  const paid=applyAction(rec,{type:'receive',cents:1703});assert.equal(paid.status,'paid');assert.equal(balance(paid),0);
});

test('main currency case converts, assesses and collects in separate steps',()=>{
  const r=rows.find(row=>row.id==='SHP008851');
  assert.equal(r.match.status,'matched');assert.equal(r.invoiceRef,'9Y1M1d-764');
  assert.equal(r.original,14740);assert.equal(r.fx.reference,'Training rate FX-01');
  assert.equal(r.potential,null);assert.equal(r.assessed,null);assert.equal(r.recovered,0);
  assert.equal(applyAction(r,{type:'assess'}),r);
  const converted=applyAction(r,{type:'confirm_fx'});
  assert.equal(converted.converted,194602);assert.equal(converted.potential,4720);
  assert.equal(converted.assessed,null);assert.equal(balance(converted),null);
  const assessed=applyAction(converted,{type:'assess'});
  assert.equal(balance(assessed),4720);assert.equal(assessed.recovered,0);
  const paid=applyAction(assessed,{type:'receive',cents:2000});
  assert.equal(paid.recovered,2000);assert.equal(balance(paid),2720);
  assert.equal(paid.status,'partial');assert.equal(screeningQueue(paid),'currency');
  const negative=rows.find(row=>row.id==='SHP004352');
  assert.equal(applyAction(negative,{type:'confirm_fx'}).status,'no_gap');
  for(const held of rows.filter(row=>row.match.status!=='matched'||!row.evidence?.checked)){
    assert.equal(held.fx,undefined);assert.equal(applyAction(held,{type:'confirm_fx'}),held);
  }
});
