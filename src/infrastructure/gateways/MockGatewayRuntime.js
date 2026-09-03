'use strict';

/**
 * Mock d'exécution utilisé par Electron jusqu'à l'arrivée du backend réel.
 * L'UI n'accède jamais à cet objet directement : main.js l'expose par des
 * canaux IPC précis via preload.js.
 */
class MockGatewayRuntime {
  constructor() {
    this.utilisateurs = [
      { id: 'u1', pseudo: 'alice' },
      { id: 'u2', pseudo: 'bob' },
      { id: 'u3', pseudo: 'charlie' },
    ];
    this.salons = [
      {
        id: 's1',
        nom: 'général',
        visibilite: 'public',
        hoteId: 'u1',
        // Salon public : tous les utilisateurs en sont membres d'office.
        membreIds: ['u1', 'u2', 'u3'],
        membresInvites: [],
        messages: [
          {
            auteurId: 'u1',
            contenu: 'Bienvenue dans ChatVardage !',
            date: Date.now(),
          },
        ],
      },
      {
        id: 's2',
        nom: 'équipe privée',
        visibilite: 'prive',
        hoteId: 'u1',
        membreIds: ['u1', 'u3'],
        membresInvites: [],
        messages: [],
      },
    ];
  }

  verifierUtilisateur(utilisateurId) {
    if (!this.utilisateurs.some((item) => item.id === utilisateurId)) {
      throw new Error('Utilisateur invalide');
    }
  }

  trouverSalon(salonId) {
    const salon = this.salons.find((item) => item.id === salonId);
    if (!salon) throw new Error('Salon introuvable');
    return salon;
  }

  obtenirEtat(utilisateurId) {
    this.verifierUtilisateur(utilisateurId);
    return {
      utilisateurs: this.utilisateurs.map((item) => ({ ...item })),
      salons: this.salons
        .filter(
          (salon) =>
            salon.visibilite === 'public' ||
            salon.membreIds.includes(utilisateurId)
        )
        .map((salon) => structuredClone(salon)),
      invitations: this.salons
        .filter((salon) => salon.membresInvites.includes(utilisateurId))
        .map((salon) => ({
          id: salon.id,
          nom: salon.nom,
          hoteId: salon.hoteId,
        })),
    };
  }

  creerSalon({ nom, prive, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const nomNettoye = typeof nom === 'string' ? nom.trim().slice(0, 40) : '';
    if (!nomNettoye) throw new Error('Le nom du salon est obligatoire');
    const visibilite = prive ? 'prive' : 'public';
    const salon = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nom: nomNettoye,
      visibilite,
      hoteId: utilisateurId,
      // Un salon public n'a pas d'invitations : tous les utilisateurs en
      // sont membres dès sa création.
      membreIds:
        visibilite === 'public'
          ? this.utilisateurs.map((item) => item.id)
          : [utilisateurId],
      membresInvites: [],
      messages: [],
    };
    this.salons.push(salon);
    return structuredClone(salon);
  }

  inviter({ salonId, utilisateurId, hoteId }) {
    this.verifierUtilisateur(utilisateurId);
    this.verifierUtilisateur(hoteId);
    const salon = this.trouverSalon(salonId);
    if (salon.visibilite === 'public') {
      throw new Error(
        'Les invitations sont désactivées pour les salons publics : tous les utilisateurs y sont déjà membres'
      );
    }
    if (salon.hoteId !== hoteId) throw new Error("Seul l'hôte peut inviter");
    if (salon.membreIds.includes(utilisateurId)) return structuredClone(salon);
    if (!salon.membresInvites.includes(utilisateurId)) {
      salon.membresInvites.push(utilisateurId);
    }
    return structuredClone(salon);
  }

  accepterInvitation({ salonId, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membresInvites.includes(utilisateurId)) {
      throw new Error('Invitation introuvable');
    }
    salon.membresInvites = salon.membresInvites.filter(
      (id) => id !== utilisateurId
    );
    if (!salon.membreIds.includes(utilisateurId)) {
      salon.membreIds.push(utilisateurId);
    }
    return structuredClone(salon);
  }

  refuserInvitation({ salonId, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membresInvites.includes(utilisateurId)) {
      throw new Error('Invitation introuvable');
    }
    salon.membresInvites = salon.membresInvites.filter(
      (id) => id !== utilisateurId
    );
  }

  envoyerMessage({ salonId, utilisateurId, contenu }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membreIds.includes(utilisateurId)) {
      throw new Error('Accès refusé à ce salon');
    }
    const texte =
      typeof contenu === 'string' ? contenu.trim().slice(0, 2000) : '';
    if (!texte) throw new Error('Le message est vide');
    const message = {
      auteurId: utilisateurId,
      contenu: texte,
      date: Date.now(),
    };
    salon.messages.push(message);
    return structuredClone(message);
  }
}

module.exports = { MockGatewayRuntime };
