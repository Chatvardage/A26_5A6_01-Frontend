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
│   │
│   └── src/
│       │
│       ├── presentation/
│       │   │
│       │   │   # Affichage et interaction avec l'utilisateur.
│       │   │   # Cette couche ne contient pas la logique métier.
│       │   │
│       │   ├── pages/
│       │   │   # Pages complètes de l'application.
│       │   │   # Exemple : LoginPage, ChatPage, ServerPage.
│       │   │
│       │   ├── components/
│       │   │   # Composants React réutilisables.
│       │   │   # Exemple : MessageList, MessageInput, ChannelList.
│       │   │
│       │   └── layouts/
│       │       # Structures générales des pages.
│       │       # Exemple : AppLayout, ChatLayout, AuthLayout.
│       │
│       ├── application/
│       │   │
│       │   │   # Logique applicative du frontend.
│       │   │   # Orchestre les actions de l'interface.
│       │   │
│       │   ├── hooks/
│       │   │   # Hooks React contenant la logique de présentation.
│       │   │   # Exemple : useMessages(), useChannels(), useAuth().
│       │   │
│       │   ├── stores/
│       │   │   # État global ou partagé de l'application.
│       │   │   # Exemple : utilisateur connecté, serveur sélectionné,
│       │   │   # channel actuel, messages en mémoire.
│       │   │
│       │   └── view-models/
│       │       # Transforme les données du domaine/API en données
│       │       # adaptées aux composants React.
│       │
│       ├── domain/
│       │   │
│       │   │   # Modèle métier utilisé par le frontend.
│       │   │   # Ne dépend ni de React ni du Gateway.
│       │   │
│       │   ├── entities/
│       │   │   # Entités métier du frontend.
│       │   │   # Exemple : User, Server, Channel, Message.
│       │   │
│       │   └── models/
│       │       # Types et modèles utilisés par le frontend.
│       │       # Exemple : UserModel, MessageModel, ChannelModel.
│       │
│       └── infrastructure/
│           │
│           │   # Communication avec les systèmes externes.
│           │   # HTTP, WebSocket, Gateway, stockage local, etc.
│           │
│           ├── gateways/
│           │   │
│           │   │   # Point d'accès aux communications avec le backend.
│           │   │
│           │   └── GatewayClient.ts
│           │       # Contrat/client utilisé par le frontend pour
│           │       # communiquer avec le Gateway.
│           │
│           └── services/
│               # Services techniques du frontend.
│               # Exemple : AuthService, StorageService, NotificationService.
│
├── backend/
│   │
│   ├── src/
│   │   │
│   │   ├── interface/
│   │   │   │
│   │   │   │   # Point d'entrée du backend.
│   │   │   │   # Reçoit les requêtes provenant de l'extérieur.
│   │   │   │
│   │   │   ├── http/
│   │   │   │   │
│   │   │   │   │   # Communication HTTP/REST.
│   │   │   │   │
│   │   │   │   ├── controllers/
│   │   │   │   │   # Reçoit une requête HTTP et appelle le
│   │   │   │   │   # Use Case approprié.
│   │   │   │   │   # Exemple : MessageController.
│   │   │   │   │
│   │   │   │   └── routes/
│   │   │   │       # Déclare les routes HTTP.
│   │   │   │       # Exemple : POST /channels/:id/messages.
│   │   │   │
│   │   │   └── websocket/
│   │   │       # Gestion des connexions et événements WebSocket.
│   │   │       # Exemple : connexion d'un utilisateur,
│   │   │       # nouveau message, typing, déconnexion.
│   │   │
│   │   ├── application/
│   │   │   │
│   │   │   │   # Logique applicative du backend.
│   │   │   │   # Définit ce que l'application peut faire.
│   │   │   │
│   │   │   ├── use-cases/
│   │   │   │   # Cas d'utilisation de l'application.
│   │   │   │   # Exemple :
│   │   │   │   # SendMessage
│   │   │   │   # GetMessages
│   │   │   │   # CreateChannel
│   │   │   │   # DeleteMessage
│   │   │   │   # JoinServer
│   │   │   │
│   │   │   └── dto/
│   │   │       # Data Transfer Objects.
│   │   │       # Définit les données échangées entre les couches.
│   │   │       # Exemple : SendMessageDto, CreateChannelDto.
│   │   │
│   │   ├── domain/
│   │   │   │
│   │   │   │   # CŒUR MÉTIER DE L'APPLICATION.
│   │   │   │   # Cette couche ne dépend pas de HTTP, WebSocket,
│   │   │   │   # base de données ou framework.
│   │   │   │
│   │   │   ├── entities/
│   │   │   │   # Entités métier.
│   │   │   │   # Exemple : User, Server, Channel, Message.
│   │   │   │
│   │   │   ├── value-objects/
│   │   │   │   # Objets représentant une valeur métier avec
│   │   │   │   # ses propres règles de validation.
│   │   │   │   # Exemple : UserId, ChannelId, MessageContent.
│   │   │   │
│   │   │   ├── events/
│   │   │   │   # Événements métier.
│   │   │   │   # Exemple : MessageCreated, MessageDeleted,
│   │   │   │   # UserJoinedChannel.
│   │   │   │
│   │   │   └── ports/
│   │   │       # Interfaces nécessaires au domaine/application.
│   │   │       # Elles décrivent CE DONT le métier a besoin,
│   │   │       # sans définir COMMENT c'est implémenté.
│   │   │       # Exemple : MessageRepository, Gateway,
│   │   │       # EventPublisher.
│   │   │
│   │   └── infrastructure/
│   │       │
│   │       │   # Implémentation technique des interfaces du domaine.
│   │       │   # Cette couche contient les détails techniques.
│   │       │
│   │       ├── persistence/
│   │       │   # Implémentations de la persistance.
│   │       │   # Exemple : FileMessageRepository,
│   │       │   # PostgresMessageRepository, etc.
│   │       │
│   │       ├── gateways/
│   │       │   │
│   │       │   │   # Implémentations des communications Gateway.
│   │       │   │
│   │       │   ├── MockGateway.ts
│   │       │   │   # Gateway temporaire utilisé pendant
│   │       │   │   # le développement et les tests.
│   │       │   │
│   │       │   └── WebSocketGateway.ts
│   │       │       # Gateway réel utilisé pour communiquer
│   │       │       # avec les clients via WebSocket.
│   │       │
│   │       ├── messaging/
│   │       │   # Communication asynchrone entre composants/services.
│   │       │   # Exemple : Redis, RabbitMQ, Kafka, etc.
│   │       │
│   │       └── config/
│   │           # Configuration technique de l'application.
│   │           # Exemple : variables d'environnement,
│   │           # configuration DB, ports, Gateway, etc.
│   │
│   └── stockage/
│       │
│       │   # DONNÉES PHYSIQUES générées par l'application.
│       │   # Ce dossier ne contient pas de logique métier.
│       │
│       └── messages/
│           # Stockage temporaire des messages pendant
│           # le développement.
│           # Exemple : fichiers JSON contenant les messages.
│
└── shared/
    │
    │   # Éléments communs au frontend et au backend.
    │   # Permet d'éviter de dupliquer certains contrats/types.
    │
    ├── types/
    │   # Types TypeScript communs.
    │   # Exemple : UserId, MessageId, ChannelId.
    │
    └── contracts/
        # Contrats de communication frontend/backend.
        # Exemple : SendMessageRequest,
        # MessageResponse, WebSocketEvent.
