export class TTLCache {
  #items = new Map();
  #inFlight = new Map();

  constructor(defaultTtlMs, maxEntries = 2000) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const item = this.#items.get(key);
    if (!item) {
      this.misses += 1;
      return undefined;
    }
    if (item.expiresAt <= Date.now()) {
      this.#items.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.#items.size >= this.maxEntries && !this.#items.has(key)) {
      const oldestKey = this.#items.keys().next().value;
      if (oldestKey !== undefined) this.#items.delete(oldestKey);
    }
    this.#items.delete(key);
    this.#items.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  async getOrCompute(key, producer, { ttlMs = this.defaultTtlMs, refresh = false } = {}) {
    if (!refresh) {
      const cached = this.get(key);
      if (cached !== undefined) return { value: cached, cacheHit: true, sharedInFlight: false };
    }
    if (this.#inFlight.has(key)) {
      return { value: await this.#inFlight.get(key), cacheHit: true, sharedInFlight: true };
    }
    const pending = Promise.resolve().then(producer);
    this.#inFlight.set(key, pending);
    try {
      const value = await pending;
      this.set(key, value, ttlMs);
      return { value, cacheHit: false, sharedInFlight: false };
    } finally {
      this.#inFlight.delete(key);
    }
  }

  delete(key) {
    return this.#items.delete(key);
  }

  deleteByPrefix(prefix) {
    let deleted = 0;
    for (const key of this.#items.keys()) {
      if (String(key).startsWith(prefix)) {
        this.#items.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  stats() {
    return { entries: this.#items.size, inFlight: this.#inFlight.size, hits: this.hits, misses: this.misses };
  }

  clear() {
    this.#items.clear();
    this.#inFlight.clear();
  }
}
