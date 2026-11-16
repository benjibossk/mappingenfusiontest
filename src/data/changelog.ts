// In-app "What's new" — single source for the panel, the status-bar version and the update toast.
// The newest entry comes first and its version must equal package.json (npm run check:changelog).
// Keep the bullets short and user-facing; the full detail lives in CHANGELOG.md / CHANGELOG.fr.md.

export interface ChangelogItem { en: string; fr: string }
export interface ChangelogEntry { version: string; date: string; items: ChangelogItem[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.6.0',
    date: '2026-11-16',
    items: [
      { en: 'Random world: nothing is built inside a lake any more. Places, farms, industrial, military and airfield zones keep off the lake outline plus a 35 m shore; roads and power lines go around lakes (bridges only over rivers). A zone with no dry ground is skipped.', fr: 'Monde aléatoire : plus rien n’est construit dans un lac. Lieux, fermes, zones industrielles, militaires et aérodrome restent hors du contour du lac plus 35 m de rive ; routes et lignes électriques contournent les lacs (ponts seulement sur les rivières). Une zone sans place au sec est sautée.' },
      { en: 'The biome now drives generation: forest density and conifer / broadleaf mix, forest generators, village gardens dressed from the biome lot templates (trees, props, fences), and ground / tree tints in the 3D view. Everon is unchanged (same seed, same map).', fr: 'Le biome pilote maintenant la génération : densité des forêts et part conifères / feuillus, générateurs de forêt, jardins des villages habillés selon les gabarits de parcelle du biome (arbres, objets, clôtures), teintes du sol et des arbres en 3D. Everon ne change pas (même graine, même carte).' },
      { en: 'Asset library: the 3D preview no longer stays empty, and "Missing" is green when nothing is missing.', fr: 'Bibliothèque : l’aperçu 3D ne reste plus vide, et « Manque » est vert quand rien ne manque.' },
      { en: 'Biome choice at step 1 and in the random world: the exported ground surfaces follow it, saved and shared with the project. Library button and a dark asset library page.', fr: 'Choix du biome à l’étape 1 et dans le monde aléatoire : les sols exportés le suivent, sauvegardé et partagé avec le projet. Bouton Bibliothèque et page de bibliothèque d’assets en thème sombre.' },
      { en: "Direct collaboration with no server: Share opens a dialog to create or join a room (peer to peer, nothing to open on your router). Atelier network comments go live to the room.", fr: "Collaboration directe sans serveur : Partager ouvre un popup Créer ou Rejoindre un salon (pair à pair, aucun port à ouvrir). Les commentaires des réseaux de l’Atelier partent en direct au salon." },
      { en: "3D view in the OpsTrack style: realistic ground from the project, simple instanced trees with distant forest dots, same light and framing. Also available in the Atelier.", fr: "Vue 3D façon OpsTrack : sol réaliste tiré du projet, arbres simples instanciés et points pour les forêts lointaines, même lumière et même cadrage. Aussi dans l’Atelier." },
      { en: "Atelier: rail, road and power network viewers with clickable inconsistencies to pin comments; per-tile texture simplifier (preview and export, Apply still experimental).", fr: "Atelier : visualiseurs des réseaux rail, routes et électricité, incohérences cliquables pour épingler un commentaire ; simplification des textures par tuile (aperçu et export, Appliquer encore expérimental)." },
      { en: "Roads V2: clean junctions, rounded bends, smooth vertical profile, bridges over valleys, islands connected automatically.", fr: "Routes V2 : carrefours propres, virages arrondis, profil en long lissé, ponts au-dessus des vallées, îlots reliés automatiquement." },
      { en: "Menu button at the top left, popups that always close, and a 20-point interface polish.", fr: "Bouton Menu en haut à gauche, popups qui se ferment toujours, et 20 retouches de l’interface." },
    ],
  },
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
