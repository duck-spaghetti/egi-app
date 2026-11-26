/** Actual decision builder preserves complete unselected canonical arrays and proof ownership. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {load}=environment();const {decisionFor}=await load('features/preparations/acceptance.js');
 const context={working:'work',public:'public',baseline:{name:'Old',contacts:[{component_id:'contact',value:'123',evidence:[{assertion_id:'old'}]}]},snapshot:{evidence:[{id:'quote',kind:'stated',span:{start:0,end:3},quote:'New'},{id:'manual',kind:'manual'}]}};
 const payload={service:structuredClone(context.baseline),location:{kind:'none'}};payload.service.name='New';
 let decision=decisionFor(context,payload,'Name correction',null);
 assert.equal(decision.service_operations.length,1);assert.equal(decision.service_operations[0].path,'/name');
 assert.equal(JSON.stringify(decision.service_operations[0].evidence_ids),'["quote"]');
 assert.equal(decision.expected_service_work,'work');assert.equal(decision.expected_service_public,'public');
 payload.service.contacts.push({value:'456',is_public:false});
 decision=decisionFor(context,payload,'Add contact',{method:'phone_call',note:'Verified'});
 const contacts=decision.service_operations.find(op=>op.path==='/contacts');
 assert.equal(contacts.value[0].component_id,'contact');assert.equal(contacts.value[0].value,'123');assert.equal(contacts.value[0].evidence,undefined);
 assert.equal(context.baseline.contacts[0].evidence[0].assertion_id,'old','trusted baseline is not mutated');
 assert.equal(decision.observations[0].method,'phone_call');
 delete payload.service.name;decision=decisionFor(context,payload,'Explicit removal',null);
 const removed=decision.service_operations.find(op=>op.path==='/name');assert.equal(removed.op,'remove');assert.equal('value' in removed,false);
 console.log('Community acceptance: selected changes, complete arrays, stripped caller proof and exact heads passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
