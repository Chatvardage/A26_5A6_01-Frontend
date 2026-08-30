# multiplatforme-gr.1

- Calendrier de travail (section projet du repo github)

# Plan de communication:
- Communication par discord
- Rencontre à chaque début de cours avant de commencer à travailler
- Documenter problème dans les messages de push git.

# Definition of done:
- 90 % de couverture de tests (logique seulement, non sur l’interface)
- Deux personnes doivent approuver les pull requests
- Code qui compile
- Interface fonctionnelle

# Technologies
- Frontend: React
- Backend: Nodejs
- BD: SQLite

# Comment démarrer
  
  ```bash
  npm install
  npm start
  ```

## Architecture

ChatVardage <br />
| <br />
├── frontend/ <br />
│   │<br />
│   └── src/<br />
│       │<br />
│       ├── presentation/<br />
│       │   │<br />
│       │   │   # Affichage et interaction avec l'utilisateur.<br />
│       │   │   # Cette couche ne contient pas la logique métier.<br />
│       │   │<br />
│       │   ├── pages/<br />
│       │   │   # Pages complètes de l'application.<br />
│       │   │   # Exemple : LoginPage, ChatPage, ServerPage.<br />
│       │   │<br />
│       │   ├── components/<br />
│       │   │   # Composants React réutilisables.<br />
│       │   │   # Exemple : MessageList, MessageInput, ChannelList.<br />
│       │   │<br />
│       │   └── layouts/<br />
│       │       # Structures générales des pages.<br />
│       │       # Exemple : AppLayout, ChatLayout, AuthLayout.<br />
│       │<br />
│       ├── application/<br />
│       │   │<br />
│       │   │   # Logique applicative du frontend.<br />
│       │   │   # Orchestre les actions de l'interface.<br />
│       │   │<br />
│       │   ├── hooks/<br />
│       │   │   # Hooks React contenant la logique de présentation.<br />
│       │   │   # Exemple : useMessages(), useChannels(), useAuth().<br />
│       │   │<br />
│       │   ├── stores/<br />
│       │   │   # État global ou partagé de l'application.<br />
│       │   │   # Exemple : utilisateur connecté, serveur sélectionné,<br />
│       │   │   # channel actuel, messages en mémoire.<br />
│       │   │<br />
│       │   └── view-models/<br />
│       │       # Transforme les données du domaine/API en données<br />
│       │       # adaptées aux composants React.<br />
│       │<br />
│       ├── domain/<br />
│       │   │<br />
│       │   │   # Modèle métier utilisé par le frontend.<br />
│       │   │   # Ne dépend ni de React ni du Gateway.<br />
│       │   │<br />
│       │   ├── entities/<br />
│       │   │   # Entités métier du frontend.<br />
│       │   │   # Exemple : User, Server, Channel, Message.<br />
│       │   │<br />
│       │   └── models/<br />
│       │       # Types et modèles utilisés par le frontend.<br />
│       │       # Exemple : UserModel, MessageModel, ChannelModel.<br />
│       │<br />
│       └── infrastructure/<br />
│           │<br />
│           │   # Communication avec les systèmes externes.<br />
│           │   # HTTP, WebSocket, Gateway, stockage local, etc.<br />
│           │<br />
│           ├── gateways/<br />
│           │   │<br />
│           │   │   # Point d'accès aux communications avec le backend.<br />
│           │   │<br />
│           │   └── GatewayClient.ts<br />
│           │       # Contrat/client utilisé par le frontend pour<br />
│           │       # communiquer avec le Gateway.<br />
│           │<br />
│           └── services/<br />
│               # Services techniques du frontend.<br />
│               # Exemple : AuthService, StorageService, NotificationService.<br />
│<br />
├── backend/<br />
│   │<br />
│   ├── src/<br />
│   │   │<br />
│   │   ├── interface/<br />
│   │   │   │<br />
│   │   │   │   # Point d'entrée du backend.<br />
│   │   │   │   # Reçoit les requêtes provenant de l'extérieur.<br />
│   │   │   │<br />
│   │   │   ├── http/<br />
│   │   │   │   │<br />
│   │   │   │   │   # Communication HTTP/REST.<br />
│   │   │   │   │<br />
│   │   │   │   ├── controllers/<br />
│   │   │   │   │   # Reçoit une requête HTTP et appelle le<br />
│   │   │   │   │   # Use Case approprié.<br />
│   │   │   │   │   # Exemple : MessageController.<br />
│   │   │   │   │<br />
│   │   │   │   └── routes/<br />
│   │   │   │       # Déclare les routes HTTP.<br />
│   │   │   │       # Exemple : POST /channels/:id/messages.<br />
│   │   │   │<br />
│   │   │   └── websocket/<br />
│   │   │       # Gestion des connexions et événements WebSocket.<br />
│   │   │       # Exemple : connexion d'un utilisateur,<br />
│   │   │       # nouveau message, typing, déconnexion.<br />
│   │   │<br />
│   │   ├── application/<br />
│   │   │   │<br />
│   │   │   │   # Logique applicative du backend.<br />
│   │   │   │   # Définit ce que l'application peut faire.<br />
│   │   │   │<br />
│   │   │   ├── use-cases/<br />
│   │   │   │   # Cas d'utilisation de l'application.<br />
│   │   │   │   # Exemple :<br />
│   │   │   │   # SendMessage<br />
│   │   │   │   # GetMessages<br />
│   │   │   │   # CreateChannel<br />
│   │   │   │   # DeleteMessage<br />
│   │   │   │   # JoinServer<br />
│   │   │   │<br />
│   │   │   └── dto/<br />
│   │   │       # Data Transfer Objects.<br />
│   │   │       # Définit les données échangées entre les couches.<br />
│   │   │       # Exemple : SendMessageDto, CreateChannelDto.<br />
│   │   │<br />
│   │   ├── domain/<br />
│   │   │   │<br />
│   │   │   │   # CŒUR MÉTIER DE L'APPLICATION.<br />
│   │   │   │   # Cette couche ne dépend pas de HTTP, WebSocket,<br />
│   │   │   │   # base de données ou framework.<br />
│   │   │   │<br />
│   │   │   ├── entities/<br />
│   │   │   │   # Entités métier.<br />
│   │   │   │   # Exemple : User, Server, Channel, Message.<br />
│   │   │   │<br />
│   │   │   ├── value-objects/<br />
│   │   │   │   # Objets représentant une valeur métier avec<br />
│   │   │   │   # ses propres règles de validation.<br />
│   │   │   │   # Exemple : UserId, ChannelId, MessageContent.<br />
│   │   │   │<br />
│   │   │   ├── events/<br />
│   │   │   │   # Événements métier.<br />
│   │   │   │   # Exemple : MessageCreated, MessageDeleted,<br />
│   │   │   │   # UserJoinedChannel.<br />
│   │   │   │<br />
│   │   │   └── ports/<br />
│   │   │       # Interfaces nécessaires au domaine/application.<br />
│   │   │       # Elles décrivent CE DONT le métier a besoin,<br />
│   │   │       # sans définir COMMENT c'est implémenté.<br />
│   │   │       # Exemple : MessageRepository, Gateway,<br />
│   │   │       # EventPublisher.<br />
│   │   │<br />
│   │   └── infrastructure/<br />
│   │       │<br />
│   │       │   # Implémentation technique des interfaces du domaine.<br />
│   │       │   # Cette couche contient les détails techniques.<br />
│   │       │<br />
│   │       ├── persistence/<br />
│   │       │   # Implémentations de la persistance.<br />
│   │       │   # Exemple : FileMessageRepository,<br />
│   │       │   # PostgresMessageRepository, etc.<br />
│   │       │<br />
│   │       ├── gateways/<br />
│   │       │   │<br />
│   │       │   │   # Implémentations des communications Gateway.<br />
│   │       │   │<br />
│   │       │   ├── MockGateway.ts<br />
│   │       │   │   # Gateway temporaire utilisé pendant<br />
│   │       │   │   # le développement et les tests.<br />
│   │       │   │<br />
│   │       │   └── WebSocketGateway.ts<br />
│   │       │       # Gateway réel utilisé pour communiquer<br />
│   │       │       # avec les clients via WebSocket.<br />
│   │       │<br />
│   │       ├── messaging/<br />
│   │       │   # Communication asynchrone entre composants/services.<br />
│   │       │   # Exemple : Redis, RabbitMQ, Kafka, etc.<br />
│   │       │<br />
│   │       └── config/<br />
│   │           # Configuration technique de l'application.<br />
│   │           # Exemple : variables d'environnement,<br />
│   │           # configuration DB, ports, Gateway, etc.<br />
│   │<br />
│   └── stockage/<br />
│       │<br />
│       │   # DONNÉES PHYSIQUES générées par l'application.<br />
│       │   # Ce dossier ne contient pas de logique métier.<br />
│       │<br />
│       └── messages/<br />
│           # Stockage temporaire des messages pendant<br />
│           # le développement.<br />
│           # Exemple : fichiers JSON contenant les messages.<br />
│<br />
└── shared/<br />
    │<br />
    │   # Éléments communs au frontend et au backend.<br />
    │   # Permet d'éviter de dupliquer certains contrats/types.<br />
    │<br />
    ├── types/<br />
    │   # Types TypeScript communs.<br />
    │   # Exemple : UserId, MessageId, ChannelId.<br />
    │<br />
    └── contracts/<br />
        # Contrats de communication frontend/backend.<br />
        # Exemple : SendMessageRequest,<br />
        # MessageResponse, WebSocketEvent.<br />
