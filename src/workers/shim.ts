// a worker has no localStorage: i18n reads it at import, give it an empty in-memory one (imported first)
const g = globalThis as unknown as { localStorage?: Storage }
if (typeof g.localStorage === 'undefined') {
  const m = new Map<string, string>()
  g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
}
export {}
