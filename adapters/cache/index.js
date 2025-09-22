// gogoworld-backend/adapters/cache/index.js
// Memory Cache Adapter (containers friendly)

const store = new Map();

function set(key, value, ttlMs = 60000) {
  const expiresAt = Date.now() + ttlMs;
  store.set(key, { value, expiresAt });
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function del(key) {
  store.delete(key);
}

function delByPrefix(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

function clear() {
  store.clear();
}

module.exports = { get, set, del, delByPrefix, clear };
