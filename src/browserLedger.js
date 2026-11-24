import {applyAction} from './ledger.js';

const legacyKey = 'cip-open-recovery-events-v1';
const sharedKey = 'cip-open-recovery-browser-v2';
const listeners = new Set();

function read(storage, key) {
  const value = JSON.parse(storage.getItem(key) || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('Invalid ledger');
  return value;
}

let local = null;
try {
  if (navigator.locks) {
    localStorage.setItem(sharedKey+'-probe','1');
    localStorage.removeItem(sharedKey+'-probe');
    local = localStorage;
  }
} catch { /* Use the existing tab session when shared storage is unavailable. */ }
export const sharedAcrossTabs = !!local;
let legacy = {};
try { legacy = read(sessionStorage,legacyKey) } catch { /* No readable prior session. */ }
let snapshot = legacy;
export const getEvents = () => snapshot;
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(value) {
  snapshot = value;
  listeners.forEach(listener=>listener());
}

function refresh() {
  if (local) publish(read(local,sharedKey));
}
if (local) {
  window.addEventListener('storage',e=>{if(e.storageArea===local && (e.key===sharedKey||e.key===null)) refresh()});
  window.addEventListener('pageshow',refresh);
}
// Preserve existing per-tab actions. A shared history already present for a case
// takes precedence so reopening the old session cannot duplicate a payment.
const ready = local ? navigator.locks.request(sharedKey,()=>{
  const current = read(local,sharedKey);
  const missing = Object.entries(legacy).filter(([key])=>!Object.hasOwn(current,key));
  if (missing.length) {
    Object.assign(current,Object.fromEntries(missing));
    local.setItem(sharedKey,JSON.stringify(current));
    sessionStorage.removeItem(legacyKey);
  }
  publish(current);
}).then(()=>true,()=>false) : Promise.resolve(true);

export async function postEvent(record,key,action) {
  if (!await ready) throw Error('The ledger could not be opened. Reload to try again.');
  function commit() {
    // Validate against the last committed record inside the lock. Two tabs
    // cannot collect the same outstanding balance by racing one another.
    const current = local ? read(local,sharedKey) : snapshot;
    const history = Array.isArray(current[key]) ? current[key] : [];
    const row = history.reduce(applyAction,record);
    if (applyAction(row,action)===row) {
      publish(current);
      throw Error('The case has changed. Check its current balance and stage.');
    }
    const next = {...current,[key]:[...history,action]};
    (local || sessionStorage).setItem(local ? sharedKey : legacyKey,JSON.stringify(next));
    publish(next);
  }
  return local ? navigator.locks.request(sharedKey,commit) : commit();
}
