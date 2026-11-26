/** Community workbench: server-backed drafts, two editable views and explicit access. */
import {createAnalysis} from './analysis.js';
import {PreparationDraft} from './draft.js';
import {renderFields, node, button} from './fields.js';
const $ = id => document.getElementById(id);
const context = JSON.parse($('preparation-context').textContent), text = context.text;
const API = '/moderazione/contribuisci/api', token = $('preparation-form-token').value;
let workspace, draft, mode = 'card', timer, saving, remote, historyAfter = 0, lastOperation;
let analysis;
let pendingInput, creation, manualAttempt, inputBase = '', publicBase = false;
const inputDirty = () => !!workspace && ($('source-text').value !== inputBase || $('public-material').checked !== publicBase);
const canEdit = () => workspace?.state === 'active' && ['owner','edit'].includes(workspace?.permission);
const uuid = () => crypto.randomUUID();
function problem(error) {
  $('preparation-error').hidden = false;
  $('preparation-error').textContent = error.status === 409 ? text.conflict : error.status === 403 ? text.forbidden : error.status === 404 ? text.not_found : error.status === 422 ? text.invalid : error.status === 413 ? text.too_large : text.save_failed;
}
function clearProblem() { $('preparation-error').hidden = true; }
async function api(path, body, options = {}) {
  const response = await fetch(API + path, {credentials:'same-origin', ...options,
    ...(body === undefined ? {} : {method:'POST', body:JSON.stringify(body)}),
    headers:{...(body === undefined ? {} : {'Content-Type':'application/json'}), 'X-EGI-Form-Token':token, ...options.headers}});
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.code); error.status = response.status; throw error; }
  return value;
}
function changed() {
  renderEvidence();
  $('save-state').textContent = text.unsaved;
  clearTimeout(timer);
  if (!draft.conflicted) timer = setTimeout(() => save().catch(problem), 650);
}
async function save() {
  clearTimeout(timer);
  if (saving) { await saving; return draft?.dirty ? save() : true; }
  if (!draft || !draft.dirty && !draft.pending) return true;
  if (draft.conflicted) return false;
  $('save-state').textContent = text.saving;
  const current = draft, attempt = current.attempt(uuid());
  saving = api('/preparazioni/'+workspace.id+'/schede', attempt).then(receipt => {
    current.acknowledge(receipt); lastOperation = receipt.operation_id;
    $('undo-card').disabled = !canEdit();
    $('save-state').textContent = current.dirty ? text.unsaved : text.saved;
    $('retry-card').hidden = true;
    return true;
  }).catch(error => {
    if (error.status === 409) { current.conflicted = true; $('compare-card').hidden = false; }
    else if (error.status && error.status < 500) current.pending = null;
    $('retry-card').hidden = error.status === 409;
    $('save-state').textContent = text.unsaved;
    throw error;
  }).finally(() => { saving = null; });
  const result = await saving;
  if (draft === current && current.dirty) changed();
  return result;
}
async function list() {
  const response = await api('/preparazioni?cestino='+$('show-trash').checked);
  $('preparation-list').replaceChildren();
  if (!response.items.length) $('preparation-list').append(node('li',text.empty));
  for (const item of response.items) {
    const li = node('li'); li.append(button(item.title, () => openWorkspace(item.id).catch(problem)));
    $('preparation-list').append(li);
  }
}
async function loadWorkspace() {
  workspace = await api('/preparazioni/'+workspace.id);
  $('workspace-title').textContent = workspace.title;
  $('workspace-source').textContent = context.sources.find(source => source.id === workspace.source_id)?.name || text.source;
  $('workspace-permission').textContent = workspace.permission === 'owner' ? text.owner : text[workspace.permission];
  $('workspace-trash').hidden = workspace.permission !== 'owner' || workspace.state !== 'active';
  $('workspace-restore').hidden = workspace.permission !== 'owner' || workspace.state !== 'trash';
  $('source-text').readOnly = !canEdit(); $('public-material').disabled = !canEdit();
  $('save-input').disabled = !canEdit(); $('manual-card').disabled = !canEdit() || !workspace.current_input_id;
  $('sharing-form').hidden = workspace.permission !== 'owner';
  $('sharing-note').hidden = workspace.permission === 'owner';
  if (!inputDirty()) $('public-material').checked = workspace.input_metadata?.public_attestation === true;
  $('original-link').hidden = !workspace.current_input_id;
  if (workspace.current_input_id) $('original-link').href = API+'/preparazioni/'+workspace.id+'/input/'+workspace.current_input_id;
  $('card-list').replaceChildren(); $('no-cards').hidden = workspace.items.length > 0;
  for (const item of workspace.items) {
    const li = node('li'), control = button((text[item.outcome] || item.outcome)+' · '+text.card+' '+(workspace.items.indexOf(item)+1), () => openCard(item.item_id).catch(problem));
    control.setAttribute('aria-current', String(draft?.item === item.item_id));
    li.append(control); $('card-list').append(li);
  }
  const people = await api('/persone'); $('share-person').replaceChildren();
  for (const person of people.items) if (person.actor_id !== workspace.owner_actor_id) $('share-person').append(new Option(person.display_name,person.actor_id));
  analysis?.load(workspace);
  $('grant-list').replaceChildren();
  for (const grant of workspace.grants || []) $('grant-list').append(node('li',(people.items.find(person => person.actor_id === grant.actor_id)?.display_name || text.person)+' · '+text[grant.permission]));
}
async function openWorkspace(id) {
  if (inputDirty()) { $('preparation-error').hidden=false; $('preparation-error').textContent=text.save_input_first; return; }
  if (draft?.dirty && !await save()) return;
  draft = null; workspace = {id}; lastOperation = null; pendingInput = null; manualAttempt = null;
  inputBase = ''; publicBase = false; $('source-text').value = ''; $('public-material').checked = false;
  await loadWorkspace();
  $('preparation-workspace').hidden = false; $('card-editor').hidden = true;
  $('source-text').value = '';
  if (workspace.current_input_id) {
    const response = await fetch(API+'/preparazioni/'+id+'/input/'+workspace.current_input_id,{credentials:'same-origin'});
    if (!response.ok) throw Object.assign(new Error(),{status:response.status});
    $('source-text').value = await response.text();
  }
  inputBase = $('source-text').value; publicBase = $('public-material').checked; analysis?.load(workspace);
  history.replaceState(null,'','/moderazione/contribuisci?id='+encodeURIComponent(id)); clearProblem();
}
function render() {
  $('card-editor').hidden = false;
  $('editable-fields').classList.toggle('preparation-fields',mode === 'fields');
  $('view-card').setAttribute('aria-pressed',String(mode === 'card'));
  $('view-fields').setAttribute('aria-pressed',String(mode === 'fields'));
  renderFields($('editable-fields'),draft,context,canEdit() && draft.payload.outcome !== 'trashed',changed);
  $('card-outcome').value = draft.payload.outcome;
  $('card-outcome').disabled = !canEdit() || draft.payload.outcome === 'trashed';
  $('save-card').disabled = !canEdit(); $('retry-card').disabled = !canEdit();
  $('trash-card').hidden = draft.payload.outcome === 'trashed'; $('trash-card').disabled = !canEdit();
  $('restore-card').hidden = draft.payload.outcome !== 'trashed'; $('restore-card').disabled = !canEdit();
  $('undo-card').disabled = !canEdit() || !lastOperation;
  renderEvidence();
  analysis?.cardChanged();
}
function renderEvidence() {
  $('card-evidence').replaceChildren();
  if (!draft.payload.evidence.length) $('card-evidence').append(node('p',text.no_evidence));
  for (const evidence of draft.payload.evidence) {
    $('card-evidence').append(node('p',caption(evidence.path), 'hint'),node('blockquote',evidence.quote || evidence.note || text.not_set));
  }
}
function caption(path) { return path.split('/').filter(part=>part && part!=='body').map(part => text.field_labels[part] || text[part] || (/^\d+$/.test(part) ? Number(part)+1 : part)).join(' · '); }
async function openCard(id) {
  if (draft?.dirty && !await save()) return;
  const result = await api('/preparazioni/'+workspace.id+'/schede/'+id);
  draft = new PreparationDraft(id,result.version); historyAfter = 0; remote = null; lastOperation = null;
  $('conflict-panel').hidden = true; $('compare-card').hidden = true; $('retry-card').hidden = true;
  $('card-history').replaceChildren(); $('save-state').textContent = text.saved;
  render(); await cardHistory();
}
async function cardHistory() {
  const result = await api('/preparazioni/'+workspace.id+'/schede/'+draft.item+'/cronologia?after='+historyAfter);
  historyAfter = result.after; $('history-more').hidden = !result.has_more;
  for (const version of result.versions) $('card-history').append(node('li',text.version+' '+version.version_number+' · '+new Date(version.created_at).toLocaleString('it')));
}
$('create-preparation').addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    if (inputDirty()) { $('preparation-error').hidden=false; $('preparation-error').textContent=text.save_input_first; return; }
    if (!creation) { const data = new FormData(form); creation = {title:data.get('title'),source:data.get('source'),name:data.get('source_name'),kind:data.get('source_kind'),sourceKey:uuid(),key:uuid()}; }
    const attempt = creation;
    if (attempt.name) {
      const source = await api('/fonti',{metadata:{name:attempt.name,source_kind:attempt.kind},request_key:attempt.sourceKey});
      attempt.source = source.source_id;
      if (!context.sources.some(item => item.id === attempt.source)) context.sources.push({id:attempt.source,name:attempt.name});
    }
    const result = await api('/preparazioni',{source_id:attempt.source,title:attempt.title,request_key:attempt.key});
    creation = null; form.reset(); await list(); await openWorkspace(result.id);
  } catch(error) { if (error.status && error.status < 500 && error.status !== 409) creation = null; problem(error); }
});
async function persistInput() {
    if (draft?.dirty && !await save()) return;
    pendingInput ??= {text:$('source-text').value,public:$('public-material').checked,expected:workspace.metadata_revision,key:uuid()};
    const attempt = pendingInput;
    await api('/preparazioni/'+workspace.id+'/input',undefined,{method:'POST',body:attempt.text,headers:{'Content-Type':'text/plain; charset=utf-8','X-EGI-Expected-Revision':String(attempt.expected),'X-EGI-Public-Material':String(attempt.public),'X-EGI-Request-Key':attempt.key}});
    inputBase = attempt.text; publicBase = attempt.public; pendingInput = null; await loadWorkspace(); clearProblem();
}
$('input-form').addEventListener('submit',async event => {
  event.preventDefault();
  try {await persistInput();analysis.sourceSaved();}catch(error){if(error.status && error.status<500)pendingInput=null;problem(error);}
});

$('manual-card').addEventListener('click',async () => {
  try { if (draft?.dirty && !await save()) return; manualAttempt ??= {input_id:workspace.current_input_id,job_id:null,selections:[{creation_key:uuid()}],request_key:uuid()}; const result = await api('/preparazioni/'+workspace.id+'/schede/crea',manualAttempt); manualAttempt=null; await loadWorkspace(); await openCard(result.items[0].item_id); } catch(error) {if(error.status && error.status<500) manualAttempt=null;problem(error);}
});
$('sharing-form').addEventListener('submit',async event => {
  event.preventDefault();
  try { await api('/preparazioni/'+workspace.id+'/accessi',{actor_id:$('share-person').value,permission:$('share-permission').value || null,expected_revision:workspace.metadata_revision,request_key:uuid()}); await loadWorkspace(); clearProblem(); } catch(error) {problem(error);}
});
for (const [id,action] of [['workspace-trash','cestina'],['workspace-restore','ripristina']]) $(id).addEventListener('click',async () => {
  try { if (draft?.dirty && !await save()) return; await api('/preparazioni/'+workspace.id+'/'+action,{expected_revision:workspace.metadata_revision,request_key:uuid()}); await loadWorkspace(); if(draft) render(); await list(); } catch(error) {problem(error);}
});
for (const [id,next] of [['view-card','card'],['view-fields','fields']]) $(id).addEventListener('click',() => {mode=next;render();});
for (const id of ['save-card','retry-card']) $(id).addEventListener('click',() => save().then(clearProblem).catch(problem));
$('card-outcome').addEventListener('change',event => {draft.edit('/outcome',event.target.value);changed();});
$('trash-card').addEventListener('click',() => {draft.edit('/outcome','trashed');changed();save().then(render).catch(problem);});
$('restore-card').addEventListener('click',() => {draft.edit('/outcome','review');changed();save().then(render).catch(problem);});
$('history-panel').addEventListener('toggle',() => {if ($('history-panel').open && draft) cardHistory().catch(problem);});
$('history-more').addEventListener('click',() => cardHistory().catch(problem));
$('undo-card').addEventListener('click',async () => {
  try { if (!await save()) return; await api('/preparazioni/'+workspace.id+'/operazioni/'+lastOperation+'/annulla',{request_key:uuid()}); lastOperation=null; await openCard(draft.item); } catch(error) {problem(error);}
});
$('compare-card').addEventListener('click',async () => {
  try {
    const result = await api('/preparazioni/'+workspace.id+'/schede/'+draft.item); remote=result.version;
    const conflicts=draft.rebase(remote); $('conflict-fields').replaceChildren(); $('conflict-panel').hidden=false;
    if (!conflicts.length) { render(); $('conflict-fields').append(node('p',text.server_version)); }
    for (const conflict of conflicts) {
      const group=node('fieldset'); group.dataset.path=conflict.path; group.append(node('legend',caption(conflict.path)));
      for (const choice of ['local','remote']) { const label=node('label'),input=node('input'); input.type='radio'; input.name='conflict'+conflict.path; input.value=choice; label.append(input,node('span',text[choice]+': '+(JSON.stringify(choice==='local'?conflict.value:conflict.remote) ?? text.cleared))); group.append(label); }
      $('conflict-fields').append(group);
    }
  } catch(error) {problem(error);}
});
$('apply-comparison').addEventListener('click',() => {
  const choices={}; for(const group of $('conflict-fields').querySelectorAll('fieldset')) { const selected=group.querySelector('input:checked'); if(selected) choices[group.dataset.path]=selected.value; }
  if(draft.rebase(remote,choices).length) { $('preparation-error').textContent=text.choose_conflicts; $('preparation-error').hidden=false; return; }
  $('conflict-panel').hidden=true; $('compare-card').hidden=true; render(); changed(); clearProblem();
});
$('workspace-refresh').addEventListener('click',()=>loadWorkspace().then(()=>{if(draft)render();clearProblem();}).catch(problem));
$('show-trash').addEventListener('change',() => list().catch(problem));
window.addEventListener('beforeunload',event => {if(draft?.dirty || draft?.pending || inputDirty()) {event.preventDefault();event.returnValue='';}});
analysis=createAnalysis({context,api,workspace:()=>workspace,draft:()=>draft,canEdit,inputDirty,persistInput,flush:save,reload:loadWorkspace,openCard,error:problem,caption});
$('source-text').addEventListener('input',()=>analysis.sourceChanged());
$('public-material').addEventListener('change',()=>analysis.sourceChanged());
list().then(() => {const id=new URLSearchParams(location.search).get('id');if(id)return openWorkspace(id);$('create-panel').open=true;}).catch(problem);
