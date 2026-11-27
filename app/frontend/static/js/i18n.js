import {normalizeLang} from "./format.js";
/** Per-page dictionary runtime; catalogues remain separate JSON files. */
export function createI18n(scope, http) {
  const cache = new Map();
  let currentLang = "it";
  let languageGeneration = 0;
  let currentMessages = {};
  let fallbackMessages = {};

  async function loadMessages(lang) {
    const code = normalizeLang(lang);
    if (cache.has(code)) {
      return cache.get(code);
    }

    const promise = http.request(`/translations/${code}.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .catch((error) => {
        scope.check();
        if (code === "it") return {};
        return loadMessages("it");
      });

    cache.set(code, promise);
    return promise;
  }

  /** Prepare a dictionary without mutating the active page; commit only the latest context. */
  async function prepareLanguage(lang) {
    const requested=normalizeLang(lang),generation=++languageGeneration;
    const fallback=await loadMessages("it");
    const messages=requested==="it"?fallback:await loadMessages(requested);
    scope.check();
    return {
      t:(key,params={},text="")=>translate(messages,fallback,key,params,text),
      commit(){
        scope.check();if(generation!==languageGeneration)return false;
        currentLang=requested;fallbackMessages=fallback;currentMessages=messages;
        document.documentElement.lang=currentLang;
        document.documentElement.dir=currentLang==="ar"?"rtl":"ltr";
        return true;
      },
    };
  }

  async function setLanguage(lang) {
    const prepared=await prepareLanguage(lang);
    prepared.commit();return currentMessages;
  }

  function translate(messages,fallback,key,params,text) {
    const value=lookup(messages,key)??lookup(fallback,key)??text;
    return typeof value==="string"?interpolate(value,params):text||key;
  }

  function t(key,params={},fallback="") {
    return translate(currentMessages,fallbackMessages,key,params,fallback);
  }

  function translatePage(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n, {}, node.textContent);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((node) => {
      node.innerHTML = t(node.dataset.i18nHtml, {}, node.innerHTML);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      node.setAttribute(
        "placeholder",
        t(node.dataset.i18nPlaceholder, {}, node.getAttribute("placeholder") || "")
      );
    });
    root.querySelectorAll("[data-i18n-title]").forEach((node) => {
      node.setAttribute("title", t(node.dataset.i18nTitle, {}, node.getAttribute("title") || ""));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
      node.setAttribute(
        "aria-label",
        t(node.dataset.i18nAriaLabel, {}, node.getAttribute("aria-label") || "")
      );
    });
  }

  function lookup(obj, key) {
    return key.split(".").reduce((acc, part) => (acc && part in acc ? acc[part] : undefined), obj);
  }

  function interpolate(template, params) {
    return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
  }


  return {
    setLanguage,
    prepareLanguage,
    t,
    translatePage,
    getCurrentLanguage: () => currentLang,
  };
}
