// Gestion des salons (canaux)
const ChannelManager = (() => {
  let channels = []; // Liste complète des canaux
  let currentServerId = null; // ID du serveur actif
  let activeChannelId = null; // ID du canal actuel
  
  // Structure des serveurs publics disponibles
  const publicServers = [
    { id: 'general', name: '#général', type: 'public' },
    { id: 'random', name: '#random', type: 'public' },
    { id: 'help', name: '#aide', type: 'public' }
  ];

  /**
   * Liste tous les salons publics disponibles
   */
  function listPublicChannels() {
    return publicServers.filter(c => c.type === 'public').map(c => ({
      id: c.id,
      name: c.name,
      topic: `C'est le salon ${c.name.toUpperCase()} du serveur !`
    }));
  }

  /**
   * Crée un nouveau salon dans le serveur actif
   */
  function createChannel(serverId, channelName, topic = '') {
    const server = servers.find(s => s.id === serverId);
    
    if (!server || !server.allowChannels) {
      console.log('Erreur : Ce serveur ne permet pas de créer des canaux');
      return null;
    }

    // Vérifie si le nom existe déjà
    if (channels.some(c => c.name === channelName)) {
      console.log(`Erreur : Un canal nommé ${channelName} existe déjà`);
      return null;
    }

    const newChannel = {
      id: `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: channelName,
      topic: topic || `Salon créé par ${currentUser.name}`,
      serverId,
      type: 'text',
      joinedAt: new Date().toISOString(),
      unreadCount: 0
    };

    channels.push(newChannel);
    console.log(`Canaux créé avec succès : ${newChannel.name}`);
    
    // Met à jour la liste des canaux dans l'UI
    updateChannelList(serverId);
    
    return newChannel;
  }

  /**
   * Rejoint un salon public
   */
  function joinPublicChannel(channelName) {
    const channel = publicServers.find(c => c.name === channelName);
    
    if (!channel) {
      console.log(`Erreur : Le salon ${channelName} n'existe pas`);
      return null;
    }

    // Créer une entrée dans notre liste de canaux
    const joinedChannel = {
      id: `public_${channel.id}`,
      name: channel.name,
      topic: `Salon public : ${channel.name.toUpperCase()}`,
      serverId: 'general', // Les salons publics sont dans le serveur général
      type: 'text',
      joinedAt: new Date().toISOString(),
      isPublic: true,
      unreadCount: 0
    };

    channels.push(joinedChannel);
    
    // Met à jour la liste des canaux
    updateChannelList('general');
    
    console.log(`Rejoint le salon : ${channel.name}`);
    
    return joinedChannel;
  }

  /**
   * Quitte un salon
   */
  function leaveChannel(channelId) {
    const index = channels.findIndex(c => c.id === channelId);
    
    if (index === -1) {
      console.log(`Le canal ${channelId} n'existe pas`);
      return false;
    }

    const channel = channels[index];
    channels.splice(index, 1);
    
    // Si c'était le canal actif, on passe au précédent
    if (activeChannelId === channelId) {
      setActiveChannel(channels[channels.length - 1]?.id || null);
    }
    
    console.log(`Quitté le salon : ${channel.name}`);
    
    // Met à jour la liste des canaux dans l'UI
    updateChannelList(channel.serverId);
    
    return true;
  }

  /**
   * Sélectionne un canal (changement de canal)
   */
  function selectChannel(channelId) {
    const channel = channels.find(c => c.id === channelId);
    
    if (!channel) {
      console.log(`Le canal ${channelId} n'est pas dans votre liste`);
      return false;
    }

    activeChannelId = channelId;
    currentServerId = channel.serverId;
    
    // Émet l'événement pour que Vue.js met à jour l'UI
    window.dispatchEvent(new CustomEvent('channel:selected', {
      detail: { 
        channel,
        channels: getChannelsByServer(channel.serverId)
      }
    }));
    
    console.log(`Sélection du salon : ${channel.name}`);
    
    return true;
  }

  /**
   * Obtient tous les canaux du serveur actif
   */
  function getChannelsByServer(serverId) {
    return channels.filter(c => c.serverId === serverId).map(c => ({
      id: c.id,
      name: c.name,
      topic: c.topic,
      unreadCount: c.unreadCount,
      type: c.type
    }));
  }

  /**
   * Obtient le canal actuel
   */
  function getCurrentChannel() {
    return channels.find(c => c.id === activeChannelId) || null;
  }

  /**
   * Met à jour la liste des canaux pour un serveur donné
   */
  function updateChannelList(serverId) {
    const container = document.getElementById('channel-list');
    if (!container) return;

    const channelsToDisplay = getChannelsByServer(serverId);
    
    // Émet l'événement pour synchroniser la liste dans Vue.js
    window.dispatchEvent(new CustomEvent('channels:update', {
      detail: { 
        channels: channelsToDisplay,
        active: getCurrentChannel()
      }
    }));
  }

  /**
   * Définit le canal actif (interne)
   */
  function setActiveChannel(channelId) {
    activeChannelId = channelId;
    
    window.dispatchEvent(new CustomEvent('channel:selected', {
      detail: { channel: getCurrentChannel() }
    }));
  }

  /**
   * Récupère le serveur actif
   */
  function getActiveServer() {
    return servers.find(s => s.id === currentServerId) || null;
  }

  // Expose les fonctions globalement pour utilisation depuis main.js
  window.ChannelManager = {
    listPublicChannels,
    createChannel,
    joinPublicChannel,
    leaveChannel,
    selectChannel,
    getChannelsByServer,
    getCurrentChannel,
    updateChannelList,
    getActiveServer,
    get channels() { return [...channels]; },
    set channel(id) { setActiveChannel(id); }
  };

})();