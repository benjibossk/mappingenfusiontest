# Audit UI · point de vue d'un débutant

Audit du 19/11/2026 sur v0.7.0 (branche `ui/kit-css-v2`), Chrome 1440×900, profil vierge (premier lancement, rien en mémoire).
Scénario : un joueur vient d'installer le mod, n'a jamais utilisé l'outil et veut créer sa première carte jouable. Il doit comprendre l'interface sans effort, être guidé, et trouver de l'aide vite.
Remplace `docs/UI_POLISH_PLAN.md` (audit MILSPEC du 16/11, terminé ou dépassé par le style Reforger).

Parcours testé : accueil → Nouvelle île → bulle « Voilà ton île » → visite guidée (5 bulles) → bouton Aide → étapes Sculpter, Eau, Routes, Villages → menu.
Hors périmètre : rendu 2D/3D de la carte, mobile (non testé ici), contenu de la génération.

Légende : **P1** = le débutant bloque ou se trompe · **P2** = il hésite · **P3** = finition.

## Ce qui marche déjà
- Accueil clair : « Par où commencer ? », 3 choix principaux, « Recommandé pour débuter » sur Nouvelle île.
- Génération immédiate (≈ 2 s) : le joueur voit une île tout de suite.
- Étapes numérotées 1 → 7 avec Précédent / Suivant.
- Contenu de l'aide solide : Cette étape, FAQ, Lexique, Clavier, procédure de connexion du Workbench en 3 étapes.

## Problèmes et correctifs

### A1 · P1 · Accueil
- **Constat** : La barre du haut montre déjà 9 outils (Relief en un clic, Rejouer, Graines, Économie, Bibliothèque, Partager, caméra, puce « Workbench : non connecté ») alors qu'aucune carte n'existe.
- **Pour le débutant** : Premier écran = première impression : trop de boutons sans contexte, et un statut « non connecté » qui laisse croire que quelque chose est cassé.
- **Correctif** : Sur l'accueil, n'afficher que le logo, la langue et « Aide ». Les outils apparaissent une fois la carte créée.

### A2 · P1 · Après « Nouvelle île »
- **Constat** : 4 messages arrivent en même temps : toast « Générer : terminé », bulle « Voilà ton île », aide souris en bas, ligne « Île 513×513, pas 8 m — aperçu seulement » en bas du panneau.
- **Pour le débutant** : Le joueur ne sait pas quoi lire en premier ; le message utile (« et maintenant ? ») est noyé.
- **Correctif** : Un seul message : la bulle « Voilà ton île » avec un bouton « Étape suivante ». Pas de toast pour la première génération, ligne technique déplacée dans l'aide.

### A3 · P1 · Étapes
- **Constat** : Après la seule génération du relief, les étapes 2 Sculpter et 3 Eau sont cochées vertes, et la bulle dit « Déjà fait : Relief, Sculpter, Eau ».
- **Pour le débutant** : Le joueur pense avoir sauté des étapes ou que l'outil a fait des choses dans son dos ; il ne sait plus où il en est.
- **Correctif** : Ne cocher que ce que le joueur a fait ou validé. Eau générée automatiquement = état « proposé » (pastille grise) jusqu'à ouverture de l'étape.

### A4 · P1 · Étape 1 Relief
- **Constat** : 14 contrôles visibles : Générer, Autre tirage, Monde aléatoire, Lieu réel, Importer le monde ouvert, liste Everon, Charger une carte de référence, Mesurer, Réglages avancés, Anneau de terrain hors carte, « la mer », Envoyer l'anneau (OTC), Enregistrer, Ouvrir.
- **Pour le débutant** : Le débutant voulait juste une île : il doit trier 14 choix, dont du jargon (OTC, anneau, heightmap, carte de référence).
- **Correctif** : Garder Biome, Générer, Autre tirage. Tout le reste dans un repli « Plus d'options » fermé par défaut ; l'anneau et l'OTC vont à l'étape Envoyer.

### A5 · P1 · Aide
- **Constat** : Le seul accès à l'aide est un « ? » de 34 px sans libellé dans le coin ; F1 n'est indiqué que dans l'infobulle. Le panneau d'aide (bon contenu : Cette étape / FAQ / Lexique / Clavier) recouvre le panneau d'étape.
- **Pour le débutant** : Un débutant bloqué ne voit pas où cliquer ; quand il trouve, l'aide cache justement ce qu'il essayait de comprendre.
- **Correctif** : Bouton « Aide » avec libellé dans la barre ; un lien « Comment faire ? » sous le titre de chaque étape qui ouvre l'aide sur cette étape ; aide en tiroir à gauche du panneau, pas par-dessus.

### A6 · P1 · Visite guidée
- **Constat** : La visite (5 bulles) n'est proposée qu'après la première génération, via « Montre-moi » dans la bulle. Rien sur l'accueil. La dernière bulle parle du « relais lancé » sans dire ce que c'est.
- **Pour le débutant** : Le joueur qui ferme la bulle ne reverra jamais la visite (seulement cachée dans l'aide) ; le mot « relais » arrive sans explication.
- **Correctif** : Sur l'accueil : lien « Première fois ? Visite en 1 minute ». Dernière bulle : « Pour jouer ta carte, il faudra connecter le Workbench : on t'expliquera à l'étape 7. »

### A7 · P1 · Workbench
- **Constat** : La puce « Workbench : non connecté » et la caméra Workbench sont visibles et actives dès la première seconde, alors que la connexion n'est utile qu'à l'envoi.
- **Pour le débutant** : Le joueur croit qu'il doit installer/connecter quelque chose avant de commencer.
- **Correctif** : Masquer puce et caméra jusqu'à la première action d'envoi ; à l'étape 7, un encart « Connecter le Workbench » en 3 étapes (le contenu existe déjà dans l'aide).

### A8 · P2 · Envoyer au Workbench
- **Constat** : Chaque étape a son propre bouton d'envoi (« Envoyer l'eau », « Envoyer les routes », « Envoyer les bâtiments », « Envoyer l'anneau ») en plus de l'étape 7 « Envoyer ».
- **Pour le débutant** : Le joueur ne sait pas s'il doit envoyer à chaque étape ou à la fin, ni ce qui se passe s'il oublie.
- **Correctif** : Un seul envoi, à l'étape 7, avec la liste de ce qui part. Les envois partiels vont dans « Plus d'options » de chaque étape.

### A9 · P2 · Étape 5 Villages
- **Constat** : Accessible sans aucune route alors que le texte dit « le long des routes » ; « Générer les villages » ne donnera rien. 9 cases à cocher, deux générateurs (« Nouveau générateur »), Densité/Graine en champs libres, cases centrées au-dessus des libellés.
- **Pour le débutant** : Le joueur clique Générer, rien n'apparaît, il ne sait pas pourquoi. Le formulaire ressemble à un panneau de debug.
- **Correctif** : Si pas de routes : encart « Trace d'abord des routes (étape 4) » + bouton. Un seul générateur ; Densité en curseur Peu / Normal / Beaucoup ; options dans un repli ; cases alignées à gauche de leur libellé.

### A10 · P2 · Étape 4 Routes
- **Constat** : Liste de 21 types de routes aux noms techniques (« Asphalte style 2 », « Route de charbon », « Béton, ligne pointillée (11 m) ») ; « Outils de test » visible.
- **Pour le débutant** : Le débutant ne sait pas laquelle choisir ; « Outils de test » fait penser à une version inachevée.
- **Correctif** : 5 types courants en boutons (Route principale, Route, Chemin de terre, Sentier, Autoroute), le reste dans « Tous les types ». « Outils de test » masqué hors mode avancé.

### A11 · P2 · Étape 3 Eau
- **Constat** : 7 types d'eau dont « Lac sombre (Cain) », « Mare sale », « Ripisylve » ; deux boutons ambre (Nouveau tracé, Envoyer l'eau) ; « Outils de test » visible.
- **Pour le débutant** : Jargon et deux actions principales concurrentes : le joueur ne sait pas laquelle faire.
- **Correctif** : Rivière / Lac en premier, le reste replié ; un seul bouton principal par étape ; « ripisylve » → « Végétation de berge ».

### A12 · P2 · Carte
- **Constat** : Infos pinceau (« rayon 200 m · force 6 — Maj+molette… ») affichées sur les étapes Villages/Routes où il n'y a pas de pinceau ; aide souris en double avec la barre d'état.
- **Pour le débutant** : Bruit permanent en bas de la carte.
- **Correctif** : Infos pinceau seulement à l'étape Sculpter ; supprimer l'aide souris quand la barre d'état la montre déjà.

### A13 · P2 · Vocabulaire
- **Constat** : Termes non expliqués : graine, OTC, heightmap, prefab, relais, bridge, Workbench, carte de référence.
- **Pour le débutant** : Chaque mot inconnu est un point d'abandon.
- **Correctif** : Remplacer quand c'est possible (graine → « numéro de tirage »), sinon un (i) qui ouvre le Lexique de l'aide sur le bon mot.

### A14 · P3 · Étapes
- **Constat** : Libellés d'étapes en 11 px ; « Champs » dans la barre mais « Champs et forêts » dans le titre ; on peut cliquer n'importe quelle étape sans prérequis.
- **Pour le débutant** : Lisibilité et cohérence.
- **Correctif** : Libellés 13 px, mêmes mots partout ; étapes non prêtes grisées avec infobulle « Fais d'abord : Routes ».

## Ordre conseillé
1. A1, A2, A7 : alléger le premier contact (accueil et première île).
2. A4, A9, A10, A11 : un seul bouton principal par étape, le reste replié.
3. A5, A6, A13 : aide visible et contextuelle, visite proposée dès l'accueil.
4. A3, A8, A14 : états des étapes et envoi unique.
5. A12 : nettoyage du bas de la carte.
