// Export panel (Giorbev's vision §5): the state of every layer against what was last sent to Workbench.
//   empty  : nothing in this layer yet
//   ready  : made, never sent
//   sent   : sent and unchanged since
//   resend : changed since it was sent (or something it is built on changed)
export type ExportState = 'empty' | 'ready' | 'sent' | 'resend'
/** sig: one fingerprint per layer ('' = empty); sent: the fingerprints at the last send (null = never sent);
 *  up: which layers each layer is built on (a road edit makes the villages on it stale too) */
export function exportStates(sig: string[], sent: string[] | null, up: number[][] = []): ExportState[] {
  return sig.map((s, i) => {
    if (!s) return 'empty'
    if (!sent) return 'ready'
    const changed = sent[i] !== s || (up[i] ?? []).some((j) => sent[j] !== sig[j])
    if (changed) return sent[i] ? 'resend' : 'ready'
    return 'sent'
  })
}
