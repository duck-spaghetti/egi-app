/** Named local collections reuse the public snapshot/refresh contract of favorites. */
import {createStore, createFavorites} from './store.js';

export function createCollections({territory, store = createStore(), prepare = async () => {},
  request = globalThis.fetch, token = () => crypto.randomUUID(), now = () => new Date().toISOString()} = {}) {
  if (!territory || typeof territory !== 'string') throw Error('invalid-territory');
  const prefix = `collections:${JSON.stringify(territory)}:`;
  const keyFor = id => {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw Error('invalid-collection');
    return prefix + id;
  };
  const nameFor = value => {
    const name = String(value ?? '').trim();
    if (!name || name.length > 80) throw Error('invalid-name');
    return name;
  };
  async function list() {
    return (await store.all()).filter(row => row.key?.startsWith(prefix)).map(row => {
      if (row.key !== keyFor(row.id) || row.schema !== 1 || !Array.isArray(row.entries)) throw Error('storage-corrupt');
      return {...row, name: nameFor(row.name)};
    }).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async function create(name) {
    name = nameFor(name); await prepare();
    const id = token(), key = keyFor(id);
    await store.mutate(key, old => {
      if (old) throw Error('duplicate-collection');
      return {schema:1,key,id,name,createdAt:now(),entries:[]};
    });
    return id;
  }
  function rename(id,name) {
    name = nameFor(name);
    return store.mutate(keyFor(id), row => {
      if (!row) throw Error('collection-removed');
      return {...row,name};
    });
  }
  function remove(id) { return store.mutate(keyFor(id), () => null); }
  function cards(id) {
    const key = keyFor(id);
    const adapter = {
      all: async () => {
        const row = (await store.all()).find(row => row.key === key);
        if (!row) throw Error('collection-removed');
        return row.entries;
      },
      mutate: async (entryKey, update) => {
        let result;
        await store.mutate(key, row => {
          if (!row) throw Error('collection-removed');
          const old = row.entries.find(entry => entry.key === entryKey);
          const next = update(old); result = next;
          if (next === undefined) return undefined;
          const entries = row.entries.filter(entry => entry.key !== entryKey);
          if (next !== null) entries.push(next);
          return {...row,entries};
        });
        return result;
      },
    };
    return createFavorites({territory,store:adapter,prepare,request,token,now});
  }
  return {list,create,rename,remove,cards};
}
