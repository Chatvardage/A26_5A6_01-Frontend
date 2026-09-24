# Branchement au backend ChatVardage

Ce document décrit le branchement de l'app à l'infrastructure ChatVardage
(Gateway + microservices, voir `A26_5A6_01-Infra`). L'app n'a pas de mode
simulé : elle parle uniquement au vrai backend.

## 🌐 Branchement au backend réel (HTTP + Socket.IO)

L'app parle au backend via `RealGatewayRuntime`
(`src/infrastructure/gateways/RealGatewayRuntime.js`, côté processus main,
chemin réellement exécuté par Electron). C'est la seule implémentation.

### Comment ça marche

- **HTTP** pour tout ce qui est requête/réponse : authentification,
  inscription, salons, messages (salon et DM), historique paginé, profil,
  configuration utilisateur (thème/langue/alias/notifications/présence).
- **Socket.IO** (namespace `/messages`) pour le temps réel : nouveaux
  messages (salon et DM), messages modifiés/supprimés, indicateur de saisie.
- Reconnexion automatique avec un délai croissant (1s → 15s max) si la
  connexion tombe (`disconnect` ou `connect_error`), avec passage de l'état
  `connecte` → `reconnexion` → `connecte`. L'état réseau de l'OS
  (`net.isOnline`, sortie de veille via `powerMonitor`) est relayé par
  main.js : hors ligne → `deconnecte` (cause `hors-ligne`), sans tentative.
  Un battement de cœur `GET /api/health` (15 s) détecte un socket zombie.

### Infrastructure réelle (ChatVardage)

Par défaut, l'app pointe sur le Gateway local de l'infrastructure ChatVardage
(voir le dépôt `A26_5A6_01-Infra`, `docker compose up`) :

```
http://localhost:3000        (HTTP + Socket.IO, via le Gateway Serveur-API)
```

Surchargeable sans toucher au code :

```bash
CHATVARDAGE_API_URL=https://votre-gateway/  npm run start:dev
CHATVARDAGE_SOCKET_URL=https://votre-gateway/  npm run start:dev
```

Le Gateway relaie ensuite vers Authentification, Room-Service,
Message-Service et User-Config-Service — voir leurs README/AGENTS.md
respectifs pour le détail par service.

### API réellement consommée (voir `RealGatewayRuntime.js` pour le détail exact)

| Méthode HTTP | Chemin | Usage |
| --- | --- | --- |
| POST | `/api/auth/login` | `{ identifiant, mot_de_passe }` → `{ jeton, utilisateur }` |
| POST | `/api/auth/register` | `{ pseudo, courriel, mot_de_passe }` → `{ jeton, utilisateur }` |
| GET/PATCH/DELETE | `/api/auth/me` | Profil courant (lecture/modification/suppression du compte) |
| GET | `/api/users/lookup?ids=` | Résolution de pseudo pour d'autres utilisateurs (id → pseudo uniquement) |
| GET/POST | `/api/rooms`, `/api/rooms/:id` | Lister/créer un salon |
| PATCH/DELETE | `/api/rooms/:id` | Renommer/changer visibilité, supprimer (modérateur/admin) |
| POST | `/api/rooms/:id/join`, `/leave` | Rejoindre/quitter un salon |
| POST | `/api/rooms/:id/invitations`, `/accept`, `/refuse` | Invitations |
| DELETE | `/api/rooms/:id/members/:userId` | Retirer un membre (modérateur/admin) |
| POST/GET | `/api/messages/rooms/:roomId`, `/history` | Messages de salon |
| PATCH/DELETE | `/api/messages/rooms/:roomId/:id` | Modifier/supprimer un message de salon |
| POST/GET | `/api/messages`, `/api/messages/history/:otherUserId` | Messages privés (DM) |
| GET | `/api/messages/conversations` | Liste des conversations privées |
| PATCH/DELETE | `/api/messages/:id` | Modifier/supprimer un DM |
| GET/PATCH | `/api/config-utilisateur` | Alias, thème, langue, mode de notification |
| PUT | `/api/config-utilisateur/presence` | Présence (soi-même uniquement) |

Socket.IO (`/messages`, `auth: { token }`) : `private-message.created/updated/deleted`,
`room-message.created/updated/deleted` (client émet aussi `room-message.join`/
`leave`/`send` — seulement après `connexion.prete`, voir plus bas),
`connexion.prete` (socket authentifié par Message-Service : le client
annonce alors sa présence et rejoint ses salons ; avant, le serveur refuse
ses événements — repli au bout de 5 s si l'événement n'arrive jamais, par
exemple face à un Message-Service plus ancien), `room-message.revoked` (accès au salon perdu : le client
oublie la room et la rejoindra si l'accès revient), `session.revoquee`
(jeton refusé, socket déconnecté : le client vérifie sa session, voir
verifierSessionApres401, au lieu de se reconnecter en boucle), `typing`
(éphémère, salon et DM).

**Rôles et autorisation** : il n'y a plus de notion d'« hôte »/propriétaire
par salon. L'autorité (créer/renommer/changer visibilité/supprimer un salon,
inviter, retirer un membre) vient uniquement du rôle global de l'utilisateur
(`utilisateur` / `moderateur` / `admin`, retourné par Authentification) —
voir `peutGererSalons` dans `src/domain/entities/Utilisateur.ts`.

**Présence et photos des autres** : `GET /api/config-utilisateur/publiques?ids=…`
(User-Config-Service) renvoie alias, avatar et présence **effective** (`actif`
= statut `enLigne` ET signe de vie de moins de 90 s). Le client renvoie
`PUT /api/config-utilisateur/presence` toutes les 20 s tant qu'il est « en
ligne » : une app fermée, plantée ou coupée du réseau apparaît donc hors
ligne aux autres au bout de 90 s. Présences rafraîchies toutes les 20 s,
avatars un tour sur six (~2 min) ou dès qu'un nouvel utilisateur apparaît.

### Authentification (pseudo/courriel + mot de passe)

- **Connexion** : `identifiant` (pseudo OU courriel) + mot de passe.
- **Inscription** : `courriel` + mot de passe — un pseudo par défaut est
  généré côté renderer à partir du courriel (`genererPseudoParDefaut`,
  `src/domain/entities/Utilisateur.ts`) et envoyé à l'inscription (le
  backend exige un pseudo dès l'inscription ; en cas de collision, le
  gateway retente automatiquement avec un pseudo légèrement randomisé). Une
  fois inscrit⋅e, l'écran "Choisis ton pseudo" permet de le changer tout de
  suite (ou plus tard, depuis la page profil).
