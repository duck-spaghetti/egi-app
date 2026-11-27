/** Persist public favorite snapshots; refresh never revives a removed or newer entry. */
const DATABASE = 'egi-favorites';
const VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined)
  .map(key => [key, structuredClone(value[key])]));
const rows = (value, keys) => (Array.isArray(value) ? value : []).map(row => pick(row, keys));

/** Copy only fields used by public card presentation, including supplementary attribution. */
export function publicCard(value, identifier = value?.id) {
  if (!value || !UUID.test(String(value.id)) || value.id !== identifier ||
      value.data_status !== 'approved_canonical_local' || typeof value.name !== 'string') {
    throw Error('invalid-card');
  }
  const card = pick(value, ['id', 'revision_id', 'data_status', 'name', 'service_title',
    'description', 'needs', 'course_levels', 'cost_tag', 'cost_note', 'delivery_mode',
    'operational_status', 'place_id', 'valid_from', 'valid_until', 'source_code', 'observed_at']);
  card.category = pick(value.category, ['id', 'slug', 'label', 'color', 'icon_path', 'sort_order']);
  // The offline view never needs a point, a visitor location or a current opening result.
  card.place = pick(value.place, ['id', 'address', 'coordinate_state', 'is_protected_address']);
  if (card.place.is_protected_address) delete card.place.address;
  card.contacts = rows((value.contacts || []).filter(row => row.is_active !== false),
    ['type', 'value', 'is_active', 'label']);
  card.conditions = rows(value.conditions, ['text', 'state', 'kind', 'source_name', 'revision_id']);
  card.sources = rows(value.sources, ['name', 'source_name', 'source_url', 'license',
    'observed_at', 'published_at', 'is_primary']);
  card.linked_sources = rows(value.linked_sources, ['source_name', 'revision_id']);
  for (const key of ['offers', 'audiences', 'access_tags', 'meal_times']) {
    card[key] = rows(value[key], ['code', 'label', 'basis', 'interpreted']);
  }
  card.hours_display = {days: (value.hours_display?.days || []).map(day => ({
    ...pick(day, ['day', 'label', 'state']),
    intervals: rows(day.intervals, ['label', 'opens_raw', 'closes_raw', 'review_note']),
  }))};
  return card;
}

/** Open a versioned object store; denied/blocked upgrades are visible and never delete data. */
export function createStore(factory = globalThis.indexedDB) {
  let opening;
  function open() {
    if (!factory) return Promise.reject(Error('storage-unavailable'));
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, VERSION);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('cards')) {
          request.result.createObjectStore('cards', {keyPath: 'key'});
        }
      };
      request.onblocked = () => { failed = true; reject(Error('storage-blocked')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
    }).catch(error => { opening = undefined; throw error; });
    return opening;
  }
  async function transaction(mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cards', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('storage-failed'));
      try { run(tx.objectStore('cards'), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    all: () => transaction('readonly', (store, done) => {
      store.getAll().onsuccess = event => done(event.target.result);
    }),
    mutate: (key, update) => transaction('readwrite', (store, done) => {
      store.get(key).onsuccess = event => {
        try {
          const next = update(event.target.result);
          if (next === undefined) return done(event.target.result);
          if (next === null) store.delete(key); else store.put(next);
          done(next);
        } catch (error) { store.transaction.abort(); }
      };
    }),
  };
}

/** Own favorites for one territory and mode, with bounded, coalesced public refresh. */
export function createFavorites({territory, store = createStore(), request = globalThis.fetch,
  prepare = async () => {}, now = () => new Date().toISOString(), token = () => crypto.randomUUID()} = {}) {
  if (typeof territory !== 'string' || !territory) throw Error('invalid-territory');
  const prefix = JSON.stringify([territory, 'canonical']);
  const keyFor = id => {
    if (!UUID.test(String(id))) throw Error('invalid-identifier');
    return `${prefix}:${id}`;
  };
  let refreshing;
  async function list() {
    const entries = (await store.all()).filter(row => row.key?.startsWith(`${prefix}:`));
    for (const row of entries) {
      if (row.schema !== VERSION || !UUID.test(String(row.id)) || row.key !== keyFor(row.id) ||
          typeof row.language !== 'string' || !row.savedAt || !row.token ||
          !['saved', 'unavailable'].includes(row.status)) throw Error('storage-corrupt');
      if (row.status === 'saved') row.card = publicCard(row.card, row.id);
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async function read(id, language) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await request(`/api/public/services/${id}?${new URLSearchParams({language})}`,
        {cache: 'no-store', credentials: 'omit', signal: controller.signal});
      if (response.headers.get('X-EGI-Data-Status') !== 'approved-canonical-local') {
        throw Error('canonical-response-required');
      }
      if (response.status === 404) return null;
      if (!response.ok) throw Error('refresh-failed');
      return publicCard(await response.json(), id);
    } finally { clearTimeout(timeout); }
  }
  async function save(id, language = 'it') {
    const key = keyFor(id);
    // Prepare all shell assets before promising offline availability or committing a new entry.
    await prepare();
    const card = await read(id, language);
    if (!card) throw Error('service-unavailable');
    const time = now();
    return store.mutate(key, old => ({schema: VERSION, key, id, language, card, status: 'saved',
      savedAt: old?.savedAt || time, updatedAt: time, token: token()}));
  }
  async function saveCopy(entry) {
    if (entry?.status !== 'saved' || !entry.updatedAt || !entry.savedAt || typeof entry.language !== 'string') throw Error('invalid-copy');
    const card = publicCard(entry.card, entry.id), key = keyFor(entry.id);
    await prepare();
    return store.mutate(key, old => old ? undefined : ({schema:VERSION,key,id:entry.id,language:entry.language,
      card,status:'saved',savedAt:now(),updatedAt:entry.updatedAt,token:token()}));
  }
  function remove(id) { return store.mutate(keyFor(id), () => null); }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const queue = await list();
      let failures = 0;
      await Promise.all(Array.from({length: Math.min(3, queue.length)}, async () => {
        while (queue.length) {
          const entry = queue.shift();
          try {
            const card = await read(entry.id, entry.language);
            await store.mutate(entry.key, current => {
              if (!current || current.token !== entry.token) return undefined;
              const changed = {schema: VERSION, key: entry.key, id: entry.id, language: entry.language,
                savedAt: entry.savedAt, updatedAt: now(), token: token()};
              return card ? {...changed, status: 'saved', card} : {...changed, status: 'unavailable'};
            });
          } catch (error) { failures++; }
        }
      }));
      return {failures};
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }
  return {list, save, saveCopy, remove, refresh};
}
