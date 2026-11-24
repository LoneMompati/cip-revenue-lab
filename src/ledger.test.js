import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {baseCase, applyAction, sumRows, balance, parsePayment} from './ledger.js';
const input = JSON.parse(fs.readFileSync(new URL('../data/shipments.json', import.meta.url)));
const rows = input.map(baseCase);
test('sample, evidence attachments and distinct keys reconcile', () => {
  assert.equal(rows.length,6000);
  assert.equal(new Set(rows.map(r=>r.id)).size,6000);
  const docs=rows.filter(r=>r.evidence);
  assert.equal(new Set(docs.map(r=>r.evidence.document)).size,48);
  for(const row of docs) for(const suffix of ['.png','-page.png']) assert.ok(fs.existsSync(new URL('../public/evidence/'+row.evidence.document+suffix,import.meta.url)));
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
