/** Render editable service/location facts with one dictionary in both visual views. */
import {evidenceFor} from './evidence.js';
import {createInterpretationControls} from './interpretations.js';
export function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
export function button(text, action, disabled = false) {
  const result = node('button', text); result.type = 'button'; result.disabled = disabled;
  result.addEventListener('click', action); return result;
}
export function renderFields(root, draft, context, canEdit, changed, redrawAll) {
  const {fields: dictionary, text} = context;
  const label = key => text.field_labels[key] || key;
  const pathFor = (prefix, key) => prefix + '/' + key;
  function edit(path, value) { draft.edit(path, value); changed(); }
  function redraw() { if(redrawAll)redrawAll();else renderFields(root, draft, context, canEdit, changed); }
  function scalar(parent, body, key, prefix) {
    const path = pathFor(prefix, key), value = body[key];
    const wrapper = node('div', undefined, 'preparation-control'); wrapper.dataset.field = key;
    wrapper.append(node('span', label(key)));
    let input,clearControl;
    if(key==='organization_id' && context.referenceLabel){
      input=node('input');input.type='text';input.readOnly=true;input.value=value?context.referenceLabel({kind:'organization',organization_id:value}):text.not_set;
    } else if (key==='territory_id' && context.references?.territories) {
      input=node('select');input.append(new Option(text.not_set,''));
      for(const area of context.references.territories)input.append(new Option(area.name,area.territory_id));
      if(value && !context.references.territories.some(area=>area.territory_id===value))input.append(new Option(value,value));
      input.value=value || '';
    } else if (dictionary.choices[key]) {
      input = node('select'); input.append(new Option(text.not_set, ''));
      for (const option of dictionary.choices[key]) {
        const caption = key === 'end_day_offset' ? (option ? text.next_day : text.same_day) : text.choice_labels[option] || String(option);
        input.append(new Option(caption, String(option)));
      }
      if (value !== undefined && !dictionary.choices[key].includes(value)) input.append(new Option(String(value), String(value)));
      input.value = value === undefined ? '' : String(value);
    } else {
      input = node(['description', 'details', 'cost_note', 'note', 'closure_reason'].includes(key) || context.cardView && ['name','formatted'].includes(key) ? 'textarea' : 'input');
      if(context.cardView && ['name','formatted'].includes(key))input.rows=1;
      if(context.cardView && ['name','description'].includes(key))input.placeholder=label(key);
      if (input.tagName === 'INPUT') input.type = key === 'is_public' ? 'checkbox' : dictionary.numbers.includes(key) ? 'number' : dictionary.dates.includes(key) ? 'date' : dictionary.times.includes(key) ? 'time' : 'text';
      if (key === 'is_public') { input.checked = value === true; input.indeterminate = value === undefined; }
      else input.value = value ?? '';
      if (dictionary.numbers.includes(key)) input.step = ['latitude', 'longitude'].includes(key) ? 'any' : '1';
      if (dictionary.times.includes(key)) input.step = '1';
    }
    input.setAttribute('aria-label', label(key));
    input.disabled = !canEdit;
    input.dataset.path = path;
    input.addEventListener('input', () => {
      let next = key === 'is_public' ? input.checked : input.value === '' ? undefined : dictionary.numbers.includes(key) ? Number(input.value) : input.value;
      edit(path, next);
      hint.firstChild.textContent = next === undefined ? text.cleared : text.changed;
      clearControl.disabled = !canEdit || next === undefined;
      for(const link of hint.querySelectorAll('[data-evidence]'))link.hidden=true;
    });
    wrapper.append(input);
    const origin = draft.payload.field_origins[path]?.state, citations=key==='is_public'?[]:evidenceFor(draft.payload,path).filter(citation=>!context.evidenceFilter || context.evidenceFilter(citation));
    const hint = node('span', undefined, 'hint');
    hint.append(node('span', origin === 'cleared' ? text.cleared : origin === 'manual' ? text.changed : citations.some(item=>item.kind==='interpreted') ? text.interpreted_value : origin === 'generated' ? text.generated : value === undefined ? text.not_set : text.input_origin));
    clearControl=button(text.clear, () => { edit(path, undefined); redraw(); }, !canEdit || value === undefined || key==='organization_id');
    hint.append(clearControl);
    if(context.onEvidence)for(const citation of citations){const link=button(text.see_source,()=>context.onEvidence(citation,path));link.dataset.evidence=citation.id;hint.append(link);}
    wrapper.append(hint); parent.append(wrapper);
  }
  function collection(parent, body, key, prefix) {
    const section = node('section', undefined, 'preparation-repeat'), path = pathFor(prefix, key);
    section.dataset.field=key;
    section.append(node('h3', label(key)));
    const values = body[key] || [];
    if(key==='classifications' && context.references?.classifications) {
      const choices=context.references.classifications;
      function category(value,index) {
        const row=node('div',undefined,'preparation-category-choice'),select=node('select');
        select.setAttribute('aria-label',text.category);select.disabled=!canEdit;
        select.append(new Option(text.choose_category,''));
        for(const choice of choices)select.append(new Option(choice.name+(choice.axis_label?' · '+choice.axis_label:''),choice.adoption_id+'/'+choice.term_id));
        if(value) {
          const selected=value.adoption_id+'/'+value.term_id;
          if(!choices.some(choice=>choice.adoption_id+'/'+choice.term_id===selected))select.append(new Option(text.unresolved_category,selected));
          select.value=selected;
        }
        select.addEventListener('change',()=>{
          const next=structuredClone(values);
          if(!select.value){if(index!==null)next.splice(index,1);else return;}
          else {const chosen=choices.find(choice=>choice.adoption_id+'/'+choice.term_id===select.value),entry={adoption_id:chosen.adoption_id,term_id:chosen.term_id};if(index===null)next.push(entry);else next[index]=entry;}
          edit(path,next);redraw();
        });
        row.append(select);section.append(row);
      }
      values.forEach((value,index)=>category(value,index));
      if(!values.length)category(null,null);
      else if(canEdit)section.append(button(text.add_category,()=>category(null,null)));
      parent.append(section);return;
    }
    values.forEach((value, index) => {
      const group = node('fieldset'); group.append(node('legend', label(key) + ' · ' + (index + 1)));
      if (key === 'territories') {
        const control = node(context.references?.territories ? 'select':'input');
        if(context.references?.territories){control.append(new Option(text.not_set,''));for(const area of context.references.territories)control.append(new Option(area.name,area.territory_id));if(value && !context.references.territories.some(area=>area.territory_id===value))control.append(new Option(value,value));}
        control.value = value; control.disabled = !canEdit;
        control.setAttribute('aria-label', label('territory_id'));
        control.addEventListener('change', () => { const next = structuredClone(values); next[index] = control.value; edit(path, next); });
        group.append(control);
      } else for (const field of dictionary.components[key]) {
        if (['days', 'intervals', 'effects'].includes(field)) collection(group, value, field, path + '/' + index);
        else scalar(group, value, field, path + '/' + index);
      }
      group.append(button(text.remove, () => { const next = structuredClone(values); next.splice(index, 1); edit(path, next); redraw(); }, !canEdit));
      section.append(group);
    });
    if(key!=='organizations')section.append(button(text.add + ' · ' + label(key), () => { edit(path, [...values, key === 'territories' ? '' : {}]); redraw(); }, !canEdit));
    parent.append(section);
  }
  root.replaceChildren();
  const service = node('section', undefined, 'preparation-section'); service.append(node('h2', text.service));
  service.dataset.kind='service';
  const extra = node('details'); extra.append(node('summary',text.additional));
  for (const key of dictionary.scalars.service) scalar(['name','description','delivery_mode','operational_status','cost_state','cost_note'].includes(key) ? service : extra, draft.payload.service, key, '/service');
  for (const key of dictionary.arrays.service) collection(['contacts','conditions','schedules'].includes(key) ? service : extra, draft.payload.service, key, '/service');
  service.append(extra);
  if (draft.payload.service.place) {
    const place = node('fieldset'); place.append(node('legend', label('place')));
    for (const key of dictionary.components.place) scalar(place, draft.payload.service.place, key, '/service/place');
    service.append(place);
  }
  const location = node('section', undefined, 'preparation-section'); location.append(node('h2', text.location), node('p', text.location_note, 'hint'));
  location.dataset.kind='location';
  const picker = node('select'); picker.setAttribute('aria-label', text.location); picker.disabled = !canEdit;
  picker.append(new Option(text.no_location, 'none'), new Option(text.new_location, 'new'));
  if (draft.payload.location.kind === 'existing') picker.append(new Option(text.existing_location, 'existing'));
  picker.value = draft.payload.location.kind;
  picker.addEventListener('change', () => { draft.edit('/location', picker.value === 'none' ? {kind:'none'} : {kind:'new',body:{}}); draft.payload.field_origins['/location/kind'] = {state:'manual'}; changed(); redraw(); });
  location.append(picker);
  const body = draft.payload.location.body;
  if (body) {
    for (const key of dictionary.scalars.location) scalar(location, body, key, '/location/body');
    for (const key of dictionary.arrays.location) collection(location, body, key, '/location/body');
  }
  const literals=node('section',undefined,'preparation-source-facts');literals.dataset.kind='source_facts';
  for(const kind of ['organization_name','category_label'])for(const subject of ['service','location']){
    const entries=(draft.payload.source_facts || []).map((fact,index)=>({fact,index})).filter(item=>item.fact.kind===kind && item.fact.subject===subject);
    if(!entries.length)continue;
    const group=node('section',undefined,'preparation-literal-group');group.dataset.factKind=kind;group.dataset.subject=subject;
    const caption=kind==='organization_name'?(subject==='location'?text.literal_location_org:text.literal_org):(subject==='location'?text.literal_location_category:text.literal_category);
    group.append(node('h3',caption));
    for(const {fact,index}of entries){
      const path='/source_facts/'+index+'/value',sourcePath='/source_facts/'+index+'/source_value';
      const row=node('div',undefined,'preparation-control preparation-literal-control');row.dataset.factId=fact.fact_id;
      const input=node('input');input.type='text';input.value=fact.value || '';input.placeholder=caption;
      input.setAttribute('aria-label',caption+' '+(index+1));input.disabled=!canEdit || context.canEditFacts===false;
      const hint=node('span',undefined,'hint'),status=node('span'),original=node('span',text.literal_original+': '+fact.source_value,'preparation-literal-original');
      const state=()=>{status.textContent=draft.payload.field_origins[path]?.state==='cleared'?text.cleared:draft.payload.field_origins[path]?.state==='manual'?text.changed:text.input_origin;original.hidden=fact.value===fact.source_value;};state();
      input.addEventListener('input',()=>{draft.edit(path,input.value || undefined);changed();state();});
      hint.append(status);
      if(context.onEvidence)for(const citation of evidenceFor(draft.payload,sourcePath).filter(item=>!context.evidenceFilter || context.evidenceFilter(item))){
        const link=button(text.see_source,()=>context.onEvidence(citation,sourcePath));link.dataset.evidence=citation.id;hint.append(link);
      }
      row.append(input,original,hint);
      context.renderResolution?.(row,draft,fact,index,canEdit,context.rerender || redraw);group.append(row);
    }
    literals.append(group);
  }
  root.append(service, location, literals);
  createInterpretationControls({node,button}).render(root,draft,context,canEdit,changed,context.rerender || redraw);
}
