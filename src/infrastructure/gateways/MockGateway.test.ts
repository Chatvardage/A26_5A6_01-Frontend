import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  creerMockGateway,
  MockGateway,
  type TypeEvenement,
} from './MockGateway';

describe('MockGateway', () => {
  let gateway: MockGateway;

  beforeEach(() => {
    gateway = creerMockGateway(10); // Latence réduite pour accélérer les tests
  });

  afterEach(() => {
    gateway.reinitialiser();
  });

  // ===== Initialisation =====
  describe('Initialisation', () => {
    it('devrait initialiser les utilisateurs et salons de test par défaut', async () => {
      const utilisateurs = await gateway.obtenirTousLesUtilisateurs();
      const salons = await gateway.obtenirTousLesSalons();

      expect(utilisateurs.map((u) => u.id).sort()).toEqual(['u1', 'u2', 'u3']);
      expect(salons.map((s) => s.id).sort()).toEqual(['s1', 's2']);

      const s1 = salons.find((s) => s.id === 's1');
      const s2 = salons.find((s) => s.id === 's2');
      expect(s1?.visibilite).toBe('public');
      expect(s2?.visibilite).toBe('prive');
    });

    it('devrait démarrer déconnecté et sans utilisateur courant', () => {
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
    });
  });

  // ===== Connexion =====
  describe('simulerConnexion', () => {
    it('devrait connecter un utilisateur existant, mettre à jour la présence et émettre les événements attendus', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('connexion', () => evenements.push('connexion'));
      gateway.ecouterEvenement('presence-mise-a-jour', () =>
        evenements.push('presence-mise-a-jour')
      );
      gateway.ecouterEvenement('message-recu', () =>
        evenements.push('message-recu')
      );

      await gateway.simulerConnexion('u1');

      expect(gateway.obtenirUtilisateurConnecte()).toBe('u1');
      expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
      expect(await gateway.obtenirPresence('u1')).toMatchObject({
        statut: 'en-ligne',
      });
      expect(evenements).toContain('connexion');
      expect(evenements).toContain('presence-mise-a-jour');
      // u1 est membre de s1 ET s2 : deux messages système "a rejoint le salon"
      expect(evenements.filter((e) => e === 'message-recu').length).toBe(2);
    });

    it('devrait rejeter et émettre une erreur pour un utilisateur inexistant', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(gateway.simulerConnexion('fantome')).rejects.toThrow(
        'Utilisateur fantome non trouvé'
      );
      expect(erreurs).toContain('Utilisateur fantome non trouvé');
    });

    it('devrait émettre un message système uniquement pour les salons où le membre appartient (membreIds)', async () => {
      const messages: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) =>
        messages.push(evt.donnees.message)
      );

      // u3 n'est membre que de s2 (privé) ; pas de s1 ni invité nulle part
      await gateway.simulerConnexion('u3');

      expect(messages.length).toBe(1);
    });

    it('devrait aussi émettre un message système pour un salon où l’utilisateur est seulement invité (membresInvites)', async () => {
      // u2 est déjà membre de s1 (membreIds) ; on l'invite aussi à s2 (privé)
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      const messages: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) =>
        messages.push(evt.donnees.message)
      );

      await gateway.simulerConnexion('u2');

      // s1 (membre) + s2 (invité, pas encore membre) = 2 messages système
      expect(messages.length).toBe(2);
    });
  });

  // ===== Déconnexion =====
  describe('simulerDeconnexion', () => {
    it("devrait rejeter et émettre une erreur si personne n'est connecté", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(gateway.simulerDeconnexion()).rejects.toThrow(
        'Aucun utilisateur connecté'
      );

      expect(erreurs).toContain('Aucun utilisateur connecté');
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
    });

    it('devrait déconnecter un utilisateur connecté, mettre sa présence hors-ligne et émettre les messages système', async () => {
      await gateway.simulerConnexion('u1');

      const evenements: TypeEvenement[] = [];
      const messages: unknown[] = [];
      gateway.ecouterEvenement('deconnexion', () =>
        evenements.push('deconnexion')
      );
      gateway.ecouterEvenement('presence-mise-a-jour', () =>
        evenements.push('presence-mise-a-jour')
      );
      gateway.ecouterEvenement('message-recu', (evt) =>
        messages.push(evt.donnees.message)
      );

      await gateway.simulerDeconnexion();

      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
      expect(await gateway.obtenirPresence('u1')).toMatchObject({
        statut: 'hors-ligne',
      });
      expect(evenements).toContain('deconnexion');
      expect(evenements).toContain('presence-mise-a-jour');
      // u1 membre de s1 et s2 : deux messages "a quitté le salon"
      expect(messages.length).toBe(2);
    });

    it('devrait émettre un message système pour un salon où l’utilisateur déconnecté est seulement invité', async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');
      await gateway.simulerConnexion('u2');

      const messages: unknown[] = [];
      gateway.ecouterEvenement('message-recu', (evt) =>
        messages.push(evt.donnees.message)
      );

      await gateway.simulerDeconnexion();

      // s1 (membre) + s2 (invité) = 2 messages système "a quitté le salon"
      expect(messages.length).toBe(2);
    });

    it(
      "devrait gérer proprement une déconnexion dont l'utilisateur courant " +
        "n'existe plus dans l'annuaire (branche défensive utilisateur introuvable)",
      async () => {
        // Ce cas est impossible à atteindre via l'API publique (utilisateurActuelId
        // n'est jamais défini sans passer par une validation dans simulerConnexion) ;
        // on force l'état interne pour couvrir la branche défensive du code.
        (
          gateway as unknown as { utilisateurActuelId: string | null }
        ).utilisateurActuelId = 'fantome';

        const evenements: TypeEvenement[] = [];
        gateway.ecouterEvenement('deconnexion', () =>
          evenements.push('deconnexion')
        );
        gateway.ecouterEvenement('presence-mise-a-jour', () =>
          evenements.push('presence-mise-a-jour')
        );

        await gateway.simulerDeconnexion();

        expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
        expect(evenements).toContain('deconnexion');
        // Aucune présence à mettre à jour pour un utilisateur qui n'existe pas
        expect(evenements).not.toContain('presence-mise-a-jour');
      }
    );
  });

  // ===== Reconnexion =====
  describe('simulerReconnexion', () => {
    it('devrait incrémenter le compteur de reconnexions, émettre l’événement et reconnecter l’utilisateur', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('reconnexion', () =>
        evenements.push('reconnexion')
      );

      await gateway.simulerReconnexion('u1');

      expect(gateway.obtenirEtatConnexion().reconnexions).toBe(1);
      expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBe('u1');
      expect(evenements).toContain('reconnexion');

      await gateway.simulerReconnexion('u1');
      expect(gateway.obtenirEtatConnexion().reconnexions).toBe(2);
    });

    it("devrait rejeter et revenir à l'état déconnecté si l'utilisateur à reconnecter n'existe pas", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(gateway.simulerReconnexion('fantome')).rejects.toThrow(
        'Utilisateur fantome non trouvé'
      );

      // L'état ne doit pas rester coincé sur 'reconnexion' : l'utilisateur
      // n'a jamais été connecté, donc l'état doit refléter 'deconnecte'.
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
      expect(erreurs).toContain('Utilisateur fantome non trouvé');
      // Le compteur de tentatives est tout de même incrémenté.
      expect(gateway.obtenirEtatConnexion().reconnexions).toBe(1);
    });
  });

  // ===== Latence =====
  describe('definirLatence', () => {
    it('devrait permettre de changer la latence simulée', async () => {
      gateway.definirLatence(5);
      await expect(gateway.simulerConnexion('u1')).resolves.toBeUndefined();
    });
  });

  // ===== Écouteurs d'événements =====
  describe('ecouterEvenement / retirerEcouteur', () => {
    it('devrait enregistrer un premier écouteur puis en ajouter un second pour le même type', async () => {
      const appels: string[] = [];
      gateway.ecouterEvenement('connexion', () => appels.push('premier'));
      gateway.ecouterEvenement('connexion', () => appels.push('second'));

      await gateway.simulerConnexion('u1');

      expect(appels).toEqual(['premier', 'second']);
    });

    it('devrait retirer un écouteur existant', async () => {
      const appels: string[] = [];
      const ecouteur = () => appels.push('appelé');
      gateway.ecouterEvenement('connexion', ecouteur);
      gateway.retirerEcouteur('connexion', ecouteur);

      await gateway.simulerConnexion('u1');

      expect(appels).toEqual([]);
    });

    it("ne devrait rien faire si on retire un écouteur d'un type jamais enregistré", () => {
      expect(() =>
        gateway.retirerEcouteur('salon-supprime', () => undefined)
      ).not.toThrow();
    });

    it("ne devrait rien faire si l'écouteur retiré n'a jamais été ajouté pour ce type", async () => {
      const appels: string[] = [];
      const ecouteurEnregistre = () => appels.push('enregistré');
      const ecouteurJamaisAjoute = () => appels.push('jamais-ajouté');

      gateway.ecouterEvenement('connexion', ecouteurEnregistre);
      gateway.retirerEcouteur('connexion', ecouteurJamaisAjoute);

      await gateway.simulerConnexion('u1');

      expect(appels).toEqual(['enregistré']);
    });
  });

  // ===== Utilisateurs =====
  describe('creerUtilisateur', () => {
    it('devrait créer un utilisateur avec un pseudo valide et émettre un événement', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('utilisateur-connecte', () =>
        evenements.push('utilisateur-connecte')
      );

      const utilisateur = await gateway.creerUtilisateur('denis');

      expect(utilisateur.pseudo).toBe('denis');
      expect(await gateway.obtenirUtilisateur(utilisateur.id)).toEqual(
        utilisateur
      );
      expect(evenements).toContain('utilisateur-connecte');
    });

    it('devrait rejeter et émettre une erreur pour un pseudo invalide', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(gateway.creerUtilisateur('ab')).rejects.toThrow(
        'Pseudo invalide : ab'
      );
      expect(erreurs).toContain('Pseudo invalide : ab');
    });
  });

  describe('obtenirUtilisateur / obtenirTousLesUtilisateurs / obtenirPresence', () => {
    it('devrait retourner undefined pour un utilisateur inconnu', async () => {
      await expect(
        gateway.obtenirUtilisateur('inconnu')
      ).resolves.toBeUndefined();
    });

    it('devrait retourner tous les utilisateurs existants', async () => {
      const utilisateurs = await gateway.obtenirTousLesUtilisateurs();
      expect(utilisateurs.length).toBe(3);
    });

    it("devrait retourner undefined pour la présence d'un utilisateur jamais connecté", async () => {
      await expect(gateway.obtenirPresence('u1')).resolves.toBeUndefined();
    });
  });

  // ===== Salons =====
  describe('creerSalon', () => {
    it('devrait créer un salon public par défaut', async () => {
      const salon = await gateway.creerSalon('Général bis', 'u1');
      expect(salon.visibilite).toBe('public');
      expect(salon.hoteId).toBe('u1');
    });

    it('devrait créer un salon privé quand demandé', async () => {
      const salon = await gateway.creerSalon('Secret', 'u1', 'prive');
      expect(salon.visibilite).toBe('prive');
    });

    it('devrait émettre "salon-cree" à la création', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('salon-cree', () =>
        evenements.push('salon-cree')
      );

      await gateway.creerSalon('Discussion', 'u1');

      expect(evenements).toContain('salon-cree');
    });

    it("devrait rejeter et émettre une erreur si l'hôte n'existe pas", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.creerSalon('Test', 'hote-inexistant')
      ).rejects.toThrow('Hôte hote-inexistant non trouvé');
      expect(erreurs).toContain('Hôte hote-inexistant non trouvé');
    });
  });

  describe('obtenirSalon / obtenirTousLesSalons', () => {
    it('devrait retourner un salon existant et undefined pour un salon inconnu', async () => {
      await expect(gateway.obtenirSalon('s1')).resolves.toMatchObject({
        id: 's1',
      });
      await expect(gateway.obtenirSalon('inconnu')).resolves.toBeUndefined();
    });

    it('devrait retourner tous les salons', async () => {
      const salons = await gateway.obtenirTousLesSalons();
      expect(salons.length).toBe(2);
    });
  });

  // ===== Invitations =====
  describe('inviterUtilisateurAuSalon', () => {
    it("devrait refuser d'inviter dans un salon inexistant", async () => {
      await expect(
        gateway.inviterUtilisateurAuSalon('salon-inexistant', 'u2', 'u1')
      ).rejects.toThrow('Salon salon-inexistant non trouvé');
    });

    it('devrait refuser toute invitation dans un salon public', async () => {
      await expect(
        gateway.inviterUtilisateurAuSalon('s1', 'u3', 'u1')
      ).rejects.toThrow(
        'Les invitations sont désactivées pour le salon public s1'
      );
    });

    it("devrait refuser si l'appelant n'est pas l'hôte du salon privé", async () => {
      await expect(
        gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u3')
      ).rejects.toThrow("Seul l'hôte peut inviter dans le salon s2");
    });

    it("devrait refuser d'inviter un utilisateur inexistant", async () => {
      await expect(
        gateway.inviterUtilisateurAuSalon('s2', 'inexistant', 'u1')
      ).rejects.toThrow('Utilisateur inexistant non trouvé');
    });

    it('devrait retourner le salon inchangé si la cible est déjà membre', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('invitation-salon-envoyee', () =>
        evenements.push('invitation-salon-envoyee')
      );

      // u1 est déjà membre de s2 (hôte)
      const salon = await gateway.inviterUtilisateurAuSalon('s2', 'u1', 'u1');

      expect(salon.membresInvites).toEqual([]);
      expect(evenements).toEqual([]);
    });

    it('devrait inviter un nouvel utilisateur et émettre "invitation-salon-envoyee"', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('invitation-salon-envoyee', () =>
        evenements.push('invitation-salon-envoyee')
      );

      const salon = await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      expect(salon.membresInvites).toContain('u2');
      expect(evenements).toEqual(['invitation-salon-envoyee']);
    });

    it('devrait rester idempotent (sans doublon) si la même invitation est répétée', async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('invitation-salon-envoyee', () =>
        evenements.push('invitation-salon-envoyee')
      );

      const salon = await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      expect(salon.membresInvites).toEqual(['u2']);
      // L'événement est ré-émis même si l'invitation existait déjà
      expect(evenements).toEqual(['invitation-salon-envoyee']);
    });
  });

  describe('obtenirInvitationsUtilisateur', () => {
    it("devrait retourner les salons pour lesquels l'utilisateur a une invitation en attente", async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      const invitations = await gateway.obtenirInvitationsUtilisateur('u2');

      expect(invitations.map((s) => s.id)).toEqual(['s2']);
    });

    it("devrait retourner un tableau vide si aucune invitation n'est en attente", async () => {
      const invitations = await gateway.obtenirInvitationsUtilisateur('u3');
      expect(invitations).toEqual([]);
    });
  });

  describe('accepterInvitationSalon', () => {
    it("devrait refuser d'accepter dans un salon inexistant", async () => {
      await expect(
        gateway.accepterInvitationSalon('salon-inexistant', 'u2')
      ).rejects.toThrow('Salon salon-inexistant non trouvé');
    });

    it("devrait refuser d'accepter une invitation inexistante", async () => {
      await expect(gateway.accepterInvitationSalon('s2', 'u2')).rejects.toThrow(
        'Aucune invitation au salon s2'
      );
    });

    it('devrait accepter une invitation valide, ajouter le membre et émettre les événements', async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('invitation-salon-acceptee', () =>
        evenements.push('invitation-salon-acceptee')
      );
      gateway.ecouterEvenement('utilisateur-rejoint-salon', () =>
        evenements.push('utilisateur-rejoint-salon')
      );

      const salon = await gateway.accepterInvitationSalon('s2', 'u2');

      expect(salon.membreIds).toContain('u2');
      expect(salon.membresInvites).not.toContain('u2');
      expect(evenements).toEqual([
        'utilisateur-rejoint-salon',
        'invitation-salon-acceptee',
      ]);
    });
  });

  describe('refuserInvitationSalon', () => {
    it('devrait refuser dans un salon inexistant', async () => {
      await expect(
        gateway.refuserInvitationSalon('salon-inexistant', 'u2')
      ).rejects.toThrow('Salon salon-inexistant non trouvé');
    });

    it("devrait refuser s'il n'y a aucune invitation en attente", async () => {
      await expect(gateway.refuserInvitationSalon('s2', 'u2')).rejects.toThrow(
        'Aucune invitation au salon s2'
      );
    });

    it('devrait refuser une invitation valide sans donner accès au salon', async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('invitation-salon-refusee', () =>
        evenements.push('invitation-salon-refusee')
      );

      const salon = await gateway.refuserInvitationSalon('s2', 'u2');

      expect(salon.membreIds).not.toContain('u2');
      expect(salon.membresInvites).not.toContain('u2');
      expect(evenements).toContain('invitation-salon-refusee');
    });
  });

  // ===== Membres =====
  describe('ajouterUtilisateurAuSalon', () => {
    it("devrait refuser d'ajouter à un salon inexistant", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.ajouterUtilisateurAuSalon('salon-inexistant', 'u2')
      ).rejects.toThrow('Salon salon-inexistant non trouvé');
      expect(erreurs).toContain('Salon salon-inexistant non trouvé');
    });

    it("devrait refuser d'ajouter un utilisateur inexistant", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.ajouterUtilisateurAuSalon('s1', 'utilisateur-inexistant')
      ).rejects.toThrow('Utilisateur utilisateur-inexistant non trouvé');
      expect(erreurs).toContain(
        'Utilisateur utilisateur-inexistant non trouvé'
      );
    });

    it('devrait retourner le salon inchangé sans événement si déjà membre', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('utilisateur-rejoint-salon', () =>
        evenements.push('utilisateur-rejoint-salon')
      );

      const salon = await gateway.ajouterUtilisateurAuSalon('s1', 'u1');

      expect(salon.membreIds).toContain('u1');
      expect(evenements).toEqual([]);
    });

    it('devrait refuser et émettre une erreur pour un salon privé sans invitation', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.ajouterUtilisateurAuSalon('s2', 'u2')
      ).rejects.toThrow('Accès refusé au salon privé s2');
      expect(erreurs).toContain('Accès refusé au salon privé s2');
    });

    it('devrait ajouter directement un utilisateur à un salon public sans invitation', async () => {
      const evenements: TypeEvenement[] = [];
      const messages: unknown[] = [];
      gateway.ecouterEvenement('utilisateur-rejoint-salon', () =>
        evenements.push('utilisateur-rejoint-salon')
      );
      gateway.ecouterEvenement('message-recu', (evt) =>
        messages.push(evt.donnees.message)
      );

      // u3 n'est ni membre ni invité de s1 (public)
      const salon = await gateway.ajouterUtilisateurAuSalon('s1', 'u3');

      expect(salon.membreIds).toContain('u3');
      expect(salon.membresInvites).toEqual([]);
      expect(evenements).toContain('utilisateur-rejoint-salon');
      expect(messages.length).toBe(1);
    });

    it('devrait ajouter un utilisateur invité à un salon privé et retirer son invitation', async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');

      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('utilisateur-rejoint-salon', () =>
        evenements.push('utilisateur-rejoint-salon')
      );

      const salon = await gateway.ajouterUtilisateurAuSalon('s2', 'u2');

      expect(salon.membreIds).toContain('u2');
      expect(salon.membresInvites).not.toContain('u2');
      expect(evenements).toContain('utilisateur-rejoint-salon');
    });
  });

  describe('retirerUtilisateurDuSalon', () => {
    it("devrait refuser de retirer d'un salon inexistant", async () => {
      await expect(
        gateway.retirerUtilisateurDuSalon('salon-inexistant', 'u2')
      ).rejects.toThrow('Salon salon-inexistant non trouvé');
    });

    it('devrait refuser de retirer un utilisateur inexistant', async () => {
      await expect(
        gateway.retirerUtilisateurDuSalon('s1', 'utilisateur-inexistant')
      ).rejects.toThrow('Utilisateur utilisateur-inexistant non trouvé');
    });

    it("devrait retourner le salon inchangé si l'utilisateur n'en est pas membre", async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('utilisateur-quitte-salon', () =>
        evenements.push('utilisateur-quitte-salon')
      );

      // u2 n'est pas membre de s2
      const salon = await gateway.retirerUtilisateurDuSalon('s2', 'u2');

      expect(salon.membreIds).not.toContain('u2');
      expect(evenements).toEqual([]);
    });

    it("devrait refuser que l'hôte quitte son propre salon", async () => {
      await expect(
        gateway.retirerUtilisateurDuSalon('s1', 'u1')
      ).rejects.toThrow("L'hôte u1 ne peut pas quitter le salon s1");
    });

    it('devrait retirer un membre normal du salon et émettre les événements', async () => {
      const evenements: TypeEvenement[] = [];
      const messages: unknown[] = [];
      gateway.ecouterEvenement('utilisateur-quitte-salon', () =>
        evenements.push('utilisateur-quitte-salon')
      );
      gateway.ecouterEvenement('message-recu', (evt) =>
        messages.push(evt.donnees.message)
      );

      const salon = await gateway.retirerUtilisateurDuSalon('s1', 'u2');

      expect(salon.membreIds).not.toContain('u2');
      expect(evenements).toContain('utilisateur-quitte-salon');
      expect(messages.length).toBe(1);
    });
  });

  describe('supprimerSalon', () => {
    it('devrait refuser de supprimer un salon inexistant', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(gateway.supprimerSalon('salon-inexistant')).rejects.toThrow(
        'Salon salon-inexistant non trouvé'
      );
      expect(erreurs).toContain('Salon salon-inexistant non trouvé');
    });

    it('devrait supprimer un salon existant et émettre "salon-supprime"', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('salon-supprime', () =>
        evenements.push('salon-supprime')
      );

      await gateway.supprimerSalon('s1');

      expect(await gateway.obtenirSalon('s1')).toBeUndefined();
      expect(evenements).toContain('salon-supprime');
    });
  });

  // ===== Messages =====
  describe('envoyerMessage', () => {
    it("devrait refuser et émettre une erreur si l'auteur n'existe pas", async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.envoyerMessage('s1', 'auteur-inexistant', 'Salut')
      ).rejects.toThrow('Auteur auteur-inexistant non trouvé');
      expect(erreurs).toContain('Auteur auteur-inexistant non trouvé');
    });

    it('devrait envoyer un message dans un salon dont on est membre', async () => {
      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('message-recu', () =>
        evenements.push('message-recu')
      );

      const message = await gateway.envoyerMessage('s1', 'u1', 'Bonjour');

      expect(message.contenu).toBe('Bonjour');
      expect(message.conversationId).toBe('s1');
      expect(evenements).toContain('message-recu');
    });

    it("devrait refuser d'envoyer un message dans un salon dont on n'est pas membre", async () => {
      // u2 n'est pas membre du salon privé s2
      await expect(
        gateway.envoyerMessage('s2', 'u2', 'Message interdit')
      ).rejects.toThrow('Accès refusé au salon s2');
    });

    it('devrait envoyer un message dans une conversation privée dont on est participant', async () => {
      const conversation = await gateway.creerConversationPrivee('u1', 'u2');

      const message = await gateway.envoyerMessage(
        conversation.id,
        'u1',
        'Salut en privé'
      );

      expect(message.conversationId).toBe(conversation.id);
      expect(message.contenu).toBe('Salut en privé');
    });

    it("devrait refuser d'envoyer un message dans une conversation privée dont on n'est pas participant", async () => {
      const conversation = await gateway.creerConversationPrivee('u1', 'u2');

      await expect(
        gateway.envoyerMessage(conversation.id, 'u3', 'Intrus')
      ).rejects.toThrow(`Accès refusé à la conversation ${conversation.id}`);
    });

    it("devrait refuser d'envoyer un message vers une conversation totalement inconnue", async () => {
      await expect(
        gateway.envoyerMessage('conversation-fantome', 'u1', 'Hep')
      ).rejects.toThrow('Conversation conversation-fantome introuvable');
    });
  });

  describe('obtenirMessage / obtenirMessagesConversation', () => {
    it('devrait retourner undefined pour un message inconnu', async () => {
      await expect(gateway.obtenirMessage('inconnu')).resolves.toBeUndefined();
    });

    it('devrait récupérer un message par son ID', async () => {
      const messageCree = await gateway.envoyerMessage('s1', 'u1', 'Test');
      const messageRecupere = await gateway.obtenirMessage(messageCree.id);
      expect(messageRecupere).toEqual(messageCree);
    });

    it("devrait récupérer tous les messages d'une conversation, et rien pour une autre", async () => {
      await gateway.envoyerMessage('s1', 'u1', 'Message 1');
      await gateway.envoyerMessage('s1', 'u2', 'Message 2');

      const messages = await gateway.obtenirMessagesConversation('s1');
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.every((m) => m.conversationId === 's1')).toBe(true);

      const aucun = await gateway.obtenirMessagesConversation('s2');
      expect(aucun).toEqual([]);
    });
  });

  describe('modifierMessage', () => {
    it('devrait refuser de modifier un message inconnu', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.modifierMessage('inconnu', 'nouveau contenu')
      ).rejects.toThrow('Message inconnu non trouvé');
      expect(erreurs).toContain('Message inconnu non trouvé');
    });

    it('devrait modifier un message existant et émettre "message-modifie"', async () => {
      const messageCree = await gateway.envoyerMessage('s1', 'u1', 'Original');

      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('message-modifie', () =>
        evenements.push('message-modifie')
      );

      const messageModifie = await gateway.modifierMessage(
        messageCree.id,
        'Corrigé'
      );

      expect(messageModifie.contenu).toBe('Corrigé');
      expect(messageModifie.modification).toEqual(expect.any(Number));
      expect(evenements).toContain('message-modifie');
    });
  });

  describe('supprimerMessage', () => {
    it('devrait refuser de supprimer un message inconnu', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(gateway.supprimerMessage('inconnu')).rejects.toThrow(
        'Message inconnu non trouvé'
      );
      expect(erreurs).toContain('Message inconnu non trouvé');
    });

    it('devrait supprimer un message existant et émettre "message-supprime"', async () => {
      const messageCree = await gateway.envoyerMessage(
        's1',
        'u1',
        'À supprimer'
      );

      const evenements: TypeEvenement[] = [];
      gateway.ecouterEvenement('message-supprime', () =>
        evenements.push('message-supprime')
      );

      await gateway.supprimerMessage(messageCree.id);

      expect(await gateway.obtenirMessage(messageCree.id)).toBeUndefined();
      expect(evenements).toContain('message-supprime');
    });
  });

  // ===== Conversations privées =====
  describe('creerConversationPrivee', () => {
    it('devrait refuser si le premier utilisateur est inconnu (court-circuit gauche)', async () => {
      const erreurs: string[] = [];
      gateway.ecouterEvenement('erreur', (evt) =>
        erreurs.push(evt.donnees.message as string)
      );

      await expect(
        gateway.creerConversationPrivee('inconnu', 'u2')
      ).rejects.toThrow("Un des utilisateurs n'a pas été trouvé");
      expect(erreurs).toContain("Un des utilisateurs n'a pas été trouvé");
    });

    it('devrait refuser si le second utilisateur est inconnu (branche droite du OU)', async () => {
      await expect(
        gateway.creerConversationPrivee('u1', 'inconnu')
      ).rejects.toThrow("Un des utilisateurs n'a pas été trouvé");
    });

    it('devrait créer la conversation privée si les deux utilisateurs existent', async () => {
      const conversation = await gateway.creerConversationPrivee('u1', 'u2');

      expect(conversation.type).toBe('privee');
      expect(conversation.participantIds).toEqual(
        expect.arrayContaining(['u1', 'u2'])
      );
      expect(await gateway.obtenirConversationPrivee(conversation.id)).toEqual(
        conversation
      );
    });
  });

  describe('obtenirConversationPrivee', () => {
    it('devrait retourner undefined pour une conversation privée inconnue', async () => {
      await expect(
        gateway.obtenirConversationPrivee('inconnue')
      ).resolves.toBeUndefined();
    });
  });

  // ===== État global =====
  describe('obtenirEtatConnexion / obtenirUtilisateurConnecte', () => {
    it("devrait refléter l'état courant avant et après connexion", async () => {
      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
      await gateway.simulerConnexion('u1');
      expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBe('u1');
    });
  });

  describe('reinitialiser', () => {
    it('devrait remettre le gateway dans son état initial après mutation', async () => {
      await gateway.simulerConnexion('u1');
      await gateway.creerSalon('Temporaire', 'u1');
      await gateway.envoyerMessage('s1', 'u1', 'Un message');
      await gateway.creerUtilisateur('denis');

      gateway.reinitialiser();

      expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
      expect(await gateway.obtenirTousLesUtilisateurs()).toEqual([]);
      expect(await gateway.obtenirTousLesSalons()).toEqual([]);
      expect(await gateway.obtenirMessagesConversation('s1')).toEqual([]);
    });
  });

  // ===== Scénario d'intégration exhaustif =====
  describe('scénario complet', () => {
    it('devrait exposer les données exactes de tous les événements métier, y compris hors salons/messages', async () => {
      const evenements: TypeEvenement[] = [];
      const types: TypeEvenement[] = [
        'utilisateur-connecte',
        'salon-cree',
        'utilisateur-rejoint-salon',
        'utilisateur-quitte-salon',
        'message-modifie',
        'message-supprime',
        'salon-supprime',
      ];
      types.forEach((type) =>
        gateway.ecouterEvenement(type, (evenement) => {
          expect(evenement.type).toBe(type);
          expect(evenement.timestamp).toEqual(expect.any(Number));
          evenements.push(type);
        })
      );

      const utilisateur = await gateway.creerUtilisateur('denis');
      const salon = await gateway.creerSalon('Exhaustif', 'u1');
      await gateway.ajouterUtilisateurAuSalon(salon.id, utilisateur.id);
      await gateway.retirerUtilisateurDuSalon(salon.id, utilisateur.id);
      const message = await gateway.envoyerMessage('s1', 'u1', 'original');
      await gateway.modifierMessage(message.id, 'modifié');
      await gateway.supprimerMessage(message.id);
      await gateway.supprimerSalon(salon.id);

      expect(evenements).toEqual(types);
    });

    it('devrait gérer plusieurs utilisateurs dans un salon public et leurs messages', async () => {
      const salon = await gateway.creerSalon('Discussion', 'u1');

      await gateway.ajouterUtilisateurAuSalon(salon.id, 'u2');
      await gateway.ajouterUtilisateurAuSalon(salon.id, 'u3');

      const salonMisAJour = await gateway.obtenirSalon(salon.id);
      expect(salonMisAJour?.membreIds.length).toBe(3);

      await gateway.envoyerMessage(salon.id, 'u1', 'Message de u1');
      await gateway.envoyerMessage(salon.id, 'u2', 'Message de u2');

      const messages = await gateway.obtenirMessagesConversation(salon.id);
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it('devrait couvrir un cycle complet invitation → connexion → acceptation → message → départ', async () => {
      await gateway.inviterUtilisateurAuSalon('s2', 'u2', 'u1');
      await gateway.simulerConnexion('u2');
      await gateway.accepterInvitationSalon('s2', 'u2');
      const message = await gateway.envoyerMessage(
        's2',
        'u2',
        'Bonjour l’équipe'
      );
      expect(message.auteurId).toBe('u2');

      await gateway.retirerUtilisateurDuSalon('s2', 'u2');
      const salonFinal = await gateway.obtenirSalon('s2');
      expect(salonFinal?.membreIds).not.toContain('u2');

      await gateway.simulerDeconnexion();
      expect(gateway.obtenirUtilisateurConnecte()).toBeNull();
    });
  });
});
