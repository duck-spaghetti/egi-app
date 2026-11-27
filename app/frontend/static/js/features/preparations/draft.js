/** Private card state, immutable save attempts and explicit three-way conflict recovery. */
const clone = value => structuredClone(value);
export function equalValue(a,b) {
  if(a===b)return true;
  if(!a || !b || typeof a!=='object' || typeof b!=='object')return false;
  if(Array.isArray(a) || Array.isArray(b))return Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((value,index)=>equalValue(value,b[index]));
  const keys=Object.keys(a).filter(key=>a[key]!==undefined),other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length && keys.every(key=>Object.hasOwn(b,key) && equalValue(a[key],b[key]));
}
const equal=equalValue;
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
      resolution.state='unresolved';resolution.context={};resolution.candidates=[];delete resolution.selected;delete resolution.confirmation;
    }
  }
  for(const field of ['interpreted_classifications','interpretation_hypotheses'])for(const record of payload[field] || [])if(related(path,record.basis.field_path)){
    record.state='stale';record[field==='interpreted_classifications'?'selected':'verification']=null;
  }
}
function changes(base, next, keys = []) {
  if (equal(base, next)) return [];
  if (base && next && !Array.isArray(base) && !Array.isArray(next) && typeof base === 'object' && typeof next === 'object') {
    return [...new Set([...Object.keys(base), ...Object.keys(next)])].flatMap(key => changes(base[key], next[key], [...keys, key]));
  }
  return [{path: pointer(keys), value: next}];
}
const stableCollections={source_facts:'fact_id',resolutions:'fact_id',interpreted_classifications:'interpretation_id',interpretation_hypotheses:'hypothesis_id',evidence:'id'};
function decisionValue(value){
  if(Array.isArray(value))return value.map(decisionValue);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['actor_id','confirmed_at','verified_at','decision_id'].includes(key)).map(([key,child])=>[key,decisionValue(child)]));
  return value;
}
const sameDecision=(a,b)=>equal(decisionValue(a),decisionValue(b));
function stableMerge(before,local,theirs,field,idField,choices,conflicts) {
  const base=new Map((before || []).map(record=>[record[idField],record])),mine=new Map((local || []).map(record=>[record[idField],record]));
  const result=clone(theirs || []),other=new Map(result.map(record=>[record[idField],record]));
  function replace(id,value){const index=result.findIndex(record=>record[idField]===id);if(value===undefined){if(index>=0)result.splice(index,1);}else if(index<0)result.push(clone(value));else result[index]=clone(value);}
  for(const id of new Set([...base.keys(),...mine.keys()])){
    const old=base.get(id),value=mine.get(id),remote=other.get(id),path=pointer([field,id]);
    if(equal(old,value))continue;
    if(!old || !value || !remote){
      const conflict=!sameDecision(remote,old) && !sameDecision(remote,value);
      if(conflict && !['local','remote'].includes(choices[path]))conflicts.push({path,value,remote,missing:!!old && !remote});
      else if(choices[path]!=='remote')replace(id,value);
      continue;
    }
    const merged=clone(remote);
    for(const change of changes(old,value)){
      const full=path+change.path,previous=readPath(old,change.path),current=readPath(remote,change.path);
      if(!sameDecision(current,previous) && !sameDecision(current,change.value) && !['local','remote'].includes(choices[full]))conflicts.push({path:full,value:change.value,remote:current});
      else if(choices[full]!=='remote')writePath(merged,change.path,change.value);
    }
    replace(id,merged);
  }
  return result;
}
function logicalFacts(payload) {
  const result=clone(payload),pathFor=path=>path.replace(/^\/source_facts\/(\d+)(\/|$)/,(_,index,tail)=>'/source_facts/@'+(payload.source_facts?.[Number(index)]?.fact_id || index)+tail);
  result.evidence=(result.evidence || []).map(evidence=>({...evidence,path:pathFor(evidence.path)}));
  result.field_origins=Object.fromEntries(Object.entries(result.field_origins || {}).map(([path,origin])=>[pathFor(path),origin]));
  return result;
}
function physicalFacts(payload) {
  const pathFor=path=>path.replace(/^\/source_facts\/@([^/]+)(\/|$)/,(_,id,tail)=>{const index=payload.source_facts.findIndex(fact=>fact.fact_id===id);return index<0?'':('/source_facts/'+index+tail);});
  payload.evidence=payload.evidence.map(evidence=>({...evidence,path:pathFor(evidence.path)})).filter(evidence=>evidence.path);
  payload.field_origins=Object.fromEntries(Object.entries(payload.field_origins).map(([path,origin])=>[pathFor(path),origin]).filter(([path])=>path));
  return payload;
}
function mergeV3(before,local,remote,choices) {
  const base=logicalFacts(before),mine=logicalFacts(local),theirs=logicalFacts(remote),payload=clone(theirs),conflicts=[];
  const edits=['service','location','target','outcome','field_origins'].flatMap(key=>changes(base[key],mine[key],[key]));
  for(const change of edits){
    const current=readPath(theirs,change.path),previous=readPath(base,change.path);
    if(!equal(current,previous) && !equal(current,change.value) && !['local','remote'].includes(choices[change.path]))conflicts.push({...change,remote:current});
    else if(choices[change.path]!=='remote')writePath(payload,change.path,change.value);
  }
  for(const [field,idField]of Object.entries(stableCollections))payload[field]=stableMerge(base[field],mine[field],theirs[field],field,idField,choices,conflicts);
  payload.schema_version=3;
  physicalFacts(payload);
  return {payload,conflicts};
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
  addSourceFact(fragment) {
    if((this.payload.source_facts || []).some(fact=>fact.fact_id===fragment.fact.fact_id))return;
    this.payload.schema_version=Math.max(2,this.payload.schema_version || 1);this.payload.source_facts??=[];this.payload.resolutions??=[];
    const index=this.payload.source_facts.length,from='/source_facts/0',into='/source_facts/'+index;
    this.payload.source_facts.push(clone(fragment.fact));
    this.payload.evidence.push({...clone(fragment.evidence),path:into+'/source_value'});
    for(const [path,origin]of Object.entries(fragment.field_origins))this.payload.field_origins[into+path.slice(from.length)]=clone(origin);
  }
  resolveFact(id,resolution) {
    if(!(this.payload.source_facts || []).some(fact=>fact.fact_id===id))throw new Error('unknown_fact');
    const value={...clone(resolution),fact_id:id};
    if(value.state!=='confirmed'){delete value.selected;delete value.confirmation;}
    this.payload.resolutions=(this.payload.resolutions || []).filter(item=>item.fact_id!==id);this.payload.resolutions.push(value);
  }
  chooseInterpretation(id,target,actor) {
    const record=this.payload.interpreted_classifications?.find(item=>item.interpretation_id===id);
    if(!record || !actor || record.state==='stale' || !record.candidates.some(candidate=>equal(candidate.target,target)))throw new Error('unknown_interpretation_choice');
    if(record.state==='confirmed' && equal(record.selected?.target,target))return;
    record.state='confirmed';record.selected={target:clone(target),actor_id:actor,confirmed_at:new Date().toISOString()};
  }
  rejectInterpretation(id) {
    const record=this.payload.interpreted_classifications?.find(item=>item.interpretation_id===id);
    if(!record)throw new Error('unknown_interpretation');record.state='rejected';record.selected=null;
  }
  verifyHypothesis(id,evidence,actor,decision) {
    const record=this.payload.interpretation_hypotheses?.find(item=>item.hypothesis_id===id);
    if(!record || !actor || !decision || record.state==='stale' || evidence.kind!=='manual' || !evidence.note?.trim() || evidence.note.length>4000 || 'span' in evidence || 'quote' in evidence || this.payload.evidence.some(item=>item.id===evidence.id))throw new Error('independent_verification_required');
    this.payload.evidence.push(clone(evidence));record.state='verified';
    record.verification={actor_id:actor,verified_at:new Date().toISOString(),decision_id:decision,evidence_ids:[evidence.id]};
  }
  rejectHypothesis(id) {
    const record=this.payload.interpretation_hypotheses?.find(item=>item.hypothesis_id===id);
    if(!record)throw new Error('unknown_hypothesis');record.state='rejected';record.verification=null;
  }
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
  reconcileSaved(remote,choices={}) {
    if(!this.pending)throw new Error('no_pending_save');
    const result=mergeV3(this.pending.payload,this.payload,remote.payload,choices);
    if(result.conflicts.length){this.conflicted=true;return result.conflicts;}
    // A legacy save also uses normalized source values, without opting into v3.
    if(Math.max(this.pending.payload.schema_version || 1,remote.payload.schema_version || 1)<3){
      result.payload.schema_version=remote.payload.schema_version || this.pending.payload.schema_version;
      if(result.payload.schema_version!==2){delete result.payload.source_facts;delete result.payload.resolutions;}
      delete result.payload.interpreted_classifications;delete result.payload.interpretation_hypotheses;
    }
    this.version=remote.id;this.base=clone(remote.payload);this.payload=result.payload;this.pending=null;this.conflicted=false;return [];
  }
  rebase(remote, choices = {}) {
    if(this.pending?.committedVersion)return this.reconcileSaved(remote,choices);
    if(Math.max(this.base.schema_version || 1,this.payload.schema_version || 1,remote.payload.schema_version || 1)>=3){
      const result=mergeV3(this.base,this.payload,remote.payload,choices);
      if(result.conflicts.length)return result.conflicts;
      this.base=clone(remote.payload);this.version=remote.id;this.payload=result.payload;this.pending=null;this.conflicted=false;return [];
    }
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
    const resolutionChanges=(this.payload.resolutions || []).flatMap(value=>{
      const before=(this.base.resolutions || []).find(item=>item.fact_id===value.fact_id);
      if(equal(before,value))return [];
      const theirs=(remote.payload.resolutions || []).find(item=>item.fact_id===value.fact_id);
      const fact=this.payload.source_facts.find(item=>item.fact_id===value.fact_id),other=(remote.payload.source_facts || []).find(item=>item.fact_id===value.fact_id);
      const missing=!other && (this.base.source_facts || []).some(item=>item.fact_id===value.fact_id);
      const stale=['confirmed','proposed'].includes(value.state) && !!other && !equal(fact.value,other.value);
      return [{path:'/resolutions/'+value.fact_id,value,before,remote:theirs,stale,missing,
        conflict:missing || !!other && (stale || !equal(before,theirs) && !equal(value,theirs))}];
    });
    const all=[...resolutionChanges.filter(change=>change.conflict).map(change=>({...change,value:change.stale?{state:'unresolved'}:change.value})),...conflicts.map(change=>({...change,remote:readPath(remote.payload,change.path)})),
      ...factConflicts.map(change=>({...change,remote:(remote.payload.source_facts || []).find(fact=>fact.fact_id===change.fact.fact_id)?.value}))];
    if(all.some(change=>!['local','remote'].includes(choices[change.path])))return all;
    const payload = clone(remote.payload);
    for (const change of local) if (choices[change.path] !== 'remote') edited(payload, change.path, change.value);
    for(const change of resolutionChanges)if(change.missing && choices[change.path]==='local'){
      const index=this.payload.source_facts.findIndex(fact=>fact.fact_id===change.value.fact_id),fact=this.payload.source_facts[index];
      facts.push({path:'/source_facts/'+index+'/value',fact,index,value:fact.value});
    }
    for(const change of facts)if(choices[change.path]!=='remote'){
      payload.schema_version=Math.max(2,payload.schema_version || 1);payload.source_facts??=[];payload.resolutions??=[];
      let index=payload.source_facts.findIndex(fact=>fact.fact_id===change.fact.fact_id);
      if(index<0){
        index=payload.source_facts.length;payload.source_facts.push(clone(change.fact));
        const from='/source_facts/'+change.index,into='/source_facts/'+index;
        for(const evidence of this.payload.evidence)if(evidence.path.startsWith(from+'/'))payload.evidence.push({...clone(evidence),path:into+evidence.path.slice(from.length)});
        for(const [path,origin]of Object.entries(this.payload.field_origins))if(path.startsWith(from+'/'))payload.field_origins[into+path.slice(from.length)]=clone(origin);
      }
      edited(payload,'/source_facts/'+index+'/value',change.value);
    }
    for(const change of resolutionChanges)if(choices[change.path]!=='remote' && payload.source_facts?.some(fact=>fact.fact_id===change.value.fact_id)){
      const value=change.stale?{fact_id:change.value.fact_id,state:'unresolved',context:{},candidates:[]}:clone(change.value);
      payload.resolutions=(payload.resolutions || []).filter(item=>item.fact_id!==value.fact_id);payload.resolutions.push(value);
    }
    this.base = clone(remote.payload);
    this.version = remote.id;
    this.payload = payload;
    this.pending = null;
    this.conflicted = false;
    return [];
  }
}
