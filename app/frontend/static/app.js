const DAYS = [
  { value: 1, short: "Lun" },
  { value: 2, short: "Mar" },
  { value: 3, short: "Mer" },
  { value: 4, short: "Gio" },
  { value: 5, short: "Ven" },
  { value: 6, short: "Sab" },
  { value: 7, short: "Dom" },
];

const CATEGORY_PALETTE = {
  food: "var(--cat-food)",
  shelter: "var(--cat-shelter)",
  hygiene: "var(--cat-hygiene)",
  health: "var(--cat-health)",
  legal: "var(--cat-legal)",
  psych: "var(--cat-psych)",
  other: "var(--cat-other)",
};

const state = {
  step: 1,
  currentTab: "single",
  cities: [],
  categories: [],
  visibleCategories: [],
  categoryTranslations: [],
  languages: [],
  selectedCategoryId: null,
  selectedCost: "variable",
  detectedLanguageId: null,
  coordinates: { latitude: null, longitude: null },
};

const form = document.getElementById("contribution-form");
const citySelect = document.getElementById("city-select");
const catGrid = document.getElementById("cat-grid");
const titleInput = document.getElementById("title-input");
const addressInput = document.getElementById("address-input");
const sourceUrlInput = document.getElementById("source-url");
const notesInput = document.getElementById("notes-input");
const submittedByInput = document.getElementById("submitted-by");
const languageSelect = document.getElementById("language-select");
const costNotesInput = document.getElementById("cost-notes");
const accessNotesInput = document.getElementById("access-notes");
const contactsList = document.getElementById("contacts-list");
const mapMiniHint = document.getElementById("map-mini-hint");
const languageDetectionText = document.getElementById("language-detection-text");
const summaryList = document.getElementById("summary-list");
const payloadPreview = document.getElementById("payload-preview");
const submitResult = document.getElementById("submit-result");
const prevStepBtn = document.getElementById("prev-step-btn");
const nextStepBtn = document.getElementById("next-step-btn");
const submitBtn = document.getElementById("submit-btn");
const topbarStepName = document.getElementById("topbar-step-name");
const progressText = document.getElementById("progress-text");
const editorStepLabel = document.getElementById("editor-step-label");
const editorStepTitle = document.getElementById("editor-step-title");
const editorStepHint = document.getElementById("editor-step-hint");
const backBtn = document.getElementById("back-btn");
const bulkCsvInput = document.getElementById("bulk-csv-input");
const bulkCsvResult = document.getElementById("bulk-csv-result");
const params = new URLSearchParams(window.location.search);

bootstrap();

async function bootstrap() {
  try {
    await Promise.all([loadCities(), loadLanguages()]);
    preselectCity();
    preselectBrowserLanguage();
    await window.EGI_I18N.setLanguage(selectedAppLanguageCode());
    window.EGI_I18N.translatePage();
    renderPips();
    renderCostOptions();
    renderHoursRows();
    appendContactRow();
    bindEvents();
    await loadCategories();
    updateStepUi();
    syncPreview();
  } catch (error) {
    showSubmitMessage(`Errore di caricamento iniziale: ${error.message}`, true);
  }
}

function bindEvents() {
  backBtn.addEventListener("click", goBackToMap);
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  prevStepBtn.addEventListener("click", () => goToStep(state.step - 1));
  nextStepBtn.addEventListener("click", async () => {
    if (!(await validateStep())) return;
    if (state.step === stepMetaList().length - 1) {
      renderReview();
    }
    goToStep(state.step + 1);
  });
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", syncPreview);
  citySelect.addEventListener("change", async () => {
    await loadCategories();
    await ensureCoordinates(false);
    syncPreview();
  });
  notesInput.addEventListener("blur", autoDetectLanguage);
  addressInput.addEventListener("blur", () => ensureCoordinates(false));
  document.getElementById("geocode-btn").addEventListener("click", () => ensureCoordinates(true));
  document.getElementById("add-contact-btn").addEventListener("click", appendContactRow);
  bulkCsvInput.addEventListener("change", renderBulkSelection);
  contactsList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-contact]");
    if (!removeButton) return;
    removeButton.closest(".contact-row").remove();
    syncPreview();
  });
}

async function loadCities() {
  const response = await fetch("/api/public/areas");
  const areas = await readJson(response, "città");
  state.cities = areas.map(normalizeArea);
  citySelect.innerHTML = state.cities
    .map((city) => `<option value="${city.id}">${escapeHtml(city.name)} (${escapeHtml(city.countryCode)})</option>`)
    .join("");
}

async function loadLanguages() {
  const response = await fetch("/api/public/languages");
  state.languages = await readJson(response, "lingue");
  languageSelect.innerHTML = '<option value="">Automatico</option>' +
    state.languages
      .map((language) => `<option value="${language.id}">${escapeHtml(language.name_english)} (${escapeHtml(language.code)})</option>`)
      .join("");
}

async function loadCategories() {
  const cityId = Number(citySelect.value || 0);
  const [categoriesResponse, translationsResponse] = await Promise.all([
    fetch("/api/taxonomy/categories?sort_by=sort_order&sort_order=asc&limit=1000"),
    fetch("/api/i18n/category-translations?limit=1000"),
  ]);
  const categories = await readJson(categoriesResponse, "categorie");
  state.categoryTranslations = await readJson(translationsResponse, "traduzioni categorie");
  state.categories = applyCategoryLabels(
    categories
      .filter((category) => category.area_id == null || Number(category.area_id) === cityId)
      .map(normalizeCategory)
  );
  state.visibleCategories = state.categories;
  if (!state.visibleCategories.find((item) => item.id === state.selectedCategoryId)) {
    state.selectedCategoryId = state.visibleCategories[0]?.id || null;
  }
  renderCategories();
}

function preselectCity() {
  const queryCityId = Number(params.get("city_id") || 0);
  const queryCity = state.cities.find((item) => item.id === queryCityId);
  if (queryCity) {
    citySelect.value = String(queryCity.id);
    return;
  }
  const defaultCity = state.cities.find((item) => item.slug === "roma" || item.name.toLowerCase() === "roma") || state.cities[0];
  if (defaultCity) {
    citySelect.value = String(defaultCity.id);
  }
}

function preselectBrowserLanguage() {
  const queryLang = (params.get("lang") || "").toLowerCase();
  const queryLanguage = state.languages.find((item) => item.code.toLowerCase() === queryLang);
  if (queryLanguage) {
    state.detectedLanguageId = queryLanguage.id;
    languageSelect.value = String(queryLanguage.id);
    return;
  }
  const browserCode = currentLanguageCode();
  const language = state.languages.find((item) => item.code.toLowerCase() === browserCode);
  if (language) {
    state.detectedLanguageId = language.id;
    languageSelect.value = String(language.id);
  }
}

function renderPips() {
  const wrap = document.getElementById("pips");
  wrap.innerHTML = stepMetaList().map((_, index) => `<button class="pip${index === 0 ? " current" : ""}" type="button" data-step-jump="${index + 1}"></button>`).join("");
  wrap.querySelectorAll("[data-step-jump]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = Number(button.dataset.stepJump);
      if (target > state.step) {
        const valid = await validateStep();
        if (!valid) return;
      }
      if (target === stepMetaList().length) {
        renderReview();
      }
      goToStep(target);
    });
  });
}

function renderCategories() {
  catGrid.innerHTML = state.visibleCategories
    .map((category) => {
      const selected = category.id === state.selectedCategoryId ? " selected" : "";
      return `
        <button class="cat-tile${selected}" type="button" data-category-id="${category.id}">
          <span class="swatch" style="background:${escapeHtml(category.color || categoryColor(category.slug))}"></span>
          <span>${escapeHtml(category.label || category.slug)}</span>
        </button>
      `;
    })
    .join("");

  catGrid.querySelectorAll("[data-category-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCategoryId = Number(button.dataset.categoryId);
      renderCategories();
      syncPreview();
    });
  });
}

function renderCostOptions() {
  const costGrid = document.getElementById("cost-grid");
  costGrid.innerHTML = costOptionsList().map(
    (option) => `
      <button class="cost-tile${option.value === state.selectedCost ? " selected" : ""}" type="button" data-cost="${option.value}">
        ${escapeHtml(option.label)}
      </button>
    `
  ).join("");

  costGrid.querySelectorAll("[data-cost]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCost = button.dataset.cost;
      renderCostOptions();
      syncPreview();
    });
  });
}

function renderHoursRows() {
  const wrap = document.getElementById("hours-mini");
  wrap.innerHTML = DAYS.map(
    (day) => `
      <div class="hours-mini-row" data-day="${day.value}">
        <div class="dlabel">${day.short}</div>
        <div class="dctrl">
          <input type="time" data-hours-name="opens_at" />
          <span>-</span>
          <input type="time" data-hours-name="closes_at" />
          <label class="closed-tog">
            <input type="checkbox" data-hours-name="is_closed" />
            chiuso
          </label>
        </div>
      </div>
    `
  ).join("");
}

function appendContactRow() {
  const template = document.getElementById("contact-row-template");
  contactsList.append(template.content.cloneNode(true));
}

function updateStepUi() {
  document.querySelectorAll(".editor-step").forEach((stepNode) => {
    stepNode.classList.toggle("active", Number(stepNode.dataset.step) === state.step);
  });

  document.querySelectorAll(".pip").forEach((pip, index) => {
    pip.classList.toggle("done", index + 1 < state.step);
    pip.classList.toggle("current", index + 1 === state.step);
  });

  const meta = stepMetaList()[state.step - 1];
  topbarStepName.textContent = meta.name;
  progressText.textContent = `${state.step}/${stepMetaList().length}`;
  editorStepLabel.textContent = `Step ${state.step}`;
  editorStepTitle.textContent = meta.title;
  editorStepHint.textContent = meta.hint;
  prevStepBtn.disabled = state.step === 1;
  nextStepBtn.hidden = state.step === stepMetaList().length;
  submitBtn.hidden = state.step !== stepMetaList().length;
}

function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.getElementById("panel-single").classList.toggle("active", tabName === "single");
  document.getElementById("panel-csv").classList.toggle("active", tabName === "csv");
}

function goBackToMap() {
  const url = new URL("/map", window.location.origin);
  const cityId = params.get("city_id") || citySelect.value;
  const lang = params.get("lang") || selectedAppLanguageCode();
  if (cityId) {
    url.searchParams.set("city_id", cityId);
  }
  if (lang) {
    url.searchParams.set("lang", lang);
  }
  window.location.href = url.toString();
}

function goToStep(step) {
  state.step = Math.max(1, Math.min(stepMetaList().length, step));
  updateStepUi();
}

async function validateStep() {
  if (state.step === 1) {
    if (!citySelect.value || !state.selectedCategoryId) return false;
  }

  if (state.step === 2) {
    if (!titleInput.reportValidity()) return false;
    if (!addressInput.reportValidity()) return false;
    const ok = await ensureCoordinates(false);
    if (!ok) {
      showSubmitMessage("Non sono riuscito a trovare le coordinate del luogo.", true);
      return false;
    }
  }

  if (state.step === 4) {
    if (!notesInput.reportValidity()) return false;
    await autoDetectLanguage();
  }

  return true;
}

function syncPreview() {
  const category = selectedCategory();
  const title = titleInput.value.trim();
  const address = addressInput.value.trim();
  const notes = notesInput.value.trim();
  const costSummary = renderCostSummary();
  const hoursSummary = renderHoursSummary();
  const contactsSummary = renderContactsSummary();

  document.getElementById("card-strip").style.background = category?.color || categoryColor(category?.slug || "other");
  const catTag = document.getElementById("card-cat-tag");
  catTag.textContent = category?.label || "Categoria";
  catTag.classList.toggle("empty", !category);
  catTag.style.background = category ? category.color || categoryColor(category.slug) : "transparent";
  catTag.style.color = category ? "white" : "";

  const cardName = document.getElementById("card-name");
  cardName.textContent = title || "Nuovo servizio";
  cardName.classList.toggle("empty", !title);

  const cardAddress = document.getElementById("card-address");
  cardAddress.textContent = address || "Indirizzo da inserire";
  cardAddress.classList.toggle("empty", !address);

  renderSection("card-section-hours", "card-hours", hoursSummary, "Da inserire");
  renderSection("card-section-cost", "card-cost", costSummary, "Da inserire");
  renderSection("card-section-description", "card-description", notes, "Da inserire");
  renderSection("card-section-contacts", "card-contacts", contactsSummary, "Da inserire");

  const hasCoordinates = state.coordinates.latitude !== null && state.coordinates.longitude !== null;
  document.getElementById("card-view").classList.toggle("empty", !hasCoordinates);
  document.getElementById("card-view-text").textContent = hasCoordinates
    ? `${state.coordinates.latitude.toFixed(5)}, ${state.coordinates.longitude.toFixed(5)}`
    : "posizione mancante";
  mapMiniHint.textContent = hasCoordinates
    ? `${state.coordinates.latitude.toFixed(5)}, ${state.coordinates.longitude.toFixed(5)}`
    : "Coordinate non trovate";
}

function renderSection(sectionId, contentId, value, emptyText) {
  const section = document.getElementById(sectionId);
  const content = document.getElementById(contentId);
  if (value) {
    content.textContent = value;
    content.classList.remove("empty");
    section.classList.remove("empty");
    return;
  }
  content.textContent = emptyText;
  content.classList.add("empty");
  section.classList.add("empty");
}

function renderHoursSummary() {
  return collectHours()
    .map((item) => {
      const day = DAYS.find((entry) => entry.value === item.weekday)?.short || "?";
      if (item.is_closed) return `${day} chiuso`;
      return `${day} ${item.opens_at || "--:--"}-${item.closes_at || "--:--"}`;
    })
    .join(" · ");
}

function renderCostSummary() {
  const labels = {
    free: "Gratis",
    donation: "Donazione",
    variable: "Variabile",
    low_cost: "Basso costo",
    paid: "A pagamento",
  };
  const parts = [labels[state.selectedCost] || labels.variable];
  if (accessNotesInput.value.trim()) parts.push(accessNotesInput.value.trim());
  if (costNotesInput.value.trim()) parts.push(costNotesInput.value.trim());
  return parts.filter(Boolean).join(" · ");
}

function renderContactsSummary() {
  return collectContacts()
    .map((item) => `${item.type}: ${item.value}`)
    .join(" · ");
}

async function ensureCoordinates(forceMessage) {
  const cityId = Number(citySelect.value || 0);
  const address = addressInput.value.trim();
  if (!cityId || !address) return false;

  const city = selectedCity();
  if (!city || !Number.isFinite(city.centerLat) || !Number.isFinite(city.centerLng)) {
    if (forceMessage) {
      showSubmitMessage("Geocoding non disponibile per la città selezionata.", true);
    }
    return false;
  }

  state.coordinates.latitude = city.centerLat;
  state.coordinates.longitude = city.centerLng;
  mapMiniHint.textContent = `${city.name}: centro città usato come fallback`;
  if (forceMessage) {
    showSubmitMessage("Geocoding dedicato rimosso: uso il centro città come fallback temporaneo.", false);
  }
  syncPreview();
  return true;
}

async function autoDetectLanguage() {
  if (!notesInput.value.trim() && !titleInput.value.trim()) return;
  const selected = state.languages.find((language) => language.id === Number(languageSelect.value || 0));
  const fallbackCode = normalizeLang(params.get("lang") || navigator.language || "it");
  const fallback = state.languages.find((language) => normalizeLang(language.code) === fallbackCode)
    || state.languages.find((language) => normalizeLang(language.code) === "it")
    || state.languages[0];
  const language = selected || fallback || null;
  state.detectedLanguageId = language?.id || null;
  languageDetectionText.textContent = language
    ? `${language.name_english || language.code} · fallback`
    : "Lingua non rilevata";
}

function buildSubmission() {
  const languageId = Number(languageSelect.value || state.detectedLanguageId || 0) || null;
  const city = selectedCity();
  const category = selectedCategory();

  return {
    submission_type: "create",
    entity_type: "service",
    target_entity_id: null,
    submitter_user_id: Number(submittedByInput.value || 0) || null,
    status: "pending",
    priority: 5,
    area_id: Number(citySelect.value) || null,
    payload: {
      area_id: Number(citySelect.value),
      category_id: state.selectedCategoryId,
      language_id: languageId,
      name: titleInput.value.trim(),
      description: notesInput.value.trim(),
      cost_tag: state.selectedCost,
      latitude: state.coordinates.latitude,
      longitude: state.coordinates.longitude,
      address: addressInput.value.trim(),
      postal_code: null,
      source_url: sourceUrlInput.value.trim() || null,
      city_context: city ? { id: city.id, name: city.name, country_code: city.countryCode } : null,
      category_context: category ? { id: category.id, slug: category.slug, label: category.label } : null,
      details: {
        access_notes: accessNotesInput.value.trim() || null,
        cost_notes: costNotesInput.value.trim() || null,
        contacts: collectContacts(),
        hours: collectHours(),
      },
    },
    payload_diff: null,
    reviewer_user_id: null,
    reviewer_note: null,
    parent_submission_id: null,
    properties: {},
  };
}

function renderReview() {
  const submission = buildSubmission();
  const payload = submission.payload;
  const summary = {
    Città: payload.city_context?.name || "-",
    Categoria: payload.category_context?.label || payload.category_context?.slug || "-",
    Titolo: payload.name || "-",
    Lingua: detectedLanguageLabel(),
    Coordinate:
      payload.latitude !== null && payload.longitude !== null
        ? `${payload.latitude}, ${payload.longitude}`
        : "-",
    Contatti: String(payload.details.contacts.length),
    Orari: String(payload.details.hours.length),
  };

  summaryList.innerHTML = Object.entries(summary)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  payloadPreview.textContent = JSON.stringify(submission, null, 2);
}

async function handleSubmit(event) {
  event.preventDefault();
  renderReview();

  try {
    const response = await fetch("/api/gov/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSubmission()),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const result = await response.json();
    payloadPreview.textContent = JSON.stringify(result, null, 2);
    showSubmitMessage(`Submission creata con id ${result.id}.`, false);
  } catch (error) {
    showSubmitMessage(`Invio fallito: ${error.message}`, true);
  }
}

function showSubmitMessage(message, isError) {
  submitResult.hidden = false;
  submitResult.textContent = message;
  submitResult.classList.toggle("error", isError);
}

function collectContacts() {
  return Array.from(contactsList.querySelectorAll(".contact-row"))
    .map((row) => ({
      type: row.querySelector('[data-name="type"]').value,
      value: row.querySelector('[data-name="value"]').value.trim(),
    }))
    .filter((item) => item.value);
}

function collectHours() {
  return Array.from(document.querySelectorAll(".hours-mini-row"))
    .map((row) => ({
      weekday: Number(row.dataset.day),
      opens_at: row.querySelector('[data-hours-name="opens_at"]').value || null,
      closes_at: row.querySelector('[data-hours-name="closes_at"]').value || null,
      is_closed: row.querySelector('[data-hours-name="is_closed"]').checked,
    }))
    .filter((item) => item.is_closed || item.opens_at || item.closes_at);
}

function currentLanguageCode() {
  return (navigator.language || "it").split("-")[0].toLowerCase();
}

function selectedAppLanguageCode() {
  const selectedId = Number(languageSelect.value || state.detectedLanguageId || 0);
  const selected = state.languages.find((item) => item.id === selectedId);
  return (selected?.code || "it").toLowerCase();
}

function renderBulkSelection() {
  const files = Array.from(bulkCsvInput.files || []);
  bulkCsvResult.innerHTML = `
    <h4>Bulk CSV</h4>
    <div>${files.length === 0 ? window.EGI_I18N.t("contribute.bulk.empty") : window.EGI_I18N.t("contribute.bulk.selected_files", { count: files.length })}</div>
    ${
      files.length
        ? `<ul>${files.map((file) => `<li>${escapeHtml(file.name)}</li>`).join("")}</ul>`
        : ""
    }
  `;
}

function selectedCity() {
  return state.cities.find((item) => item.id === Number(citySelect.value || 0)) || null;
}

function selectedCategory() {
  return state.categories.find((item) => item.id === state.selectedCategoryId) || null;
}

function detectedLanguageLabel() {
  const selectedId = Number(languageSelect.value || state.detectedLanguageId || 0);
  const language = state.languages.find((item) => item.id === selectedId);
  return language ? `${language.name_english} (${language.code})` : "non rilevata";
}

function categoryColor(slug) {
  return CATEGORY_PALETTE[slug] || CATEGORY_PALETTE.other;
}

function stepMetaList() {
  return [
    {
      name: window.EGI_I18N.t("contribute.steps.category.name"),
      title: window.EGI_I18N.t("contribute.steps.category.title"),
      hint: window.EGI_I18N.t("contribute.steps.category.hint"),
    },
    {
      name: window.EGI_I18N.t("contribute.steps.essentials.name"),
      title: window.EGI_I18N.t("contribute.steps.essentials.title"),
      hint: window.EGI_I18N.t("contribute.steps.essentials.hint"),
    },
    {
      name: window.EGI_I18N.t("contribute.steps.hours.name"),
      title: window.EGI_I18N.t("contribute.steps.hours.title"),
      hint: window.EGI_I18N.t("contribute.steps.hours.hint"),
    },
    {
      name: window.EGI_I18N.t("contribute.steps.description.name"),
      title: window.EGI_I18N.t("contribute.steps.description.title"),
      hint: window.EGI_I18N.t("contribute.steps.description.hint"),
    },
    {
      name: window.EGI_I18N.t("contribute.steps.review.name"),
      title: window.EGI_I18N.t("contribute.steps.review.title"),
      hint: window.EGI_I18N.t("contribute.steps.review.hint"),
    },
  ];
}

function costOptionsList() {
  return [
    { value: "free", label: "Gratis" },
    { value: "donation", label: "Donazione" },
    { value: "variable", label: "Variabile" },
    { value: "low_cost", label: "Basso costo" },
    { value: "paid", label: "A pagamento" },
  ].map((item) => ({
    ...item,
    label:
      window.EGI_I18N.t(`contribute.cost.${item.value}`, {}, "") ||
      item.label,
  }));
}

async function readJson(response, label) {
  if (response.ok) return response.json();
  let detail = response.statusText;
  try {
    const payload = await response.json();
    detail = payload.detail?.message || payload.detail || detail;
  } catch (_error) {
    // Keep the HTTP status text when the body is not JSON.
  }
  throw new Error(`Errore caricando ${label}: ${detail}`);
}

function normalizeArea(area) {
  const center = pointLatLng(area.default_center);
  const bbox = bboxFromPolygon(area.geometry_bbox);
  return {
    id: area.id,
    slug: area.slug,
    name: area.name,
    countryCode: area.country_code,
    isDefault: area.slug === "roma" || area.name.toLowerCase() === "roma",
    centerLat: center.lat,
    centerLng: center.lng,
    bboxNorth: bbox.north,
    bboxSouth: bbox.south,
    bboxEast: bbox.east,
    bboxWest: bbox.west,
  };
}

function normalizeCategory(category) {
  return {
    id: category.id,
    area_id: category.area_id,
    slug: category.slug,
    label: category.slug,
    color: category.color,
    icon_path: category.icon_path,
    sort_order: category.sort_order,
  };
}

function applyCategoryLabels(categories) {
  const languageId = Number(languageSelect.value || state.detectedLanguageId || 0)
    || state.languages.find((language) => normalizeLang(language.code) === selectedAppLanguageCode())?.id
    || state.languages.find((language) => normalizeLang(language.code) === "it")?.id
    || null;
  return categories.map((category) => {
    const translation = state.categoryTranslations.find(
      (item) => item.category_id === category.id && item.language_id === languageId
    ) || state.categoryTranslations.find((item) => item.category_id === category.id);
    return {
      ...category,
      label: translation?.label || category.slug,
    };
  });
}

function pointLatLng(geojson) {
  if (!geojson || geojson.type !== "Point" || !Array.isArray(geojson.coordinates)) {
    return { lat: null, lng: null };
  }
  const [lng, lat] = geojson.coordinates;
  return { lat: Number(lat), lng: Number(lng) };
}

function bboxFromPolygon(geojson) {
  const ring = geojson?.type === "Polygon" && Array.isArray(geojson.coordinates)
    ? geojson.coordinates.flat(1)
    : [];
  const lngs = ring.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const lats = ring.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (!lngs.length || !lats.length) {
    return { north: null, south: null, east: null, west: null };
  }
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function normalizeLang(value) {
  return String(value || "it").split("-")[0].toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
