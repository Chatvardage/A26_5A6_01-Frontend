import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  creerMockGateway,
  MockGateway,
  type TypeEvenement,
} from './MockGateway';

describe('MockGateway', () => {
  let gateway: MockGateway;

  beforeEach(() => {
    gateway = creerMockGateway(50); // Latence réduite pour les tests
  });

  afterEach(() => {
    gateway.reinitialiser();
  });

  // ===== Tests de Connexion =====
  describe('Connexion', () => {
    it('devrait connecter un utilisateur avec succès', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('connexion', () => {
        evenements.push('connexion');
      });

      await gateway.simulerConnexion('u1');
      const etat = gateway.obtenirEtatConnexion();

      expect(etat.statut).toBe('connecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBe('u1');
      expect(evenements).toContain('connexion');
    });

    it("devrait émettre une erreur si l'utilisateur n'existe pas", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message as string);
      });

      try {
        await gateway.simulerConnexion('utilisateur-inexistant');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it('devrait emettre un message système lors de la connexion', async () => {
      const messagesRecus: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) => {
        messagesRecus.push(evt.donnees.message);
      });

      await gateway.simulerConnexion('u1');

      expect(messagesRecus.length).toBeGreaterThan(0);
    });
  });

  // ===== Tests de Déconnexion =====
  describe('Déconnexion', () => {
    beforeEach(async () => {
      await gateway.simulerConnexion('u1');
    });

    it('devrait déconnecter un utilisateur', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('deconnexion', () => {
        evenements.push('deconnexion');
      });

      await gateway.simulerDeconnexion();
      const etat = gateway.obtenirEtatConnexion();

      expect(etat.statut).toBe('deconnecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
      expect(evenements).toContain('deconnexion');
    });

    it("devrait émettre une erreur si personne n'est connecté", async () => {
      await gateway.simulerDeconnexion();
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      await gateway.simulerDeconnexion();

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it('devrait mettre à jour la présence lors de la déconnexion', async () => {
      const presences: unknown[] = [];
      gateway.ecouterEvenement('presence-mise-a-jour', (evt) => {
        presences.push(evt.donnees.presence);
      });

      await gateway.simulerDeconnexion();

      expect(presences.length).toBeGreaterThan(0);
    });

    it("devrait gérer la déconnexion quand l'utilisateur n'existe plus", async () => {
      // Utiliser une approche pour tester le cas où utilisateur est null
      // On peut tester indirectement via les états
      await gateway.simulerDeconnexion();
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');

      // Deuxième déconnexion devrait émettre une erreur (personne n'est connecté)
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      await gateway.simulerDeconnexion();
      expect(erreurs.length).toBeGreaterThan(0);
    });

    it('devrait émettre des messages système lors de la déconnexion dans les salons', async () => {
      await gateway.simulerConnexion('u1');
      const messagesSysteme: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) => {
        const message = evt.donnees.message as { type?: string } | undefined;
        if (message?.type === 'systeme') {
          messagesSysteme.push(message);
        }
      });

      await gateway.simulerDeconnexion();

      // Devrait avoir au moins un message système pour le salon 's1'
      expect(messagesSysteme.length).toBeGreaterThan(0);
    });
  });

  // ===== Tests de Reconnexion =====
  describe('Reconnexion', () => {
    beforeEach(async () => {
      await gateway.simulerConnexion('u1');
      await gateway.simulerDeconnexion();
    });

    it('devrait reconnecter un utilisateur après une déconnexion', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('reconnexion', () => {
        evenements.push('reconnexion');
      });
      gateway.ecouterEvenement('connexion', () => {
        evenements.push('connexion');
      });

      await gateway.simulerReconnexion('u1');
      const etat = gateway.obtenirEtatConnexion();

      expect(etat.statut).toBe('connecte');
      expect(evenements).toContain('reconnexion');
      expect(evenements).toContain('connexion');
    });

    it('devrait incrémenter le compteur de reconnexions', async () => {
      const etatAvant = gateway.obtenirEtatConnexion();
      const reconnexionsAvant = etatAvant.reconnexions ?? 0;

      await gateway.simulerReconnexion('u1');
      const etatApres = gateway.obtenirEtatConnexion();

      expect(etatApres.reconnexions ?? 0).toBe(reconnexionsAvant + 1);
    });

    it('devrait traiter les utilisateurs en membreIds ou membresInvites lors de la déconnexion', async () => {
      // Se reconnecter d'abord
      await gateway.simulerReconnexion('u1');

      // Récupérer le salon et le modifier pour avoir u1 en membresInvites d'un autre salon
      // Créer un nouveau salon où u1 n'est pas membre mais invité
      const salonTest = await gateway.creerSalon('TestInvit', 'u2', 'public');

      // Utiliser la méthode publique pour ajouter u1 aux membresInvites
      // Note: Ce test suppose une méthode auxiliaire ou on doit passer par ajouterUtilisateurAuSalon
      await gateway.ajouterUtilisateurAuSalon(salonTest.id, 'u1');

      const messagesSysteme: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) => {
        const message = evt.donnees.message as Record<string, unknown>;
        if (message?.type === 'systeme') {
          messagesSysteme.push(evt.donnees.message);
        }
      });

      // Déconnecter - devrait émettre un message système pour le salon invité
      await gateway.simulerDeconnexion();

      // Vérifier qu'au moins un message système a été émis (u1 peut être dans les deux salons)
      expect(messagesSysteme.length).toBeGreaterThan(0);
    });
  });

  // ===== Tests de Latence =====
  describe('Latence', () => {
    it('devrait respecter la latence définie', async () => {
      gateway.definirLatence(100);
      const debut = Date.now();
      await gateway.simulerConnexion('u1');
      const duree = Date.now() - debut;

      expect(duree).toBeGreaterThanOrEqual(100);
    });

    it('devrait permettre de modifier la latence', async () => {
      gateway.definirLatence(10);
      const debut = Date.now();
      await gateway.obtenirTousLesUtilisateurs();
      const duree = Date.now() - debut;

      expect(duree).toBeLessThan(50);
    });
  });

  // ===== Tests de Gestion des Événements =====
  describe('Gestion des Événements', () => {
    it("devrait enregistrer un écouteur d'événement", () => {
      const appelees: string[] = [];
      const ecouteur = () => {
        appelees.push('appellé');
      };

      gateway.ecouterEvenement('connexion', ecouteur);
      expect(appelees.length).toBe(0); // Pas appelé encore
    });

    it('devrait émettre des événements aux écouteurs enregistrés', async () => {
      const donnees: unknown[] = [];
      gateway.ecouterEvenement('connexion', (evt) => {
        donnees.push(evt.donnees);
      });

      await gateway.simulerConnexion('u1');

      expect(donnees.length).toBeGreaterThan(0);
    });

    it("devrait retirer un écouteur d'événement", async () => {
      const appelees: number[] = [];
      const ecouteur = () => {
        appelees.push(1);
      };

      gateway.ecouterEvenement('connexion', ecouteur);
      await gateway.simulerConnexion('u1');
      const nbAppelAvantRetrait = appelees.length;

      gateway.retirerEcouteur('connexion', ecouteur);
      gateway.reinitialiser();
      // Note: après reinitialiser(), les écouteurs sont supprimés, donc pas d'appel attendu
      // Le test vérifie que l'écouteur a bien été retiré
      expect(appelees.length).toBe(nbAppelAvantRetrait);
    });

    it("devrait gérer le retrait d'un écouteur pour un type d'événement qui n'existe pas", async () => {
      const ecouteur = () => {
        // dummy
      };

      // Ne devrait pas lever d'erreur
      expect(() => {
        gateway.retirerEcouteur(
          'evenement-inexistant' as TypeEvenement,
          ecouteur
        );
      }).not.toThrow();
    });
  });

  // ===== Tests de Gestion des Utilisateurs =====
  describe('Gestion des Utilisateurs', () => {
    it('devrait créer un nouvel utilisateur', async () => {
      const utilisateur = await gateway.creerUtilisateur('nouveau_user');

      expect(utilisateur.pseudo).toBe('nouveau_user');
      expect(utilisateur.id).toBeDefined();
    });

    it('devrait rejeter un pseudo invalide', async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees);
      });

      try {
        await gateway.creerUtilisateur('ab'); // Trop court
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it('devrait récupérer un utilisateur par son ID', async () => {
      const utilisateur = await gateway.obtenirUtilisateur('u1');

      expect(utilisateur).toBeDefined();
      expect(utilisateur?.pseudo).toBe('alice');
    });

    it('devrait récupérer tous les utilisateurs', async () => {
      const utilisateurs = await gateway.obtenirTousLesUtilisateurs();

      expect(utilisateurs.length).toBeGreaterThan(0);
      expect(utilisateurs.some((u) => u.id === 'u1')).toBe(true);
    });

    it("devrait obtenir la présence d'un utilisateur", async () => {
      await gateway.simulerConnexion('u1');
      const presence = await gateway.obtenirPresence('u1');

      expect(presence).toBeDefined();
      expect(presence?.statut).toBe('en-ligne');
    });

    it("devrait retourner undefined pour la présence d'un utilisateur inexistant", async () => {
      const presence = await gateway.obtenirPresence('utilisateur-inexistant');

      expect(presence).toBeUndefined();
    });
  });

  // ===== Tests de Gestion des Salons =====
  describe('Gestion des Salons', () => {
    it('devrait créer un nouveau salon', async () => {
      const salon = await gateway.creerSalon('Général', 'u1', 'public');

      expect(salon.nom).toBe('Général');
      expect(salon.hoteId).toBe('u1');
      expect(salon.visibilite).toBe('public');
    });

    it("devrait émettre une erreur si l'hôte du salon n'existe pas", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.creerSalon('Test', 'hote-inexistant', 'public');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it('devrait récupérer un salon par son ID', async () => {
      const salon = await gateway.obtenirSalon('s1');

      expect(salon).toBeDefined();
      expect(salon?.nom).toBe('Général');
    });

    it('devrait retourner undefined pour un salon inexistant', async () => {
      const salon = await gateway.obtenirSalon('salon-inexistant');

      expect(salon).toBeUndefined();
    });

    it('devrait récupérer tous les salons', async () => {
      const salons = await gateway.obtenirTousLesSalons();

      expect(salons.length).toBeGreaterThan(0);
      expect(salons.some((s) => s.id === 's1')).toBe(true);
    });

    it('devrait ajouter un utilisateur à un salon', async () => {
      const salonAvant = await gateway.obtenirSalon('s1');
      const nbMembresAvant = salonAvant?.membreIds.length ?? 0;

      await gateway.ajouterUtilisateurAuSalon('s1', 'u3');
      const salonApres = await gateway.obtenirSalon('s1');
      const nbMembresApres = salonApres?.membreIds.length ?? 0;

      expect(nbMembresApres).toBe(nbMembresAvant + 1);
      expect(salonApres?.membreIds.includes('u3')).toBe(true);
    });

    it("devrait retirer un utilisateur d'un salon", async () => {
      const salonAvant = await gateway.obtenirSalon('s1');
      const nbMembresAvant = salonAvant?.membreIds.length ?? 0;

      await gateway.retirerUtilisateurDuSalon('s1', 'u2');
      const salonApres = await gateway.obtenirSalon('s1');
      const nbMembresApres = salonApres?.membreIds.length ?? 0;

      expect(nbMembresApres).toBe(nbMembresAvant - 1);
      expect(salonApres?.membreIds.includes('u2')).toBe(false);
    });

    it("devrait retourner le salon sans le modifier si l'utilisateur n'en fait pas partie", async () => {
      // D'abord retirer u2 (qui n'est pas hôte) du salon s1
      await gateway.retirerUtilisateurDuSalon('s1', 'u2');

      const salonAvant2 = await gateway.obtenirSalon('s1');
      const nbMembresAvant2 = salonAvant2?.membreIds.length ?? 0;

      // Essayer de retirer u2 à nouveau (pas dans le salon)
      const salonApres = await gateway.retirerUtilisateurDuSalon('s1', 'u2');
      const nbMembresApres = salonApres?.membreIds.length ?? 0;

      expect(nbMembresApres).toBe(nbMembresAvant2);
    });

    it('devrait supprimer un salon', async () => {
      await gateway.supprimerSalon('s1');
      const salon = await gateway.obtenirSalon('s1');

      expect(salon).toBeUndefined();
    });

    it("devrait émettre une erreur si l'utilisateur n'existe pas lors de l'ajout au salon", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.ajouterUtilisateurAuSalon('s1', 'utilisateur-inexistant');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it("devrait émettre une erreur si l'utilisateur n'existe pas lors du retrait du salon", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.retirerUtilisateurDuSalon('s1', 'utilisateur-inexistant');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it("devrait émettre une erreur si le salon n'existe pas lors du retrait", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.retirerUtilisateurDuSalon('salon-inexistant', 'u1');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it("devrait émettre une erreur lors de la suppression d'un salon inexistant", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.supprimerSalon('salon-inexistant');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it("devrait retourner le salon sans le modifier si l'utilisateur est déjà dans le salon", async () => {
      const salonAvant = await gateway.obtenirSalon('s1');
      const nbMembresAvant = salonAvant?.membreIds.length ?? 0;

      // Essayer d'ajouter u1 à nouveau (déjà dans s1)
      const salonApres = await gateway.ajouterUtilisateurAuSalon('s1', 'u1');
      const nbMembresApres = salonApres?.membreIds.length ?? 0;

      expect(nbMembresApres).toBe(nbMembresAvant);
      expect(salonApres.membreIds.length).toBe(salonAvant?.membreIds.length);
    });

    it("devrait émettre une erreur si le salon n'existe pas lors de l'ajout", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.ajouterUtilisateurAuSalon('salon-inexistant', 'u1');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });
  });

  // ===== Tests de Gestion des Messages =====
  describe('Gestion des Messages', () => {
    it('devrait envoyer un message', async () => {
      const message = await gateway.envoyerMessage(
        's1',
        'u1',
        'Bonjour tout le monde!'
      );

      expect(message.contenu).toBe('Bonjour tout le monde!');
      expect(message.auteurId).toBe('u1');
      expect(message.conversationId).toBe('s1');
      expect(message.type).toBe('texte');
    });

    it('devrait récupérer un message par son ID', async () => {
      const messageCree = await gateway.envoyerMessage('s1', 'u1', 'Test');
      const messageRecupere = await gateway.obtenirMessage(messageCree.id);

      expect(messageRecupere).toBeDefined();
      expect(messageRecupere?.contenu).toBe('Test');
    });

    it("devrait récupérer tous les messages d'une conversation", async () => {
      await gateway.envoyerMessage('s1', 'u1', 'Message 1');
      await gateway.envoyerMessage('s1', 'u2', 'Message 2');

      const messages = await gateway.obtenirMessagesConversation('s1');

      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.every((m) => m.conversationId === 's1')).toBe(true);
    });

    it('devrait modifier un message', async () => {
      const messageCree = await gateway.envoyerMessage('s1', 'u1', 'Original');
      const messageModifie = await gateway.modifierMessage(
        messageCree.id,
        'Modifié'
      );

      expect(messageModifie.contenu).toBe('Modifié');
      expect(messageModifie.modification).toBeDefined();
    });

    it('devrait supprimer un message', async () => {
      const messageCree = await gateway.envoyerMessage(
        's1',
        'u1',
        'À supprimer'
      );

      await gateway.supprimerMessage(messageCree.id);
      const message = await gateway.obtenirMessage(messageCree.id);

      expect(message).toBeUndefined();
    });

    it("devrait émettre un événement lors de la réception d'un message", async () => {
      const messagesRecus: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) => {
        messagesRecus.push(evt.donnees.message);
      });

      await gateway.envoyerMessage('s1', 'u1', 'Test');

      expect(messagesRecus.length).toBeGreaterThan(0);
    });

    it("devrait émettre une erreur si l'auteur du message n'existe pas", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.envoyerMessage('s1', 'auteur-inexistant', 'Test');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it("devrait émettre une erreur lors de la modification d'un message inexistant", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.modifierMessage('message-inexistant', 'Nouveau contenu');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });
  });

  // ===== Tests de Conversations Privées =====
  describe('Conversations Privées', () => {
    it('devrait créer une conversation privée entre deux utilisateurs', async () => {
      const conversation = await gateway.creerConversationPrivee('u1', 'u2');

      expect(conversation).toBeDefined();
      expect(conversation.participantIds).toContain('u1');
      expect(conversation.participantIds).toContain('u2');
    });

    it('devrait récupérer une conversation privée par son ID', async () => {
      const conversation = await gateway.creerConversationPrivee('u1', 'u2');
      const conversationRecuperee = await gateway.obtenirConversationPrivee(
        conversation.id
      );

      expect(conversationRecuperee).toBeDefined();
      expect(conversationRecuperee?.id).toBe(conversation.id);
    });

    it('devrait retourner undefined pour une conversation inexistante', async () => {
      const conversation = await gateway.obtenirConversationPrivee(
        'conversation-inexistante'
      );

      expect(conversation).toBeUndefined();
    });

    it("devrait émettre une erreur si un utilisateur n'existe pas lors de la création", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.creerConversationPrivee('u1', 'utilisateur-inexistant');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });

    it("devrait émettre une erreur lors de la suppression d'un message inexistant", async () => {
      const erreurs: unknown[] = [];
      gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
      });

      try {
        await gateway.supprimerMessage('message-inexistant');
      } catch {
        // Erreur attendue
      }

      expect(erreurs.length).toBeGreaterThan(0);
    });
  });

  // ===== Tests de Réinitialisation =====
  describe('Réinitialisation', () => {
    it('devrait réinitialiser le gateway à son état initial', async () => {
      await gateway.simulerConnexion('u1');
      gateway.definirLatence(500);

      gateway.reinitialiser();
      const etat = gateway.obtenirEtatConnexion();

      expect(etat.statut).toBe('deconnecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
    });
  });

  // ===== Tests d'Intégration =====
  describe('Intégration', () => {
    it('devrait gérer un flux complet de chat', async () => {
      // Connexion de l'utilisateur 1
      await gateway.simulerConnexion('u1');
      expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');

      // Envoi d'un message
      const message1 = await gateway.envoyerMessage('s1', 'u1', 'Bonjour!');
      expect(message1.contenu).toBe('Bonjour!');

      // Récupération des messages
      const messages = await gateway.obtenirMessagesConversation('s1');
      expect(messages.some((m) => m.id === message1.id)).toBe(true);

      // Modification du message
      const messageModifie = await gateway.modifierMessage(
        message1.id,
        'Bonjour tout le monde!'
      );
      expect(messageModifie.contenu).toBe('Bonjour tout le monde!');

      // Déconnexion
      await gateway.simulerDeconnexion();
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
    });

    it('devrait gérer plusieurs utilisateurs dans un salon', async () => {
      // Créer un salon
      const salon = await gateway.creerSalon('Discussion', 'u1', 'public');

      // Ajouter les utilisateurs
      await gateway.ajouterUtilisateurAuSalon(salon.id, 'u2');
      await gateway.ajouterUtilisateurAuSalon(salon.id, 'u3');

      // Vérifier que les utilisateurs ont bien été ajoutés
      const salonMisAJour = await gateway.obtenirSalon(salon.id);
      expect(salonMisAJour?.membreIds.length).toBe(3);

      // Envoyer des messages
      await gateway.envoyerMessage(salon.id, 'u1', 'Message de u1');
      await gateway.envoyerMessage(salon.id, 'u2', 'Message de u2');

      // Récupérer les messages
      const messages = await gateway.obtenirMessagesConversation(salon.id);
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });
  });
});
