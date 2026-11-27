/** Edit selective submitted proposals before creating a separately published draft. */
import {PreparationDraft} from './draft.js';
import {renderFields,node} from './fields.js';
import {decisionFor,createAcceptanceAttempt} from './acceptance.js';
import {renderCard} from './card.js';
import {createReferenceControls} from './references.js';
import {evidenceMatches} from './evidence.js';
import {reviewPayload,selectReviewInterpretation,clearReviewInterpretation} from './interpretations.js';
const $=id=>document.getElementById(id), context=JSON.parse($('community-review-context').textContent), text=context.text;
const writable=!context.resolution && !context.closed, proposed=context.snapshot.values;
const payload=reviewPayload(context),interpretationSelections={};
const draft=new PreparationDraft(context.snapshot.item_id,{id:context.snapshot.item_version_id,payload});
let submission;
const reconciliations={};
const referenceUI=createReferenceControls({text,references:context.references,changed:comparison,fresh:current=>current===draft && !submission?.locked,
  catalog:query=>post('/moderazione/contributo/'+context.snapshot.contribution_id+'/catalogo',{query}),
  suggest:(current,fact,query)=>post('/moderazione/contributo/'+context.snapshot.contribution_id+'/suggerimenti',{fact_id:fact.fact_id,query}),
  requireReconciliation:!!context.service_id,reconciliations});
function summarize(value) {
  if(value===undefined)return text.cleared;
  if(Array.isArray(value))return value.map(summarize).join('\n') || text.not_set;
  if(value && typeof value==='object')return Object.entries(value).filter(([key])=>!['component_id','evidence'].includes(key)).map(([key,child])=>(text.field_labels[key] || key)+': '+summarize(child)).join('; ');
  return String(value);
}
function comparison() {
  if(!$('review-comparison'))return;
  const decision=decisionFor(context,draft.payload,'preview',null,reconciliations,interpretationSelections),table=node('table',undefined,'desk-table compare');
  for(const operation of decision.service_operations) {
    const key=operation.path.slice(1),row=node('tr'); row.className='changed';
    row.append(node('th',text.field_labels[key] || key),node('td',summarize(context.baseline[key])),node('td',summarize(operation.value)));
    table.append(row);
  }
  $('review-comparison').replaceChildren();
  if(!decision.service_operations.length)$('review-comparison').append(node('p',text.review_no_changes));
  else {const heading=node('p',text.review_baseline+' → '+text.review_after,'hint');$('review-comparison').append(heading,table);}
  for(const action of decision.fact_actions || [])if(action.action!=='keep'){
    const fact=payload.source_facts.find(item=>item.fact_id===action.fact_id);
    $('review-comparison').append(node('p',fact.value+' → '+referenceUI.label(action.selected.target)+(action.selected.role?' · '+(text.ref_roles[action.selected.role] || action.selected.role):'')));
  }
}
function render() {
  const view={...context,interpretationReview:true,interpretationSupport:proposed.interpretation_support || [],interpretationSelections,
    selectInterpretation:(record,target,note)=>selectReviewInterpretation(draft.payload,interpretationSelections,record,target,note,context.baseline),
    clearInterpretation:record=>clearReviewInterpretation(draft.payload,interpretationSelections,record.interpretation_id,context.baseline),
    renderResolution:referenceUI.render,rerender:render,referenceLabel:referenceUI.label,canEditFacts:false,sourceName:context.snapshot.source_metadata.name,text:{...text,input_origin:text.review_current_value},evidenceFilter:evidence=>evidenceMatches(draft.payload,proposed,evidence),onEvidence:(evidence)=>{
    $('review-field-evidence').hidden=false;$('review-field-evidence').replaceChildren(node('strong',text.source_passage),node('blockquote',evidence.quote));
  }};
  ($('review-editor').classList.contains('preparation-fields')?renderFields:renderCard)($('review-editor'),draft,view,writable && !submission?.locked,comparison);comparison();
  for(const input of document.querySelectorAll('#community-accept-form input,#community-accept-form textarea,#community-accept-form select,#review-proposal-choices input'))input.disabled=!!submission?.locked;

}
async function post(path,body) {
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-EGI-Form-Token':$('community-review-token').value},body:JSON.stringify(body)});
  if(!response.ok){const error=new Error();error.status=response.status;throw error;}
  return response.json();
}
function fail(error) {$('review-error').hidden=false;$('review-error').textContent=error.status===409?text.review_stale:text.review_failed;}
submission=createAcceptanceAttempt({key:()=>crypto.randomUUID(),
  request:body=>post('/moderazione/contributo/'+context.snapshot.contribution_id+'/accetta-community',body),
  onAccepted:()=>window.location.reload(),onError:fail,onState:state=>{
    render();const control=$('review-accept-button'),status=$('review-pending-status');
    if(control){control.disabled=state.inFlight || state.complete;control.textContent=state.uncertain?text.review_retry_decision:text.review_accept;}
    if(status){status.hidden=!state.locked;status.textContent=state.complete?text.review_accepted:state.uncertain?text.review_uncertain_decision:text.review_sending_decision;}
  }});
if(writable && context.service_id) {
  for(const [key,value] of Object.entries(proposed.service)) {
    if(key==='classifications' && proposed.schema_version>=3)continue;
    const label=node('label',undefined,'desk-inline'),check=node('input');check.type='checkbox';
    label.append(check,node('span',text.review_use_proposal+' '+(text.field_labels[key] || key)+': '+summarize(value)));
    check.addEventListener('change',()=>{
      if(check.checked && Array.isArray(value)) {
        const next=structuredClone(draft.payload.service[key] || []);
        for(const item of value){const index=item?.component_id?next.findIndex(old=>old.component_id===item.component_id):-1;if(index>=0)next[index]=structuredClone(item);else next.push(structuredClone(item));}
        draft.payload.service[key]=next;
      } else if(check.checked)draft.payload.service[key]=structuredClone(value);
      else if(key in context.baseline)draft.payload.service[key]=structuredClone(context.baseline[key]);else delete draft.payload.service[key];
      render();
    });
    $('review-proposal-choices').append(label);
  }
  if(proposed.location.kind!=='none') {
    const label=node('label',undefined,'desk-inline'),check=node('input');check.type='checkbox';label.append(check,node('span',text.review_use_location));
    check.addEventListener('change',()=>{draft.payload.location=structuredClone(check.checked?proposed.location:{kind:'none'});if(check.checked && proposed.location.kind==='new')delete draft.payload.service.place;else if(context.baseline.place)draft.payload.service.place=structuredClone(context.baseline.place);render();});
    $('review-proposal-choices').append(label);
  }
}
for(const [id,fields] of [['review-card',false],['review-fields',true]])$(id).addEventListener('click',()=>{
  $('review-editor').classList.toggle('preparation-fields',fields);
  $('review-card').setAttribute('aria-pressed',String(!fields));$('review-fields').setAttribute('aria-pressed',String(fields));render();
});
$('community-accept-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  try {
    const observed=$('review-observed').checked,method=$('review-method').value,reason=$('review-reason').value.trim();
    if(!reason || observed && !method || !draft.payload.service.delivery_mode){$('review-error').hidden=false;$('review-error').textContent=text.review_invalid;return;}
    if(context.service_id && draft.payload.resolutions?.some(item=>item.state==='confirmed' && !reconciliations[item.fact_id])){$('review-error').hidden=false;$('review-error').textContent=text.ref_reconcile_required;return;}
    await submission.send(()=>decisionFor(context,draft.payload,reason,observed?{method,note:$('review-note').value}:null,reconciliations,interpretationSelections));
  } catch(error) {fail(error);}
});
for(const form of document.querySelectorAll('.community-admit-source'))form.addEventListener('submit',async event=>{
  event.preventDefault();
  try {await post('/moderazione/contribuisci/api/fonti/'+form.dataset.source+'/ammetti',{reason:new FormData(form).get('reason')});form.replaceWith(node('p',text.review_admitted_now));}
  catch(error){fail(error);}
});
referenceUI.loadNames(draft).then(render).catch(fail);

if($('review-original-editor')){const original=new PreparationDraft(context.snapshot.item_id,{id:context.snapshot.item_version_id,payload:{...structuredClone(proposed),evidence:context.snapshot.evidence}});renderFields($('review-original-editor'),original,{...context,interpretationSupport:proposed.interpretation_support || []},false,()=>{});}

for(const form of document.querySelectorAll('.community-publish-organization'))form.addEventListener('submit',async event=>{
  event.preventDefault();const control=form.querySelector('button');control.disabled=true;
  try{await post('/moderazione/contributo/'+context.snapshot.contribution_id+'/enti/'+form.dataset.organization+'/pubblica',{
    expected_work:form.dataset.working,expected_public:form.dataset.public || null,reason:new FormData(form).get('reason')});window.location.reload();}
  catch(error){fail(error);}finally{control.disabled=false;}
});
