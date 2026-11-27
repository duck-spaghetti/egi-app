/** Edit selective submitted proposals before creating a separately published draft. */
import {PreparationDraft} from './draft.js';
import {renderFields,node} from './fields.js';
import {decisionFor} from './acceptance.js';
import {renderCard} from './card.js';
import {evidenceMatches} from './evidence.js';
const $=id=>document.getElementById(id), context=JSON.parse($('community-review-context').textContent), text=context.text;
const writable=!context.resolution && !context.closed, proposed=context.snapshot.values;
const payload={schema_version:proposed.schema_version || 1,service:structuredClone(!context.service_id || !writable ? proposed.service : context.baseline),
  location:structuredClone(!context.service_id || !writable ? proposed.location : {kind:'none'}),
  target:proposed.target,field_origins:structuredClone(!context.service_id || !writable ? proposed.field_origins || {} : {}),evidence:context.snapshot.evidence,outcome:'review'};
if(proposed.schema_version===2){
  payload.source_facts=structuredClone(proposed.source_facts);payload.resolutions=structuredClone(proposed.resolutions);
  Object.assign(payload.field_origins,structuredClone(Object.fromEntries(Object.entries(proposed.field_origins || {}).filter(([path])=>path.startsWith('/source_facts/')))));
}
if(context.resolution){payload.service=structuredClone(context.accepted_service);payload.location=structuredClone(context.accepted_location || {kind:'none'});payload.field_origins={};payload.evidence=[];}
if(context.resolution && payload.schema_version===2){payload.source_facts=[];payload.resolutions=[];}
const draft=new PreparationDraft(context.snapshot.item_id,{id:context.snapshot.item_version_id,payload});
let pending;
function summarize(value) {
  if(value===undefined)return text.cleared;
  if(Array.isArray(value))return value.map(summarize).join('\n') || text.not_set;
  if(value && typeof value==='object')return Object.entries(value).filter(([key])=>!['component_id','evidence'].includes(key)).map(([key,child])=>(text.field_labels[key] || key)+': '+summarize(child)).join('; ');
  return String(value);
}
function comparison() {
  if(!$('review-comparison'))return;
  const decision=decisionFor(context,draft.payload,'preview',null),table=node('table',undefined,'desk-table compare');
  for(const operation of decision.service_operations) {
    const key=operation.path.slice(1),row=node('tr'); row.className='changed';
    row.append(node('th',text.field_labels[key] || key),node('td',summarize(context.baseline[key])),node('td',summarize(operation.value)));
    table.append(row);
  }
  $('review-comparison').replaceChildren();
  if(!decision.service_operations.length)$('review-comparison').append(node('p',text.review_no_changes));
  else {const heading=node('p',text.review_baseline+' → '+text.review_after,'hint');$('review-comparison').append(heading,table);}
}
function render() {
  const view={...context,canEditFacts:false,sourceName:context.snapshot.source_metadata.name,text:{...text,input_origin:text.review_current_value},evidenceFilter:evidence=>evidenceMatches(draft.payload,proposed,evidence),onEvidence:(evidence)=>{
    $('review-field-evidence').hidden=false;$('review-field-evidence').replaceChildren(node('strong',text.source_passage),node('blockquote',evidence.quote));
  }};
  ($('review-editor').classList.contains('preparation-fields')?renderFields:renderCard)($('review-editor'),draft,view,writable,comparison);comparison();
}
async function post(path,body) {
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-EGI-Form-Token':$('community-review-token').value},body:JSON.stringify(body)});
  if(!response.ok){const error=new Error();error.status=response.status;throw error;}
  return response.json();
}
function fail(error) {$('review-error').hidden=false;$('review-error').textContent=error.status===409?text.review_stale:text.review_failed;}
if(writable && context.service_id) {
  for(const [key,value] of Object.entries(proposed.service)) {
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
    pending ??= {request_key:crypto.randomUUID(),decision:decisionFor(context,draft.payload,reason,observed?{method,note:$('review-note').value}:null)};
    await post('/moderazione/contributo/'+context.snapshot.contribution_id+'/accetta-community',pending);
    window.location.reload();
  } catch(error) {if(error.status && error.status<500)pending=null;fail(error);}
});
for(const form of document.querySelectorAll('.community-admit-source'))form.addEventListener('submit',async event=>{
  event.preventDefault();
  try {await post('/moderazione/contribuisci/api/fonti/'+form.dataset.source+'/ammetti',{reason:new FormData(form).get('reason')});form.replaceWith(node('p',text.review_admitted_now));}
  catch(error){fail(error);}
});
render();

if($('review-original-editor')){const original=new PreparationDraft(context.snapshot.item_id,{id:context.snapshot.item_version_id,payload:{...structuredClone(proposed),evidence:context.snapshot.evidence}});renderFields($('review-original-editor'),original,context,false,()=>{});}
