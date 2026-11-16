// The tracing / satellite image survives a page reload: kept as a Blob in IndexedDB (localStorage is far
// too small for a picture). Every call is best effort: private windows or blocked storage just return null.

const DB = 'reforger-mapper', STORE = 'kv', KEY = 'trace'
/** above this the image is not kept (IndexedDB quotas vary, a 4k ortho JPEG is ~5 MB) */
export const TRACE_MAX_BYTES = 40 * 1024 * 1024

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await open()
    return await new Promise<T | null>((res) => {
      const q = f(db.transaction(STORE, mode).objectStore(STORE))
      q.onsuccess = () => res((q.result as T) ?? null)
      q.onerror = () => res(null)
    })
  } catch { return null }
}

/** a canvas (satellite tiles stitched by the real-world import) becomes a JPEG blob */
export function toBlob(src: HTMLImageElement | HTMLCanvasElement | Blob): Promise<Blob | null> {
  if (src instanceof Blob) return Promise.resolve(src)
  if (src instanceof HTMLCanvasElement) return new Promise((res) => { try { src.toBlob((b) => res(b), 'image/jpeg', 0.85) } catch { res(null) } })
  return fetch(src.src).then((r) => r.blob()).catch(() => null)
}

export async function saveTrace(src: HTMLImageElement | HTMLCanvasElement | Blob | null): Promise<boolean> {
  if (!src) { await tx('readwrite', (s) => s.delete(KEY)); return true }
  const b = await toBlob(src)
  if (!b || b.size > TRACE_MAX_BYTES) return false
  return (await tx('readwrite', (s) => s.put(b, KEY))) !== null
}

export async function loadTrace(): Promise<HTMLImageElement | null> {
  const b = await tx<Blob>('readonly', (s) => s.get(KEY))
  if (!(b instanceof Blob)) return null
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => res(null)
    img.src = URL.createObjectURL(b)
  })
}

/** data: URL for a saved project file, or null when the picture is too big to embed (> 8 MB) */
export async function traceDataUrl(src: HTMLImageElement | HTMLCanvasElement): Promise<string | null> {
  const b = await toBlob(src)
  if (!b || b.size > 8 * 1024 * 1024) return null
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(b) })
}
