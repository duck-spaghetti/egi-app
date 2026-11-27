/** Actual retained-result UI: explicit choices, provenance, replay and bounded scope. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const flush=async()=>{for(let n=0;n<50;n++)await Promise.resolve();};
const all=root=>[root,...root.children.flatMap(all)];
const text=root=>all(root).map(node=>node.textContent || '').join(' ');
const find=(root,label)=>all(root).find(node=>node.type==='button' && node.textContent===label);
const checkbox=(root,label)=>all(root).find(node=>node.children[0]?.type==='checkbox' && node.children[1]?.textContent===label)?.children[0];
const rawKey='proposal /opaque?one:two',groupKey='group /opaque?left:right';
async function fixture(){
 let sequence=0;const env=environment({crypto:{randomUUID:()=>`key-${++sequence}`}}),root=env.document.createElement('section');
 const {createProposals}=await env.load('features/preparations/proposals.js');
 const draft={item:'card',version:'v1',dirty:false,payload:{service:{description:'Keep local'}}},workspace={id:'workspace',state:'active',permission:'owner',items:[]};
 const calls=[],refreshes=[],groups=[],errors=[];let flushes=0,inputDirty=false,flushAllowed=true,writeFailure=false,readFailure=false,waitRead=null,waitWrite=null;
 let materializations=[];
 const target={kind:'classification',adoption_id:'secret-adoption',term_id:'secret-term'},source={support_key:'source',record_key:'card',origin:'source',quote:'C04 presso la sede',text:'C04 presso la sede'},metadata={support_key:'metadata',record_key:'card',origin:'source_metadata',quote:'Rete pubblica',text:'Rete pubblica'};
 const dto=task=>({task,job_id:task==='group_labels'?'group-job':'job-1',packet_id:'packet',plan_id:'plan',plan_version:1,item_id:task==='group_labels'?null:'card',
  proposals:task==='group_labels'?[{proposal_key:groupKey,relation:'related',unit_keys:['label-a','label-b'],membership_issues:[{unit_key:'label-a',reason:'unsampled_occurrences'}],choices:[{candidate_key:'candidate',reason:'Contesti correlati',support_keys:['source']}],reason:'Correlazione, non equivalenza',support_keys:['source']}]:[
   {proposal_key:rawKey,basis_key:'basis',state:'proposed',choices:[{candidate_key:'candidate',reason:'Dalla descrizione, da verificare',support_keys:['source','metadata']}],missing_context:[]},
   {proposal_key:'no-match',basis_key:'basis',state:'no_supplied_match',choices:[],missing_context:[]},{proposal_key:'insufficient',basis_key:'basis',state:'insufficient_context',choices:[],missing_context:['incomplete_catalog']}],
  total_proposals:task==='group_labels'?1:3,next_offset:50,hypotheses:task==='group_labels'?[]:[{hypothesis_key:'hypothesis /opaque',statement:'C04 potrebbe essere una sigla',status:'unverified',trigger_support_keys:['source']}],total_hypotheses:task==='group_labels'?0:1,next_hypothesis_offset:null,
  catalog_choices:[{candidate_key:'candidate',label:'Assistenza sanitaria',target}],context:{scope:{territory_id:'territory',axis_id:'axis'},catalog_snapshot:{digest:'catalog-digest'},as_of:'2026-11-27'},records:[{record_key:'card',item_version:'v1'}],bases:[{basis_key:'basis',record_key:'card',kind:'description',value:'C04',support_keys:['source']}],supports:[source,metadata],support_total:101,supports_complete:false,materializations});
 const api=async(path,body)=>{
  calls.push({path,body});if(readFailure && !path.includes('/schede/'))throw Object.assign(new Error('forbidden'),{status:403});
  if(path.includes('/schede/')){
   if(writeFailure){writeFailure=false;throw new Error('network');}if(waitWrite)await waitWrite;
   const hypothesis=path.endsWith('/ipotesi'),keys=body[hypothesis?'hypothesis_keys':'proposal_keys'];materializations.push(...keys.map(local_key=>({local_key,id:'stable-private-id',kind:hypothesis?'hypothesis':'classification',state:hypothesis?'unverified':'proposed'})));
   return{operation_id:'operation',items:[{item_id:'card',before:body.expected_version,after:'server-version'}]};
  }
  if(path.includes('/piani/')){const offset=Number(new URL('http://local'+path).searchParams.get('offset'));return{total_packets:51,packets:offset===0?Array.from({length:50},(_,i)=>({packet_id:'class-'+i,task:'classify_cards'})):[{packet_id:'packet',task:'group_labels'}],packet_jobs:[{packet_id:'packet',job_id:'group-job',state:'failed'}]};}
  if(path.endsWith('/elementi')){
   const members=Array.from({length:101},(_,i)=>({item_id:'member-'+i,expected_version:'frozen-'+i,basis_kind:i%2?'interpreted_classification':'source_fact',basis_id:'basis-'+i})).slice(body.offset,body.offset+body.limit);
   return{members,total_members:101,next_offset:body.offset+members.length<101?body.offset+members.length:null,unresolved_occurrences:1,details:members.map(member=>({member,name:'Servizio '+member.item_id,label:'Mensa',origin:member.basis_kind,original:{value:'Mensa'}}))};
  }
  if(path.endsWith('/passaggi')){const supports=Array.from({length:101},(_,i)=>({...source,support_key:'support-'+i,origin:i%10?'source':'source_metadata',quote:'Passaggio '+i})).slice(body.offset,body.offset+body.limit);return{supports,total_supports:101,next_offset:body.offset+supports.length<101?body.offset+supports.length:null};}
  if(waitRead)return waitRead;
  return dto(path.includes('/group-job/')?'group_labels':'classify_cards');
 };
 const controller=createProposals({root,context:{},api,workspace:()=>workspace,draft:()=>draft,canEdit:()=>workspace.permission==='owner',inputDirty:()=>inputDirty,flush:async()=>{flushes++;if(flushAllowed)draft.dirty=false;return flushAllowed;},
  recordResults:async(item,offset)=>{calls.push({path:'record-results',item,offset});return{results:[{job_id:'job-1',state:'analyzed',processed_basis_keys:['basis'],unprocessed_basis_keys:['remaining']}],total_results:2,next_result_offset:offset===0?50:null};},
  planState:()=>({plan:{plan_id:'plan',version:1}}),refreshItem:async(receipt,wid)=>{refreshes.push({receipt,wid,dirty:draft.dirty,local:draft.payload.service.description});if(receipt.items[0]?.item_id===draft.item)draft.version=receipt.items[0].after;},prepareGroup:async value=>{groups.push(value);return true;},error:error=>errors.push(error)});
 controller.render();
 const click=async label=>{const control=find(root,label);assert.ok(control,label);assert.equal(control.disabled,false,label+' enabled');control.click();await flush();};
 const pick=label=>{const control=checkbox(root,label);assert.ok(control,label);assert.equal(control.disabled,false);control.checked=true;control.dispatch('change',{});};
 return{env,root,controller,draft,workspace,calls,refreshes,groups,errors,click,pick,dto,get flushes(){return flushes;},set inputDirty(value){inputDirty=value;},set flushAllowed(value){flushAllowed=value;},set writeFailure(value){writeFailure=value;},set waitRead(value){waitRead=value;},set waitWrite(value){waitWrite=value;},set readFailure(value){readFailure=value;},set materializations(value){materializations=value;}};
}
async function openCard(f){await f.click('Leggi le analisi della scheda');assert.match(text(f.root),/esiti parziali/);await f.click('Analisi 1 · esiti parziali');}
(async()=>{
 const f=await fixture();assert.equal(f.calls.length,0,'render reads/writes no model or proposal automatically');await openCard(f);
 assert.match(text(f.root),/Assistenza sanitaria/);assert.match(text(f.root),/Interpretazione IA — da verificare/);assert.match(text(f.root),/Ipotesi IA non verificata — da confermare/);assert.doesNotMatch(text(f.root),/secret-term|secret-adoption/);assert.match(text(f.root),/Contesto della fonte, non prova/);assert.match(text(f.root),/Nessuna corrispondenza tra i termini forniti/);assert.match(text(f.root),/catalogo fornito è parziale/);
 assert.equal(all(f.root).filter(node=>node.type==='checkbox' && !node.disabled).length,2,'only useful proposal and unverified hypothesis selectable');
 f.pick('Aggiungi questa proposta e le sue alternative, da controllare');f.flushAllowed=false;await f.click('Aggiungi le proposte scelte, da controllare');assert.equal(f.calls.some(call=>call.path.includes('/schede/')),false,'dirty/conflict barrier does not discard or materialize');
 f.flushAllowed=true;f.draft.version='annotation-only-version';f.writeFailure=true;await f.click('Aggiungi le proposte scelte, da controllare');
 const first=f.calls.find(call=>call.path.includes('/schede/'));assert.equal(first.body.expected_version,'annotation-only-version','retained unchanged source is not blanket-rejected for later annotation');assert.equal(first.body.proposal_keys[0],rawKey);assert.equal(f.calls.filter(call=>call.path.includes('/schede/')).length,1,'unknown write never auto-retries');
 const flushCount=f.flushes;f.draft.dirty=true;f.draft.payload.service.description='Later unsaved annotation';await f.click('Ripeti la richiesta conservata');
 const writes=f.calls.filter(call=>call.path.includes('/schede/'));assert.equal(JSON.stringify(writes[0].body),JSON.stringify(writes[1].body));assert.equal(f.flushes,flushCount,'explicit uncertain replay preserves original exact body instead of flushing a new head');assert.equal(f.refreshes[0].local,'Later unsaved annotation');assert.match(text(f.root),/Già aggiunta, da controllare/);
 assert.equal(checkbox(f.root,'Aggiungi questa proposta e le sue alternative, da controllare').disabled,true,'known materialized outcome cannot accidentally reset review');
 f.pick('Conserva questa ipotesi come non verificata');await f.click('Aggiungi le ipotesi come non verificate');assert.equal(f.calls.filter(call=>call.path.endsWith('/ipotesi')).length,1);assert.match(text(f.root),/Ipotesi già aggiunta come non verificata/);
 assert.equal(f.calls.some(call=>call.path.includes(rawKey) || call.path.includes(encodeURIComponent(rawKey))),false,'arbitrary result-local keys never enter URLs');
 await f.click('Altri esiti della scheda');assert.ok(f.calls.some(call=>call.path==='record-results' && call.offset===50));
 f.materializations=[{local_key:rawKey,kind:'classification',state:'confirmed'},{local_key:'hypothesis /opaque',kind:'hypothesis',state:'verified'}];await f.click('Analisi 1 · esiti parziali');assert.match(text(f.root),/Già confermata/);assert.match(text(f.root),/Ipotesi già verificata/);
 const group=await fixture();await group.click('Leggi i confronti del piano');await group.click('Altre richieste del piano');await group.click('Confronto 1 · esiti da controllare');assert.match(text(group.root),/Categorie correlate: non sono equivalenti/);await group.click('Esamina le schede di questo confronto');
 await group.click('Seleziona i membri di questa pagina');await group.click('Altri membri del confronto');await group.click('Seleziona i membri di questa pagina');await group.click('Altri membri del confronto');await group.click('Seleziona i membri di questa pagina');await group.click('Prepara un gruppo proposto dai membri scelti');
 assert.equal(group.groups[0].members.length,101);assert.equal(group.groups[0].total_members,101);assert.equal(group.groups[0].relation,'related');assert.equal(group.groups[0].proposal_id,'packet:'+groupKey);assert.ok(group.groups[0].members.some(member=>member.basis_kind==='interpreted_classification'));assert.equal(group.calls.some(call=>call.path.includes('/gruppi') || call.path.includes('/applica')),false,'handoff prepares only, never saves/applies');
 await group.click('Leggi contesto e passaggi');await group.click('Altri passaggi e contesto');await group.click('Altri passaggi e contesto');assert.match(text(group.root),/101–101 passaggi mostrati su 101/);assert.ok(group.calls.filter(call=>call.path.endsWith('/passaggi')).every(call=>call.body.proposal_key===groupKey && call.body.limit===50));
 const stale=await fixture();await stale.click('Leggi le analisi della scheda');let release;stale.waitRead=new Promise(resolve=>release=resolve);find(stale.root,'Analisi 1 · esiti parziali').click();stale.draft.item='different-card';stale.controller.cardChanged();release(stale.dto('classify_cards'));await flush();assert.doesNotMatch(text(stale.root),/Assistenza sanitaria/,'late prior-card read discarded');
 for(const item of [f,group,stale])item.controller.dispose();
 console.log('Workbench proposals: scoped partial jobs, original/weak support, explicit proposals and hypotheses, exact uncertain replay, preserved review, 101-member/support paging and stale-card guards passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
