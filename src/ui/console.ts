// Journal console: every message of the app (step log, toasts, JS errors) in one place at the bottom,
// whatever step is open. A "Journal" button in the status bar opens a semi-opaque panel over the map.
import { getLang } from '../i18n'

type Kind = 'info' | 'ok' | 'err'
interface Entry { at: Date; kind: Kind; text: string; src: string }

const L = {
  fr: { open: 'Journal', title: 'Journal de l’app', clear: 'Vider', copy: 'Copier', close: 'Fermer', empty: 'Rien pour l’instant : les messages de chaque étape, les notifications et les erreurs arrivent ici.', all: 'Tout', errs: 'Erreurs', copied: 'Copié' },
  en: { open: 'Log', title: 'App log', clear: 'Clear', copy: 'Copy', close: 'Close', empty: 'Nothing yet: messages from every step, notifications and errors show up here.', all: 'All', errs: 'Errors', copied: 'Copied' },
}
const T = () => (getLang() === 'fr' ? L.fr : L.en)
const KEY = 'reforger-mapper.console'
const MAX = 500
const entries: Entry[] = []
let unread = 0, unreadErr = 0, onlyErr = false
let panel: HTMLElement | null = null, list: HTMLElement | null = null, btn: HTMLButtonElement | null = null

const hhmmss = (d: Date) => d.toTimeString().slice(0, 8)
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/** add a line to the journal (called by toast(), the step log observer and the error handlers) */
export function journal(text: string, kind: Kind = 'info', src = '') {
  const tx = text.trim()
  if (!tx) return
  const last = entries[entries.length - 1]
  if (last && last.text === tx && last.kind === kind && Date.now() - last.at.getTime() < 1500) return // same message twice in a row
  entries.push({ at: new Date(), kind, text: tx, src })
  if (entries.length > MAX) entries.shift()
  if (panel?.hidden !== false) { unread++; if (kind === 'err') unreadErr++ }
  render()
}

function render() {
  if (btn) {
    btn.dataset.err = unreadErr ? '1' : ''
    btn.querySelector('.jcount')!.textContent = unread ? String(unread) : ''
  }
  if (!list || panel?.hidden) return
  const rows = entries.filter((e) => !onlyErr || e.kind === 'err')
  list.innerHTML = rows.length
    ? rows.map((e) => `<li data-kind="${e.kind}"><time>${hhmmss(e.at)}</time>${e.src ? `<span class="jsrc">${esc(e.src)}</span>` : ''}<span class="jtext">${esc(e.text)}</span></li>`).join('')
    : `<li class="jempty">${T().empty}</li>`
  list.scrollTop = list.scrollHeight
}

function show(open: boolean) {
  if (!panel || !btn) return
  panel.hidden = !open
  btn.setAttribute('aria-expanded', String(open))
  btn.classList.toggle('active', open)
  if (open) { unread = 0; unreadErr = 0 }
  try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ }
  render()
}

/** mount once: button in the status bar, panel above it, hooks on the step log and on JS errors */
export function mountConsole(opts: { stepName: () => string }) {
  const t = T()
  const bar = document.querySelector('.statusbar')
  btn = document.createElement('button')
  btn.type = 'button'; btn.id = 'consoleBtn'; btn.className = 'jbtn'
  btn.setAttribute('aria-controls', 'consolePanel'); btn.setAttribute('aria-expanded', 'false')
  btn.innerHTML = `<svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>${t.open}</span><b class="jcount"></b>`
  bar?.prepend(btn)

  panel = document.createElement('section')
  panel.id = 'consolePanel'; panel.className = 'jpanel'; panel.hidden = true
  panel.setAttribute('role', 'log'); panel.setAttribute('aria-label', t.title)
  panel.innerHTML = `<header><b>${t.title}</b>
    <span class="jfilter" role="radiogroup"><button type="button" data-f="all" class="on" role="radio" aria-checked="true">${t.all}</button><button type="button" data-f="err" role="radio" aria-checked="false">${t.errs}</button></span>
    <span class="grow"></span>
    <button type="button" data-a="copy">${t.copy}</button><button type="button" data-a="clear">${t.clear}</button>
    <button type="button" data-a="close" class="jx" aria-label="${t.close}" title="${t.close}">✕</button></header><ol></ol>`
  list = panel.querySelector('ol')
  document.body.appendChild(panel)

  btn.addEventListener('click', () => show(!!panel?.hidden))
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return
    if (b.dataset.f) {
      onlyErr = b.dataset.f === 'err'
      panel!.querySelectorAll('.jfilter button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)) })
      render()
    } else if (b.dataset.a === 'clear') { entries.length = 0; render() }
    else if (b.dataset.a === 'close') show(false)
    else if (b.dataset.a === 'copy') {
      const txt = entries.map((x) => `${hhmmss(x.at)} [${x.kind}]${x.src ? ' ' + x.src : ''} ${x.text}`).join('\n')
      void navigator.clipboard?.writeText(txt).then(() => { b.textContent = T().copied; setTimeout(() => { b.textContent = T().copy }, 1200) }).catch(() => {})
    }
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel && !panel.hidden && panel.contains(document.activeElement)) show(false) })

  // the step log (#log in the side panel): every new text goes to the journal, tagged with the step
  const log = document.getElementById('log')
  if (log) new MutationObserver(() => journal(log.textContent ?? '', /erreur|error|échec|failed|impossible/i.test(log.textContent ?? '') ? 'err' : 'info', opts.stepName())).observe(log, { childList: true, characterData: true, subtree: true })
  // uncaught errors
  addEventListener('error', (e) => journal(e.message || String(e.error), 'err', 'JS'))
  addEventListener('unhandledrejection', (e) => journal(String((e.reason as Error)?.message ?? e.reason), 'err', 'JS'))

  let open = false
  try { open = localStorage.getItem(KEY) === '1' } catch { /* */ }
  show(open)
}
