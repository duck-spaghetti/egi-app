/** Actual v3 draft, normalized-save, explicit review and shared control behavior. */
const assert=require('node:assert/strict');
const {environment}=require('./module_fixture.cjs');
const clone=value=>structuredClone(value),json=value=>JSON.parse(JSON.stringify(value));
const target={kind:'classification',adoption_id:'adoption',release_id:'release',term_id:'term',axis_id:'axis'};
function version(){
 const basis={item_version:'basis-version',field_path:'/service/description',value_digest:'digest',evidence_ids:['proof']};
 return {id:'v1',payload:{schema_version:3,service:{name:'Original',description:'C.F. Example',delivery_mode:'in_person'},location:{kind:'none'},target:{kind:'new'},outcome:'review',field_origins:{},
  source_facts:[{fact_id:'fact1',kind:'category_label',subject:'service',source_value:'Original label',value:'Original label'}],resolutions:[{fact_id:'fact1',state:'unresolved',context:{},candidates:[]}],
  evidence:[{id:'proof',path:'/service/description',input_id:'input',input_hash:'hash',kind:'stated',span:{start:0,end:4},quote:'C.F.'},
   {id:'literal',path:'/source_facts/0/source_value',input_id:'input',input_hash:'hash',kind:'stated',span:{start:5,end:19},quote:'Original label'}],
  interpreted_classifications:[{interpretation_id:'i1',basis:clone(basis),context:{territory_id:'territory',axis_id:'axis',catalog_digest:'catalog',as_of:'2026-11-27'},candidates:[{target:clone(target),reason:'Interpretation, to confirm',support_evidence_ids:['proof']}],state:'proposed',selected:null,method:'ai',job_id:'job'}],
  interpretation_hypotheses:[{hypothesis_id:'h1',kind:'abbreviation_expansion',statement:'Possible expansion, to verify',state:'unverified',basis:clone(basis),trigger_evidence_ids:['proof'],job_id:'job',verification:null}]}};
}
function dom(){
 function node(tag,text){return {tag,textContent:text || '',value:'',dataset:{},children:[],listeners:{},append(...items){this.children.push(...items);},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;}};}
 function button(text,action,disabled=false){return {...node('button',text),disabled,click(){if(!this.disabled)action();}};}
 const all=root=>[root,...root.children.flatMap(all)];return {node,button,all};
}
(async()=>{
 const {load}=environment({crypto:{randomUUID:(()=>{let n=0;return ()=> 'generated-'+(++n);})()}});
 const {PreparationDraft}=await load('features/preparations/draft.js');
 const {reviewPayload,selectReviewInterpretation,clearReviewInterpretation,interpretationEvidence,createInterpretationControls,interpretationText}=await load('features/preparations/interpretations.js');
 const {decisionFor}=await load('features/preparations/acceptance.js');
 const initial=version(),draft=new PreparationDraft('item',initial);
 draft.addSourceFact({fact:{fact_id:'fact2',kind:'category_label',subject:'service',source_value:'Second',value:'Second'},evidence:{id:'second',path:'/source_facts/0/source_value'},field_origins:{}});
 assert.equal(draft.payload.schema_version,3);assert.equal(draft.payload.interpretation_hypotheses.length,1);
 const local=new PreparationDraft('item',initial),remote=version();
 remote.id='v2';remote.payload.interpreted_classifications.unshift({...clone(remote.payload.interpreted_classifications[0]),interpretation_id:'i2'});
 remote.payload.interpretation_hypotheses.unshift({...clone(remote.payload.interpretation_hypotheses[0]),hypothesis_id:'h2'});
 local.rejectInterpretation('i1');local.rejectHypothesis('h1');
 assert.equal(local.rebase(remote).length,0);
 assert.equal(local.payload.interpreted_classifications.find(record=>record.interpretation_id==='i1').state,'rejected');
 assert.equal(local.payload.interpreted_classifications.find(record=>record.interpretation_id==='i2').state,'proposed');
 assert.equal(local.payload.interpretation_hypotheses.find(record=>record.hypothesis_id==='h2').state,'unverified');
 const deleting=new PreparationDraft('item',initial);deleting.payload.interpreted_classifications=[];
 const changed=version();changed.id='changed';changed.payload.interpreted_classifications[0].candidates[0].reason='Another reviewed interpretation';
 assert.equal(deleting.rebase(changed)[0].path,'/interpreted_classifications/i1');
 assert.equal(deleting.payload.interpreted_classifications.length,0,'unresolved conflict changes no local state');
 deleting.rebase(changed,{'/interpreted_classifications/i1':'local'});assert.equal(deleting.payload.interpreted_classifications.length,0);
 const remoteDelete=new PreparationDraft('item',initial);remoteDelete.rejectHypothesis('h1');
 const deleted=version();deleted.id='deleted';deleted.payload.interpretation_hypotheses=[];
 assert.equal(remoteDelete.rebase(deleted)[0].missing,true);remoteDelete.rebase(deleted,{'/interpretation_hypotheses/h1':'remote'});assert.equal(remoteDelete.payload.interpretation_hypotheses.length,0);
 const pending=new PreparationDraft('item',initial);pending.chooseInterpretation('i1',target,'client-actor');pending.attempt('save');pending.edit('/service/name','Typed while saving');
 const normalized={id:'server-v2',payload:clone(pending.pending.payload)};
 normalized.payload.interpreted_classifications[0].selected.actor_id='server-actor';normalized.payload.interpreted_classifications[0].selected.confirmed_at='server-time';
 normalized.payload.service.classifications=[{adoption_id:'adoption',term_id:'term'}];
 assert.equal(pending.reconcileSaved(normalized).length,0);assert.equal(pending.version,'server-v2');assert.equal(pending.pending,null);assert.equal(pending.dirty,true);
 assert.equal(pending.payload.service.name,'Typed while saving');assert.equal(pending.payload.interpreted_classifications[0].selected.actor_id,'server-actor');
 assert.equal(pending.base.service.name,'Original');
 const staleSave=new PreparationDraft('item',initial);staleSave.chooseInterpretation('i1',target,'actor');staleSave.attempt('save');staleSave.edit('/service/description','A corrected description');
 const normalizedStale={id:'s2',payload:clone(staleSave.pending.payload)};normalizedStale.payload.interpreted_classifications[0].selected.confirmed_at='authoritative-time';
 assert.equal(staleSave.reconcileSaved(normalizedStale).length,0);assert.equal(staleSave.payload.interpreted_classifications[0].state,'stale');assert.equal(staleSave.payload.interpreted_classifications[0].selected,null);
 const clean=new PreparationDraft('item',initial);clean.attempt('save');assert.equal(clean.reconcileSaved({id:'v2',payload:clone(initial.payload)}).length,0);assert.equal(clean.dirty,false);
 const atomic=new PreparationDraft('item',initial);atomic.attempt('save');atomic.payload.service.classifications=[{adoption_id:'mine',term_id:'mine'}];
 const otherClassification={id:'conflicting-save',payload:clone(initial.payload)};otherClassification.payload.service.classifications=[{adoption_id:'theirs',term_id:'theirs'}];
 assert.equal(atomic.reconcileSaved(otherClassification)[0].path,'/service/classifications');assert.ok(atomic.pending);assert.equal(atomic.version,'v1');
 atomic.reconcileSaved(otherClassification,{'/service/classifications':'local'});assert.equal(atomic.payload.service.classifications[0].term_id,'mine');assert.equal(atomic.base.service.classifications[0].term_id,'theirs');
 const reorderedFacts=new PreparationDraft('item',initial);reorderedFacts.addSourceFact({fact:{fact_id:'fact2',kind:'category_label',subject:'service',source_value:'Other',value:'Other'},evidence:{id:'fact2-proof',path:'/source_facts/0/source_value'},field_origins:{}});
 reorderedFacts.base=clone(reorderedFacts.payload);reorderedFacts.edit('/source_facts/0/value','My corrected label');
 const reorderedRemote={id:'reordered',payload:clone(reorderedFacts.base)};reorderedRemote.payload.source_facts.reverse();reorderedRemote.payload.evidence.find(item=>item.id==='literal').path='/source_facts/1/source_value';reorderedRemote.payload.evidence.find(item=>item.id==='fact2-proof').path='/source_facts/0/source_value';
 assert.equal(reorderedFacts.rebase(reorderedRemote).length,0);assert.equal(reorderedFacts.payload.source_facts[1].value,'My corrected label');assert.equal(reorderedFacts.payload.evidence.find(item=>item.id==='literal').path,'/source_facts/1/source_value');assert.equal(reorderedFacts.payload.field_origins['/source_facts/1/value'].state,'manual');
 const compensation=new PreparationDraft('item',initial),old=version();old.id='old';old.payload.schema_version=1;delete old.payload.source_facts;delete old.payload.resolutions;delete old.payload.interpreted_classifications;delete old.payload.interpretation_hypotheses;
 compensation.rebase(old);assert.equal(compensation.payload.schema_version,3);assert.equal(compensation.payload.interpreted_classifications.length,0);
 const verification=new PreparationDraft('item',initial),manual={id:'independent',path:'/service/description',input_id:'input',input_hash:'hash',kind:'manual',note:'Called the responsible office and verified the expansion independently.'};
 assert.throws(()=>verification.verifyHypothesis('h1',{...manual,id:'proof'},'actor','decision'));
 assert.throws(()=>verification.verifyHypothesis('h1',{...manual,quote:'C.F.',span:{start:0,end:4}},'actor','decision'));
 verification.verifyHypothesis('h1',manual,'actor','decision');assert.equal(verification.payload.interpretation_hypotheses[0].state,'verified');
 assert.equal(verification.payload.interpreted_classifications[0].state,'proposed');assert.equal(verification.payload.service.classifications,undefined);
 const snapshot=version().payload;snapshot.interpreted_classifications[0].state='confirmed';snapshot.interpreted_classifications[0].selected={target:clone(target),actor_id:'author',confirmed_at:'then'};
 snapshot.service.classifications=[{adoption_id:'adoption',term_id:'term'}];snapshot.interpretation_support=[{basis:clone(snapshot.interpreted_classifications[0].basis),evidence:[clone(snapshot.evidence[0])],context_support:[{quote:'A school network',origin:'source_metadata'}]}];
 const context={baseline:{name:'Existing',classifications:[{adoption_id:'baseline',term_id:'retained'}]},service_id:'service',working:'work',public:'public',snapshot:{item_id:'item',values:snapshot,evidence:snapshot.evidence}};
 const review=reviewPayload(context),selections={};assert.equal(review.schema_version,3);assert.equal(review.source_facts.length,1);assert.equal(review.interpretation_hypotheses.length,1);assert.equal(review.interpretation_support,undefined);
 assert.equal(review.service.classifications.length,1,'author/model categories never autoaccept into baseline');
 selectReviewInterpretation(review,selections,snapshot.interpreted_classifications[0],target,'Human explanation after checking original context.',context.baseline);
 let decision=decisionFor(context,review,'Explicit selective decision',null,{},selections);
 assert.equal(decision.schema_version,2);assert.equal(decision.fact_actions.length,1);assert.equal(decision.interpreted_classifications,undefined);assert.equal(decision.interpretation_support,undefined);
 assert.equal(decision.observations[0].method,'other');assert.equal(decision.observations[0].paths[0],'/service/classifications');
 assert.equal(decision.service_operations.find(operation=>operation.path==='/classifications').evidence_ids.length,0,'description trigger quote is never direct classification proof');
 assert.throws(()=>decisionFor(context,review,'No invented provenance',null,{}, {forged:{target,note:'Fake'}}));
 clearReviewInterpretation(review,selections,'i1',context.baseline);assert.equal(review.service.classifications.length,1);assert.equal(review.service.classifications[0].term_id,'retained');
 const newReview=reviewPayload({...context,service_id:null});assert.equal(newReview.service.classifications.length,0,'new-service author-confirmed model classifications need fresh explicit moderator choice');
 const quotes=interpretationEvidence(snapshot.interpreted_classifications[0],{evidence:[]},snapshot.interpretation_support);assert.equal(quotes.evidence[0].quote,'C.F.');assert.equal(quotes.context[0].origin,'source_metadata');
 snapshot.interpretation_support[0].basis=Object.fromEntries(Object.entries(snapshot.interpretation_support[0].basis).reverse());assert.equal(interpretationEvidence(snapshot.interpreted_classifications[0],{evidence:[]},snapshot.interpretation_support).evidence.length,1,'server object key order does not hide historical snapshot support');
 const elements=dom(),root=elements.node('root'),uiDraft=new PreparationDraft('item',initial),controls=createInterpretationControls(elements);
 let renders=0;const view={actor_id:'actor',text:{},references:{classifications:[{adoption_id:'adoption',term_id:'term',name:'Named category'}]}};
 controls.render(root,uiDraft,view,true,()=>{},()=>renders++);
 assert.ok(elements.all(root).some(element=>element.textContent===interpretationText.aiProposed));assert.ok(elements.all(root).some(element=>element.textContent===interpretationText.aiUnverified),'real closed hypotheses use job provenance, never a nonexistent method field');assert.equal(elements.all(root).some(element=>element.textContent===interpretationText.manualOrigin),false);
 const buttons=elements.all(root).filter(element=>element.tag==='button');assert.equal(buttons.some(button=>button.textContent===interpretationText.confirm),true);
 buttons.find(button=>button.textContent===interpretationText.confirm).click();assert.equal(uiDraft.payload.interpreted_classifications[0].state,'confirmed');assert.equal(uiDraft.payload.interpretation_hypotheses[0].state,'unverified');
 const verify=buttons.find(button=>button.textContent===interpretationText.verify);verify.click();assert.equal(uiDraft.payload.interpretation_hypotheses[0].state,'unverified','blank verification cannot be passively accepted');
 const note=elements.all(root).filter(element=>element.tag==='textarea').at(-1);note.value='Verified by phone with the named office.';verify.click();assert.equal(uiDraft.payload.interpretation_hypotheses[0].state,'verified');assert.equal(uiDraft.payload.evidence.at(-1).kind,'manual');assert.equal(uiDraft.payload.evidence.at(-1).quote,undefined);
 assert.ok(renders>=2);
 const moderatorRoot=elements.node('root'),moderatorDraft=new PreparationDraft('item',{id:'snapshot',payload:reviewPayload(context)}),moderatorSelections={};
 controls.render(moderatorRoot,moderatorDraft,{...view,interpretationReview:true,interpretationSelections:moderatorSelections,selectInterpretation:(record,target,note)=>selectReviewInterpretation(moderatorDraft.payload,moderatorSelections,record,target,note,context.baseline)},true,()=>{},()=>{});
 const moderate=elements.all(moderatorRoot).find(element=>element.tag==='button' && element.textContent===interpretationText.confirm);
 moderate.click();assert.equal(Object.keys(moderatorSelections).length,0,'moderator cannot accept a model category without an independent human interpretation note');
 const moderatorNote=elements.all(moderatorRoot).find(element=>element.tag==='textarea');moderatorNote.value='I checked the original context and interpret this as the proposed category.';moderate.click();assert.equal(Object.keys(moderatorSelections).length,1);
 console.log('Preparation v3: stable identities/deletions, normalized save stamps/concurrent edits, separate verification and explicit snapshot moderation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
