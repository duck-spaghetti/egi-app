/** Durable interpretation UI: first eligible insertion, explicit updates and selection. */
import {node,button} from './fields.js';
export function createAnalysis(host) {
  const {text} = host.context;
  const $ = id => document.getElementById(id);
  let workspaceId, job, pollTimer, pasteTimer, autoAttempted=false, requested=false;
  let pendingRequest, pendingApplication, loading=false, unavailable=false;
  const selected = new Set();
  const extractionJobs = workspace => (workspace?.jobs || []).filter(item=>item.task===undefined || item.task==='extract_text');
  const writable = () => host.canEdit();
  const active = () => ['queued','leased','running'].includes(job?.state);
  const current = () => job?.input_id === host.workspace()?.current_input_id && !host.inputDirty();
  function render() {
    const workspace=host.workspace();
    $('analysis-panel').hidden=!workspace;
    if(!workspace) return;
    $('analysis-update').disabled=!writable() || active() || loading || !$('source-text').value.trim() || !$('public-material').checked;
    $('analysis-cancel').hidden=!active(); $('analysis-cancel').disabled=!writable();
    $('analysis-status').textContent = unavailable ? text.analysis_unavailable : job?.diagnostics?.some(item=>item.code==='budget_exceeded') ? text.analysis_budget : job ? text.job_states[job.state] || text.load_failed : text.analysis_intro;
    $('analysis-stale').hidden=!job || current();
    $('analysis-uncertain').hidden=job?.state!=='uncertain';
    $('analysis-candidates').replaceChildren();
    for(const candidate of job?.state==='succeeded' ? job.output?.candidates || [] : []) {
      const id=job.candidate_ids[candidate.candidate_key], item=node('li'), label=node('label'), check=node('input');
      check.type='checkbox'; check.value=id; check.checked=selected.has(id); check.disabled=!writable() || !current() || !!pendingApplication;
      check.addEventListener('change',()=>{if(check.checked)selected.add(id);else selected.delete(id);renderActions();});
      label.append(check,node('strong',candidate.service.name || text.unnamed_candidate));
      item.append(label);
      if(candidate.service.description) item.append(node('p',candidate.service.description));
      const location=candidate.location?.body;
      if(candidate.service.delivery_mode) item.append(node('p',text.choice_labels[candidate.service.delivery_mode] || candidate.service.delivery_mode,'hint'));
      if(location?.name || location?.addresses?.length) item.append(node('p',[location.name,...(location.addresses || []).map(address=>address.formatted || address.line1 || '')].filter(Boolean).join(' · '),'hint'));
      if(candidate.evidence?.length) {const details=node('details');details.append(node('summary',text.evidence));for(const evidence of candidate.evidence)details.append(node('blockquote',evidence.quote || ''));item.append(details);}
      $('analysis-candidates').append(item);
    }
    renderActions();
  }
  function renderActions() {
    const available=writable() && current() && job?.state==='succeeded' && selected.size>0;
    $('analysis-create').disabled=!available;
    $('analysis-apply').disabled=!available || selected.size!==1 || !host.draft();
  }
  async function poll() {
    clearTimeout(pollTimer);
    if(!job || !workspaceId) return;
    const id=workspaceId, jobId=job.job_id;
    try {
      const value=await host.api('/preparazioni/'+id+'/lavori/'+jobId);
      if(workspaceId!==id || job?.job_id!==jobId) return;
      const changed=job.state!==value.state; job=value;
      if(changed || value.output) render();
      if(active()) pollTimer=setTimeout(poll,1500);
    } catch(error) {host.error(error);}
  }
  async function requestJob(automatic=false) {
    if(loading || !writable() || !$('public-material').checked || !$('source-text').value.trim()) return;
    if(automatic && (autoAttempted || requested || host.workspace()?.jobs?.length)) return;
    if(automatic) autoAttempted=true;
    loading=true; unavailable=false; render();
    try {
      await host.flush();
      if(host.draft()?.conflicted) return;
      if(host.inputDirty() || !host.workspace().current_input_id) await host.persistInput();
      const workspace=host.workspace();
      if(host.inputDirty() || workspace.input_metadata?.public_attestation!==true) return;
      pendingRequest ??= {input_id:workspace.current_input_id,task:'extract_text',request_key:crypto.randomUUID()};
      const receipt=await host.api('/preparazioni/'+workspace.id+'/analisi',pendingRequest);
      pendingRequest=null; requested=true; job={...receipt,input_id:workspace.current_input_id}; selected.clear();
      await poll();
    } catch(error) {if(error.status && error.status<500 || error.message==='ai_not_configured')pendingRequest=null;unavailable=true;if(error.status!==503)host.error(error);}
    finally {loading=false;render();}
  }
  async function materialize(update=false) {
    if(loading || !current() || !selected.size || !writable())return;
    loading=true;
    try {
      if(!await host.flush())return;
      const draft=host.draft();
      if(update && (!draft || selected.size!==1))return;
      pendingApplication ??= {input_id:job.input_id,job_id:job.job_id,request_key:crypto.randomUUID(),
        selections:[...selected].map(candidate_id=>update?{candidate_id,target_item_id:draft.item,expected_version:draft.version}:{candidate_id})};
      render();
      const receipt=await host.api('/preparazioni/'+workspaceId+'/schede/crea',pendingApplication);
      pendingApplication=null;
      await host.reload(); await host.openCard(receipt.items[0].item_id);
      const kept=receipt.items.flatMap(item=>item.conflicts || []);
      $('analysis-kept').textContent=kept.length?text.manual_preserved+' '+kept.map(host.caption).join(', '):'';
    } catch(error) {if(error.status && error.status<500)pendingApplication=null;host.error(error);}
    finally {loading=false;render();}
  }
  $('analysis-update').addEventListener('click',()=>requestJob());
  $('analysis-create').addEventListener('click',()=>materialize(false));
  $('analysis-apply').addEventListener('click',()=>materialize(true));
  $('analysis-cancel').addEventListener('click',async()=>{try{await host.api('/preparazioni/'+workspaceId+'/lavori/'+job.job_id+'/annulla',{request_key:crypto.randomUUID()});await poll();}catch(error){host.error(error);}});
  return {
    load(workspace) {
      if(workspace.id!==workspaceId) {clearTimeout(pollTimer);clearTimeout(pasteTimer);workspaceId=workspace.id;job=null;autoAttempted=false;requested=false;unavailable=false;pendingRequest=null;pendingApplication=null;selected.clear();}
      const latest=extractionJobs(workspace).at(-1);
      if(latest && (!job || latest.job_id!==job.job_id)) {job=latest;selected.clear();poll();}
      render();
    },
    sourceChanged() {
      clearTimeout(pasteTimer);render();
      if(!autoAttempted && !requested && !extractionJobs(host.workspace()).length && writable() && $('public-material').checked && $('source-text').value.trim()) pasteTimer=setTimeout(()=>requestJob(true),800);
    },
    sourceSaved() {render();requestJob(true);},
    cardChanged() {renderActions();}
  };
}
