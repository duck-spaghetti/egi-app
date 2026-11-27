import {createCollections} from '../features/favorites/collections.js';
import {prepareOffline} from '../features/favorites/offline.js';
import {createPresentation} from '../features/services/presentation.js';
import {createI18n} from '../i18n.js';
import {Lifecycle,startPage} from '../lifecycle.js';
import {escapeHtml} from '../format.js';

export async function startLists(context = window.EGI_LISTS_CONTEXT, {scope=new Lifecycle(),collectionFactory=createCollections}={}) {
  const el=id=>document.getElementById(id);
  const languageSelect=el('lists-language'), select=el('lists-select'), status=el('lists-status');
  const requested=new URLSearchParams(location.search).get('lang');
  const language=['it','en','fr','ar'].includes(requested)?requested:'it';
  languageSelect.value=language;
  const i18n=createI18n(scope,{request:url=>fetch(url)});await i18n.setLanguage(language);scope.check();i18n.translatePage();
  const t=key=>i18n.t(`lists.${key}`), f=key=>i18n.t(`favorites.${key}`);
  document.title=`EGI — ${t('title')}`;
  languageSelect.addEventListener('change',()=>{location.href=`/preferiti/liste?${new URLSearchParams({lang:languageSelect.value})}${location.hash}`;},{signal:scope.signal});
  if(!context.canonical){status.textContent=f('canonicalOnly');
    document.querySelectorAll('form button,form input,#lists-select').forEach(node=>{node.disabled=true;});return;}
  const collections=collectionFactory({territory:context.territory,prepare:prepareOffline});
  let rows=[],selected=location.hash.slice(1),generation=0,busy=false;
  async function render() {
    const version=++generation;
    const current=await collections.list();scope.check();if(version!==generation)return;
    rows=current; if(!rows.some(row=>row.id===selected))selected=rows[0]?.id || '';
    select.innerHTML=rows.map(row=>`<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)} (${row.entries.length})</option>`).join('');
    select.value=selected;select.disabled=!rows.length;
    history.replaceState(null,'',`${location.pathname}${location.search}${selected?'#'+selected:''}`);
    el('lists-manage').hidden=!selected;el('collection-document').hidden=!selected;
    status.textContent=selected?'':t('empty');
    el('collection-cards').replaceChildren();if(!selected)return;
    const row=rows.find(row=>row.id===selected);
    el('lists-rename').elements.name.value=row.name;el('collection-title').textContent=row.name;
    const entries=await collections.cards(selected).list();scope.check();if(version!==generation)return;
    el('lists-print').disabled=!entries.length;
    if(!entries.length){const empty=document.createElement('p');empty.textContent=t('emptyCollection');el('collection-cards').append(empty);}
    for(const entry of entries){
      const article=document.createElement('article');article.className='favorite-card';
      if(entry.status==='saved'){
        const model=createPresentation({snapshot:()=>({categories:[],lang:entry.language}),context:{canonical:true},translate:i18n.t});
        const poi=model.normalizePublicService(entry.card);
        article.innerHTML=`<h2>${escapeHtml(model.serviceTitle(poi))}</h2><p>${escapeHtml(poi.address || '')}</p>
          ${model.renderInfoSection(poi)}${model.renderHoursSection(poi)}${model.renderContactsSection(poi)}${model.renderSourcesSection(poi)}`
          .replace(/id="(sec-[a-z]+)"/g,`id="$1-${entry.id}"`);
      }else{const title=document.createElement('h2');title.textContent=f('unavailable');article.append(title);}
      const meta=document.createElement('p');meta.className='favorite-meta';
      meta.textContent=`${f('updated')}: ${new Date(entry.updatedAt).toLocaleString(language)} · ${f('contentLanguage')}: ${entry.language.toUpperCase()}`;
      article.append(meta);
      const remove=document.createElement('button');remove.type='button';remove.className='collection-remove';remove.textContent=t('remove');
      const collection=selected;
      remove.addEventListener('click',()=>run(async()=>{await collections.cards(collection).remove(entry.id);await render();el('collection-title').focus();}),{signal:scope.signal});
      article.append(remove);el('collection-cards').append(article);
    }
  }
  async function run(action){
    if(busy)return;busy=true;
    const controls=[...document.querySelectorAll('.lists-controls button,.lists-controls input,.lists-controls select,.collection-remove')];
    const disabled=controls.map(node=>node.disabled);controls.forEach(node=>{node.disabled=true;});
    try{await action();}catch(error){if(!scope.signal.aborted)status.textContent=t('error');}
    finally{controls.forEach((node,index)=>{if(node.isConnected)node.disabled=disabled[index];});busy=false;
      select.disabled=!rows.length;el('lists-print').disabled=!el('collection-cards').querySelector('article');}
  }
  el('lists-create').addEventListener('submit',event=>{event.preventDefault();const name=event.currentTarget.elements.name.value;
    void run(async()=>{selected=await collections.create(name);el('lists-create').reset();await render();select.focus();});},{signal:scope.signal});
  el('lists-rename').addEventListener('submit',event=>{event.preventDefault();const name=event.currentTarget.elements.name.value;
    void run(async()=>{await collections.rename(selected,name);await render();select.focus();});},{signal:scope.signal});
  el('lists-delete').addEventListener('click',()=>{
    if(window.confirm(t('deleteConfirm')))void run(async()=>{await collections.remove(selected);selected='';await render();select.focus();});
  },{signal:scope.signal});
  async function refresh(){if(!selected)return;
    await run(async()=>{const {failures}=await collections.cards(selected).refresh();await render();status.textContent=t(failures?'refreshError':'refreshed');});}
  select.addEventListener('change',()=>{selected=select.value;void run(render).then(()=>{if(navigator.onLine)void refresh();});},{signal:scope.signal});
  el('lists-refresh').addEventListener('click',refresh,{signal:scope.signal});
  let printDetails=[];
  window.addEventListener('beforeprint',()=>{
    printDetails=[...el('collection-cards').querySelectorAll('details')].filter(node=>!node.open);
    printDetails.forEach(node=>{node.open=true;});
  },{signal:scope.signal});
  window.addEventListener('afterprint',()=>{printDetails.forEach(node=>{node.open=false;});printDetails=[];},{signal:scope.signal});
  el('lists-print').addEventListener('click',()=>{if(selected && !busy)window.print();},{signal:scope.signal});
  window.addEventListener('online',refresh,{signal:scope.signal});
  window.addEventListener('pageshow',()=>{if(!busy)void run(render);},{signal:scope.signal});
  window.addEventListener('focus',()=>{if(!busy)void run(render);},{signal:scope.signal});
  await run(render);if(navigator.onLine)void refresh();
}
if(globalThis.window?.EGI_LISTS_CONTEXT)startPage(()=>{
  const scope=new Lifecycle();return {mount:()=>startLists(window.EGI_LISTS_CONTEXT,{scope}),dispose:()=>scope.dispose()};
});
