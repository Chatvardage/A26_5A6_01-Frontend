'use strict';

// runtime/utilisateurs.js — Utilisateurs connus : pseudos, profils publics (alias, photo), suggestions et recherche.
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const {
  DUREE_PRIORITE_HORS_LIGNE_MS,
  MEMBRES_SUGGERES_PAR_SERVEUR,
  NOMBRE_MAX_IDS_LOOKUP,
  NOMBRE_MAX_IDS_PUBLICS,
} = require('./constantes');

module.exports = {
  // --- Utilisateurs connus (voir commentaire de classe) -----------------------

  enregistrerUtilisateurConnu(utilisateur) {
    if (!utilisateur || !utilisateur.id) return;
    const existant = this.utilisateursConnus.get(utilisateur.id) ?? {};
    this.utilisateursConnus.set(utilisateur.id, {
      id: utilisateur.id,
      pseudo: utilisateur.pseudo ?? existant.pseudo ?? utilisateur.id,
      role: utilisateur.role ?? existant.role,
    });
  },

  /**
   * Retourne les utilisateurs "connus" localement (soi-même, participants de
   * DM déjà ouverts, résultats de résolution de pseudo — voir
   * resoudrePseudos). Ce n'est PAS un répertoire
   * global : aucun endpoint de ce type n'existe côté backend pour un
   * utilisateur non-admin.
   */
  obtenirUtilisateurs() {
    return [...this.utilisateursConnus.values()].map((item) => ({
      ...item,
      alias: this.profilsPublics.get(item.id)?.alias ?? null,
      avatar: this.profilsPublics.get(item.id)?.avatar ?? null,
    }));
  },

  /**
   * Résout les pseudos d'une liste d'ids inconnus localement via
   * `GET /api/users/lookup` (voir Authentification, endpoint public
   * authentifié dédié à l'affichage — jamais de courriel/rôle exposés par
   * cette route). Best-effort : une erreur réseau ne fait pas planter
   * l'appelant, les ids restent simplement non résolus (affichés en repli par
   * l'UI).
   */
  async resoudrePseudos(ids) {
    const uniques = [...new Set(ids)].filter(Boolean);
    const inconnus = uniques.filter((id) => !this.utilisateursConnus.has(id));
    // Profils publics (avatar, présence) jamais chargés : en parallèle de la
    // résolution des pseudos, pour que la première vue affiche déjà les photos.
    const sansProfil = uniques.filter(
      (id) =>
        id !== this.utilisateurConnecte?.id && !this.profilsPublics.has(id)
    );
    await Promise.all([
      inconnus.length ? this.resoudrePseudosInconnus(inconnus) : null,
      sansProfil.length ? this.chargerProfilsPublics(sansProfil) : null,
    ]);
  },

  async resoudrePseudosInconnus(inconnus) {
    // Par lots (voir NOMBRE_MAX_IDS_LOOKUP), en parallèle : un lot en erreur
    // n'empêche pas de résoudre les autres.
    const lots = [];
    for (let i = 0; i < inconnus.length; i += NOMBRE_MAX_IDS_LOOKUP) {
      lots.push(inconnus.slice(i, i + NOMBRE_MAX_IDS_LOOKUP));
    }
    await Promise.all(
      lots.map(async (lot) => {
        try {
          const resultats = await this.appelHttp(
            `/api/users/lookup?ids=${lot.map(encodeURIComponent).join(',')}`
          );
          for (const item of resultats ?? []) {
            this.enregistrerUtilisateurConnu(item);
          }
        } catch {
          // Résolution best-effort : voir docstring.
        }
      })
    );
  },

  /**
   * Charge alias/avatar/présence d'autres utilisateurs
   * (`GET /api/config-utilisateur/publiques`, 100 ids par requête). Émet
   * 'presence' pour chaque présence qui change, et 'profils-publics' si un
   * avatar ou un alias a changé (pour que l'UI redessine). Best-effort.
   */
  async chargerProfilsPublics(ids, { inclureAvatar = true } = {}) {
    const cibles = [...new Set(ids)].filter(
      (id) => id && id !== this.utilisateurConnecte?.id
    );
    const profilsModifies = [];
    for (let i = 0; i < cibles.length; i += NOMBRE_MAX_IDS_PUBLICS) {
      const lot = cibles.slice(i, i + NOMBRE_MAX_IDS_PUBLICS);
      let resultats;
      try {
        resultats = await this.appelHttp(
          `/api/config-utilisateur/publiques?ids=${lot.map(encodeURIComponent).join(',')}` +
            (inclureAvatar ? '' : '&inclureAvatar=false')
        );
      } catch {
        continue;
      }
      const parId = new Map((resultats ?? []).map((p) => [p.idUtilisateur, p]));
      for (const id of lot) {
        // Absent de la réponse = aucune configuration : hors ligne, sans photo.
        const profil = parId.get(id);
        const precedent = this.profilsPublics.get(id);
        const suivant = {
          alias: profil?.alias ?? null,
          avatar: inclureAvatar
            ? (profil?.avatar ?? null)
            : (precedent?.avatar ?? null),
        };
        if (
          precedent &&
          (precedent.alias !== suivant.alias ||
            precedent.avatar !== suivant.avatar)
        ) {
          profilsModifies.push(id);
        }
        this.profilsPublics.set(id, suivant);
        const horsLigneRecent =
          Date.now() - (this.horsLigneTempsReel.get(id) ?? 0) <
          DUREE_PRIORITE_HORS_LIGNE_MS;
        // Hors ligne selon User-Config-Service : fait toujours foi. En ligne :
        // confirmé par le temps réel s'il est disponible (voir
        // enLigneTempsReel), sinon sauf « hors ligne » tout récent.
        const confirmeEnLigne = this.enLigneTempsReel
          ? this.enLigneTempsReel.has(id)
          : !horsLigneRecent;
        const statut =
          profil?.actif && confirmeEnLigne ? 'en-ligne' : 'hors-ligne';
        if (this.presences[id] !== statut) {
          this.definirPresenceInterne({ utilisateurId: id, statut });
        }
      }
    }
    if (profilsModifies.length)
      this.emettre('profils-publics', profilsModifies);
  },

  /**
   * Candidats "Nouveau message privé" : description d'affichage (nom,
   * alias, avatar, présence) d'une liste d'ids déjà résolus, sans
   * soi-même, triée par nom affiché.
   */
  decrireUtilisateurs(ids) {
    const moi = this.utilisateurConnecte?.id;
    return [...new Set(ids)]
      .filter((id) => id !== moi && this.utilisateursConnus.has(id))
      .map((id) => ({
        id,
        pseudo: this.utilisateursConnus.get(id).pseudo,
        alias: this.profilsPublics.get(id)?.alias ?? null,
        avatar: this.profilsPublics.get(id)?.avatar ?? null,
        present: this.presences[id] === 'en-ligne',
      }))
      .sort((a, b) =>
        (a.alias || a.pseudo).localeCompare(b.alias || b.pseudo, undefined, {
          sensitivity: 'base',
        })
      );
  },

  /**
   * Suggestions de personnes à qui écrire, sans rien taper : interlocuteurs
   * de DM déjà connus et premiers membres de chacun de ses serveurs (pas
   * tous : tout le monde est membre du serveur par défaut). Pour les autres,
   * la recherche par pseudo (rechercherUtilisateurs).
   */
  async obtenirSuggestionsDm() {
    const ids = new Set(this.partenairesDmConnus);
    try {
      const serveurs = await this.chargerServeurs();
      const pages = await Promise.all(
        serveurs.map((serveur) =>
          this.appelHttp(
            `/api/servers/${encodeURIComponent(serveur.id)}/members?limite=${MEMBRES_SUGGERES_PAR_SERVEUR}`
          ).catch(() => null)
        )
      );
      for (const page of pages) {
        for (const membre of page?.membres ?? []) ids.add(membre.utilisateurId);
      }
    } catch {
      // Best-effort : on garde au moins les interlocuteurs connus.
    }
    await this.resoudrePseudos([...ids]);
    return this.decrireUtilisateurs([...ids]);
  },

  /**
   * Recherche par début de pseudo (`GET /api/users/search`, Authentification)
   * pour écrire à quelqu'un avec qui on ne partage aucun salon.
   */
  async rechercherUtilisateurs(texte) {
    const q = String(texte ?? '')
      .trim()
      .slice(0, 20);
    if (!q) return [];
    const resultats = await this.appelHttp(
      `/api/users/search?q=${encodeURIComponent(q)}&limit=20`
    );
    for (const item of resultats ?? []) this.enregistrerUtilisateurConnu(item);
    const ids = (resultats ?? []).map((item) => item.id);
    await this.resoudrePseudos(ids);
    return this.decrireUtilisateurs(ids);
  },

  /** Notre propre alias/avatar, pour obtenirUtilisateurs() (messages que
   * l'on a soi-même envoyés, liste des membres). */
  memoriserProfilSoi(config) {
    if (!this.utilisateurConnecte) return;
    this.profilsPublics.set(this.utilisateurConnecte.id, {
      alias: config.alias ?? null,
      avatar: config.avatar ?? null,
    });
  },
};
