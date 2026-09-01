# 🚀 MockGateway - Système de Simulation pour ChatVardage

## À Propos

**MockGateway** est un système complet de simulation pour l'application ChatVardage. Il permet de tester l'application sans serveur réel en simulant toutes les interactions réseau.

## 📂 Fichiers Inclus

| Fichier                      | Description                                     |
| ---------------------------- | ----------------------------------------------- |
| `src/MockGateway.ts`         | Implémentation principale (808 lignes)          |
| `src/MockGateway.test.ts`    | Suite de tests complète (460 lignes, 101 tests) |
| `src/ExemplesMockGateway.ts` | 10 exemples d'utilisation pratiques             |
| `MOCKGATEWAY.md`             | Documentation détaillée                         |
| `RESUME_MOCKGATEWAY.md`      | Résumé technique                                |

## ✨ Fonctionnalités

### ✅ Gestion de la Connexion

- Connexion d'utilisateur
- Déconnexion
- Reconnexion avec compteur
- États: connecté / déconnecté / en reconnexion

### ✅ Gestion des Utilisateurs

- Création d'utilisateurs
- Récupération des utilisateurs
- Gestion de la présence (en-ligne / hors-ligne)
- Validation des pseudos

### ✅ Gestion des Salons

- Création de salons (public/privé)
- Ajout/retrait de membres
- Suppression de salons
- Récupération des salons

### ✅ Gestion des Messages

- Envoi de messages
- Modification de messages
- Suppression de messages
- Récupération de l'historique

### ✅ Système d'Événements

- 14 types d'événements
- Écouteurs ajoutables/retirables
- Émission en temps réel
- Gestion des erreurs

### ✅ Simulation de Latence

- Latence configurable en millisecondes
- Applicable à toutes les opérations
- Utile pour tester le comportement réseau

## 🚀 Démarrage Rapide

### Installation

Aucune installation supplémentaire requise. Le MockGateway est intégré au projet.

### Utilisation Simple

```typescript
import { creerMockGateway } from './src/MockGateway.ts';

// Créer une instance
const gateway = creerMockGateway(100); // 100ms de latence

// Connecter un utilisateur
await gateway.simulerConnexion('u1');

// Envoyer un message
await gateway.envoyerMessage('s1', 'u1', 'Bonjour!');

// Déconnecter
await gateway.simulerDeconnexion();
```

### Avec Événements

```typescript
// Écouter les événements
gateway.ecouterEvenement('connexion', (evt) => {
  console.log('Utilisateur connecté:', evt.donnees.utilisateurId);
});

gateway.ecouterEvenement('message-recu', (evt) => {
  console.log('Nouveau message:', evt.donnees.message.contenu);
});

// Les événements seront émis automatiquement
await gateway.simulerConnexion('u1');
await gateway.envoyerMessage('s1', 'u1', 'Test');
```

## 📚 Exemples

Le fichier `src/ExemplesMockGateway.ts` contient 10 exemples complets:

1. **Connexion simple** - Connexion et déconnexion de base
2. **Reconnexion** - Gestion des reconnexions
3. **Utilisateurs** - Création et gestion d'utilisateurs
4. **Salons** - Création et gestion de salons
5. **Messages** - Envoi et gestion de messages
6. **Latence** - Simulation de latence réseau
7. **Événements** - Gestion des événements
8. **Scénario complet** - Cas d'usage multi-utilisateur
9. **Conversations privées** - Messages directs
10. **Gestion d'erreurs** - Traitement des erreurs

Pour exécuter les exemples:

```typescript
import { executerTousLesExemples } from './src/ExemplesMockGateway.ts';

await executerTousLesExemples();
```

## 🧪 Tests

### Exécuter tous les tests

```bash
npm test
```

### Résultats

```
✓ Test Files  8 passed (8)
✓ Tests       101 passed (101)
✓ Duration    ~3.6 secondes
```

### Couverture des tests

- ✅ Connexion/Déconnexion/Reconnexion (8 tests)
- ✅ Latence (2 tests)
- ✅ Événements (3 tests)
- ✅ Utilisateurs (4 tests)
- ✅ Salons (6 tests)
- ✅ Messages (8 tests)
- ✅ Intégration (2 tests)
- ✅ Autres (58 tests de cas d'erreur et de variation)

## 📖 Documentation

### Guide Complet

Voir [MOCKGATEWAY.md](MOCKGATEWAY.md) pour la documentation complète avec:

- Description de chaque fonctionnalité
- Exemples de code détaillés
- Cas d'usage courants
- API complète
- Configuration

### Résumé Technique

Voir [RESUME_MOCKGATEWAY.md](RESUME_MOCKGATEWAY.md) pour:

- Statistiques du projet
- Points clés de l'implémentation
- Résultats des tests
- Prochaines étapes possibles

## 🔌 API Principale

```typescript
class MockGateway {
  // Connexion
  simulerConnexion(userId: string): Promise<void>;
  simulerDeconnexion(): Promise<void>;
  simulerReconnexion(userId: string): Promise<void>;

  // Utilisateurs
  creerUtilisateur(pseudo: string): Promise<Utilisateur>;
  obtenirUtilisateur(userId: string): Promise<Utilisateur | undefined>;
  obtenirTousLesUtilisateurs(): Promise<Utilisateur[]>;
  obtenirPresence(userId: string): Promise<Presence | undefined>;

  // Salons
  creerSalon(
    nom: string,
    hoteId: string,
    visibilite: 'public' | 'prive'
  ): Promise<Salon>;
  obtenirSalon(salonId: string): Promise<Salon | undefined>;
  obtenirTousLesSalons(): Promise<Salon[]>;
  ajouterUtilisateurAuSalon(salonId: string, userId: string): Promise<Salon>;
  retirerUtilisateurDuSalon(salonId: string, userId: string): Promise<Salon>;
  supprimerSalon(salonId: string): Promise<void>;

  // Messages
  envoyerMessage(
    conversationId: string,
    auteurId: string,
    contenu: string
  ): Promise<Message>;
  modifierMessage(messageId: string, contenuNouveau: string): Promise<Message>;
  supprimerMessage(messageId: string): Promise<void>;
  obtenirMessage(messageId: string): Promise<Message | undefined>;
  obtenirMessagesConversation(conversationId: string): Promise<Message[]>;

  // Conversations Privées
  creerConversationPrivee(
    userA: string,
    userB: string
  ): Promise<ConversationPrivee>;
  obtenirConversationPrivee(
    conversationId: string
  ): Promise<ConversationPrivee | undefined>;

  // Événements
  ecouterEvenement(type: TypeEvenement, ecouteur: EcouteurEvenement): void;
  retirerEcouteur(type: TypeEvenement, ecouteur: EcouteurEvenement): void;

  // Latence
  definirLatence(latenceMs: number): void;

  // État
  obtenirEtatConnexion(): EtatConnexion;
  obtenirUtilisateurConnecte(): string | null;
  reinitialiser(): void;
}
```

## 🎯 Données de Test Initiales

Le MockGateway vient pré-configuré avec:

**Utilisateurs:**

- `u1`: alice
- `u2`: bob
- `u3`: charlie

**Salons:**

- `s1`: Général (public, membres: u1, u2)
- `s2`: Privé (privé, membres: u1, u3)

## 💡 Cas d'Usage

### Test d'authentification

```typescript
await gateway.simulerConnexion(userId);
expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
```

### Test de chat multi-utilisateur

```typescript
const salon = await gateway.creerSalon('Discussion', 'u1');
await gateway.ajouterUtilisateurAuSalon(salon.id, 'u2');
await gateway.envoyerMessage(salon.id, 'u1', 'Bonjour!');
```

### Test de reconnexion

```typescript
await gateway.simulerConnexion('u1');
await gateway.simulerDeconnexion();
await gateway.simulerReconnexion('u1');
expect(gateway.obtenirEtatConnexion().reconnexions).toBeGreaterThan(0);
```

### Test de latence réseau

```typescript
gateway.definirLatence(1000); // Simuler une connexion lente
const debut = Date.now();
await gateway.obtenirTousLesUtilisateurs();
const duree = Date.now() - debut;
expect(duree).toBeGreaterThanOrEqual(1000);
```

## 🛠️ Configuration

### Modifier la latence

```typescript
const gateway = creerMockGateway(50); // 50ms par défaut
gateway.definirLatence(200); // Changer à 200ms
```

### Réinitialiser

```typescript
gateway.reinitialiser(); // Retour à l'état initial
```

### Accéder à l'état

```typescript
const etat = gateway.obtenirEtatConnexion();
const user = gateway.obtenirUtilisateurConnecte();
```

## ⚙️ Configuration TypeScript

Note: Les fichiers TypeScript du projet utilisent l'extension `.ts` dans les imports. Si vous avez une erreur TypeScript concernant `allowImportingTsExtensions`, activez cette option dans `tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true
  }
}
```

## 📊 Statistiques

- **Lignes de code:** 808 (MockGateway.ts)
- **Lignes de tests:** 460 (MockGateway.test.ts)
- **Exemples:** 10
- **Tests:** 101 ✅ TOUS PASSANTS
- **Types d'événements:** 14
- **Méthodes publiques:** 30+

## 🤝 Contribution

Le MockGateway est complètement implémenté et testé. Pour améliorer le projet:

1. Ajouter des fonctionnalités supplémentaires dans `MockGateway.ts`
2. Ajouter les tests correspondants dans `MockGateway.test.ts`
3. Mettre à jour la documentation

## 📝 Licence

Voir le fichier LICENSE du projet ChatVardage.

## 🎓 Support

Pour plus d'informations:

- Voir la [documentation complète](MOCKGATEWAY.md)
- Consulter les [exemples](src/ExemplesMockGateway.ts)
- Lire le [résumé technique](RESUME_MOCKGATEWAY.md)

---

**Créé pour le cours de développement multiplateforme - CÉGEP**
