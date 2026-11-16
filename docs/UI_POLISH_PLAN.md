# Plan de finition de l'interface (UI polish)

Audit du 16/11/2026 sur v0.5.0 (Chrome 1440×900 et 390 px). Captures : `scratchpad/pw/ui-audit-*.png` (session Claude, temporaires).

Maquettes cibles : canevas Claude Design « Refonte reforger-mapper » — https://claude.ai/artifact/AogcaPts9BvCMcicnRji31 (privé). Chaque point renvoie à un board.

Légende : **P1** = gêne ou trompe l'utilisateur · **P2** = incohérence visible · **P3** = finition.

## Règles transverses (charte MILSPEC)

- Polices : Oswald (titres, boutons, MAJUSCULES, interlettrage 0.08–0.14em), Barlow Semi Condensed (texte, 15 px min.), Share Tech Mono (données, statuts, 12 px min.).
- Couleurs : fond #0B0C0D, surfaces #101113 / #16181A, traits #2E3236 / #3A3F44, texte #EAEDEF / #C9CFD3 / #A2A9AE (jamais plus clair que #A2A9AE pour du texte), ambre #E0A233 (un seul bouton primaire par zone), vert #5FA24A, rouge #C8574D réservé aux vraies erreurs.
- Rayon 2 px partout ; cibles cliquables ≥ 40 px (44 px dans les dialogues) ; espacements 8/12/16/20/24.
- Plus aucun emoji dans l'UI ; icônes SVG au trait.

## Liste priorisée

### 01. [P1] Accueil

- **Problème** : 5 cartes en grille 4+1 : « Atelier » orpheline en bas à gauche, hauteurs inégales (Rejoindre plus haute), « Ouvrir un fichier » flotte en bas à droite.
- **Correctif** : 2 groupes : « Créer » (3 grandes cartes de même hauteur) et « Existante » (2 cartes larges) ; projets récents + Ouvrir un fichier en une rangée.
- **Où** : `src/style.css .welcome .choices (l.204, puis surcharges MILSPEC) ; balisage #welcome dans src/main.ts`
- **Board** : `Accueil.dc.html` · capture `ui-audit-01-welcome.png`
- **Statut** : FAIT (16/11/2026).

### 02. [P1] Accueil

- **Problème** : Le panneau d'étape (Relief, Générer…) et la barre Calques restent visibles derrière l'accueil : deux appels à l'action concurrents.
- **Correctif** : Accueil plein écran : masquer .side, .layers, #helpFab tant que #welcome est visible ; bandeau « Carte en cours → Revenir à ma carte » en tête quand on vient du Menu.
- **Où** : `src/style.css (body:has(#welcome:not([hidden])) .side…) ; #welcomeResume`
- **Board** : `Accueil.dc.html` · capture `ui-audit-04-menu-return.png`
- **Statut** : FAIT (16/11/2026).

### 03. [P1] Global

- **Problème** : Bouton « ? » flottant et « Calques » se chevauchent en bas à gauche et recouvrent les cartes de l'accueil et le panneau d'aide.
- **Correctif** : Déplacer l'aide dans l'en-tête (bouton 32 px + F1) ; Calques reste seul en bas à gauche, 16 px de marge.
- **Où** : `#helpFab, .layers (style.css l.130)`
- **Board** : `Aide.dc.html` · capture `ui-audit-05-help-panel.png`
- **Statut** : FAIT (16/11/2026).

### 04. [P1] Carte 2D

- **Problème** : Le texte d'aide souris en haut de la carte est coupé (« Ctrl+molette ») et passe sous le bouton 3D.
- **Correctif** : Aide souris en bas au centre, une ligne courte, masquable ; bouton 3D dans la barre d'outils de carte.
- **Où** : `.overlay (style.css l.41/128), .v3d-toggle (l.591), i18n hint.map`
- **Board** : `Vue3D.dc.html` · capture `ui-audit-03-step4-roads.png`
- **Statut** : FAIT (16/11/2026) — le bouton 3D reste seul en haut à droite : plus de chevauchement, l'aide souris est en bas.

### 05. [P1] Vue 3D

- **Problème** : Barre 3D surchargée : retour « 2D » minuscule, case à cocher + select + texte de debug « texture 0.9 s » + aide sur 2 lignes.
- **Correctif** : Barre groupée : RETOUR 2D (primaire) | Rendu Réaliste/Carte (segmenté) | Relief | bascules Arbres/Grille | Recentrer, Vue de dessus. Temps de rendu en toast.
- **Où** : `src/view3d/index.ts .v3d-bar, .v3d-back, .v3d-ms, .v3d-help`
- **Board** : `Vue3D.dc.html` · capture `ui-audit-09-3d-real.png`
- **Statut** : FAIT (16/11/2026) — rendu en boutons segmentés (Satellite en 3e segment si une photo est chargée).

### 06. [P1] Collaboration

- **Problème** : Compteur « 1 (direct : ) » : parenthèse vide quand on est seul, emoji 👥 hors charte ; Quitter le salon en gros en haut.
- **Correctif** : Liste « En ligne » avec pastilles nominatives ; Quitter le salon en bas, style danger discret.
- **Où** : `i18n p2p.peers ; #p2pStatus, #collabInfo (style.css l.309)`
- **Board** : `Collaboration.dc.html` · capture `ui-audit-08d-collab-panel.png`
- **Statut** : FAIT (16/11/2026).

### 07. [P1] Partager

- **Problème** : Dialogue : deux colonnes Créer/Rejoindre + deux boutons ambre ; lien tronqué ; avertissement de sécurité en petit gris ; « Avancé (serveur, TURN) » jargon.
- **Correctif** : Onglets Créer / Rejoindre, un seul primaire, lien en mono pleine largeur + COPIER, avertissement avec icône cadenas, lien texte « Réglages réseau avancés ».
- **Où** : `#shareDlg, #shareCreate, #shareLink, #shareJoin`
- **Board** : `Partager.dc.html` · capture `ui-audit-08c-share-created.png`
- **Statut** : FAIT (16/11/2026).

### 08. [P1] Monde aléatoire

- **Problème** : Le panneau « En cours » se pose par-dessus le formulaire (boutons à moitié cachés) ; valeurs « ×1 » loin sous les curseurs, icônes ⓘ sur leur propre ligne.
- **Correctif** : Pendant le calcul le dialogue montre seulement la progression (étapes cochées, %, temps restant, Annuler) ; valeur à droite du curseur, ⓘ dans le libellé.
- **Où** : `#rwDlg, .rw-bar, .rw-checks (style.css l.161-168)`
- **Board** : `Progression.dc.html` · capture `ui-audit-10b-random-busy.png`
- **Statut** : FAIT (16/11/2026).

### 09. [P1] Atelier

- **Problème** : Statut « Workbench : OUVERT (écriture bloquée) » en rouge : on croit à une erreur alors que c'est normal.
- **Correctif** : Puce ambre « Workbench ouvert · lecture seule » + explication au survol.
- **Où** : `src/atelier/atelier.css .at-wb[data-st=open] (l.15)`
- **Board** : `Atelier.dc.html` · capture `ui-audit-11-atelier-A1.png`
- **Statut** : FAIT (16/11/2026).

### 10. [P1] Atelier

- **Problème** : Étapes A1–A6 : canevas vide et une phrase grise quand il n'y a rien (« Chargez d'abord un monde ») ; étapes sans état fait/en cours.
- **Correctif** : Étapier avec ✓ / courant ambre ; état vide avec action (« Aller à A0 ») ; chiffres-clés en tête du panneau.
- **Où** : `src/atelier/ui.ts .at-steps ; atelier.css l.18-21`
- **Board** : `Atelier.dc.html` · capture `ui-audit-11-atelier-A1.png`
- **Statut** : FAIT (16/11/2026).

### 11. [P1] Atelier

- **Problème** : Le journal affiche le chemin Windows sans ses barres obliques inverses (« C:UsersbenboDocuments… »).
- **Correctif** : Échapper / afficher le chemin tel quel ; vérifier la sérialisation vers le relais.
- **Où** : `src/atelier/ui.ts (#atJournal), bridge.ts`
- **Board** : `Atelier.dc.html` · capture `ui-audit-11-atelier-A1.png`
- **Statut** : FAIT (16/11/2026) — cause : le script d'audit (chaîne JS non échappée) ; l'app garde le chemin, vérifié au journal.

### 12. [P1] Mobile 390

- **Problème** : En-tête qui chevauche les cartes, panneau d'étape qui couvre la moitié basse de l'accueil, « ? » et Calques par-dessus.
- **Correctif** : < 720 px : en-tête compact (menu ☰), accueil seul en colonne, panneau d'étape en tiroir repliable.
- **Où** : `src/style.css @media (max-width: 720px)`
- **Board** : `Corrections.dc.html` · capture `ui-audit-12-m-welcome.png`
- **Statut** : FAIT (16/11/2026).

### 13. [P2] Étapes

- **Problème** : Libellés de l'étapier en 11 px gris (« Champs et forêts » sur 2 lignes) ; légende « vert = fait · ambre… » en 11 px.
- **Correctif** : Étapier 13 px, libellés courts, légende déplacée dans la bulle d'aide de l'étape.
- **Où** : `.stepper button (style.css l.372)`
- **Board** : `Aide.dc.html` · capture `ui-audit-03-step1-island.png`
- **Statut** : FAIT (16/11/2026).

### 14. [P2] Panneau d'étape

- **Problème** : Boutons qui passent à la ligne au hasard (Nouvelle route / Retirer la dernière / Tout effacer), primaire et destructif côte à côte ; la barre Précédent/Suivant est coupée par le pied de page.
- **Correctif** : Grille de boutons 2 colonnes, destructif en lien texte ; pied Précédent/Suivant collant au-dessus du footer.
- **Où** : `.side .actions, .side footer ; style.css`
- **Board** : `Corrections.dc.html` · capture `ui-audit-03-step4-roads.png`
- **Statut** : FAIT (16/11/2026).

### 15. [P2] Toasts

- **Problème** : Toast « Ouverture de la vue 3D : terminé » posé sur le bas du panneau latéral.
- **Correctif** : Toasts en bas au centre de la carte, 3 max, succès 4 s, erreurs persistantes.
- **Où** : `#toast`
- **Board** : `Progression.dc.html` · capture `ui-audit-09-3d-real.png`
- **Statut** : FAIT (16/11/2026).

### 16. [P2] Nouveautés

- **Problème** : Badge « V0.5.0 » en 11 px orange dans le coin du pied de page, quasi invisible.
- **Correctif** : Badge dans l'en-tête à côté du nom, point ambre si non lu ; panneau avec COMPRIS.
- **Où** : `#verLink, #newsPanel`
- **Board** : `Nouveautes.dc.html` · capture `ui-audit-06-news.png`
- **Statut** : FAIT (16/11/2026) — sur téléphone le badge est masqué ; Nouveautés reste accessible depuis l'aide.

### 17. [P2] Aide

- **Problème** : Panneau d'aide couvre la carte et descend sur Calques ; boutons « ALLER » répétés 7 fois.
- **Correctif** : Panneau à onglets Cette étape / FAQ / Lexique / Clavier, ancré sous l'en-tête, contenu de l'étape courante d'abord.
- **Où** : `#helpPanel, #helpTour`
- **Board** : `Aide.dc.html` · capture `ui-audit-05-help-panel.png`
- **Statut** : FAIT (16/11/2026).

### 18. [P2] Atelier

- **Problème** : Bouton langue « FR ⇄ » différent du menu langue du générateur ; « RM ▸ » cryptique.
- **Correctif** : Même sélecteur FR · Français ▾ ; bouton « ← Générateur » à gauche.
- **Où** : `src/atelier/ui.ts .at-top, .at-brand`
- **Board** : `Atelier.dc.html` · capture `ui-audit-11-atelier-A0.png`
- **Statut** : FAIT (16/11/2026).

### 19. [P2] Charte

- **Problème** : style.css empile l'ancien thème bleu (#3d6fd8, radius 6-10 px) et les surcharges MILSPEC : arrondis et bleus réapparaissent (accueil, étapier).
- **Correctif** : Supprimer le bloc ancien thème ; tokens MILSPEC seuls (radius 2 px, ambre).
- **Où** : `src/style.css l.1-210 vs l.290+`
- **Board** : `Corrections.dc.html`
- **Statut** : FAIT (16/11/2026).

### 20. [P3] Accueil

- **Problème** : « ENVIRON 10 5 » : unité manquante (10 s).
- **Correctif** : Texte « ≈ 10 S · 4 À 16 KM ».
- **Où** : `i18n welcome.random.meta`
- **Board** : `Accueil.dc.html` · capture `ui-audit-01-welcome.png`
- **Statut** : FAIT (16/11/2026).

## Ordre de réalisation conseillé

1. Nettoyer `src/style.css` (point « Charte ») : supprime d'un coup plusieurs incohérences.
2. Accueil plein écran + bouton aide dans l'en-tête (Accueil, Aide).
3. Barre 3D et aide souris (Vue3D).
4. Partager / Collaboration.
5. Progression + toasts (composant unique réutilisé par Monde aléatoire, 3D, Atelier).
6. Atelier (statut, étapier, états vides, chemin).
7. Mobile 390 px.

Après chaque lot : relancer le script de captures (1440 et 390) et comparer au board.
