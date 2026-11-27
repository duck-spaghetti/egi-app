/** Keep bookmark controls in cards and list rows in sync with committed local favorites. */
import {escapeHtml} from '../../format.js';

export function bookmarkIcon() {
  return '<svg class="bookmark-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/static/assets/icons/ui/bookmark.svg#bookmark"></use></svg>';
}

export function createFavoriteControls({favorites, scope, translate, notify, changed, chooseList, listSaved = async()=>[], root = document}) {
  let entries = [], savedIds = new Set(), ready = false, generation = 0;
  const pending = new Set();
  const t = key => translate(`favorites.${key}`);
  const selected = id => savedIds.has(id);
  function button(id, title, position) {
    return `<button type="button" class="favorite-toggle" id="favorite-${position}-${escapeHtml(id)}"
      data-favorite-id="${escapeHtml(id)}" data-favorite-title="${escapeHtml(title)}"
      aria-pressed="${selected(id)}" aria-label="${escapeHtml(chooseList ? translate('lists.savePlace') : t(selected(id) ? 'remove' : 'add'))} · ${escapeHtml(title)}"
      ${!ready || pending.has(id) ? 'disabled' : ''}>${bookmarkIcon()}</button>`;
  }
  function sync() {
    root.querySelectorAll('[data-favorite-id]').forEach(control => {
      const saved = selected(control.dataset.favoriteId);
      const label = `${chooseList ? translate('lists.savePlace') : t(saved ? 'remove' : 'add')} · ${control.dataset.favoriteTitle}`;
      control.setAttribute('aria-pressed', String(saved));
      control.setAttribute('aria-label', label);
      control.setAttribute('title', ready ? label : t('storageError'));
      control.setAttribute('aria-busy', String(pending.has(control.dataset.favoriteId)));
      control.disabled = !ready || pending.has(control.dataset.favoriteId);
    });
  }
  async function load(report = false) {
    const current = ++generation;
    try {
      const [data,otherIds] = await Promise.all([favorites.list(),listSaved()]); scope.check();
      if (current !== generation) return false;
      entries = data; savedIds = new Set([...data.map(entry => entry.id),...otherIds]); ready = true;
      sync(); changed(); return true;
    } catch (error) {
      if (!scope.signal.aborted && current === generation) {
        ready = false; sync(); if (report) notify(t('storageError'));
      }
      return false;
    }
  }
  async function toggle(control) {
    const id = control.dataset.favoriteId;
    if (!ready || pending.has(id)) return;
    const saved = selected(id), focus = root.activeElement === control;
    const controlId = control.id;
    const language = control.closest('[data-language]')?.dataset.language || root.documentElement.lang || 'it';
    pending.add(id); generation++; sync();
    try {
      if (saved) await favorites.remove(id); else await favorites.save(id, language);
      scope.check(); const loaded = await load(true); scope.check();
      if (!loaded) return;
      notify(t(saved ? 'removed' : 'saved'));
    } catch (error) { if (!scope.signal.aborted) notify(t('saveError')); }
    finally {
      pending.delete(id);
      if (!scope.signal.aborted) {
        sync();
        if (focus && (root.activeElement === root.body || root.activeElement === control)) {
          const replacement = root.getElementById(controlId)
            || root.querySelector('#poi-list [data-favorite-id]') || root.getElementById('list-title');
          replacement?.focus();
        }
      }
    }
  }
  root.addEventListener('click', event => {
    const control = event.target.closest?.('[data-favorite-id]');
    if (!control || control.disabled) return;
    event.stopPropagation();
    if(chooseList)void chooseList(control,control.dataset.favoriteId,
      control.closest('[data-language]')?.dataset.language || root.documentElement.lang || 'it',
      entries.find(entry=>entry.id===control.dataset.favoriteId));
    else void toggle(control);
  }, {signal: scope.signal});
  return {button, sync, load, entries: () => entries};
}
