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

  async function setLanguage(lang) {
    const requested = normalizeLang(lang);
    const generation = ++languageGeneration;
    const fallback = await loadMessages("it");
    const messages = requested === "it" ? fallback : await loadMessages(requested);
    scope.check();
    if (generation !== languageGeneration) return;
    currentLang=requested;
    fallbackMessages=fallback;currentMessages=messages;
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";
    return currentMessages;
  }

  function t(key, params = {}, fallback = "") {
    const value = lookup(currentMessages, key) ?? lookup(fallbackMessages, key) ?? fallback;
    if (typeof value !== "string") {
      return fallback || key;
    }
    return interpolate(value, params);
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
    t,
    translatePage,
    getCurrentLanguage: () => currentLang,
  };
}
