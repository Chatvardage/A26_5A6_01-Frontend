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
&emsp;| <br />
&emsp;├── frontend/ <br />
&emsp;│&emsp;│<br />
&emsp;│&emsp;└── src/<br />
&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;├── presentation/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Affichage et interaction avec l'utilisateur.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Cette couche ne contient pas la logique métier.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;├── pages/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Pages complètes de l'application.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Exemple : LoginPage, ChatPage, ServerPage.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;├── components/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Composants React réutilisables.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Exemple : MessageList, MessageInput, ChannelList.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;└── layouts/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Structures générales des pages.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Exemple : AppLayout, ChatLayout, AuthLayout.<br />
&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;├── application/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Logique applicative du frontend.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Orchestre les actions de l'interface.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;├── hooks/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Hooks React contenant la logique de présentation.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Exemple : useMessages(), useChannels(), useAuth().<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;├── stores/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # État global ou partagé de l'application.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Exemple : utilisateur connecté, serveur sélectionné,<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # channel actuel, messages en mémoire.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;└── view-models/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Transforme les données du domaine/API en données<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# adaptées aux composants React.<br />
&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;├── domain/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Modèle métier utilisé par le frontend.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Ne dépend ni de React ni du Gateway.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;├── entities/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Entités métier du frontend.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Exemple : User, Server, Channel, Message.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;└── models/<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Types et modèles utilisés par le frontend.<br />
&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Exemple : UserModel, MessageModel, ChannelModel.<br />
&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;└── infrastructure/<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│   # Communication avec les systèmes externes.<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│   # HTTP, WebSocket, Gateway, stockage local, etc.<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;├── gateways/<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│&emsp;│   # Point d'accès aux communications avec le backend.<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│&emsp;└── GatewayClient.ts<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Contrat/client utilisé par le frontend pour<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# communiquer avec le Gateway.<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;└── services/<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;# Services techniques du frontend.<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;# Exemple : AuthService, StorageService, NotificationService.<br />
&emsp;│<br />
&emsp;├── backend/<br />
&emsp;│&emsp;│<br />
&emsp;│&emsp;├── src/<br />
&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;├── interface/<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Point d'entrée du backend.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Reçoit les requêtes provenant de l'extérieur.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;├── http/<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│   # Communication HTTP/REST.<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;├── controllers/<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│   # Reçoit une requête HTTP et appelle le<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│   # Use Case approprié.<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│   # Exemple : MessageController.<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;└── routes/<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Déclare les routes HTTP.<br />
&emsp;│&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Exemple : POST /channels/:id/messages.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;└── websocket/<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Gestion des connexions et événements WebSocket.<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Exemple : connexion d'un utilisateur,<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# nouveau message, typing, déconnexion.<br />
&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;├── application/<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Logique applicative du backend.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Définit ce que l'application peut faire.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;├── use-cases/<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Cas d'utilisation de l'application.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Exemple :<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # SendMessage<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # GetMessages<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # CreateChannel<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # DeleteMessage<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # JoinServer<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;└── dto/<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Data Transfer Objects.<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Définit les données échangées entre les couches.<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Exemple : SendMessageDto, CreateChannelDto.<br />
&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;├── domain/<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # CŒUR MÉTIER DE L'APPLICATION.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Cette couche ne dépend pas de HTTP, WebSocket,<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # base de données ou framework.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;├── entities/<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Entités métier.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Exemple : User, Server, Channel, Message.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;├── value-objects/<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Objets représentant une valeur métier avec<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # ses propres règles de validation.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Exemple : UserId, ChannelId, MessageContent.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;├── events/<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Événements métier.<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # Exemple : MessageCreated, MessageDeleted,<br />
&emsp;│&emsp;│&emsp;│&emsp;│   # UserJoinedChannel.<br />
&emsp;│&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;│&emsp;└── ports/<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Interfaces nécessaires au domaine/application.<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Elles décrivent CE DONT le métier a besoin,<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# sans définir COMMENT c'est implémenté.<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# Exemple : MessageRepository, Gateway,<br />
&emsp;│&emsp;│&emsp;│&emsp;&emsp;&emsp;# EventPublisher.<br />
&emsp;│&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;└── infrastructure/<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # Implémentation technique des interfaces du domaine.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # Cette couche contient les détails techniques.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;├── persistence/<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # Implémentations de la persistance.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # Exemple : FileMessageRepository,<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # PostgresMessageRepository, etc.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;├── gateways/<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Implémentations des communications Gateway.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;├── MockGateway.ts<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # Gateway temporaire utilisé pendant<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;│   # le développement et les tests.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;└── WebSocketGateway.ts<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# Gateway réel utilisé pour communiquer<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│&emsp;&emsp;&emsp;# avec les clients via WebSocket.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;├── messaging/<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # Communication asynchrone entre composants/services.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│   # Exemple : Redis, RabbitMQ, Kafka, etc.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;└── config/<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;# Configuration technique de l'application.<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;# Exemple : variables d'environnement,<br />
&emsp;│&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;# configuration DB, ports, Gateway, etc.<br />
&emsp;│&emsp;│<br />
&emsp;│&emsp;└── stockage/<br />
&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;│   # DONNÉES PHYSIQUES générées par l'application.<br />
&emsp;│&emsp;&emsp;&emsp;│   # Ce dossier ne contient pas de logique métier.<br />
&emsp;│&emsp;&emsp;&emsp;│<br />
&emsp;│&emsp;&emsp;&emsp;└── messages/<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;# Stockage temporaire des messages pendant<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;# le développement.<br />
&emsp;│&emsp;&emsp;&emsp;&emsp;&emsp;# Exemple : fichiers JSON contenant les messages.<br />
&emsp;│<br />
&emsp;└── shared/<br />
&emsp;&emsp;&emsp;│<br />
&emsp;&emsp;&emsp;│   # Éléments communs au frontend et au backend.<br />
&emsp;&emsp;&emsp;│   # Permet d'éviter de dupliquer certains contrats/types.<br />
&emsp;&emsp;&emsp;│<br />
&emsp;&emsp;&emsp;├── types/<br />
&emsp;&emsp;&emsp;│   # Types TypeScript communs.<br />
&emsp;&emsp;&emsp;│   # Exemple : UserId, MessageId, ChannelId.<br />
&emsp;&emsp;&emsp;│<br />
&emsp;&emsp;&emsp;└── contracts/<br />
&emsp;&emsp;&emsp;&emsp;&emsp;# Contrats de communication frontend/backend.<br />
&emsp;&emsp;&emsp;&emsp;&emsp;# Exemple : SendMessageRequest,<br />
&emsp;&emsp;&emsp;&emsp;&emsp;# MessageResponse, WebSocketEvent.<br />
