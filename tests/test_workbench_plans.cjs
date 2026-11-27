/** Exercise the actual plan controller with explicit actions and bounded reads. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const textOf=node=>[node.textContent,...node.children.map(textOf)].join(' ');
async function fixture(count=2,restore=false){
 let sequence=0;const timers=new Map(),calls=[],errors=[];
 const history=new Map();
 const env=environment({crypto:{randomUUID:()=>`request-${++sequence}`},setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const {createPlans}=await env.load('features/preparations/plans.js');
 let workspace={id:'workspace',state:'active',permission:'owner',current_input_id:'input',items:Array.from({length:count},(_,i)=>({item_id:`card-${i}`,display_name:`Servizio ${i}`}))};
 const draft={item:'card-0',version:'version-card-0',dirty:false,payload:{service:{description:'Local text'}}};
 let inputDirty=false,denied=false,failStart=false,failPreview=false,flushAllowed=true,delayFlush=null,delayReads=null;
 let plan={plan_id:'plan',version:1,input_id:'input',selection:workspace.items.slice(0,2).map(item=>({record_key:item.item_id,item_version:'version-'+item.item_id})),
  configuration:{model:'fixture-only',max_input_tokens:200000,max_output_tokens:10000},planned_request_count:2,ceiling_micro_usd:100000,followup_limits:{max_total_packets:8,max_followup_packets:3,max_reserved_micro_usd:1000000},
  initial_packet_ids:['packet'],stage_policy:{tasks:['classify_cards','group_labels']},shared_context:{scope:{},source_metadata:[{name:'Fonte pubblica'}],inventory_coverage:{total_labels:1,supplied_labels:1,omitted_labels:0}},
  packets:[{packet_id:'packet',task:'classify_cards',required_record_ids:['card-0','card-1'],reference_record_ids:[],required_unit_keys:['unit-0','unit-1'],predecessor_packet_ids:[]}],
  total_packets:1,packet_jobs:[{packet_id:'packet',state:null}],events:[{event_id:1,kind:'previewed',body:{}}],next_event_id:null};
 let coverage={progress:'planned',record_coverage:{selected_records:2,pending_records:2},records:[{record_key:'card-0',state:'pending',processed_basis_keys:[],unprocessed_basis_keys:['basis']}],total_records:2,next_record_offset:null,
  comparison_coverage:{selected_unit_keys:['label'],completed_scope_keys:[],pending_scope_keys:['comparison'],omitted_unit_keys:[]}};
 if(restore)workspace.latest_analysis_plan={plan_id:'plan',version:1};
 const api=async(path,body)=>{
  calls.push({path,body});if(denied)throw Object.assign(new Error('forbidden'),{status:403});
  if(delayReads && !body)return delayReads;
  if(path.endsWith('/anteprima') || path.endsWith('/modifica')){if(failPreview)throw new Error('network');const old=plan;history.set(old.plan_id,old);plan={...old,plan_id:path.endsWith('/modifica')?'amended-'+(++sequence):old.plan_id,selection:body.item_ids.map(id=>({record_key:id,item_version:'version-'+id}))};return plan;}
  if(path.endsWith('/avvia')){if(failStart){failStart=false;throw new Error('network');}plan={...plan,events:[...plan.events,{kind:'started',body:{}}],packet_jobs:[{packet_id:'packet',state:'queued'}]};coverage={...coverage,progress:'running'};return plan;}
  if(path.includes('/pacchetti/'))return{packet_id:'paid-retry'};
  if(path.includes('/risultati?'))return{results:[],next_offset:null};
  if(path.includes('/eventi?'))return{events:[{event_id:101,kind:'completed',body:{}}],next_event_id:null};
  if(path.includes('/copertura?'))return coverage;
  if(!body){const id=path.match(/\/piani\/([^/?]+)/)?.[1];return id && id!==plan.plan_id?history.get(id):plan;}
  throw new Error(path);
 };
 const controller=createPlans({context:{references:{}},workspace:()=>workspace,draft:()=>draft,canEdit:()=>workspace.permission==='owner',inputDirty:()=>inputDirty,
  flush:async()=>{if(delayFlush)await delayFlush;if(flushAllowed)draft.dirty=false;return flushAllowed;},api,error:error=>errors.push(error),openCard:async()=>{}});
 env.get('plan-max-requests').value='8';env.get('plan-max-followups').value='3';env.get('plan-max-cost').value='1';
 controller.load(workspace);
 const checks=workspace.items.map(item=>controller.selectionControl(item));
 return{env,controller,calls,timers,errors,draft,checks,get workspace(){return workspace;},set workspace(value){workspace=value;},get plan(){return plan;},set plan(value){plan=value;},get coverage(){return coverage;},set coverage(value){coverage=value;},
  set inputDirty(value){inputDirty=value;},set denied(value){denied=value;},set failStart(value){failStart=value;},set failPreview(value){failPreview=value;},set flushAllowed(value){flushAllowed=value;},set delayFlush(value){delayFlush=value;},set delayReads(value){delayReads=value;}};
}
(async()=>{
 const f=await fixture();await flush();assert.equal(f.calls.length,0,'opening a preparation starts no plan or analysis');
 for(const check of f.checks){check.checked=true;check.dispatch('change',{});}
 f.inputDirty=true;f.controller.sourceChanged();f.env.get('plan-preview').click();await flush();assert.equal(f.calls.length,0,'unsaved source barrier retains the local material');
 f.inputDirty=false;f.draft.dirty=true;f.flushAllowed=false;f.env.get('plan-preview').click();await flush();assert.equal(f.calls.length,0,'conflicting card is not silently excluded');
 f.flushAllowed=true;f.env.get('plan-preview').click();await flush();
 const preview=f.calls.find(call=>call.path.endsWith('/anteprima'));assert.equal(preview.body.item_ids.length,2);assert.equal(preview.body.configuration_version,null);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/avvia')).length,0,'preview never starts work');
 assert.match(textOf(f.env.get('plan-summary')),/fixture-only/);assert.match(textOf(f.env.get('plan-summary')),/Costo massimo/);
 f.env.get('plan-max-cost').value='0.5';f.env.get('plan-max-cost').dispatch('input',{});assert.equal(f.env.get('plan-start').disabled,true);
 f.env.get('plan-start').click();await flush();assert.equal(f.calls.some(call=>call.path.endsWith('/avvia')),false,'changed limits require a new reviewed preview');
 f.env.get('plan-max-cost').value='1';f.env.get('plan-max-cost').dispatch('input',{});
 f.plan={...f.plan,ceiling_micro_usd:1};await f.controller.refresh();assert.match(textOf(f.env.get('plan-summary')),/0,000001/,'integer microUSD ceiling never rounds down to zero');
 f.plan={...f.plan,catalog_coverage:{supplied_terms:3,complete:false}};await f.controller.refresh();assert.match(textOf(f.env.get('plan-summary')),/Catalogo EGI parziale: 3 termini forniti; il totale e il numero di omissioni non sono determinati/);
 f.failStart=true;f.env.get('plan-start').click();await flush();const firstStart=f.calls.find(call=>call.path.endsWith('/avvia'));
 assert.equal(f.timers.size,0,'uncertain HTTP action is not retried automatically');
 f.env.get('plan-start').click();await flush();const starts=f.calls.filter(call=>call.path.endsWith('/avvia'));
 assert.equal(starts.length,2);assert.equal(starts[1].body.request_key,firstStart.body.request_key,'explicit network retry reuses exact request key');
 assert.equal(f.timers.size,1,'only active work polls');
 const originalDraft=f.draft;f.draft.dirty=true;f.draft.payload.service.description='Unsent local edit';
 f.coverage={...f.coverage,progress:'finished_with_gaps',record_coverage:{selected_records:2,validated_records:1,insufficient_context_records:1},records:[{record_key:'card-0',state:'partial',processed_basis_keys:['one'],unprocessed_basis_keys:['two']} ]};
 f.plan={...f.plan,packet_jobs:[{packet_id:'packet',state:'succeeded'}]};
 const poll=[...f.timers.values()][0];f.timers.clear();await poll();await flush();
 assert.equal(f.draft,originalDraft);assert.equal(f.draft.payload.service.description,'Unsent local edit','progress preserves the single unsaved draft');
 assert.match(textOf(f.env.get('plan-coverage')),/1 analisi disponibili.*1 astensioni/);assert.match(textOf(f.env.get('plan-coverage')),/1 ancora da confrontare/);
 f.coverage={...f.coverage,comparison_coverage:{...f.coverage.comparison_coverage,limitations:['insufficient_context','incomplete_units','unsampled_occurrences']},records:[{...f.coverage.records[0],reason:'budget_exceeded'}]};await f.controller.refresh();assert.match(textOf(f.env.get('plan-coverage')),/Alcuni confronti si sono astenuti/);assert.match(textOf(f.env.get('plan-coverage')),/non vale per quelle non esaminate/);assert.match(textOf(f.env.get('plan-records')),/Budget disponibile insufficiente/);
 assert.match(textOf(f.env.get('plan-records')),/1 ancora da verificare/);assert.equal(f.calls.some(call=>call.path.includes('/proposte')),false,'coverage never materializes a proposal');
 await f.controller.recordResults('card-0',50);assert.match(f.calls.at(-1).path,/offset=50&limit=50/);assert.equal(f.calls.some(call=>call.path.includes('/lavori/')),false,'no unbounded job read');
 f.plan={...f.plan,total_packets:51,next_event_id:100};await f.controller.refresh();f.env.get('plan-packet-next').click();await flush();assert.ok(f.calls.some(call=>/piani\/plan\?version=1&offset=50&limit=50/.test(call.path)));
 f.env.get('plan-events-more').click();await flush();assert.ok(f.calls.some(call=>/eventi\?version=1&after=100&limit=50/.test(call.path)));
 f.denied=true;await f.controller.refresh();assert.equal(f.timers.size,0);assert.equal(f.env.get('plan-continue').disabled,true);assert.equal(f.draft.payload.service.description,'Unsent local edit');
 const uncertain=await fixture(2,true);await flush();uncertain.plan={...uncertain.plan,packet_jobs:[{packet_id:'packet',state:'uncertain'}]};uncertain.coverage={...uncertain.coverage,progress:'waiting_retry'};await uncertain.controller.refresh();
 const row=uncertain.env.get('plan-packets').children[0],ack=row.children.find(child=>child.children[0]?.type==='checkbox').children[0],paid=row.children.find(child=>child.textContent==='Nuovo tentativo a pagamento');
 assert.equal(paid.disabled,true);assert.match(textOf(row),/vecchia riserva resta impegnata/);assert.equal(uncertain.calls.some(call=>call.path.includes('/pacchetti/')),false,'uncertainty never starts an automatic repair');
 ack.checked=true;ack.dispatch('change',{});assert.equal(paid.disabled,false);paid.click();await flush();assert.equal(uncertain.calls.filter(call=>call.path.includes('/pacchetti/')).length,1,'paid retry requires a fresh visible acknowledgment and explicit action');
 uncertain.controller.dispose();
 const restored=await fixture(2,true);await flush();assert.equal(restored.controller.selectedItems().length,2);assert.equal(restored.calls.some(call=>call.body),false,'reload restores durable plan with reads only');
 const amended=await fixture(2,true);await flush();const oldIdentity=amended.controller.current().plan.plan_id;
 amended.checks[0].checked=false;amended.checks[0].dispatch('change',{});amended.env.get('plan-amend').click();await flush();
 const amendment=amended.calls.find(call=>call.path.endsWith('/modifica'));assert.equal(amendment.body.version,1);assert.equal(amendment.body.item_ids.length,1);assert.notEqual(amended.controller.current().plan.plan_id,oldIdentity);assert.equal(amended.calls.some(call=>call.path.endsWith('/avvia')),false,'amendment is a new preview, not a hidden start');
 const find=(root,text)=>root.type==='button' && root.textContent===text?root:root.children.map(child=>find(child,text)).find(Boolean);
 amended.draft.dirty=true;amended.draft.payload.service.description='Keep while inspecting history';find(amended.env.get('plan-summary'),'Mostra il piano precedente').click();await flush();assert.equal(amended.controller.current().plan.plan_id,oldIdentity);assert.equal(amended.draft.payload.service.description,'Keep while inspecting history');
 find(amended.env.get('plan-summary'),'Torna al piano più recente').click();await flush();assert.notEqual(amended.controller.current().plan.plan_id,oldIdentity);amended.controller.dispose();
 const restoringChoice=await fixture();let releaseRestore;restoringChoice.delayReads=new Promise(resolve=>releaseRestore=resolve);restoringChoice.workspace.latest_analysis_plan={plan_id:'plan',version:1};restoringChoice.controller.load(restoringChoice.workspace);
 const localChoice=restoringChoice.controller.selectionControl(restoringChoice.workspace.items[0]);localChoice.checked=true;localChoice.dispatch('change',{});restoringChoice.delayReads=null;releaseRestore(restoringChoice.plan);await flush();assert.equal(restoringChoice.controller.selectedItems().length,1,'late durable restore must not silently expand a new local selection');restoringChoice.controller.dispose();
 const capped=await fixture(101);for(const check of capped.checks){check.checked=true;check.dispatch('change',{});}assert.equal(capped.controller.selectedItems().length,100);assert.equal(capped.checks[100].checked,false);assert.match(capped.env.get('plan-feedback').textContent,/Nessuna selezione/);assert.equal(capped.calls.length,0);
 const raced=await fixture();raced.checks[0].checked=true;raced.checks[0].dispatch('change',{});let release;raced.delayFlush=new Promise(resolve=>release=resolve);
 raced.env.get('plan-preview').click();raced.workspace={id:'other',permission:'owner',state:'active',current_input_id:'other-input',items:[]};raced.controller.load(raced.workspace);release();await flush();assert.equal(raced.calls.length,0,'late old-workspace save cannot authorize a new-workspace plan');
 const late=await fixture(2,true);await flush();let releaseRead;late.delayReads=new Promise(resolve=>releaseRead=resolve);const oldRefresh=late.controller.refresh();late.workspace={id:'new',permission:'owner',state:'active',items:[]};late.controller.load(late.workspace);releaseRead(late.plan);await oldRefresh;assert.equal(late.controller.current().plan,null,'late old-workspace reads cannot replace the new panel');
 for(const item of [f,restored,capped,raced,late])item.controller.dispose();
 console.log('Workbench plans: explicit preview/start/replay, draft barriers, separate coverage, bounded pages, access loss, reload and workspace generation guards passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
