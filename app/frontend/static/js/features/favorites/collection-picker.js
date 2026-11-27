import {createFavorites} from './store.js';
import {createCollections} from './collections.js';
import {prepareOffline} from './offline.js';
import {escapeHtml} from '../../format.js';

/** A dialog owns collection choice; the bookmark remains an independent quick save. */
export function createCollectionPicker({territory,scope,translate,notify,root=document,collectionFactory=createCollections,favorites=createFavorites({territory,prepare:prepareOffline}),changed=()=>{}}) {
  const collections = collectionFactory({territory,prepare:prepareOffline});
  const t = key => translate(`lists.${key}`);
  let dialog, opener, busy = false;
  scope.signal.addEventListener('abort',()=>dialog?.remove(),{once:true});
  return async function choose(control,id,language,savedCopy) {
    if (busy) return;
    busy = true; opener = control;
    try {
      const [rows,favoriteRows] = await Promise.all([collections.list(),favorites.list()]); scope.check();
      dialog?.remove(); dialog = root.createElement('dialog');
      dialog.className = 'collection-dialog';
      dialog.innerHTML = `<h2>${escapeHtml(t('add'))}</h2><form>
        <label>${escapeHtml(t('choose'))}<select name="collection"><option value="favorites">${escapeHtml(translate('favorites.title'))}${favoriteRows.some(row=>row.id===id) ? ' ✓' : ''}</option><option value="new">${escapeHtml(t('new'))}</option>
        ${rows.map(row=>`<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}${row.entries?.some(entry=>entry.id===id) ? ' ✓' : ''}</option>`).join('')}</select></label>
        <label data-new-name hidden>${escapeHtml(t('name'))}<input name="name" maxlength="80" autocomplete="off"></label>
        <p role="status" aria-live="polite"></p><div class="collection-actions">
        <button type="button" data-cancel>${escapeHtml(t('cancel'))}</button>
        <button type="button" data-remove hidden>${escapeHtml(t('remove'))}</button>
        <button type="submit">${escapeHtml(t('save'))}</button></div></form>`;
      root.body.append(dialog);
      const currentDialog=dialog,currentOpener=opener;
      const form = dialog.querySelector('form'), select = form.elements.collection, name = form.elements.name;
      const remove=currentDialog.querySelector('[data-remove]');
      const target=()=>select.value==='favorites'?favorites:collections.cards(select.value);
      function updateChoice(){
        name.required=select.value==='new';currentDialog.querySelector('[data-new-name]').hidden=!name.required;
        const entries=select.value==='favorites'?favoriteRows:rows.find(row=>row.id===select.value)?.entries || [];
        remove.hidden=!entries.some(entry=>entry.id===id);
      }
      select.addEventListener('change',updateChoice);updateChoice();
      const close = () => {currentDialog.close();currentOpener?.isConnected && currentOpener.focus();};
      dialog.querySelector('[data-cancel]').addEventListener('click',close);
      dialog.addEventListener('close',()=>{if(!form.querySelector('[type="submit"]').disabled)busy=false;currentOpener?.isConnected && currentOpener.focus();});
      remove.addEventListener('click',async()=>{
        if(form.querySelector('[type="submit"]').disabled)return;
        const submit=form.querySelector('[type="submit"]');submit.disabled=true;remove.disabled=true;
        try{await target().remove(id);scope.check();changed();close();notify(t('removed'));}
        catch(error){if(!scope.signal.aborted)currentDialog.querySelector('[role="status"]').textContent=t('error');}
        finally{submit.disabled=false;remove.disabled=false;if(!currentDialog.open)busy=false;}
      });
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;
        submit.disabled=true;select.disabled=true;name.disabled=true;
        try {
          const collection = select.value==='new' ? await collections.create(name.value) : select.value;
          // Keep a newly created collection selected if saving its first service fails.
          if (select.value==='new') {const option=root.createElement('option');option.value=collection;
            option.textContent=name.value.trim();select.append(option);select.value=collection;}
          const destination=collection==='favorites'?favorites:collections.cards(collection);
          if(savedCopy?.status==='saved')await destination.saveCopy(savedCopy);
          else await destination.save(id,language);scope.check();
          changed();close();notify(t('saved'));
        } catch(error) {
          if(!scope.signal.aborted)currentDialog.querySelector('[role="status"]').textContent=t('error');
        } finally {submit.disabled=false;select.disabled=false;name.disabled=false;if(!currentDialog.open)busy=false;}
      });
      dialog.showModal();
    } catch(error) {busy=false;if(!scope.signal.aborted)notify(t('error'));}
  };
}
