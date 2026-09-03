// ============================================================================
// Service de gestion des salons (canals) - Implémentation avec mock pour le développement
// ============================================================================

import type { Channel } from '../entity/Channel';
import type { User } from '../entity/User';

/**
 * Gestionnaire d'événements pour les salons
 */
class ChannelEvents {
  public static readonly ChannelCreated = 'channel:created';
  public static readonly ChannelJoined = 'channel:joined';
  public static readonly ChannelLeft = 'channel:left';
  public static readonly ChannelsListUpdated = 'channels:list';

  private static listeners: { [eventName: string]: ((data: any) => void)[] } = {};

  /**
   * Ajoute un écouteur pour un événement spécifique
   */
  public static on(event: string, listener: (data: any) => void): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);

    return () => {
      this.listeners[event] = this.listeners[event].filter(l => l !== listener);
    };
  }

  /**
   * Émet un événement avec ses données
   */
  public static emit(event: string, data: any): void {
    const listeners = this.listeners[event];
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }
}

/**
 * Service de gestion des salons - Implémentation mock pour le développement
 */
export class ServiceChannel {
  /**
   * Liste complète de tous les canaux connus
   */
  private channels: Channel[] = [];

  /**
   * Canal actuel sélectionné par l'utilisateur
   */
  private currentChannelId: string | null = null;

  /**
   * Nom de l'utilisateur connecté (utilisé pour déterminer les salons publics)
   */
  private readonly user: User;

  /**
   * Constructeur avec un utilisateur authentifié
   */
  constructor(user: User) {
    this.user = user;
    this._initDefaultChannels();
  }

  /**
   * Initialise les salons par défaut (salons publics prédéfinis)
   */
  private _initDefaultChannels(): void {
    const defaultChannels: Channel[] = [
      new Channel('#general', 'Général - Discussions libres', false),
      new Channel('#announcements', 'Annonces - Informations importantes', false),
      new Channel('#help', 'Aide - Questions et réponses', false),
      new Channel('#random', 'Hasard - Conversations détendues', false),
    ];

    this.channels = defaultChannels;
  }

  /**
   * Obtient la liste complète de tous les salons publics disponibles
   */
  public getChannels(): Channel[] {
    return this.channels.filter(c => !c.isPrivate);
  }

  /**
   * Obtient un salon spécifique par son nom
   */
  public getChannel(channelName: string): Channel | null {
    const normalized = channelName.startsWith('#') ? channelName : '#' + channelName;
    return this.channels.find(c => c.name === normalized) || null;
  }

  /**
   * Crée un nouveau salon public - Fonctionnalité demandée
   */
  public createChannel(channelName: string, topic?: string): Channel {
    const name = channelName.startsWith('#') ? channelName : '#' + channelName;
    const now = new Date().toISOString();

    const newChannel = new Channel(
      name,
      topic || 'Nouveau salon créé',
      false,
      now
    );

    this.channels.push(newChannel);
    this.emit('channel:created', { channel: newChannel });

    return newChannel;
  }

  /**
   * Rejoint un salon public - Fonctionnalité demandée
   */
  public joinChannel(channelName: string): Channel | null {
    const normalized = channelName.startsWith('#') ? channelName : '#' + channelName;
    
    // Vérifie si le salon existe déjà dans la liste
    if (this.getChannel(normalized)) {
      this.setActiveChannel(normalized);
      return this.getChannel(normalized);
    }

    // Crée un nouveau salon public s'il n'existe pas
    const now = new Date().toISOString();
    const newChannel = new Channel(
      normalized,
      'Salon rejoint',
      false,
      now
    );

    this.channels.push(newChannel);
    this.setActiveChannel(normalized);
    this.emit('channel:joined', { channel: newChannel });

    return newChannel;
  }

  /**
   * Quitte un salon - Fonctionnalité demandée
   */
  public leaveChannel(channelName: string): boolean {
    const normalized = channelName.startsWith('#') ? channelName : '#' + channelName;
    
    const index = this.channels.findIndex(c => c.name === normalized);
    if (index !== -1) {
      const channel = this.channels[index];

      // Si le salon actif est quitté, changer de canal
      if (this.currentChannelId === channel.name) {
        this.currentChannelId = null;
        this.emit('channel:left', { 
          channel: channel, 
          newChannelId: null 
        });
      } else {
        this.emit('channel:left', { 
          channel: channel, 
          newChannelId: this.currentChannelId || null 
        });
      }

      this.channels.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Sélectionne le salon comme actif (pour affichage des messages)
   */
  private setActiveChannel(channelName: string): void {
    const channel = this.getChannel(channelName);
    if (!channel) {
      throw new Error('Canal inexistant : ' + channelName);
    }

    this.currentChannelId = channel.name;
    this.emit('channels:list', { channels: this.getChannels(), active: channel });
  }

  /**
   * Obtient le canal actuel
   */
  public getCurrentChannel(): Channel | null {
    return this.currentChannelId 
      ? this.getChannel(this.currentChannelId) || null
      : null;
  }

  /**
   * Émet un événement
   */
  private emit(event: 'channels:list' | 'channel:created' | 'channel:joined' | 'channel:left', data: any): void {
    ChannelEvents.emit(event, data);
  }

  /**
   * Obtient l'événement de liste des canaux (utilisé pour synchronisation)
   */
  public getChannelsListEvent(): typeof ChannelEvents.ChannelCreated = ChannelEvents.ChannelCreated;
}