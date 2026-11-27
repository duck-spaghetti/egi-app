/** Named local catalog choices shared by editable cards and selective moderation. */
import {node,button} from './fields.js';
const key=target=>target.kind==='organization'?'org:'+target.organization_id:'category:'+target.adoption_id+':'+target.term_id;
export function createReferenceControls(options) {
  const {text,catalog,suggest,changed,flush=async()=>true,fresh=()=>true,references={}}=options;
  const labels=new Map(),states=new Map();let activeItem;
  for(const item of references.classifications || [])labels.set('category:'+item.adoption_id+':'+item.term_id,item.name);
  for(const item of references.organizations || [])labels.set('org:'+item.organization_id,item.name);
  function remember(page) {for(const entry of page.entries)if(entry.target)labels.set(key(entry.target),entry.label);return page;}
  function label(target) {return target.kind==='new_organization'?target.body.name:labels.get(key(target)) || (target.kind==='organization'?text.ref_selected_org:text.ref_selected_category);}
  async function loadNames(draft) {
    const targets=(draft.payload.resolutions || []).flatMap(r=>[r.selected?.target,...r.candidates.map(c=>c.target)]).filter(t=>t?.kind==='organization');
    for(const org of draft.payload.service.organizations || [])targets.push({kind:'organization',organization_id:org.organization_id});
    const ids=[...new Set(targets.map(t=>t.organization_id))].filter(id=>!labels.has('org:'+id)).slice(0,100);
    if(!ids.length)return;
    const query={kind:'organization',organization_ids:ids,limit:50};
    const first=remember(await catalog(query));if(first.next_offset!==null)remember(await catalog({...query,offset:first.next_offset}));
  }
  function render(row,draft,fact,index,canEdit,redraw) {
    if(activeItem!==draft.item){states.clear();activeItem=draft.item;}
    const details=node('details',undefined,'preparation-resolution'),summary=node('summary'),body=node('div');
    const stateKey=draft.item+':'+fact.fact_id,state=states.get(stateKey) || {};states.set(stateKey,state);
    state.body=body;body.inert=!!state.busy;
    const current=()=>draft.payload.resolutions?.find(r=>r.fact_id===fact.fact_id);
    function status() {const r=current();summary.textContent=(text['ref_'+(r?.state || 'unresolved')])+(r?.selected?' · '+label(r.selected.target)+(r.selected.role?' · '+(text.ref_roles[r.selected.role] || r.selected.role):''):'');}
    let runTicket;
    async function run(action) {
      if(state.busy)return;
      state.busy=true;runTicket=state.sequence=(state.sequence || 0)+1;
      const value=fact.value;body.inert=true;body.setAttribute('aria-busy','true');
      try {await action(value);}catch(error){feedback.textContent=error.status===409?text.ref_stale:text.ref_failed;}
      finally{state.busy=false;body.inert=false;body.setAttribute('aria-busy','false');if(state.body){state.body.inert=false;state.body.setAttribute('aria-busy','false');}}
    }
    const feedback=node('p',undefined,'hint');feedback.setAttribute('role','status');
    function update(resolution) {state.sequence=(state.sequence || 0)+1;draft.resolveFact(fact.fact_id,resolution);changed();redraw();}
    async function choose(target,scope,role,value) {
      if(!await flush() || !fresh(draft) || fact.value!==value || runTicket!==state.sequence)throw Object.assign(new Error(),{status:409});
      if(fact.kind==='organization_name' && !role){feedback.textContent=text.ref_role_required;return;}
      update({state:'confirmed',context:scope,candidates:[],selected:{target,...(role?{role}:{})}});
    }
    function control(title,type='input',value='') {
      const wrap=node('label'),input=node(type);input.value=value;input.setAttribute('aria-label',title);wrap.append(node('span',title),input);body.append(wrap);return input;
    }
    function addContinuation(page,load,show,title=text.ref_more,isCurrent=()=>true) {
      let offset=page.next_offset;
      if(offset===null)return;
      const more=button(title,()=>run(async()=>{
        if(offset===null || !isCurrent()){more.disabled=true;feedback.textContent=text.ref_search_changed;return;}
        const next=await load(offset);
        if(!isCurrent()){more.disabled=true;feedback.textContent=text.ref_search_changed;return;}
        show(next);offset=next.next_offset;more.disabled=offset===null;
      }));
      body.append(more);
    }
    function entryButtons(entries,scope,role) {
      const list=node('div',undefined,'preparation-reference-results');
      for(const entry of entries) {
        const title=entry.label || label(entry.target),wrap=node('div');
        const select=button(title,()=>run(value=>choose(entry.target,typeof scope==='function'?scope(entry):scope,role?.value,value)),!canEdit);
        wrap.append(select);if(entry.published===false || entry.target.kind==='organization' && entry.target.expected_work!==entry.target.expected_public)wrap.append(node('span',text.ref_draft,'badge'));
        if(entry.reason)wrap.append(node('p',text['ref_reason_'+entry.reason] || entry.reason,'hint'));list.append(wrap);
      }
      if(!entries.length)list.append(node('p',text.ref_no_match,'hint'));
      body.append(list);return list;
    }
    function build() {
      body.replaceChildren();status();
      if(!fact.value){body.append(node('p',text.ref_cleared,'hint'));return;}
      const r=current();
      if(r?.selected){body.append(node('p',label(r.selected.target)));if(r.selected.role)body.append(node('p',text.ref_role+': '+(text.ref_roles[r.selected.role] || r.selected.role)));}
      if(!canEdit){if(r?.candidates?.length)entryButtons(r.candidates.map(item=>({...item,label:label(item.target)})),r.context);body.append(node('p',text.ref_readonly,'hint'));return;}
      let role;
      if(fact.kind==='organization_name'){
        role=control(text.ref_role,'select');role.append(new Option(text.not_set,''));
        for(const [value,title]of Object.entries(text.ref_roles))role.append(new Option(title,value));
        if(r?.selected?.role && !text.ref_roles[r.selected.role])role.append(new Option(r.selected.role,r.selected.role));
        role.value=r?.selected?.role || '';
        const picker=role;picker.append(new Option(text.ref_other_role,'__other__'));
        const custom=control(text.ref_custom_role);custom.maxLength=100;custom.parentElement.hidden=true;
        picker.addEventListener('change',()=>{custom.parentElement.hidden=picker.value!=='__other__';if(picker.value==='__other__')custom.focus();});
        role={get value(){return picker.value==='__other__'?custom.value.trim():picker.value;}};
        body.append(node('p',text.ref_role_hint,'hint'));
      }
      if(r?.state==='confirmed' && options.requireReconciliation){
        const picker=control(text.ref_reconcile,'select');picker.append(new Option(text.not_set,''),new Option(text.ref_retain,'retain'),new Option(text.ref_replace,'replace'));
        picker.value=options.reconciliations?.[fact.fact_id] || '';
        picker.addEventListener('change',()=>{options.reconciliations[fact.fact_id]=picker.value;changed();});
      }
      if(r?.candidates?.length)entryButtons(r.candidates.map(item=>({...item,label:label(item.target)})),r.context,role);
      if(fact.kind==='organization_name'){
        const search=control(text.ref_search_org,'input',fact.value.length<=500?fact.value:'');search.maxLength=500;
        body.append(button(text.ref_search,()=>run(async()=>{
          const query={kind:'organization',search:search.value,limit:50},page=remember(await catalog(query));
          state.results?.remove();state.results=entryButtons(page.entries,{},role);
          feedback.textContent=page.next_offset!==null?text.ref_more_results:text.ref_local_only;
          addContinuation(page,offset=>catalog({...query,offset}),next=>{remember(next);state.results?.remove();state.results=entryButtons(next.entries,{},role);},text.ref_more,()=>search.value===query.search);
        })));
        body.append(button(text.ref_prepare_org,()=>run(async()=>{
          state.newForm?.remove();const form=node('fieldset');form.append(node('legend',text.ref_new_org));body.append(form);state.newForm=form;
          function field(title,value=''){const wrap=node('label'),input=node('input');input.value=value;input.setAttribute('aria-label',title);wrap.append(node('span',title),input);form.append(wrap);return input;}
          const name=field(text.ref_org_name,fact.value),language=field(text.ref_org_language),description=field(text.field_labels.description),type=field(text.ref_org_type),website=field(text.ref_org_website);
          language.placeholder='it';const scope=node('select');scope.setAttribute('aria-label',text.ref_org_scope);scope.append(new Option(text.not_set,''),new Option(text.ref_global,'global'));
          for(const area of references.territories || [])scope.append(new Option(area.name,area.territory_id));
          const scopeLabel=node('label');scopeLabel.append(node('span',text.ref_org_scope),scope);form.append(scopeLabel);
          const duplicate=node('p',undefined,'hint');form.append(duplicate);let context;
          async function check() {const page=remember(await catalog({kind:'organization',search:name.value,limit:50}));context=page.context;duplicate.textContent=page.entries.length?text.ref_duplicates:text.ref_no_duplicates;}
          name.addEventListener('input',()=>{context=null;duplicate.textContent=text.ref_check_name;});
          form.append(button(text.ref_check_name,()=>run(check)),button(text.ref_confirm_new,()=>run(async value=>{
            if(!name.value.trim() || !language.value.trim() || !scope.value || !role.value){feedback.textContent=text.ref_new_required;return;}
            if(!context){await check();return;}
            const prior=context.catalog_digest;await check();if(prior!==context.catalog_digest){feedback.textContent=text.ref_duplicates_changed;return;}
            const proposed={name:name.value.trim(),original_language:language.value.trim(),territories:scope.value==='global'?[]:[scope.value]};
            for(const [key,input]of [['description',description],['organization_type',type],['website',website]])if(input.value.trim())proposed[key]=input.value.trim();
            // Trimmed proposed names must match the context the operator reviewed.
            if(proposed.name!==context.organization_name){name.value=proposed.name;await check();return;}
            await choose({kind:'new_organization',body:proposed},context,role.value,value);
          })));
          await check();
        })));
      } else if(fact.subject==='service'){
        const target=r?.selected?.target || r?.candidates?.[0]?.target;
        const term=(references.classifications || []).find(item=>item.adoption_id===target?.adoption_id && item.term_id===target?.term_id);
        const area=(references.territories || []).find(item=>item.territory_id===r?.context?.territory_id);
        if(area || term?.axis_label)body.append(node('p',[area?.name,term?.axis_label].filter(Boolean).join(' · '),'hint'));
        const picker=control(text.ref_context,'select');picker.append(new Option(text.ref_choose_context,''));
        let contexts=state.contexts || [];
        contexts.forEach((entry,index)=>picker.append(new Option(entry.territory_label+' · '+entry.axis_label+' · '+entry.release_version,String(index))));
        if(state.selectedContext!==undefined)picker.value=String(state.selectedContext);
        body.append(button(text.ref_load_contexts,()=>run(async()=>{
          const page=await catalog({kind:'taxonomy_context',limit:50});contexts=page.entries;state.contexts=contexts;
          picker.replaceChildren(new Option(text.ref_choose_context,''));
          contexts.forEach((entry,index)=>picker.append(new Option(entry.territory_label+' · '+entry.axis_label+' · '+entry.release_version,String(index))));
          feedback.textContent=page.next_offset!==null?text.ref_context_more:text.ref_local_only;
          const selected=state.query || r?.context,selectedIndex=contexts.findIndex(entry=>entry.territory_id===selected?.territory_id && entry.axis_id===selected?.axis_id);
          state.selectedContext=selectedIndex>=0?selectedIndex:undefined;picker.value=selectedIndex>=0?String(selectedIndex):'';
          addContinuation(page,offset=>catalog({kind:'taxonomy_context',limit:50,offset}),next=>{
            const base=contexts.length;contexts.push(...next.entries);
            next.entries.forEach((entry,index)=>picker.append(new Option(entry.territory_label+' · '+entry.axis_label+' · '+entry.release_version,String(base+index))));
          },text.ref_more_contexts);
        })));
        async function matchContext(query,value) {
          if(!await flush() || !fresh(draft) || fact.value!==value || runTicket!==state.sequence)throw Object.assign(new Error(),{status:409});
          const prior=JSON.stringify(current());let answer;
          try{answer=await suggest(draft,fact,query);}catch(error){build();throw error;}
          if(!fresh(draft) || fact.value!==value || prior!==JSON.stringify(current()) || runTicket!==state.sequence || draft.dirty && options.requireSavedSuggestions)throw Object.assign(new Error(),{status:409});
          state.coverage=answer.complete;state.count=answer.candidate_count;state.hasResult=true;state.longValue=answer.long_value;update(answer.resolution);
        }
        picker.addEventListener('change',()=>run(async value=>{
          if(picker.value==='')return;const selected=contexts[Number(picker.value)];
          state.selectedContext=Number(picker.value);state.query={kind:'classification',territory_id:selected.territory_id,axis_id:selected.axis_id,adoption_id:selected.adoption_id};
          await matchContext(state.query,value);
        }));
        const scope=state.query || (r?.context?.axis_id?{kind:'classification',...r.context}:null);
        if(scope){
          body.append(button(text.ref_refresh_local,()=>run(value=>matchContext(scope,value))));
          const search=control(text.ref_search_category);search.maxLength=500;
          body.append(button(text.ref_browse_categories,()=>run(async()=>{
            const query={...scope,search:search.value,limit:50,offset:0},page=remember(await catalog(query));
            const selectedScope={territory_id:scope.territory_id,axis_id:scope.axis_id};
            state.results?.remove();state.results=entryButtons(page.entries,selectedScope);
            feedback.textContent=page.next_offset!==null?text.ref_more_results:text.ref_local_only;
            addContinuation(page,offset=>catalog({...query,offset}),next=>{remember(next);state.results?.remove();state.results=entryButtons(next.entries,selectedScope);},text.ref_more,()=>search.value===query.search);
          })));
        }
        if(state.hasResult && !r?.candidates?.length && r?.state!=='confirmed')body.append(node('p',state.longValue?text.ref_long_value:text.ref_no_match,'hint'));
        if(state.coverage===false)body.append(node('p',text.ref_incomplete,'hint'));
        body.append(node('p',text.ref_context_hint,'hint'));
      } else body.append(node('p',text.ref_location_category,'hint'));
      body.append(button(text.ref_keep_literal,()=>update({state:'unresolved',context:{},candidates:[]})),button(text.ref_reject,()=>update({state:'ignored',context:{},candidates:[]})),feedback);
    }
    details.append(summary,body);row.append(details);build();
    details.addEventListener('toggle',()=>{if(details.open && current()?.state==='proposed')feedback.textContent=text.ref_proposals_hint;});
    row.querySelector('input')?.addEventListener('input',()=>{state.coverage=undefined;state.hasResult=false;build();});
  }
  return {render,loadNames,label};
}
