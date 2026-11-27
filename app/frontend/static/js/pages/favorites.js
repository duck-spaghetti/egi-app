import {createCollectionPicker} from '../features/favorites/collection-picker.js';
/** Render saved public cards without mounting a map or caching public API responses. */
import {createFavorites} from '../features/favorites/store.js';
import {prepareOffline} from '../features/favorites/offline.js';
import {bookmarkIcon} from '../features/favorites/controls.js';
import {createPresentation} from '../features/services/presentation.js';
import {createI18n} from '../i18n.js';
import {Lifecycle} from '../lifecycle.js';
import {escapeHtml} from '../format.js';

export async function startFavorites(context = window.EGI_FAVORITES_CONTEXT) {
  const scope = new Lifecycle();
  const status = document.getElementById('favorites-status');
  const list = document.getElementById('favorites-list');
  const refreshButton = document.getElementById('favorites-refresh');
  const languageSelect = document.getElementById('favorites-language');
  const requested = new URLSearchParams(location.search).get('lang');
  const language = ['it', 'en', 'fr', 'ar'].includes(requested) ? requested : 'it';
  languageSelect.value = language;
  const i18n = createI18n(scope, {request: url => fetch(url)});
  await i18n.setLanguage(language);
  i18n.translatePage();
  const message = key => i18n.t(`favorites.${key}`);
  document.title = `EGI — ${message('title')}`;
  languageSelect.addEventListener('change', () => {
    location.href = `/preferiti?${new URLSearchParams({lang: languageSelect.value})}`;
  }, {signal: scope.signal});
  if (!context.canonical) {
    status.textContent = message('canonicalOnly'); list.setAttribute('aria-busy', 'false');
    refreshButton.disabled = true; return;
  }
  const favorites = createFavorites({territory: context.territory, prepare: prepareOffline});
  const chooseList=createCollectionPicker({territory:context.territory,scope,translate:i18n.t,favorites,changed:()=>{void render();},notify:message=>{status.textContent=message;}});
  let rendering = 0;
  async function render(focusId) {
    const generation = ++rendering;
    const entries = await favorites.list();
    if (generation !== rendering) return;
    const active = document.activeElement;
    const activeCard = active?.closest?.('[data-favorite-card]');
    const focus = activeCard ? {id: activeCard.dataset.favoriteCard,
      remove: active.hasAttribute('data-remove-favorite'), href: active.getAttribute('href')} : null;
    const expanded = new Set([...list.querySelectorAll('details[data-favorite][open]')].map(el => el.dataset.favorite));
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p'); empty.textContent = message('empty'); list.append(empty);
    }
    for (const entry of entries) {
      const article = document.createElement('article'); article.className = 'favorite-card';
      article.dataset.favoriteCard = entry.id;
      let body = '';
      if (entry.status === 'saved') {
        const model = createPresentation({snapshot: () => ({categories: [], lang: entry.language}),
          context: {canonical: true}, translate: i18n.t});
        const poi = model.normalizePublicService(entry.card);
        body = `<details data-favorite="${entry.id}"${expanded.has(entry.id) ? ' open' : ''}>
          <summary>${escapeHtml(model.serviceTitle(poi))}</summary>
          <p>${escapeHtml(poi.address || '')}</p>
          ${model.renderInfoSection(poi)}${model.renderHoursSection(poi)}
          ${model.renderContactsSection(poi)}${model.renderSourcesSection(poi)}</details>`
          .replace(/id="(sec-[a-z]+)"/g, `id="$1-${entry.id}"`);
      } else {
        body = `<h2>${escapeHtml(message('unavailable'))}</h2><p>${escapeHtml(message('removedDetails'))}</p>`;
      }
      article.innerHTML = `${body}<p class="favorite-meta">${escapeHtml(message('updated'))}: ${escapeHtml(new Date(entry.updatedAt).toLocaleString(language))}
        · ${escapeHtml(message('contentLanguage'))}: ${escapeHtml(entry.language.toUpperCase())}</p>`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'favorite-toggle'; remove.innerHTML = bookmarkIcon();
      remove.setAttribute('aria-pressed', 'true');
      remove.setAttribute('aria-label', `${message('remove')} · ${entry.status === 'saved' ? entry.card.name : message('unavailable')}`);
      remove.setAttribute('title', message('remove')); remove.dataset.removeFavorite = entry.id;
      remove.setAttribute('aria-label',`${i18n.t('lists.savePlace')} · ${entry.status==='saved'?entry.card.name:message('unavailable')}`);
      remove.addEventListener('click',()=>chooseList(remove,entry.id,entry.language,entry));
      article.append(remove);
      list.append(article);
    }
    list.setAttribute('aria-busy', 'false');
    if (focusId) (list.querySelector('[data-remove-favorite]') || refreshButton).focus();
    else if (focus) {
      const article = list.querySelector(`[data-favorite-card="${focus.id}"]`);
      const link = focus.href && [...(article?.querySelectorAll('a[href]') || [])]
        .find(node => node.getAttribute('href') === focus.href);
      const target = focus.remove ? article?.querySelector('button') : link || article?.querySelector('summary');
      (target || article?.querySelector('button') || refreshButton).focus();
    }
  }
  let refreshing;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshButton.disabled = true; status.textContent = message('refreshing');
    refreshing = (async () => {
      try {
        const {failures} = await favorites.refresh();
        await render(); status.textContent = message(failures ? 'refreshError' : 'refreshed');
      } catch (error) { status.textContent = message('storageError'); }
      finally { refreshButton.disabled = false; refreshing = undefined; }
    })();
    return refreshing;
  }
  refreshButton.addEventListener('click', refresh, {signal: scope.signal});
  window.addEventListener('online', refresh, {signal: scope.signal});
  window.addEventListener('offline', () => { status.textContent = message('offline'); }, {signal: scope.signal});
  window.addEventListener('pageshow', () => { void render().catch(() => { status.textContent = message('storageError'); }); }, {signal: scope.signal});
  try {
    await render();
    if (navigator.onLine) void refresh(); else status.textContent = message('offline');
  } catch (error) { status.textContent = message('storageError'); list.setAttribute('aria-busy', 'false'); }
}

if (globalThis.window?.EGI_FAVORITES_CONTEXT) void startFavorites();
