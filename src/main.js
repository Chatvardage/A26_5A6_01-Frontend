// Gestion des salons (canaux)
(() => {
  const serveurs = window.serveurs ?? [];
  const utilisateurActuel = window.utilisateurActuel ?? { nom: 'utilisateur' };
  let salons = []; // Liste complète des salons
  let serveurActifId = null; // ID du serveur actif
  let salonActifId = null; // ID du salon actuel
  
  // Structure des serveurs publics disponibles
  const serveursPublics = [
    { id: 'general', name: '#général', type: 'public' },
    { id: 'hasard', name: '#hasard', type: 'public' },
    { id: 'help', name: '#aide', type: 'public' }
  ];

  /**
   * Liste tous les salons publics disponibles
   */
  function listerSalonsPublics() {
    return serveursPublics.filter(salon => salon.type === 'public').map(salon => ({
      id: salon.id,
      name: salon.name,
      topic: `C'est le salon ${salon.name.toUpperCase()} du serveur !`
    }));
  }

  /**
   * Crée un nouveau salon dans le serveur actif
   */
  function creerSalon(serveurId, nomSalon, sujet = '') {
    const serveur = serveurs.find(serveur => serveur.id === serveurId);
    
    if (!serveur || !serveur.allowChannels) {
      console.log('Erreur : Ce serveur ne permet pas de créer des canaux');
      return null;
    }

    // Vérifie si le nom existe déjà
    if (salons.some(salon => salon.name === nomSalon)) {
      console.log(`Erreur : Un salon nommé ${nomSalon} existe déjà`);
      return null;
    }

    const nouveauSalon = {
      id: `salon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: nomSalon,
      topic: sujet || `Salon créé par ${utilisateurActuel.nom}`,
      serverId: serveurId,
      type: 'text',
      joinedAt: new Date().toISOString(),
      unreadCount: 0
    };

    salons.push(nouveauSalon);
    console.log(`Salon créé avec succès : ${nouveauSalon.name}`);
    
    // Met à jour la liste des canaux dans l'UI
    actualiserListeSalons(serveurId);
    
    return nouveauSalon;
  }

  /**
   * Rejoint un salon public
   */
  function rejoindreSalonPublic(nomSalon) {
    const salon = serveursPublics.find(salonPublic => salonPublic.name === nomSalon);
    
    if (!salon) {
      console.log(`Erreur : Le salon ${nomSalon} n'existe pas`);
      return null;
    }

    // Créer une entrée dans notre liste de canaux
    const salonRejoint = {
      id: `public_${salon.id}`,
      name: salon.name,
      topic: `Salon public : ${salon.name.toUpperCase()}`,
      serverId: 'general', // Les salons publics sont dans le serveur général
      type: 'text',
      joinedAt: new Date().toISOString(),
      isPublic: true,
      unreadCount: 0
    };

    salons.push(salonRejoint);
    
    // Met à jour la liste des canaux
    actualiserListeSalons('general');
    
    console.log(`Salon rejoint : ${salon.name}`);
    
    return salonRejoint;
  }

  /**
   * Quitte un salon
   */
  function quitterSalon(salonId) {
    const index = salons.findIndex(salon => salon.id === salonId);
    
    if (index === -1) {
      console.log(`Le salon ${salonId} n'existe pas`);
      return false;
    }

    const salon = salons[index];
    salons.splice(index, 1);
    
    // Si c'était le canal actif, on passe au précédent
    if (salonActifId === salonId) {
      definirSalonActif(salons[salons.length - 1]?.id || null);
    }
    
    console.log(`Salon quitté : ${salon.name}`);
    
    // Met à jour la liste des canaux dans l'UI
    actualiserListeSalons(salon.serverId);
    
    return true;
  }

  /**
   * Sélectionne un canal (changement de canal)
   */
  function selectionnerSalon(salonId) {
    const salon = salons.find(salonCourant => salonCourant.id === salonId);
    
    if (!salon) {
      console.log(`Le salon ${salonId} n'est pas dans votre liste`);
      return false;
    }

    salonActifId = salonId;
    serveurActifId = salon.serverId;
    
    // Émet l'événement pour que Vue.js met à jour l'UI
    window.dispatchEvent(new CustomEvent('channel:selected', {
      detail: { 
        channel: salon,
        channels: obtenirSalonsDuServeur(salon.serverId)
      }
    }));
    
    console.log(`Salon sélectionné : ${salon.name}`);
    
    return true;
  }

  /**
   * Obtient tous les canaux du serveur actif
   */
  function obtenirSalonsDuServeur(serveurId) {
    return salons.filter(salon => salon.serverId === serveurId).map(salon => ({
      id: salon.id,
      name: salon.name,
      topic: salon.topic,
      unreadCount: salon.unreadCount,
      type: salon.type
    }));
  }

  /**
   * Obtient le canal actuel
   */
  function obtenirSalonActif() {
    return salons.find(salon => salon.id === salonActifId) || null;
  }

  /**
   * Met à jour la liste des canaux pour un serveur donné
   */
  function actualiserListeSalons(serveurId) {
    const container = document.getElementById('channel-list');
    if (!container) return;

    const salonsAAfficher = obtenirSalonsDuServeur(serveurId);
    
    // Émet l'événement pour synchroniser la liste dans Vue.js
    window.dispatchEvent(new CustomEvent('channels:update', {
      detail: { 
        channels: salonsAAfficher,
        active: obtenirSalonActif()
      }
    }));
  }

  /**
   * Définit le canal actif (interne)
   */
  function definirSalonActif(salonId) {
    salonActifId = salonId;
    
    window.dispatchEvent(new CustomEvent('channel:selected', {
      detail: { channel: obtenirSalonActif() }
    }));
  }

  /**
   * Récupère le serveur actif
   */
  function obtenirServeurActif() {
    return serveurs.find(serveur => serveur.id === serveurActifId) || null;
  }

  // Expose les fonctions globalement pour utilisation depuis main.js
  window.ChannelManager = {
    listerSalonsPublics,
    creerSalon,
    rejoindreSalonPublic,
    quitterSalon,
    selectionnerSalon,
    obtenirSalonsDuServeur,
    obtenirSalonActif,
    actualiserListeSalons,
    obtenirServeurActif,
    get salons() { return [...salons]; },
    set salon(id) { definirSalonActif(id); }
  };

})();