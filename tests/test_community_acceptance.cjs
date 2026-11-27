/** Actual decision builder preserves complete unselected canonical arrays and proof ownership. */
const assert=require('node:assert/strict');const {environment}=require('./module_fixture.cjs');
(async()=>{
 const {load}=environment();const {decisionFor,createAcceptanceAttempt}=await load('features/preparations/acceptance.js');
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
 payload.schema_version=2;
 payload.source_facts=[{fact_id:'raw-org',value:'Alfa'},{fact_id:'raw-category',value:'Mensa'},{fact_id:'unknown',value:'Unresolved'}];
 payload.resolutions=[{fact_id:'raw-org',state:'confirmed',context:{catalog_digest:'bound'},candidates:[],selected:{target:{kind:'new_organization',body:{name:'Alfa',original_language:'it',territories:[]}},role:'provider'}},
  {fact_id:'raw-category',state:'confirmed',context:{axis_id:'axis',territory_id:'territory'},candidates:[],selected:{target:{kind:'classification',adoption_id:'adoption',term_id:'term',axis_id:'axis',release_id:'release'}}}];
 decision=decisionFor(context,payload,'Explicit human decision',null,{'raw-org':'replace'});
 assert.equal(decision.schema_version,2);assert.equal(decision.fact_actions.length,3);
 assert.equal(decision.fact_actions[0].action,'create');assert.equal(decision.fact_actions[0].selected.role,'provider');assert.equal(decision.fact_actions[0].reconcile,'replace');
 assert.equal(decision.fact_actions[1].action,'select');assert.equal(decision.fact_actions[2].action,'keep');
 assert.equal(decision.fact_actions[0].note,'Explicit human decision');
 assert.equal(payload.service.organizations,undefined,'resolution never fills canonical body implicitly');
 const requests=[],states=[];let accepted=0,failures=0,builds=0;
 const attempt=createAcceptanceAttempt({key:()=>String(requests.length+1),onState:state=>states.push(state),onAccepted:()=>accepted++,onError:()=>failures++,
  request:async body=>{requests.push(body);if(requests.length===1)throw Object.assign(new Error(),{status:503});return {service_id:'retained'};}});
 const originalDecision={reason:'Original visible decision',service_operations:[]};
 await attempt.send(()=>{builds++;return originalDecision;});
 assert.equal(attempt.locked,true);assert.equal(states.at(-1).uncertain,true);assert.equal(failures,1);
 originalDecision.reason='Later unsent edit';
 await attempt.send(()=>{builds++;return {reason:'New decision'};});
 assert.equal(builds,1,'unknown outcome must retry captured decision without reading changed controls');
 assert.equal(JSON.stringify(requests[0]),JSON.stringify(requests[1]));assert.equal(requests[1].decision.reason,'Original visible decision');
 assert.equal(accepted,1);assert.equal(attempt.locked,true);assert.equal(states.at(-1).complete,true);
 await attempt.send(()=>({reason:'Another'}));assert.equal(requests.length,2,'accepted receipt cannot be sent as a new decision');
 const rejected=createAcceptanceAttempt({key:()=> 'known-rejection',onState:()=>{},onAccepted:()=>{},onError:()=>{},request:async()=>{throw Object.assign(new Error(),{status:422});}});
 await rejected.send(()=>({reason:'Invalid'}));assert.equal(rejected.locked,false,'known validation rejection unlocks editing');
 console.log('Community acceptance: selected changes, complete arrays, stripped caller proof and exact heads passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
