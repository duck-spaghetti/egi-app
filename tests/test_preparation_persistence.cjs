/** Actual save sequencing: normalized decisions, post-send edits and explicit recovery. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const clone=value=>structuredClone(value),plain=value=>JSON.parse(JSON.stringify(value));
function version(schema=3) {
 const payload={schema_version:schema,service:{name:'Original'},location:{kind:'none'},target:{kind:'new'},outcome:'review',evidence:[],field_origins:{}};
 if(schema>=2){payload.source_facts=[];payload.resolutions=[];}
 if(schema===3){payload.interpreted_classifications=[];payload.interpretation_hypotheses=[];}
 return {id:'before',payload};
}
(async()=>{
 const {load}=environment();
 const {PreparationDraft}=await load('features/preparations/draft.js');
 const {saveDraft}=await load('features/preparations/persistence.js');
 const target={kind:'classification',adoption_id:'a',release_id:'r',term_id:'t',axis_id:'axis'};
 const original=version();original.payload.service.description='Original context';original.payload.interpreted_classifications=[{interpretation_id:'i',state:'proposed',selected:null,candidates:[{target}],basis:{field_path:'/service/description'},method:'ai',job_id:'job'}];
 const draft=new PreparationDraft('card',original),calls=[];
 draft.chooseInterpretation('i',target,'client');
 let release,server;
 const api=(path,body)=>{
  calls.push({path,body:body && clone(body)});
  if(body){server=clone(body.changes[0].payload);server.service.classifications=[{adoption_id:'a',term_id:'t'}];server.interpreted_classifications[0].selected.actor_id='server';return new Promise(resolve=>release=()=>resolve({operation_id:'op',items:[{item_id:'card',after:'after'}]}));}
  return Promise.resolve({version:{id:'after',payload:server}});
 };
 const saved=saveDraft(draft,api,'workspace','key');
 draft.edit('/service/name','Typed while saving');release();
 const result=await saved;
 assert.equal(result.conflicts.length,0);assert.equal(result.refreshView,true);
 assert.equal(draft.version,'after');assert.equal(draft.pending,null);assert.equal(draft.payload.service.name,'Typed while saving');
 assert.equal(draft.payload.interpreted_classifications[0].selected.actor_id,'server');assert.equal(draft.dirty,true);
 assert.equal(calls[0].body.changes[0].payload.service.name,'Original');assert.match(calls[1].path,/\?version=after$/);

 const retry=new PreparationDraft('card',version()),attempts=[];retry.edit('/service/name','Saved value');let failRead=true,remote;
 const transport=async(path,body)=>{
  if(body){attempts.push(plain(body));remote=clone(body.changes[0].payload);return {operation_id:'op2',items:[{item_id:'card',after:'saved'}]};}
  if(failRead)throw Object.assign(new Error('temporary'),{status:503});
  return {version:{id:'saved',payload:remote}};
 };
 await assert.rejects(saveDraft(retry,transport,'workspace','original-key'));
 assert.equal(retry.pending.committedVersion,'saved');assert.equal(retry.version,'before');
 retry.edit('/service/name','Later edit');failRead=false;
 await saveDraft(retry,transport,'workspace','unused-new-key');
 assert.deepEqual(attempts[0],attempts[1]);assert.equal(attempts[1].request_key,'original-key');
 assert.equal(retry.payload.service.name,'Later edit');assert.equal(retry.pending,null);assert.equal(retry.version,'saved');

 const conflict=new PreparationDraft('card',version());let normalized;
 const conflicting=async(path,body)=>{
  if(body){normalized=clone(body.changes[0].payload);normalized.service.name='Server normalized';return {items:[{item_id:'card',after:'normalized'}]};}
  return {version:{id:'normalized',payload:normalized}};
 };
 const inFlight=saveDraft(conflict,conflicting,'workspace','conflict-key');conflict.edit('/service/name','Local');
 const unresolved=await inFlight;
 assert.equal(unresolved.conflicts.length,1);assert.equal(conflict.conflicted,true);assert.equal(conflict.pending.committedVersion,'normalized');
 assert.equal(conflict.rebase({id:'normalized',payload:normalized},{'/service/name':'local'}).length,0);
 assert.equal(conflict.payload.service.name,'Local');assert.equal(conflict.version,'normalized');assert.equal(conflict.pending,null);

 const legacy=new PreparationDraft('old',version(1));let exchanges=0;
 await saveDraft(legacy,async(path,body)=>{exchanges++;assert.ok(body);return {items:[{item_id:'old',after:'old-after'}]};},'workspace','old-key');
 assert.equal(exchanges,1);assert.equal(legacy.version,'old-after');
 console.log('Preparation persistence: server normalization, concurrent edits, exact retry and committed conflict recovery passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
