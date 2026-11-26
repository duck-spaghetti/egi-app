/** Private card state, immutable save attempts and explicit three-way conflict recovery. */
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parts = path => path.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
const pointer = keys => '/' + keys.map(x => String(x).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
export function readPath(value, path) {
  return parts(path).reduce((node, key) => node?.[key], value);
}
function writePath(value, path, next) {
  const keys = parts(path), last = keys.pop();
  let node = value;
  for (const key of keys) node = node[key] ??= {};
  if (next === undefined) delete node[last];
  else node[last] = clone(next);
}
function related(a, b) { return a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); }
function edited(payload, path, value) {
  writePath(payload, path, value);
  payload.evidence = payload.evidence.filter(e => !related(e.path, path));
  for (const old of Object.keys(payload.field_origins)) if (old.startsWith(path + '/')) delete payload.field_origins[old];
  if (path.startsWith('/service/') || path.startsWith('/location/')) {
    payload.field_origins[path] = {state: value === undefined ? 'cleared' : 'manual'};
  }
}
function changes(base, next, keys = []) {
  if (equal(base, next)) return [];
  if (base && next && !Array.isArray(base) && !Array.isArray(next) && typeof base === 'object' && typeof next === 'object') {
    return [...new Set([...Object.keys(base), ...Object.keys(next)])].flatMap(key => changes(base[key], next[key], [...keys, key]));
  }
  return [{path: pointer(keys), value: next}];
}
export class PreparationDraft {
  constructor(item, version) {
    this.item = item;
    this.version = version.id;
    this.base = clone(version.payload);
    this.payload = clone(version.payload);
    this.pending = null;
    this.conflicted = false;
  }
  get dirty() { return !equal(this.base, this.payload); }
  edit(path, value) { edited(this.payload, path, value); }
  attempt(key) {
    if (!this.pending) this.pending = {key, payload: clone(this.payload), version: this.version};
    return {request_key: this.pending.key, changes: [{item_id: this.item, expected_version: this.pending.version, payload: clone(this.pending.payload)}]};
  }
  acknowledge(receipt) {
    this.version = receipt.items.find(item => item.item_id === this.item).after;
    this.base = this.pending.payload;
    this.pending = null;
    this.conflicted = false;
  }
  rebase(remote, choices = {}) {
    const local = ['service', 'location', 'target', 'outcome'].flatMap(key => changes(this.base[key], this.payload[key], [key]));
    const conflicts = local.filter(change => !equal(readPath(remote.payload, change.path), readPath(this.base, change.path)) && !equal(readPath(remote.payload, change.path), change.value));
    if (conflicts.some(change => !['local', 'remote'].includes(choices[change.path]))) return conflicts.map(change => ({...change, remote: readPath(remote.payload, change.path)}));
    const payload = clone(remote.payload);
    for (const change of local) if (choices[change.path] !== 'remote') edited(payload, change.path, change.value);
    this.base = clone(remote.payload);
    this.version = remote.id;
    this.payload = payload;
    this.pending = null;
    this.conflicted = false;
    return [];
  }
}
