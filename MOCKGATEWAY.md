# Branchement au backend ChatVardage

> Historique : ce fichier documentait autrefois en détail `MockGateway.ts`,
> un simulateur en mémoire utilisé pendant les premières itérations, avant
> qu'un vrai backend n'existe. **Ce mock a été retiré** (`MockGateway.ts`,
> `MockGatewayRuntime.js` et leurs tests n'existent plus dans ce dépôt) une
> fois l'infrastructure réelle ChatVardage (Gateway + microservices, voir
> `A26_5A6_01-Infra`) disponible. Ce document décrit maintenant uniquement le
> branchement réel.

## 🌐 Branchement au backend réel (HTTP + Socket.IO)

**Le mock a été retiré** (`MockGateway.ts`/`MockGatewayRuntime.js` et leurs
tests n'existent plus, ainsi que le switch `CHATVARDAGE_BACKEND=mock`). L'app
parle uniquement au vrai backend via `RealGatewayRuntime`
(`src/infrastructure/gateways/RealGatewayRuntime.js`, côté processus main,
chemin réellement exécuté par Electron). `HttpWebSocketGateway`
(`src/infrastructure/gateways/HttpWebSocketGateway.ts`) reste une
implémentation TypeScript de référence du même contrat `ChatGateway`/
`AuthGateway`, pour un usage hors Electron — elle n'est pas branchée dans
l'app elle-même (voir son en-tête).

### Comment ça marche

- **HTTP** pour tout ce qui est requête/réponse : authentification,
  inscription, salons, messages (salon et DM), historique paginé, profil,
  configuration utilisateur (thème/langue/alias/notifications/présence).
- **Socket.IO** (namespace `/messages`) pour le temps réel : nouveaux
  messages (salon et DM), messages modifiés/supprimés, indicateur de saisie.
- Reconnexion automatique avec un délai croissant (1s → 15s max) si la
  connexion tombe involontairement, avec passage de l'état `connecte` →
  `reconnexion` → `connecte` (ou `deconnecte` si la fermeture est
  volontaire — boutons "Coupure"/"Reconnexion").

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
`leave`/`send`), `typing` (éphémère, salon et DM).

**Rôles et autorisation** : il n'y a plus de notion d'« hôte »/propriétaire
par salon. L'autorité (créer/renommer/changer visibilité/supprimer un salon,
inviter, retirer un membre) vient uniquement du rôle global de l'utilisateur
(`utilisateur` / `moderateur` / `admin`, retourné par Authentification) —
voir `peutGererSalons` dans `src/domain/entities/Utilisateur.ts`.

**Lacune backend connue et assumée** : aucun service n'expose la présence
d'un AUTRE utilisateur (seule la sienne, via `/api/config-utilisateur/presence`) —
la présence affichée pour les autres reste "hors-ligne" par défaut tant que
ce n'est pas ajouté côté backend.

### Authentification (pseudo/courriel + mot de passe)

- **Connexion** : `identifiant` (pseudo OU courriel) + mot de passe.
- **Inscription** : `courriel` + mot de passe — un pseudo par défaut est
  généré côté renderer à partir du courriel (`genererPseudoParDefaut`,
  `src/domain/entities/Utilisateur.ts`) et envoyé à l'inscription (le
  backend exige un pseudo dès l'inscription ; en cas de collision, le
  gateway retente automatiquement avec un pseudo légèrement randomisé). Une
  fois inscrit⋅e, l'écran "Choisis ton pseudo" permet de le changer tout de
  suite (ou plus tard, depuis la page profil).
