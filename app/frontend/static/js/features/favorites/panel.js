import {escapeHtml} from '../../format.js';
import {createPresentation} from '../services/presentation.js';

/** The saved-place library lives in the same sheet system as filters and settings. */
export function createSavedPanel({favorites,collections,scope,translate,emit,changed,renderEntry,root=document}) {
  const sheet=root.getElementById('sheet-saved'),groups=root.getElementById('saved-groups');
  const t=key=>translate(`lists.${key}`),f=key=>translate(`favorites.${key}`);
  let data=[],generation=0,busy=false;
  async function render(){
    const current=++generation;
    const [quick,lists]=await Promise.all([favorites.list(),collections.list()]);scope.check();
    const named=await Promise.all(lists.map(async list=>({...list,entries:await collections.cards(list.id).list()})));
    if(current!==generation)return;
    data=[{id:'favorites',name:f('title'),entries:quick},...named];
    groups.innerHTML=data.map(group=>`<section class="saved-group" data-saved-group="${escapeHtml(group.id)}">
      <header><h3>${escapeHtml(group.name)} <span class="saved-count">${group.entries.length}</span></h3>
      <div class="saved-group-actions"><button type="button" data-saved-map="${escapeHtml(group.id)}" ${group.entries.length?'':'disabled'}>${escapeHtml(t('map'))}</button>
      <button type="button" data-saved-print="${escapeHtml(group.id)}" ${group.entries.length?'':'disabled'}>${escapeHtml(t('print'))}</button></div></header>
      ${group.entries.length?`<ul class="saved-services">${group.entries.map(entry=>`<li>${renderEntry(entry,group.id)}</li>`).join('')}</ul>`:`<p class="saved-empty">${escapeHtml(group.id==='favorites'?f('empty'):t('emptyCollection'))}</p>`}</section>`).join('');
  }
  async function open(){
    emit('openSheet',{id:'sheet-saved'});
    try{await changed();await render();}catch(error){if(!scope.signal.aborted)root.getElementById('saved-status').textContent=t('error');}
  }
  function print(group){
    const target=root.getElementById('saved-print');
    target.innerHTML=`<h1>EGI · ${escapeHtml(group.name)}</h1><p>${escapeHtml(f('snapshot'))}</p>`+group.entries.map(entry=>{
      if(entry.status!=='saved')return `<article><h2>${escapeHtml(f('unavailable'))}</h2></article>`;
      const model=createPresentation({snapshot:()=>({categories:[],lang:entry.language}),context:{canonical:true},translate});
      const poi=model.normalizePublicService(entry.card);
      return `<article><h2>${escapeHtml(model.serviceTitle(poi))}</h2><p>${escapeHtml(poi.address || '')}</p>${model.renderInfoSection(poi)}${model.renderHoursSection(poi)}${model.renderContactsSection(poi)}${model.renderSourcesSection(poi)}<p>${escapeHtml(f('updated'))}: ${escapeHtml(new Date(entry.updatedAt).toLocaleString(root.documentElement.lang))} · ${escapeHtml(entry.language)}</p></article>`;
    }).join('');
    target.querySelectorAll('details').forEach(node=>{node.open=true;});
    root.body.classList.add('printing-saved');window.print();
  }
  window.addEventListener('afterprint',()=>root.body.classList.remove('printing-saved'),{signal:scope.signal});
  groups.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button || button.disabled || busy)return;
    const group=data.find(group=>group.id===button.closest('[data-saved-group]')?.dataset.savedGroup);if(!group)return;
    if(button.hasAttribute('data-saved-print'))return print(group);
    if(button.hasAttribute('data-saved-map'))return emit('savedMap',group);
    if(button.hasAttribute('data-saved-select'))return emit('savedMap',{...group,selectId:button.dataset.savedSelect});
  },{signal:scope.signal});
  const form=root.getElementById('saved-create');
  root.getElementById('saved-new').addEventListener('click',()=>{form.hidden=false;form.elements.name.focus();},{signal:scope.signal});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button');button.disabled=true;
    try{await collections.create(form.elements.name.value);scope.check();form.reset();form.hidden=true;await render();root.getElementById('saved-new').focus();}
    catch(error){if(!scope.signal.aborted)root.getElementById('saved-status').textContent=t('error');}
    finally{busy=false;button.disabled=false;}
  },{signal:scope.signal});
  return {open,render,visible:()=>sheet.classList.contains('shown')};
}
