export class FixedWindowRateLimiter {
  constructor({ limit, windowMs = 60000, maxClients = 10000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxClients = maxClients;
    this.clients = new Map();
  }

  consume(key) {
    const now = Date.now();
    let entry = this.clients.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + this.windowMs };
    entry.count += 1;
    this.clients.set(key, entry);
    if (this.clients.size > this.maxClients) {
      for (const [clientKey, value] of this.clients) {
        if (value.resetAt <= now || this.clients.size > this.maxClients) this.clients.delete(clientKey);
        if (this.clients.size <= this.maxClients) break;
      }
    }
    return {
      allowed: entry.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }
}
