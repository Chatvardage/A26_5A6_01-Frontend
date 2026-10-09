# AGENTS.md — ChatVardage (frontend / application desktop)

Instructions pour tout agent IA (Claude Code, Cursor, Copilot, etc.) qui
travaille dans **ce dépôt**.

## Portée — lire en premier

Ce dépôt est le **frontend uniquement** : l'application desktop Electron
de Chatvardage. Il n'inclut PAS le backend.

Le backend conteneurisé et les services temps réel vivent dans des **dépôts Git séparés** : API HTTP + WebSocket, base de
données, Redis, panneau d'administration — tout ça hors de ce dépôt, avec
son propre README et son propre docker-compose.yml. Un agent qui travaille
ici n'a pas à implémenter cette API ; ce dépôt ne fait qu'y **consommer**
via `RealGatewayRuntime.js` (voir plus bas).

> L’[architecture dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/architecture-frontend.md) décrit la structure **réelle** du code
> (processus main, preload, pages, flux de session/préférences/fenêtre).
> Le garder à jour quand on ajoute un fichier, un canal IPC important ou un
> flux.

### Backend réel — état actuel

L'app parle uniquement au vrai backend, via `RealGatewayRuntime.js` (voir
`BACKEND.md`). **Aucun mock** : pas de gateway simulé, pas de mode hors
ligne, pas de données de démonstration en mémoire ou en localStorage — ne
pas en réintroduire (décision d'équipe). Les doublures des tests unitaires
(`vi.fn()`, `electron` simulé) ne sont pas concernées. `maquette/` ne
contient que les maquettes de design (PDF).

## Ce que c'est (aujourd'hui)

Application de clavardage desktop construite avec Electron.
Un seul processus Electron `main.js` fait autorité pour tout l'état
métier (utilisateurs, salons, messages, présence, réseau) : c'est
`RealGatewayRuntime.js`, une seule instance, jamais dupliquée par fenêtre.
Deux surfaces UI très différentes consomment cet état via IPC :

1. **Écran de connexion** (`src/presentation/pages/connexion/`) — React +
   TypeScript, bundlé par Vite. Seule partie de l'app avec un vrai build.
2. **Dashboard + Messages privés** (`src/presentation/pages/index.html` et
   `message-prive.html`) — JS vanilla, chargé directement par Electron
   (`loadFile`), aucun bundler. `nodeIntegration: false` partout : ces
   fichiers n'ont **jamais** accès à `require()` ni à Node.

## Lancer, tester, valider

```bash
npm install
npm run start:dev     # mode dev : Vite + Electron orchestrés par scripts/start.js
npm start              # mode prod : build automatique (prestart) puis Electron seul
npm test               # vitest run
npm run test:coverage  # avec couverture : 100 % exigé sur src/**/*.ts, RealGatewayRuntime.js et runtime/ (voir vitest.config.ts)
npm run lint            # eslint . --ext .js,.jsx,.ts,.tsx
npx tsc --noEmit        # compilation TypeScript sans émission
npm audit --audit-level=high  # aucune vulnérabilité high/critical (vérifié en CI)
npm run build           # build de la page de connexion (dist/login/)
```

**Avant de considérer une tâche terminée**, dans cet ordre :
`npm audit --audit-level=high` → `npx tsc --noEmit` → `npm run lint` → `npm test`
(ou `test:coverage` si le changement touche la logique) → `npm run build`. Un changement qui touche
au dashboard ou aux messages privés (JS vanilla, jamais compilé) ne sera
détecté par **aucun** de ces outils s'il casse au runtime — le seul moyen
fiable de le vérifier est de lancer l'app et de cliquer dedans (voir
"Piège n°1" plus bas).

CI (`.github/workflows/builds.yml`) : `npm ci && npm audit --audit-level=high &&
npm run lint && npx tsc --noEmit && npm run test:coverage && npm run build:login` à chaque
PR, sur `main`/`develop`, et avant tout build multiplateforme (tag `v*` ou
lancement manuel) — la couverture (100 %), les types et le build de la page
de connexion sont donc vérifiés en CI. Le lint échoue au moindre
avertissement (`--max-warnings=0`).

**Audit des dépendances** : le CI lance `npm audit --audit-level=high` (dépendances de dev comprises). Si un avis `high` ou `critical` sans correctif compatible le bloque, forcer une version corrigée par un `overrides` ciblé dans `package.json` si elle existe ; sinon consigner l'exception dans une section « Limites connues » du README, à créer au besoin (paquet, avis, raison, condition de retrait). Ne pas retirer ni affaiblir l'étape.

## Architecture réelle (détail complet dans Infra/docs/architecture-frontend.md)

```
main.js                    Processus main Electron : assemble les
                            modules de src/main/ et gère le cycle de vie
                            (requestSingleInstanceLock, activate…).
src/main/                  Modules du processus main (CommonJS), un par
                            responsabilité — voir Architecture.md. L'état
                            partagé passe par `etat` (contexte.js), jamais
                            par des variables globales ; l'UNIQUE
                            RealGatewayRuntime vit dans gateway.js. Un
                            nouveau canal IPC passe toujours par
                            exposerCanal (securite.js), qui vérifie la
                            provenance.
preload.js                  Seul pont autorisé vers le renderer
                            (contextBridge). Deux objets globaux exposés :
                            window.electronAPI (session, salons, i18n,
                            réseau, présence...) et window.notifications
                            (notifications système, badge, focus fenêtre).
                            Injecte aussi la barre de titre (.app-titlebar)
                            dans chaque page, boutons → canaux 'fenetre:*'.
src/partage/               Noyau React partagé avec le client mobile
                            (A26_5A6_01-Mobile) : useAsyncResource,
                            useSearchResults, search, groupResults,
                            highlight. Sans dépendance à Electron, à
                            React Native ni à l'application (seulement
                            `react`) ; les textes d'erreur sont injectés
                            (`describeError`). Partage par COPIE : les
                            fichiers doivent rester identiques dans les
                            deux dépôts, vérifié par
                            A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh
                            — modifier un fichier ici impose de reporter
                            le même changement dans Mobile. Aucune page
                            actuelle ne l'importe encore (réservé au futur
                            écran de recherche Web) ; la couverture 100 %
                            s'applique quand même. La saisie de recherche
                            est tronquée à MAX_QUERY_LENGTH sans signal :
                            l'écran consommateur pose `maxLength`.
                            `useAsyncResource` exige un `load` STABLE
                            (useCallback) : une fonction recréée à chaque
                            rendu relance le chargement complet en boucle.
scripts/start.js            Orchestre Vite + Electron (dev) ou juste
                            Electron après build (prod) — évite le rituel
                            manuel "deux terminaux + $env:NODE_ENV".

src/infrastructure/gateways/
  AuthGateway.ts             Interface TypeScript du contrat de gateway
                              utilisé par l'écran de connexion React.
  RealGatewayRuntime.js        La VRAIE implémentation utilisée par
                              main.js : HTTP + Socket.IO vers le Gateway
                              (Serveur-API). Classe JS simple, aucune
                              dépendance TS. Lève des CODES d'erreur
                              stables (ex. "ERR_PSEUDO_PRIS|alice"), JAMAIS
                              de texte traduit — voir i18n plus bas.
  runtime/*.js                 Ses méthodes, un fichier par domaine
                              (session, serveurs, messages, présence,
                              réseau…), ajoutées à son prototype par
                              Object.assign : `this` y est l'instance.
                              Nouvelle méthode → le fichier du domaine.

src/i18n/
  translations.json           SEULE source de vérité pour tous les textes
                               (clés imbriquées, fr + en).
  i18n.js                      Lookup t() en CommonJS, pour main.js/
                               preload.js (require()).
  i18n-web.ts                  Même lookup en ESM/TypeScript, pour
                               React/Vite (import).
  i18n-browser.js (dans src/presentation/pages/javascript/)
                               Même lookup en script classique, expose
                               window.I18n, pour renderer.js et
                               message-prive.js (pas de require(), pas de
                               bundler — voir "Piège n°2").
  → Trois implémentations de la MÊME petite fonction, une par
    environnement de module du projet. C'est voulu, pas de la dette :
    voir le commentaire en tête de chaque fichier. Ne jamais essayer de
    les fusionner en un seul fichier partagé — ça a déjà cassé le build
    de prod une fois (Rollup traite les .js source comme de l'ESM, pas
    du CommonJS).

src/presentation/pages/
  connexion/                   Page React (Vite root). LoginPage.tsx ne
                                stocke JAMAIS de texte déjà traduit dans
                                son état — seulement des clés/codes,
                                traduits au RENDU avec la langue courante
                                (voir "Piège n°3").
  index.html + javascript/salons/*.js + renderer.js
                                Dashboard (salons) : scripts classiques qui
                                partagent la portée globale, chargés dans
                                l'ordre d'index.html ; renderer.js (le
                                dernier) démarre la page. Seules des
                                DÉFINITIONS et des abonnements au niveau
                                supérieur des fichiers salons/*.js : rien ne
                                doit s'y exécuter au chargement (voir
                                salons.chargement.test.ts).
  javascript/logique-interface.js
                                Logique pure des pages de chat, testée à
                                100 % : y mettre toute règle testable
                                (fusion, défilement, tris…).
  message-prive.html + javascript/messages-prives/*.js
                     + javascript/message-prive.js
                                Page des messages privés (DM), découpée
                                comme les salons : les scripts de
                                messages-prives/ ne font que DÉCLARER ;
                                seul message-prive.js, chargé en dernier,
                                démarre la page (DOMContentLoaded). Rien ne
                                doit s'exécuter au chargement (voir
                                message-prive.chargement.test.ts).
  javascript/notif-prefs.js    Préférences de notification et compteurs
                                de non-lus, partagés entre les deux pages
                                JS vanilla via window.NotifPrefs (même
                                pattern que window.I18n). Les non-lus
                                viennent de Message-Service (état de
                                lecture serveur) : jamais de carte de
                                lecture locale (localStorage). Chargé AVANT renderer.js/
                                message-prive.js dans le HTML — comme
                                i18n-browser.js et chat-ui-shared.js :
                                l'ordre des <script> compte, ce sont des
                                scripts classiques (pas des modules), qui
                                partagent le même scope global.
  javascript/chat-ui-shared.js Logique réseau/présence et dialogue de
                                recherche de messages, partagés entre
                                les deux pages, expose window.ChatUiShared
                                (même pattern que window.I18n/NotifPrefs).
```

## Pièges connus — déjà arrivés plusieurs fois, à vérifier explicitement

Ces régressions se sont TOUTES produites au moins une fois dans
l'historique de ce projet, généralement après un merge ou une copie
manuelle de fichiers entre collaborateurs. Un agent qui touche à ces
zones doit vérifier activement qu'il n'en réintroduit pas une.

1. **`index.html` et `message-prive.html` sont deux fichiers différents.**
   Ils se sont déjà retrouvés strictement identiques (l'un écrasé par une
   copie de l'autre) — après connexion, l'app chargeait alors l'interface
   des messages privés au lieu du dashboard des salons. Si l'un des deux
   fichiers semble étrangement similaire à l'autre, ou si `index.html` ne
   charge plus `renderer.js`, c'est ce bug.

2. **`renderer.js` et `message-prive.js` n'ont jamais accès à `require()`**
   (`nodeIntegration: false`). Toute donnée venant du processus main doit
   passer par `window.electronAPI.*` (IPC), jamais par un `require()`
   direct d'un fichier de `src/`. `tsc` et le serveur de dev Vite ne
   détectent PAS cette erreur (ils ne s'appliquent pas à ces fichiers) ;
   seul un lancement réel de l'app le révèle (`window.NotifPrefs`/
   `window.I18n` undefined, plantage silencieux).

3. **Ne jamais stocker un texte déjà traduit dans un état React/JS qui
   survit à un changement de langue** (ex. un message d'erreur affiché).
   Stocker la clé ou le code brut, traduire à chaque rendu/affichage avec
   `t(langueActuelle, ...)`. Sinon, changer de langue après coup ne
   retraduit jamais ce qui est déjà affiché.

4. **`RealGatewayRuntime.js` doit lever des CODES, jamais du texte
   français en dur** (`throw new Error('ERR_XXX')`, pas
   `throw new Error('Une erreur en français')`). La traduction se fait à
   la frontière IPC/UI (voir `messageErreur()` dans `i18n-browser.js`, ou
   l'équivalent dans `main.tsx`), jamais dans la couche métier — qui ne
   doit pas connaître la langue de l'utilisateur.

5. **`sessionStorage` ne survit pas de façon fiable à une navigation
   `file://` entre deux pages différentes** (`index.html` →
   `message-prive.html`). Pour tout ce qui doit survivre à cette
   navigation (identité de l'utilisateur connecté, langue...), utiliser
   un état côté processus main exposé via IPC (voir
   `session:utilisateur-connecte`, `langue:obtenir`), pas seulement
   `sessionStorage`. Pour ce qu'une page doit ouvrir en arrivant
   (notification cliquée, « + » du rail) : `definirCibleNavigation` avant
   de naviguer, `prendreCibleNavigation([types])` à l'arrivée (canaux
   `navigation:*-cible`, src/main/fenetre.js).

6. **Fichiers de config qui reviennent en arrière** : `package.json`
   (version de `vitest`/`@vitest/coverage-v8` — doit matcher la version de
   `vite` installée, sinon deux copies de `vite` s'installent et `tsc`
   plante) et `.eslintrc.js` (`ignorePatterns` doit exclure `dist/`). Si
   `npx tsc --noEmit` échoue avec une erreur de type Vite/Vitest
   incohérente, vérifier `npm ls vite` en premier.

7. **Barre de titre : deux copies du style.** `.app-titlebar` et
   `--titlebar-*` sont définis dans `styles.css` (pages vanilla) ET dans
   `connexion.css` (page React, bundle Vite séparé) : toute modification
   doit être faite dans les deux. Tout élément `position: fixed` en haut de
   page doit tenir compte de `--titlebar-height`.

8. **Contenu traduit du serveur par défaut.** `SALONS_PAR_DEFAUT` et
   `MESSAGE_BIENVENUE_ID` (`logique-interface.js`) reprennent les identifiants figés
   de Room-Service/Message-Service et les noms d'origine (`annonces`,
   `général`). Si une migration backend change ces noms ou le texte de
   bienvenue, mettre à jour ces constantes et
   `channels.welcomeMessage` (fr + en) dans `translations.json`.

9. **Thème : uniquement depuis la page profil.** Ne pas réintroduire de
   sélecteur de thème sur les écrans de connexion/inscription. La langue,
   elle, reste choisie à la connexion et est enregistrée dans le profil
   (`apresOuvertureSessionAvecLangueChoisie` dans `main.js`).

10. **`clamp(min, préféré, max)` avec `min > max`** est déjà arrivé dans
    `connexion.css` (`clamp(15px, 0.75vw, 13px)`) — invalide silencieusement
    en CSS, pas d'erreur, juste un rendu cassé.

Ces régressions reviennent parce que plusieurs personnes éditent les mêmes
fichiers sans toujours repartir de la dernière version poussée. Avant de
merger un travail issu d'une copie locale, vérifier qu'aucun marqueur de
conflit Git (`<<<<<<<`, `=======`, `>>>>>>>`) ne traîne dans le diff.

## Conventions

- Noms de variables, fonctions et commentaires : **en français**, dans
  tout le code (TS et JS). Les clés de traduction elles-mêmes sont en
  anglais (`auth.invalidFormat`, `errors.ERR_PSEUDO_PRIS`).
  Exception assumée : les identifiants de `src/partage/` sont en anglais
  (`useAsyncResource`, `loadMore`…), car ces fichiers sont copiés à
  l'identique dans le client mobile, qui suit la convention inverse ;
  leurs commentaires restent en français.
- Aucun texte d'UI en dur dans un composant ou un template — toujours via
  `t(langue, 'cle')`. Pour le HTML statique des pages vanilla, utiliser
  les attributs `data-i18n` / `data-i18n-title` / `data-i18n-aria-label` /
  `data-i18n-placeholder`, retraduits par `appliquerTraductionsStatiques()`.
- Toute nouvelle clé de traduction va dans `src/i18n/translations.json`,
  sous les DEUX langues (`fr` et `en`) — jamais une clé dans une seule.
- Toute nouvelle erreur métier dans `RealGatewayRuntime.js` : un code
  stable (`ERR_NOUVELLE_ERREUR`, éventuellement `ERR_X|param`), plus les
  deux traductions correspondantes dans `translations.json` sous
  `errors.*`.
- `localStorage`/`sessionStorage` : uniquement pour des préférences
  purement locales à UNE page (ex. `NotifPrefs`), jamais pour de l'état
  qui doit survivre à une navigation entre pages — voir Piège n°5.

## Documentation centrale

Infra est la référence du démarrage complet, des architectures, contrats et scénarios de validation. Le README local décrit le dépôt et ses commandes; les guides détaillés sont dans `A26_5A6_01-Infra/docs/`. Toute modification de contrat doit mettre à jour la référence centrale et ses liens.

## Revue PR #104 — 9 octobre 2026

- Nouveau jeton de `logout-others` vérifié avant toute modification de session ou persistance. Réponse invalide : erreur traduite de reconnexion requise, ancien état conservé, rotation terminée sans rouvrir le socket.
- Confirmation de livraison sans identifiant ignorée : aucune requête vers `/undefined/delivered`.
- IPv6 conservé avec `[::1]` : `URL.hostname` de Node garde les crochets, contrairement à l'affirmation de la review. Le comportement est vérifié dans le runtime Node utilisé pour les tests.
- Pas de garde supplémentaire pour les modes de pagination : les appelants fournissent un seul mode; Message-Service rejette explicitement les combinaisons incompatibles en 400. Un nouvel appelant doit respecter ce contrat.
- `serveur.salons` reste obligatoire : Room-Service fournit ce tableau et il est utilisé par le mapping et les adhésions Socket.IO, pas seulement le tri. Un repli local au tri masquerait un contrat invalide sans réparer ces autres consommateurs.
- Constantes inactives des fixtures et structure du bloc de déconnexion conservées : aucun défaut de comportement ou de rendu établi par la review. La déconnexion est un bouton d'action, sans formulaire à soumettre.

Validation de cette review sous Node 22.23.2 : audit high, types, lint, build et 405 tests avec couverture 100 % passent. Le hostname IPv6 testé est `[::1]`. Validation manuelle Electron non effectuée.

## Nouvelle revue PR #104 — tri de pagination

- Les deux fusions de pages récentes de salon utilisent explicitement `date`; le curseur est donc le dernier message chronologique. La pagination récente DM/salon abandonne un historique vidé sans erreur ni requête invalide. Tests exécutant les fonctions des pages avec la vraie fusion.
- Boucle de profil non retenue : `definirPresenceInterne` n'appelle pas `annoncerProfil`; seule `modifierPresence` annonce une action locale. `configObtenir` normalise aussi le statut. La review confond ces deux méthodes.
- Confirmation groupée différée : les confirmations individuelles ignorent déjà les messages sortants et livrés; la page est bornée à 50. Un batch nécessiterait un nouveau contrat backend sans défaut fonctionnel démontré dans cette review.
- Alias `counter` conservé : capture de la référence utilisée par le nettoyage de l'effet, équivalente fonctionnellement et conforme au lint des hooks. Aucun comportement à corriger; modifier un fichier partagé imposerait en plus une coordination Mobile inutile.
- URL invalide déjà refusée au démarrage par `URL` : personnaliser ce texte opérateur est facultatif et la suggestion inclut la valeur brute, pouvant exposer des identifiants.
- Journal des décisions maintenu dans AGENTS conformément à la demande explicite de l'utilisateur.

Validation : audit high, types, lint, build et 408 tests à couverture 100 % sous Node 22.23.2. Les nouvelles régressions exécutent les fonctions des pages; validation manuelle Electron non effectuée.

## Revue PR #100 — décisions du 6 octobre 2026

- Réponses HTTP vides : correction retenue pour les non-lus et les lecteurs, y compris le DM (204 produit undefined dans appelHttp). Tests de régression pour 204 et JSON null.
- versConversationLocale sans session : pas de garde supplémentaire; son appelant obtenirNonLus vérifie la session avant de convertir les identifiants. Aucun autre appel de production ne nécessite ce cas.
- totalNonLus avec un type inconnu : pas de changement; les appelants utilisent salon ou prive. Accepter silencieusement une valeur hors contrat masquerait une erreur d'appel.
- Math.max avec une lecture absente : pas de repli à zéro; traiterLectureEntrante fournit une date numérique. La validation des dates Redis est renforcée dans Message-Service, à la source. Un repli nullish ne corrigerait d'ailleurs pas NaN.
- Minuteur après fermeture de recherche : reporté; il peut déclencher une requête bornée supplémentaire, sans fuite de données ni changement de conversation. Ce coût ponctuel ne justifie pas de modifier le cycle de vie du dialogue dans cette correction.
- Suppression du canal resumes-conversations-privees : conservée; la recherche dans les fichiers de production ne trouve plus de consommateur. La suppression est intentionnelle, les non-lus viennent du serveur.
- CSS :has() : conservé; Electron embarque une version de Chromium compatible (voir la version Electron de package.json).

Validation : Node 22.23.2, npm ci --ignore-scripts, audit high, TypeScript, lint, 263 tests (couverture 100 %) et build passent. Le lockfile met à jour uniquement http-cache-semantics 4.2.0 vers 4.3.0 et source-map-js 1.2.1 vers 1.2.2 pour retirer les deux avis high. Il reste huit avis modérés. La première tentative de tests sous Node 18 échouait au chargement de Vitest; Node 22 est requis par le projet. Les changements concernent le runtime main testé, sans modification des pages; pas de validation manuelle Electron effectuée.

### Nouvelle revue PR #100
- Style des compteurs : préfixe #user-panel parasite retiré.
- Recherche : réponses invalidées dès la saisie, pagination masquée et terme capturé par requête.
- Marquage échoué : compteur restauré, messages arrivés pendant la requête conservés et tentative suivante permise; une seule requête en cours par conversation.
Validation : audit high, types, lint, 265 tests, couverture 100 % et build passent sous Node 22. Les pages sont vérifiées par les tests jsdom; validation manuelle Electron non effectuée.


### Suite de la revue PR #100 — position et synchronisation des lectures

Accusés : position complète propagée jusqu’aux coches et « Vu par », fusion monotone des réponses HTTP avec le temps réel, initialisation avant la requête et rejet des réponses d’une ancienne ouverture. Frontière des non-lus figée par identifiant. Marquage réussi : réponse réconciliée, nouveaux messages marqués ensuite seulement si la conversation est encore affichée au premier plan.

Validation locale sous Node 24 : audit high, types (Frontend), lint, tests avec couverture et build. La validation manuelle Electron n’a pas été effectuée. Tests PostgreSQL non exécutés : aucune DATABASE_URL de test disponible et démarrage de la base jetable empêché par les permissions de l’environnement. La validation d’intégration reste requise avant fusion.


### Revue suivante PR #100 — rechargement des non-lus et reconnexion

Une réponse de non-lus dépassée par une autre requête est ignorée. Une réception ou un marquage local pendant le chargement impose une relecture serveur, bornée à une relance; si les deux réponses deviennent périmées, les compteurs locaux sont conservés jusqu’à la synchronisation suivante. Après reconnexion, la conversation active recharge aussi ses accusés de lecture, en conservant sa position monotone pendant la requête.

Validation de cette suite : audit high, types, lint, 277 tests avec couverture 100 % et build passent sous Node 24. Validation manuelle Electron non effectuée.


### Suite de revue du 6 octobre — concurrence et contrat PUT

Les chargements de non-lus préservent les conversations dont le PUT de lecture est en cours. Si un chargement a exclu une conversation, son état est rechargé après la résolution du PUT, avant de rafraîchir les badges ou de retenter une lecture. Régressions couvertes : succès et échec après réception d’un message et abandon de la conversation. Validation : audit high, types, lint, build et 279 tests à couverture 100 % passent sous Node 24. Test manuel Electron non exécuté.

### Suite de revue — compteur autoritaire et libellé de lecture

Après un PUT réussi pour une conversation qui n’est plus affichée, les non-lus sont relus pour distinguer un message arrivé avant ou après la position enregistrée par le serveur. Cela supprime les badges fantômes lorsque la conversation a été quittée et conserve la relance si elle reste affichée. Le contrat expose la position du dernier message lu, pas l’heure de l’action de lecture : l’interface affiche donc « Lu » / « Read » plutôt qu’une heure d’envoi présentée comme heure de lecture.

Validation : audit high, types, lint, build et 280 tests avec couverture 100 % passent sous Node 24. Test manuel Electron non exécuté.
\n\n

### Navigation pendant les attentes

La relance d’un PUT de lecture réévalue le focus et la conversation affichée après la relecture HTTP. Un saut vers un résultat de recherche conserve l’identifiant initial et s’arrête sans notification si la conversation change pendant la pagination, pour les DM comme les salons. Trois régressions simulent ces changements pendant les requêtes. Validation : audit high, types, lint, build et 283 tests avec couverture 100 % passent sous Node 24; validation manuelle Electron non effectuée.

### Recherche pendant une pagination

Les appels de pagination partagent la promesse en cours pour la même conversation : un saut de recherche attend donc le chargement déclenché par le défilement avant de reprendre, au lieu de conclure que le message est absent. L’ouverture d’un résultat DM vérifie aussi la conversation active après le rendu initial. Trois régressions couvrent le partage des requêtes DM/salon et une navigation pendant l’ouverture. Validation manuelle Electron non effectuée.

Validation : audit high, types, lint, build et 286 tests avec couverture 100 % passent sous Node 24.

### Suppression des messages et non-lus

Après chaque événement de suppression, les deux pages relisent les compteurs serveur, même si le message ne figure pas dans leur cache, puis mettent à jour les compteurs, le rail et le badge de l’application. Aucun décrément local : un message supprimé peut déjà être lu ou être absent de la fenêtre d’historique. Deux régressions couvrent les pages salons et DM avec une réponse serveur différée.

Validation : audit high, types, lint, build et 288 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Lecture bornée au dernier message rendu

Le marquage intervient après la construction des messages de la page et transmet l’identifiant du dernier message enregistré rendu, jamais celui d’un brouillon non livré. Le gateway exige cet identifiant et le transmet dans le PUT : un message ajouté côté serveur avant la requête mais pas encore affiché reste non lu. Une lecture en cours mémorise le rendu suivant et ne se relance que si la borne affichée change. Les tests couvrent les bornes DM/salon, les arrivées sans rendu et le rendu suivant pendant un PUT.

Validation : audit high, types, lint, build et 290 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée. Le contrat messageId existe déjà dans Message-Service #9, désormais fusionnée; aucune modification de cette PR fermée.

### Pagination et réouverture

Chaque pagination et saut de recherche conserve l’objet d’historique propre à son ouverture. La réouverture remplace cet objet : les anciennes réponses, erreurs et finalisations sont ignorées, même avec le même identifiant de conversation. Les promesses de pagination ne sont partagées qu’au sein de cette ouverture; une ancienne réponse ne peut ni créer un trou ni arrêter ou libérer la nouvelle requête. Quatre régressions couvrent les DM et salons, la conservation du curseur récent et l’annulation des anciens sauts.

Validation : audit high, types, lint, build et 294 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Événement reçu après un snapshot de non-lus

Un message reçu peut déjà figurer dans les compteurs HTTP : son incrément local est donc provisoire. Après le traitement de chaque événement d’autrui, les deux pages relisent les non-lus serveur puis rafraîchissent les compteurs, le rail et le badge de l’application. Les gardes existantes protègent les réceptions et PUT concurrents; en cas d’échec HTTP, les compteurs locaux sont conservés. Quatre régressions distinguent les événements déjà inclus d’un nouveau message, pour les DM et salons. Les doublures des pages suivent maintenant les compteurs serveur après chaque événement.

Validation : audit high, types, lint, build et 298 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Vérification du tri des lectures et des dates entrantes

La comparaison lexicographique des identifiants à dates égales est conservée : elle reproduit le contrat serveur `(createdAt, id)`, son `orderBy` et ses filtres `id > lastReadMessageId`. Un tri numérique naturel de m2/m10 divergerait de ce contrat; les identifiants ne définissent jamais seuls la chronologie. Le séparateur de non-lus est fixé par identifiant et ne dépend pas de ces comparaisons.

Les événements de lecture vérifient désormais Number.isFinite après Date.parse avant toute résolution de lecteur ou émission vers les pages. Les dates vides, non interprétables et hors plage sont ignorées; les régressions sont ajoutées au test de relais existant. Validation : audit high, types, lint, build et 298 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.
