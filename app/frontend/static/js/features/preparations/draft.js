/** Private card state, immutable save attempts and explicit three-way conflict recovery. */
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parts = path => path.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
const pointer = keys => '/' + keys.map(x => String(x).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
export function readPath(value, path) {
  return parts(path).reduce((node, key) => node?.[key], value);
}
function writePath(value, path, next) {
  const keys = parts(path), last = keys.pop();
  let node = value;
  for (const key of keys) node = node[key] ??= {};
  if (next === undefined) delete node[last];
  else node[last] = clone(next);
}
function related(a, b) { return a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); }
function edited(payload, path, value) {
  writePath(payload, path, value);
  payload.evidence = payload.evidence.filter(e => !related(e.path, path));
  for (const old of Object.keys(payload.field_origins)) if (old.startsWith(path + '/')) delete payload.field_origins[old];
  if (path.startsWith('/service/') || path.startsWith('/location/') || /^\/source_facts\/\d+\/value$/.test(path)) {
    payload.field_origins[path] = {state: value === undefined ? 'cleared' : 'manual'};
  }
  if (/^\/source_facts\/\d+\/value$/.test(path)) {
    const fact=payload.source_facts[Number(parts(path)[1])];
    for(const resolution of payload.resolutions || [])if(resolution.fact_id===fact.fact_id){
      resolution.state='unresolved';resolution.context={};resolution.candidates=[];delete resolution.selected;
    }
  }
}
function changes(base, next, keys = []) {
  if (equal(base, next)) return [];
  if (base && next && !Array.isArray(base) && !Array.isArray(next) && typeof base === 'object' && typeof next === 'object') {
    return [...new Set([...Object.keys(base), ...Object.keys(next)])].flatMap(key => changes(base[key], next[key], [...keys, key]));
  }
  return [{path: pointer(keys), value: next}];
}
export class PreparationDraft {
  constructor(item, version) {
    this.item = item;
    this.version = version.id;
    this.base = clone(version.payload);
    this.payload = clone(version.payload);
    this.pending = null;
    this.conflicted = false;
  }
  get dirty() { return !equal(this.base, this.payload); }
  edit(path, value) { edited(this.payload, path, value); }
  attempt(key) {
    if (!this.pending) this.pending = {key, payload: clone(this.payload), version: this.version};
    return {request_key: this.pending.key, changes: [{item_id: this.item, expected_version: this.pending.version, payload: clone(this.pending.payload)}]};
  }
  acknowledge(receipt) {
    this.version = receipt.items.find(item => item.item_id === this.item).after;
    this.base = this.pending.payload;
    this.pending = null;
    this.conflicted = false;
  }
  rebase(remote, choices = {}) {
    const local = ['service', 'location', 'target', 'outcome'].flatMap(key => changes(this.base[key], this.payload[key], [key]));
    const conflicts = local.filter(change => !equal(readPath(remote.payload, change.path), readPath(this.base, change.path)) && !equal(readPath(remote.payload, change.path), change.value));
    // Fact positions may change remotely. Compare/apply editable values by stable
    // private identity so another fact's correction or source quote survives.
    const facts=(this.payload.source_facts || []).flatMap((fact,index)=>{
      const before=(this.base.source_facts || []).find(old=>old.fact_id===fact.fact_id);
      return before && equal(before.value,fact.value)?[]:[{path:'/source_facts/'+index+'/value',fact,index,value:fact.value,before}];
    });
    const factConflicts=facts.filter(change=>{
      const found=(remote.payload.source_facts || []).find(fact=>fact.fact_id===change.fact.fact_id);
      return (!found && !!change.before) || !equal(found?.value,change.before?.value) && !equal(found?.value,change.value);
    });
    const all=[...conflicts.map(change=>({...change,remote:readPath(remote.payload,change.path)})),
      ...factConflicts.map(change=>({...change,remote:(remote.payload.source_facts || []).find(fact=>fact.fact_id===change.fact.fact_id)?.value}))];
    if(all.some(change=>!['local','remote'].includes(choices[change.path])))return all;
    const payload = clone(remote.payload);
    for (const change of local) if (choices[change.path] !== 'remote') edited(payload, change.path, change.value);
    for(const change of facts)if(choices[change.path]!=='remote'){
      payload.schema_version=2;payload.source_facts??=[];payload.resolutions??=[];
      let index=payload.source_facts.findIndex(fact=>fact.fact_id===change.fact.fact_id);
      if(index<0){
        index=payload.source_facts.length;payload.source_facts.push(clone(change.fact));
        const from='/source_facts/'+change.index,into='/source_facts/'+index;
        for(const evidence of this.payload.evidence)if(evidence.path.startsWith(from+'/'))payload.evidence.push({...clone(evidence),path:into+evidence.path.slice(from.length)});
        for(const [path,origin]of Object.entries(this.payload.field_origins))if(path.startsWith(from+'/'))payload.field_origins[into+path.slice(from.length)]=clone(origin);
      }
      edited(payload,'/source_facts/'+index+'/value',change.value);
    }
    this.base = clone(remote.payload);
    this.version = remote.id;
    this.payload = payload;
    this.pending = null;
    this.conflicted = false;
    return [];
  }
}
