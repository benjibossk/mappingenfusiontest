// In-app "What's new" — single source for the panel, the status-bar version and the update toast.
// The newest entry comes first and its version must equal package.json (npm run check:changelog).
// Keep the bullets short and user-facing; the full detail lives in CHANGELOG.md / CHANGELOG.fr.md.

export interface ChangelogItem { en: string; fr: string }
export interface ChangelogEntry { version: string; date: string; items: ChangelogItem[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.5.0',
    date: '2026-11-16',
    items: [
      { en: 'A guided interface: a welcome screen, then 7 numbered steps from relief to sending to Workbench.', fr: 'Une interface guidée : un écran d\'accueil, puis 7 étapes numérotées, du relief à l\'envoi vers Workbench.' },
      { en: 'Random world: one number makes a whole map, tuned on Everon, Arland and Kolguyev.', fr: 'Monde aléatoire : un seul nombre fait une carte entière, réglée sur Everon, Arland et Kolguyev.' },
      { en: 'Livelier villages: organic streets, farm yards, gardens, a church, ports.', fr: 'Villages plus vivants : rues organiques, cours de ferme, jardins, une église, des ports.' },
      { en: 'Industrial zones, military bases and airfields, with suggested spots on the map.', fr: 'Zones industrielles, bases militaires et aérodromes, avec des emplacements proposés sur la carte.' },
      { en: 'Roads that avoid steep slopes, and power lines along them.', fr: 'Des routes qui évitent les fortes pentes, et des lignes électriques le long.' },
      { en: 'Ground surfaces read from a satellite photo (5 colours).', fr: 'Des sols lus sur une photo satellite (5 couleurs).' },
      { en: 'Collaboration tab: comments pinned on the map, history of changes, mini-map.', fr: 'Onglet Collaboration : commentaires épinglés sur la carte, historique des changements, mini-carte.' },
      { en: 'Help bubble, guided tour, FAQ, glossary and this What\'s new panel.', fr: 'Bulle d\'aide, visite guidée, FAQ, glossaire et ce panneau Nouveautés.' },
      { en: 'Language selector, with export / import of a translation.', fr: 'Choix de la langue, avec export / import d\'une traduction.' },
      { en: 'Long jobs run in the background with a real progress bar and Cancel.', fr: 'Les longs calculs tournent en arrière-plan, avec une vraie barre de progression et Annuler.' },
      { en: 'Fixed "Too many layers" in Workbench, and forests on made-up islands.', fr: 'Corrigé : « Too many layers » dans Workbench, et les forêts sur les îles inventées.' },
    ],
  },
  {
    version: '0.4.8',
    date: '2026-10-17',
    items: [{ en: 'Road clean-up skips points too close together (no more "invalid segments").', fr: 'Le nettoyage des routes saute les points trop proches (fini les « invalid segments »).' }],
  },
  {
    version: '0.4.7',
    date: '2026-10-17',
    items: [
      { en: 'Sent vs built report to see what Workbench really built.', fr: 'Rapport envoyé / construit pour voir ce que Workbench a vraiment construit.' },
      { en: 'Broken road pieces are cleaned before sending.', fr: 'Les morceaux de route cassés sont nettoyés avant l\'envoi.' },
    ],
  },
  {
    version: '0.4.6',
    date: '2026-10-17',
    items: [
      { en: '"Send everything to Workbench" button.', fr: 'Bouton « Tout envoyer à Workbench ».' },
      { en: 'Big projects no longer reach Workbench empty.', fr: 'Les gros projets n\'arrivent plus vides dans Workbench.' },
    ],
  },
]

export const APP_VERSION = CHANGELOG[0].version
