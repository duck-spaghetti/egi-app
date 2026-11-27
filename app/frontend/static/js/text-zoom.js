/** Apply a bounded local text-size preference without zooming map geometry or page layout. */
const KEY = 'egi-text-zoom';
const DEFAULT = 100, MAXIMUM = 200, STEP = 10;

export function textZoomValue(value) {
  const number = typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? Number(value) : NaN;
  return Number.isInteger(number) && number >= DEFAULT && number <= MAXIMUM && number % STEP === 0
    ? number : DEFAULT;
}

export function createTextZoom({root = document, storage, host = window} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch (error) { storage = null; }
  }
  let value = DEFAULT;
  try { value = textZoomValue(storage?.getItem(KEY)); } catch (error) { /* Text zoom still works for this visit. */ }

  function render() {
    root.documentElement.style.setProperty('--egi-text-scale', String(value / DEFAULT));
    root.querySelectorAll('[data-text-zoom]').forEach(row => {
      const active = root.activeElement;
      const decrease = row.querySelector('[data-zoom-action="decrease"]');
      const increase = row.querySelector('[data-zoom-action="increase"]');
      decrease.disabled = value === DEFAULT;
      increase.disabled = value === MAXIMUM;
      const reset = row.querySelector('[data-zoom-action="reset"]');
      if (value === DEFAULT && (active === reset || active === decrease)) increase.focus();
      if (value === MAXIMUM && active === increase) decrease.focus();
      reset.hidden = value === DEFAULT;
      row.querySelector('[data-zoom-value]').textContent = `${value}%`;
    });
    measureBanner();
    host.dispatchEvent?.(new Event('resize'));
  }
  function measureBanner() {
    const banner = root.querySelector('.preview-banner');
    if (banner) root.documentElement.style.setProperty('--egi-banner-height', `${Math.ceil(banner.getBoundingClientRect().height)}px`);
  }
  function apply(next, persist = true) {
    value = textZoomValue(next); render();
    if (persist) {
      try {
        if (value === DEFAULT) storage?.removeItem(KEY); else storage?.setItem(KEY, String(value));
      } catch (error) { /* A denied preference write must not prevent larger text. */ }
    }
  }
  function click(event) {
    const button = event.target.closest?.('[data-zoom-action]');
    if (!button || button.disabled || !button.closest('[data-text-zoom]')) return;
    const action = button.dataset.zoomAction;
    if (action === 'reset') apply(DEFAULT);
    if (action === 'increase') apply(Math.min(MAXIMUM, value + STEP));
    if (action === 'decrease') apply(Math.max(DEFAULT, value - STEP));
  }
  function synchronize(event) {
    if (event.storageArea && storage && event.storageArea !== storage) return;
    if (event.key === KEY || event.key === null) apply(textZoomValue(event.newValue), false);
  }
  root.addEventListener('click', click);
  host.addEventListener('storage', synchronize);
  const banner = root.querySelector('.preview-banner');
  const observer = banner && globalThis.ResizeObserver ? new ResizeObserver(() => {
    measureBanner(); host.dispatchEvent?.(new Event('resize'));
  }) : null;
  if (observer) observer.observe(banner);
  render();
  return {dispose() {
    root.removeEventListener('click', click); host.removeEventListener('storage', synchronize);
    observer?.disconnect();
  }};
}

if (globalThis.document?.documentElement?.hasAttribute?.('data-text-zoom-enabled')) createTextZoom();
