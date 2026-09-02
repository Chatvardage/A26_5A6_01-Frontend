# MockGateway - Documentation

Le **MockGateway** est un système complet de simulation pour tester l'application de chat sans avoir besoin d'un serveur réel. Il permet de simuler tous les aspects d'une application de chat : connexion, déconnexion, reconnexion, utilisateurs, salons, messages, et événements.

## 🎯 Caractéristiques

### 1. **Simulation de la Connexion**

Simule la connexion d'un utilisateur au système avec gestion de l'état et émission d'événements.

```typescript
// Connecter un utilisateur
await gateway.simulerConnexion('u1');

// Vérifier l'état de connexion
const etat = gateway.obtenirEtatConnexion();
console.log(etat.statut); // 'connecte'
```

**Points clés:**

- Valide l'existence de l'utilisateur
- Met à jour l'état de connexion
- Émet un événement `connexion`
- Génère des messages système dans les salons
- Met à jour la présence de l'utilisateur

### 2. **Simulation de la Déconnexion**

Simule la déconnexion d'un utilisateur avec nettoyage d'état approprié.

```typescript
// Déconnecter l'utilisateur
await gateway.simulerDeconnexion();

// Vérifier que l'utilisateur est déconnecté
const etat = gateway.obtenirEtatConnexion();
console.log(etat.statut); // 'deconnecte'
```

**Points clés:**

- Met à jour la présence à "hors-ligne"
- Émet des messages système
- Émet un événement `deconnexion`
- Nettoie l'utilisateur connecté

### 3. **Simulation de la Reconnexion**

Simule une reconnexion après une déconnexion, avec incrémentation du compteur.

```typescript
// Se reconnecter
await gateway.simulerReconnexion('u1');

// Vérifier le nombre de reconnexions
const etat = gateway.obtenirEtatConnexion();
console.log(etat.reconnexions); // 1 (ou plus)
```

**Points clés:**

- Incrémente le compteur de reconnexions
- Passe par l'état 'reconnexion' temporaire
- Émet les événements `reconnexion` et `connexion`

### 4. **Simulation de la Latence**

Simule un délai réseau réaliste pour chaque opération.

```typescript
// Définir une latence de 100ms
gateway.definirLatence(100);

// Les opérations attendront la latence définie
const debut = Date.now();
await gateway.obtenirTousLesUtilisateurs();
const duree = Date.now() - debut; // ~100ms
```

**Points clés:**

- Applicable à toutes les opérations asynchrones
- Configurable après création
- Utile pour tester le comportement avec une connexion lente

### 5. **Gestion des Événements**

Système complet d'événements pour observer les changements.

```typescript
// Écouter un événement
gateway.ecouterEvenement('message-recu', (evenement) => {
  console.log('Nouveau message:', evenement.donnees.message);
});

// Retirer un écouteur
gateway.retirerEcouteur('message-recu', ecouteur);
```

**Types d'événements disponibles:**

- `connexion` - Utilisateur connecté
- `deconnexion` - Utilisateur déconnecté
- `reconnexion` - Utilisateur en reconnexion
- `utilisateur-connecte` - Nouvel utilisateur créé
- `utilisateur-deconnecte` - Utilisateur supprimé
- `utilisateur-rejoint-salon` - Utilisateur rejoint un salon
- `utilisateur-quitte-salon` - Utilisateur quitte un salon
- `salon-cree` - Nouveau salon créé
- `salon-supprime` - Salon supprimé
- `message-recu` - Nouveau message reçu
- `message-modifie` - Message modifié
- `message-supprime` - Message supprimé
- `presence-mise-a-jour` - Présence d'un utilisateur mise à jour
- `erreur` - Erreur survenue

### 6. **Gestion des Utilisateurs**

#### Créer un utilisateur

```typescript
const utilisateur = await gateway.creerUtilisateur('nouveau_user');
console.log(utilisateur.id); // 'u4' (ou autre)
console.log(utilisateur.pseudo); // 'nouveau_user'
```

**Validation:**

- Le pseudo doit contenir 3-20 caractères
- Caractères autorisés: lettres, chiffres, underscore (_), tiret (-)

#### Récupérer les utilisateurs

```typescript
// Un utilisateur spécifique
const user = await gateway.obtenirUtilisateur('u1');

// Tous les utilisateurs
const tous = await gateway.obtenirTousLesUtilisateurs();

// La présence d'un utilisateur
const presence = await gateway.obtenirPresence('u1');
console.log(presence.statut); // 'en-ligne' ou 'hors-ligne'
```

### 7. **Gestion des Salons**

#### Créer un salon

```typescript
const salon = await gateway.creerSalon(
  'Général', // nom
  'u1', // hôte (créateur)
  'public' // visibilité: 'public' ou 'prive'
);
```

#### Gérer les membres

```typescript
// Ajouter un utilisateur
await gateway.ajouterUtilisateurAuSalon('s1', 'u3');

// Retirer un utilisateur
await gateway.retirerUtilisateurDuSalon('s1', 'u3');

// Supprimer le salon
await gateway.supprimerSalon('s1');
```

#### Récupérer les salons

```typescript
// Un salon spécifique
const salon = await gateway.obtenirSalon('s1');

// Tous les salons
const salons = await gateway.obtenirTousLesSalons();
```

### 8. **Gestion des Messages**

#### Envoyer un message

```typescript
const message = await gateway.envoyerMessage(
  's1', // ID de la conversation
  'u1', // ID de l'auteur
  'Bonjour tout le monde!' // contenu
);
```

#### Modifier un message

```typescript
const messageModifie = await gateway.modifierMessage(
  messageId,
  'Contenu modifié'
);
```

#### Récupérer les messages

```typescript
// Un message spécifique
const message = await gateway.obtenirMessage('msg-1');

// Tous les messages d'une conversation
const messages = await gateway.obtenirMessagesConversation('s1');
```

#### Supprimer un message

```typescript
await gateway.supprimerMessage('msg-1');
```

### 9. **Conversations Privées**

#### Créer une conversation privée

```typescript
const conversation = await gateway.creerConversationPrivee('u1', 'u2');
```

#### Récupérer une conversation privée

```typescript
const conv = await gateway.obtenirConversationPrivee(conversationId);
```

## 📝 Exemple Complet

```typescript
import { creerMockGateway } from './MockGateway.ts';

// Créer une instance du gateway
const gateway = creerMockGateway(100); // 100ms de latence

// Définir des écouteurs
gateway.ecouterEvenement('connexion', (evt) => {
  console.log('Utilisateur connecté:', evt.donnees);
});

gateway.ecouterEvenement('message-recu', (evt) => {
  console.log('Nouveau message:', evt.donnees.message);
});

// Scénario de test
async function scenario() {
  try {
    // 1. Connexion
    await gateway.simulerConnexion('u1');
    console.log('✓ Utilisateur connecté');

    // 2. Créer un salon
    const salon = await gateway.creerSalon('Discussion', 'u1', 'public');
    console.log('✓ Salon créé:', salon.nom);

    // 3. Ajouter un utilisateur
    await gateway.ajouterUtilisateurAuSalon(salon.id, 'u2');
    console.log('✓ Utilisateur ajouté au salon');

    // 4. Envoyer des messages
    const msg1 = await gateway.envoyerMessage(salon.id, 'u1', 'Bonjour!');
    console.log('✓ Message envoyé');

    // 5. Modifier le message
    const msgModifie = await gateway.modifierMessage(
      msg1.id,
      'Bonjour tout le monde!'
    );
    console.log('✓ Message modifié');

    // 6. Récupérer les messages
    const messages = await gateway.obtenirMessagesConversation(salon.id);
    console.log('✓ Messages récupérés:', messages.length);

    // 7. Déconnexion
    await gateway.simulerDeconnexion();
    console.log('✓ Utilisateur déconnecté');
  } catch (erreur) {
    console.error('✗ Erreur:', erreur);
  }
}

// Exécuter le scénario
await scenario();
```

## 🔧 Configuration Initiale

Le MockGateway est pré-configuré avec des données de test:

**Utilisateurs:**

- `u1`: alice
- `u2`: bob
- `u3`: charlie

**Salons:**

- `s1`: Général (public, membres: u1, u2)
- `s2`: Privé (privé, membres: u1, u3)

## 💡 Cas d'Usage

### Test d'une application de chat

```typescript
// Tester le flux d'authentification
await gateway.simulerConnexion(userId);
expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
```

### Simulation de problèmes de réseau

```typescript
// Augmenter la latence pour simuler une connexion lente
gateway.definirLatence(1000); // 1 seconde

// Reconnecter après une déconnexion
await gateway.simulerReconnexion(userId);
```

### Test des événements

```typescript
let messageRecu = false;
gateway.ecouterEvenement('message-recu', () => {
  messageRecu = true;
});

await gateway.envoyerMessage('s1', 'u1', 'Test');
expect(messageRecu).toBe(true);
```

## 🛠️ Réinitialisation

Pour réinitialiser le gateway à son état initial:

```typescript
gateway.reinitialiser();
```

Cela:

- Efface tous les utilisateurs personnalisés
- Réinitialise les salons et conversations
- Efface les messages
- Réinitialise l'état de connexion
- Recharge les données de test par défaut

## ⚙️ État Interne

Accéder à l'état actuel:

```typescript
// État de connexion
const etat = gateway.obtenirEtatConnexion();

// Utilisateur connecté
const userId = gateway.obtenirUtilisateurConnecte();
```

## 🎓 Tests

Le MockGateway inclut des tests complets couvrant:

- Connexion et déconnexion
- Reconnexion avec compteur
- Latence
- Événements
- Gestion des utilisateurs
- Gestion des salons
- Gestion des messages
- Intégration complète

Exécuter les tests:

```bash
npm test
```
