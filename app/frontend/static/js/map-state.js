/** Page state, DOM references and owned lifecycle handles. */
import { normalizeLang } from "./map-utils.js";

export const context = window.EGI_MAP_CONTEXT;

export const DEBUG_MODE = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

export const state = {
  categories: [],
  categoryTranslations: [],
  languages: [],
  pois: [],
  transitByPlace: {},
  focusSiteKey: null,
  transitAvailability: "loading",
  cityOptions: [],
  filters: {
    cats: new Set(), offersOff: new Set(),
    q: "", source: "", issue: "", access: "", audience: "", meal: "", level: "", section: "all", order: "name", openNow: false,
  },
  taxonomy: {needs: [], offers: [], audiences: [], access: [], meal_times: [], paths: [], course_levels: []},
  view: "map",
  userLoc: null,
  city: context.cityName || "Territorio",
  lang: normalizeLang(context.languageCode || "it"),
};

export const backdrop = document.getElementById("backdrop");

export const stage = document.getElementById("stage");

export const listView = document.getElementById("list-view");

export const viewToggle = document.getElementById("view-toggle");

export const viewToggleLabel = document.getElementById("view-toggle-label");

export const cityLabel = document.getElementById("city-label");

export const cityValue = document.getElementById("city-value");

export const langValue = document.getElementById("lang-value");

export const locStatus = document.getElementById("loc-status");

export const suggestions = document.getElementById("suggestions");

export const toast = document.getElementById("toast");

export const settingsBackHead = document.getElementById("settings-back-head");


export const runtime={map:null,markersLayer:null,transport:null,cycle:null,userMarker:null,cityBounds:null,
  sheetReturnFocus:null,originRequest:null,addressRequest:null,canonicalRefreshInFlight:false,lifecycle:null};

/** Own one page's listeners, timers and asynchronous request cancellation. */
export class Lifecycle {
  constructor(){ this.controller=new AbortController(); this.timers=new Set(); }
  get signal(){ return this.controller.signal; }
  every(callback,delay){ const id=setInterval(callback,delay); this.timers.add(id); return id; }
  dispose(){ this.controller.abort(); for(const id of this.timers) clearInterval(id); this.timers.clear(); }
}
