// Mask painting worker (preview/finalMasks.ts): in { body, g }, out { ok: {side, names, bytes} } or { err }
import { paintPreview, type MaskBody, type previewGrid } from '../preview/finalMasks'

self.onmessage = (e: MessageEvent<{ body: MaskBody; g: ReturnType<typeof previewGrid> }>) => {
  try {
    const ok = paintPreview(e.data.body, e.data.g)
    ;(self as unknown as Worker).postMessage({ ok }, ok.bytes.map((b) => b.buffer as ArrayBuffer))
  } catch (err) {
    self.postMessage({ err: String((err as Error)?.message ?? err) })
  }
}
