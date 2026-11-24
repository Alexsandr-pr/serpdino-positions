/**
 * Process-level cache for loaded and already trimmed data (table rows, pages): SerpDino answers
 * are too big for the Next.js data cache, but the rows built from them are small.
 * Kept for the life of the server process, so a serverless instance keeps it only while it is warm.
 */
const store = new Map<string, { expires: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlSeconds: number, load: () => Promise<T>, { fresh = false } = {}): Promise<T> {
  if (ttlSeconds <= 0) return load();
  const now = Date.now();
  const hit = store.get(key);
  if (!fresh && hit && hit.expires > now) return hit.value as Promise<T>;

  const value = load();
  store.set(key, { expires: now + ttlSeconds * 1000, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > 200) {
    for (const [name, entry] of store) if (entry.expires <= now) store.delete(name);
  }
  return value;
}
