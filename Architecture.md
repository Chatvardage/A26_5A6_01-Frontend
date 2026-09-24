# Architecture du Frontend ChatVardage

Application desktop Electron. Ce dépôt ne contient que le client : le
backend (Gateway + microservices) vit dans les autres dépôts `A26_5A6_01-*`
(voir `A26_5A6_01-Infra`). Le contrat HTTP/Socket.IO consommé est décrit
dans `BACKEND.md`.

## Vue d'ensemble

```text
Pages (renderer, sans Node.js)
  connexion/ (React + Vite)     index.html / message-prive.html / profil.html (JS vanilla)
          │                                   │
          └──────── window.electronAPI / window.notifications ────────┘
                                   │  (preload.js, contextBridge)
                                   ▼
                    IPC Electron (canaux explicites, provenance vérifiée)
                                   │
                                   ▼
main.js + src/main/ ── état unique du processus : session, préférences, fenêtre
   │
   ▼
RealGatewayRuntime.js ── HTTP + Socket.IO ──► Serveur-API (Gateway, port 3000)
                                                ├─ Authentification
                                                ├─ Room-Service (serveurs, salons)
                                                ├─ Message-Service (messages, temps réel)
                                                └─ User-Config-Service (préférences, présence)
```

Un seul processus (`main.js` et ses modules `src/main/`) détient l'état métier et une **seule**
instance de `RealGatewayRuntime`, partagée par toutes les pages : naviguer
d'une page à l'autre ne perd ni la session ni les préférences.

## Arborescence

```text
main.js                      Processus principal Electron : profil
                             (CHATVARDAGE_PROFIL), chargement des modules
                             ci-dessous, verrou d'instance, cycle de vie
src/main/                    Modules du processus principal (CommonJS)
  contexte.js                état partagé (`etat` : fenêtre, langue, thème,
                             préférences…), logDebugNotif,
                             envoyerVersRenderer
  gateway.js                 l'UNIQUE instance de RealGatewayRuntime
  securite.js                isAppUrl, exposerCanal + vérification de
                             provenance, CSP de la page de connexion (testé)
  menu.js                    menu natif traduit
  fenetre.js                 fenêtre sans cadre hors macOS,
                             agrandir/restaurer géré par l'app, zoom
                             adaptatif, navigation, canaux 'fenetre:*'
  notifications.js           notifications système (repli sans D-Bus),
                             badge, canaux 'notification*'
  preferences.js             copie locale des préférences (thème, langue,
                             notifications, alias, avatar), synchronisée
                             avec User-Config-Service et diffusée aux pages
                             ('preferences:change')
  session.js                 connexion, déconnexion, session expirée,
                             relais des événements temps réel vers la page
  canaux-donnees.js          canaux qui délèguent au gateway (serveurs,
                             salons, messages, profil, présence)
  reseau.js                  sonde de connectivité réseau du système

preload.js                   Seul pont vers les pages (contextBridge)
  - window.electronAPI       session, serveurs/salons, messages, profil,
                             préférences, i18n, réseau, présence
  - window.notifications     notifications système, badge, focus fenêtre
  - barre de titre           injecte .app-titlebar (logo, nom, boutons
                             réduire/agrandir/fermer → canaux 'fenetre:*')

scripts/start.js             Lance Vite + Electron (dev) ou Electron seul
                             après build (prod)

assets/                      Icônes de l'app (icon.png, icon.ico)

src/
  domain/entities/           Modèle métier, sans dépendance à l'UI ni au
                             réseau (TypeScript, testé) : Utilisateur,
                             Serveur (rôles et permissions d'affichage),
                             EtatConnexion

  infrastructure/
    config/ConfigurationApi.js   URL du Gateway (CHATVARDAGE_API_URL,
                                 CHATVARDAGE_SOCKET_URL)
    gateways/
      AuthGateway.ts                   Contrat consommé par l'écran de
                                       connexion React
      RealGatewayRuntime.js            Implémentation utilisée par main.js :
                                       appels HTTP, Socket.IO, reconnexion,
                                       jeton persisté. Lève des CODES
                                       d'erreur (ERR_*), jamais du texte

  i18n/
    translations.json        Seule source des textes (fr + en), y compris
                             les salons par défaut et le message de
                             bienvenue (channels.defaultAnnouncements,
                             channels.defaultGeneral, channels.welcomeMessage)
    i18n.js                  t() pour main.js (CommonJS)
    i18n-web.ts              t() pour la page React (ESM)

  presentation/pages/
    connexion/               Page React (build Vite → dist/login/)
      main.tsx               Composition : restauration de session, langue,
                             application du dernier thème connu
      LoginPage.tsx          Connexion (sélecteur de langue, pas de thème)
      InscriptionPage.tsx    Inscription
      PseudoChoicePage.tsx   « Choisis ton pseudo » après l'inscription
      connexion.css          Styles + barre de titre (.app-titlebar)
    index.html + javascript/salons/*.js + ../../../renderer.js
                             Serveurs et salons. Scripts classiques chargés
                             dans l'ordre (même portée globale) :
                               etat.js        DOM, état, stockage, réseau
                               historique.js  historique, messages non livrés
                               affichage.js   rendu salons/messages/actions
                               dialogues.js   créer, inviter, membres, menus
                               session.js     envoi, profil, initialiser()
                               temps-reel.js  notifications, messages reçus/
                                              modifiés/supprimés, saisie
                             renderer.js, chargé en dernier, lance la page.
    message-prive.html + javascript/messages-prives/*.js
                       + javascript/message-prive.js
                             Messages privés. Même principe que les salons
                             (scripts classiques, même portée globale) :
                               etat.js           dépendances, DOM, réseau,
                                                 présence, notifications
                               historique.js     non livrés, pagination
                               conversations.js  liste, saisie, messages
                                                 reçus, préférences
                               affichage.js      rendu liste/conversation
                               saisie.js         nouveau DM, filtres, envoi
                               rail.js           rail, pastilles, badge,
                                                 menu des notifications
                             message-prive.js, chargé en dernier, lance la
                             page au DOMContentLoaded.
    profil.html + javascript/profil.js
                             Profil : identité, compte, préférences (seul
                             endroit où changer le thème), suppression
    javascript/              Scripts classiques partagés (chargés avant la
                             page, exposent un global) :
      logique-interface.js   window.LogiqueInterface : logique PURE des deux
                             pages de chat (fusion/ajout/remplacement de
                             messages, règle de défilement, tris, contenu
                             du serveur par défaut), testée à 100 %
      i18n-browser.js        window.I18n
      theme-browser.js       window.ThemeManager (data-theme sur <html>)
      chat-ui-shared.js      window.ChatUiShared : réseau, présence,
                             avatars, actions de message, rôles
      notif-prefs.js         window.NotifPrefs : non-lus, mode de notif.
    css/
      styles.css             Styles communs (variables de thème, barre de
                             titre, messages, dialogues, panneau des
                             membres, toasts)
      message-prive.css      Spécifique aux messages privés
      profil.css             Spécifique au profil
```

## Flux importants

**Ouverture de session.** La page de connexion appelle
`session:authentifier` ou `session:inscription`. `main.js` charge les
serveurs, récupère les préférences depuis User-Config-Service, puis y
enregistre la langue si elle a été explicitement changée sur l'écran de
connexion (`langueChoisieAvantConnexion`,
`apresOuvertureSessionAvecLangueChoisie`). La reprise automatique d'une
session (`session:restaurer`) garde la langue du profil.

**Préférences.** Thème et langue sont modifiés depuis la page profil
(`preferences:modifier`, `theme:definir`, `langue:definir`). `main.js` met
à jour sa copie, enregistre sur le serveur et diffuse
`preferences:change` à la page affichée.

**Traductions.** Les pages vanilla reçoivent tout le dictionnaire une fois
(`i18n:dictionnaires`). Les textes sont traduits à l'affichage, jamais
stockés déjà traduits. Les données saisies par les utilisateurs (noms de
serveurs et de salons, messages) ne sont pas traduites, sauf le contenu
créé par migration du serveur par défaut, reconnu à ses identifiants figés
tant qu'il n'a pas été renommé ou modifié.

**Fenêtre.** Hors macOS, `frame: false`. `preload.js` ajoute la barre de
titre à chaque page ; sa place (`--titlebar-height`) est réservée en CSS
dès le premier affichage (bordure haute du `body`), pour que la page ne
se décale pas quand la barre apparaît. Les boutons appellent
`fenetre:reduire`, `fenetre:agrandir` et `fenetre:fermer` ; `main.js`
renvoie `fenetre:maximisee` pour l'icône agrandir/restaurer. À chaque
redimensionnement, `appliquerZoomAdaptatif` ajuste le zoom (100 % à
135 %).

**Session expirée.** Sur un 401 pendant une session ouverte,
`RealGatewayRuntime` revérifie le jeton (`GET /api/auth/me`) — un 401 peut
aussi vouloir dire « mot de passe actuel incorrect ». Si le jeton est
refusé, la session est fermée et `session-expiree` est émis : `main.js`
ramène la fenêtre à l'écran de connexion, qui l'explique
(`navigation:motif-retour-connexion`).

**Temps réel sans rechargement.** Un message reçu, modifié ou supprimé (salon
ou privé) est appliqué à l'état déjà affiché ; les listes ne défilent vers
le bas que si on suit la conversation. Le sondage de présence (20 s) ne
réinterroge pas les autres utilisateurs tant que le temps réel est actif.

## Tests

- `src/**/*.test.ts` (Vitest, jsdom) ; couverture 100 % exigée sur
  `src/**/*.ts`, `RealGatewayRuntime.js` et `logique-interface.js`.
- `salons/salons.chargement.test.ts` et `message-prive.chargement.test.ts` :
  les pages de chat chargées avec tous leurs scripts dans l'ordre réel et
  une fausse API Electron (contrat du découpage, messages reçus/modifiés/
  supprimés, rechargements évités, droits d'invitation).

## Sécurité

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webviewTag: false`. Jeton de session chiffré par le système
(`safeStorage`) dans un fichier `0600`. Chaque canal IPC est déclaré explicitement dans
`preload.js` et `main.js`, qui vérifie la provenance de l'appel. Les
messages sont affichés par `textContent` / création DOM, jamais par
injection HTML.
