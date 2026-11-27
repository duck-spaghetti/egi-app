/** Compose the editable service presentation using the shared field controls/draft. */
import {renderFields,node,button} from './fields.js';

export function renderCard(root,draft,context,canEdit,changed) {
  const controls=node('div'),text=context.text;
  renderFields(controls,draft,{...context,cardView:true},canEdit,changed,()=>renderCard(root,draft,context,canEdit,changed));
  const service=controls.querySelector('[data-kind=service]'),location=controls.querySelector('[data-kind=location]');
  const card=node('article',undefined,'preparation-service-card');card.setAttribute('aria-label',text.editable_card);
  const header=node('header',undefined,'preparation-card-header'),mode=service.querySelector('[data-field=delivery_mode]');
  const metadata=node('div',undefined,'preparation-card-metadata'),categories=service.querySelector('[data-field=classifications]');
  categories.querySelector('h3').remove();metadata.append(categories,mode);
  header.append(metadata,service.querySelector('[data-field=name]'));
  card.append(header);
  function section(title,content) {
    const part=node('section',undefined,'preparation-card-section');part.append(node('h3',title),content);card.append(part);return part;
  }
  if(draft.payload.location.kind!=='none') {
    const place=node('div',undefined,'preparation-card-place'),addresses=location.querySelector(':scope > [data-field=addresses]');
    if(addresses) {
      addresses.querySelector('h3').remove();
      for(const group of addresses.querySelectorAll(':scope > fieldset')) {
        const extra=node('details');extra.append(node('summary',text.card_address_details));
        const primary=group.querySelector('[data-field=formatted]');
        for(const control of [...group.querySelectorAll(':scope > .preparation-control')])if(control!==primary)extra.append(control);
        group.append(extra);
      }
      place.append(addresses);
    }
    const details=node('details',undefined,'preparation-location-extra');details.append(node('summary',text.card_location_details),location);place.append(details);header.append(place);
  } else if(['in_person','itinerant'].includes(draft.payload.service.delivery_mode)) {
    header.append(button(text.card_add_location,()=>{extra.open=true;location.querySelector('select').focus();}));
  }
  section(text.card_description,service.querySelector('[data-field=description]'));
  for(const [key,title] of [['schedules',text.card_when],['conditions',text.card_access],['contacts',text.field_labels.contacts]]) {
    const fields=service.querySelector(':scope > [data-field='+key+']');
    const part=node('section',undefined,'preparation-card-section');part.append(node('h3',title));
    fields.querySelector('h3').remove();
    if(key==='schedules' && draft.payload.service.schedules?.length) {
      const summaries=node('div');
      function updateHours() {
        summaries.replaceChildren();
      for(const schedule of draft.payload.service.schedules) {
        const summary=node('p',undefined,'preparation-hours-line');
        summary.append(node('strong',text.choice_labels[schedule.scope] || text.field_labels.schedules));
        for(const day of schedule.days || [])summary.append(node('span',(text.choice_labels[day.weekday] || day.weekday)+' · '+(day.state==='closed'?text.choice_labels.closed:day.intervals?.map(interval=>[interval.opens,interval.closes].filter(Boolean).join('–')).join(', ') || text.not_set)));
        summaries.append(summary);
      }
      }
      updateHours();part.append(summaries);
      fields.addEventListener('input',updateHours);fields.addEventListener('change',updateHours);
      const editing=node('details');editing.open=draft.payload.service.schedules.some(schedule=>!schedule.scope || !schedule.days?.length || schedule.days.some(day=>!day.weekday || !day.state || day.state==='intervals' && !day.intervals?.length));
      editing.append(node('summary',canEdit?text.card_edit_hours:text.fields_view),fields);part.append(editing);
    } else part.append(fields);
    if(key==='contacts')for(const group of fields.querySelectorAll(':scope > fieldset')) {
      const extra=node('details',undefined,'preparation-contact-extra');extra.append(node('summary',text.card_contact_details));
      for(const control of [...group.querySelectorAll(':scope > .preparation-control')]) {
        if(!['channel_type','value','is_public'].includes(control.dataset.field))extra.append(control);
      }
      group.append(extra);
    }
    card.append(part);
  }
  const extra=node('details',undefined,'preparation-card-extra');extra.append(node('summary',text.additional));
  for(const child of [...service.children])if(child.tagName==='DETAILS'){for(const field of [...child.children])if(field.tagName!=='SUMMARY')extra.append(field);}else if(child.tagName!=='H2')extra.append(child);
  if(draft.payload.location.kind==='none')extra.append(location);
  card.append(extra);
  const footer=node('footer',undefined,'preparation-card-source');
  footer.append(node('span',text.source,'preparation-eyebrow'),node('strong',context.sourceName || text.not_set),node('p',text.card_not_published,'hint'));card.append(footer);
  root.replaceChildren(card);
  function fitText(input) {input.style.height='0px';input.style.height=(input.scrollHeight+input.offsetHeight-input.clientHeight)+'px';}
  for(const input of card.querySelectorAll('textarea'))if(input.getBoundingClientRect().width)fitText(input);
  card.addEventListener('input',event=>{if(event.target.tagName==='TEXTAREA')fitText(event.target);});
}
