/** Actual browser state: provenance, stable retries and concurrent recovery. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {load}=environment();const {PreparationDraft}=await load('features/preparations/draft.js');
 const version={id:'v1',payload:{service:{name:'Original',description:'Source description',contacts:[{value:'123'}]},location:{kind:'none'},target:{kind:'new'},outcome:'review',field_origins:{},evidence:[{id:'quote',path:'/service/name'},{id:'other',path:'/service/description'}]}};
 const draft=new PreparationDraft('item',version);
 draft.edit('/service/name','Corrected');
 assert.equal(draft.payload.evidence.length,1);
 assert.equal(draft.payload.field_origins['/service/name'].state,'manual');
 const first=draft.attempt('request1');draft.edit('/service/description',undefined);
 assert.equal(draft.payload.field_origins['/service/description'].state,'cleared');
 assert.equal(JSON.stringify(draft.attempt('request2')),JSON.stringify(first));
 draft.acknowledge({items:[{item_id:'item',after:'v2'}]});
 assert.equal(draft.dirty,true);assert.equal(draft.version,'v2');
 assert.equal(draft.attempt('request3').changes[0].payload.service.description,undefined);
 draft.edit('/service/name','Second correction');
 const remote=structuredClone(version);remote.id='v3';remote.payload.service.name='Another person';remote.payload.service.contacts[0].value='456';
 const conflicts=draft.rebase(remote);assert.equal(conflicts.length,1);assert.equal(conflicts[0].path,'/service/name');
 assert.equal(draft.payload.service.name,'Second correction');
 draft.rebase(remote,{'/service/name':'local'});
 assert.equal(draft.payload.service.name,'Second correction');assert.equal(draft.payload.service.contacts[0].value,'456');
 assert.equal(draft.version,'v3');assert.equal(draft.pending,null);
 const another=new PreparationDraft('item',version);another.edit('/service/name','Mine');another.rebase(remote,{'/service/name':'remote'});
 assert.equal(another.payload.service.name,'Another person');
 console.log('Preparation draft: provenance, immutable retries, dirty saves and explicit conflict recovery passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
