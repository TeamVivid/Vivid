let customStorage = null;

class MemoryStorage {
  constructor() {
    this.cache = new Map();
  }

  async get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value !== undefined ? item.value : item;
  }

  async set(key, value, ttlMs = 0) {
    const entry = {
      value,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0
    };
    this.cache.set(key, entry);
    if (this.cache.size > 2000) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    return true;
  }

  async has(key) {
    return (await this.get(key)) !== null;
  }

  async delete(key) {
    return this.cache.delete(key);
  }
}

const defaultStorage = new MemoryStorage();

export function setStorageAdapter(adapter) {
  customStorage = adapter;
}

export function getStorageAdapter() {
  return customStorage || defaultStorage;
}

export async function getCachedItem(key) {
  const s = getStorageAdapter();
  return s.get ? await s.get(key) : null;
}

export async function setCachedItem(key, value, ttlMs = 0) {
  const s = getStorageAdapter();
  if (s.set) await s.set(key, value, ttlMs);
}

export default {
  setStorageAdapter,
  getStorageAdapter,
  getCachedItem,
  setCachedItem
};
