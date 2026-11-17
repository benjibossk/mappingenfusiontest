// "Mods" setting (Library page + Send step): tick the Workshop mods whose prefabs the generators may use
// (library/mods.ts, all off by default), and the addon dependencies a project needs because of them.
import { MOD_INDEX, enabledMods, onModsChange, requiredMods, setModEnabled } from './library/mods'
import { t } from './i18n'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** fieldset with one checkbox per registered mod; stays in sync with the other instances */
export function modsChecklist(): HTMLElement {
  const box = document.createElement('fieldset')
  box.className = 'mods'
  const render = () => {
    const on = new Set(enabledMods())
    box.innerHTML = `<legend>${t('mods.title')}</legend><p class="hint">${t('mods.lead')}</p>` + MOD_INDEX.map((m) =>
      `<label title="${esc(m.licence ?? '')} · ${Object.keys(m.families).length} ${t('mods.families')}"><input type="checkbox" data-mod="${m.guid}"${on.has(m.guid) ? ' checked' : ''}> ${esc(m.name)} <small>v${esc(m.version)} · ${m.count} prefabs · ${m.guid}</small></label>`).join('')
  }
  box.addEventListener('change', (e) => { const i = e.target as HTMLInputElement; if (i.dataset.mod) setModEnabled(i.dataset.mod, i.checked) })
  onModsChange(render)
  render()
  return box
}

/** one line per addon the placed prefabs require (to add to the target .gproj Dependencies), '' if none */
export function modDepsText(prefabs: Iterable<string>): string {
  const need = requiredMods(prefabs)
  return need.length ? t('mods.deps') + '\n' + need.map((m) => `  ${m.guid}  ${m.name}${m.version ? ' v' + m.version : ''}`).join('\n') : ''
}
