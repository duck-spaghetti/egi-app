/** Render editable service/location facts with one dictionary in both visual views. */
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
export function renderFields(root, draft, context, canEdit, changed) {
  const {fields: dictionary, text} = context;
  const label = key => text.field_labels[key] || key;
  const pathFor = (prefix, key) => prefix + '/' + key;
  function edit(path, value) { draft.edit(path, value); changed(); }
  function redraw() { renderFields(root, draft, context, canEdit, changed); }
  function scalar(parent, body, key, prefix) {
    const path = pathFor(prefix, key), value = body[key];
    const wrapper = node('div', undefined, 'preparation-control'); wrapper.dataset.field = key;
    wrapper.append(node('span', label(key)));
    let input;
    if (dictionary.choices[key]) {
      input = node('select'); input.append(new Option(text.not_set, ''));
      for (const option of dictionary.choices[key]) {
        const caption = key === 'end_day_offset' ? (option ? text.next_day : text.same_day) : text.choice_labels[option] || String(option);
        input.append(new Option(caption, String(option)));
      }
      if (value !== undefined && !dictionary.choices[key].includes(value)) input.append(new Option(String(value), String(value)));
      input.value = value === undefined ? '' : String(value);
    } else {
      input = node(['description', 'details', 'cost_note', 'note', 'closure_reason'].includes(key) ? 'textarea' : 'input');
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
      hint.lastChild.disabled = !canEdit || next === undefined;
    });
    wrapper.append(input);
    const origin = draft.payload.field_origins[path]?.state;
    const hint = node('span', undefined, 'hint');
    hint.append(node('span', origin === 'cleared' ? text.cleared : origin === 'manual' ? text.changed : origin === 'generated' ? text.generated : value === undefined ? text.not_set : text.input_origin));
    hint.append(button(text.clear, () => { edit(path, undefined); redraw(); }, !canEdit || value === undefined));
    wrapper.append(hint); parent.append(wrapper);
  }
  function collection(parent, body, key, prefix) {
    const section = node('section', undefined, 'preparation-repeat'), path = pathFor(prefix, key);
    section.append(node('h3', label(key)));
    const values = body[key] || [];
    values.forEach((value, index) => {
      const group = node('fieldset'); group.append(node('legend', label(key) + ' · ' + (index + 1)));
      if (key === 'territories') {
        const control = node('input'); control.value = value; control.disabled = !canEdit;
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
    section.append(button(text.add + ' · ' + label(key), () => { edit(path, [...values, key === 'territories' ? '' : {}]); redraw(); }, !canEdit));
    parent.append(section);
  }
  root.replaceChildren();
  const service = node('section', undefined, 'preparation-section'); service.append(node('h2', text.service));
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
  root.append(service, location);
}
