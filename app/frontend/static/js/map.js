import {runtime,Lifecycle,listView,stage,state} from "./map-state.js";
/** Map page startup and disposal. */
import { loadData } from "./map-data.js";
import { refresh, renderFilters } from "./map-filters.js";
import { updateOpeningBadges } from "./map-hours.js";
import { applyShellTranslations, bindUi, renderSettings, syncFilterLayout, updateViewToggle } from "./map-shell.js";
import { initMap } from "./map-view.js";
export async function init() {
  await window.EGI_I18N.setLanguage(state.lang);
  applyShellTranslations();
  initMap();
  bindUi();
  syncFilterLayout();
  await loadData();
  if (runtime.lifecycle?.signal.aborted) return;
  renderFilters();
  renderSettings();
  refresh();
  runtime.lifecycle.every(updateOpeningBadges,30000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden) updateOpeningBadges();}, {signal: runtime.lifecycle?.signal});
}

/** Dispose page-owned work; repeated calls are safe. */
export function dispose(){
  runtime.lifecycle?.dispose(); runtime.originRequest?.abort(); runtime.addressRequest?.abort();
  runtime.transport?.dispose(); runtime.cycle?.dispose(); runtime.map?.remove();
  runtime.map=null; runtime.transport=null; runtime.cycle=null; runtime.lifecycle=null;
}
/** Start once and contain bootstrap errors without exposing response content. */
export async function start(){
  if(runtime.lifecycle) return;
  runtime.lifecycle=new Lifecycle();
  try { await init(); } catch(error) {
    if(runtime.lifecycle?.signal.aborted) return;
    document.getElementById("poi-list").innerHTML='<div class="empty-state"><p>Catalogo temporaneamente non disponibile. Riprova.</p></div>';
    state.view="list"; listView.classList.add("shown"); stage.classList.add("list-mode"); updateViewToggle();
  }
}
window.addEventListener("pagehide",dispose);
window.addEventListener("pageshow",event=>{if(event.persisted) void start();});
void start();
