// ============================================================================
// Service de gestion des salons - Implémentation avec mock pour le développement
// ============================================================================

import type { ChatGateway } from '../../infrastructure/gateways/ChatGateway';
import { creerSalon, type Salon } from '../entities/Salon';
import type { Utilisateur } from '../entities/Utilisateur';

/**
 * Gestionnaire d'événements pour les salons
 */
type DonneesEvenement = Record<string, unknown>;

export class ChannelEvents {
  public static readonly ChannelCreated = 'channel:created';
  public static readonly ChannelJoined = 'channel:joined';
  public static readonly ChannelLeft = 'channel:left';
  public static readonly ChannelsListUpdated = 'channels:list';

  private static listeners: {
    [eventName: string]: ((data: DonneesEvenement) => void)[];
  } = {};

  /**
   * Ajoute un écouteur pour un événement spécifique
   */
  public static on(
    event: string,
    listener: (data: DonneesEvenement) => void
  ): () => void {
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
  public static emit(event: string, data: DonneesEvenement): void {
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
  private salons: Salon[] = [];

  /**
   * Canal actuel sélectionné par l'utilisateur
   */
  private salonActifId: string | null = null;

  /**
   * Nom de l'utilisateur connecté (utilisé pour déterminer les salons publics)
   */
  private readonly user: Utilisateur;

  private readonly chatGateway: ChatGateway;
  /**
   * Constructeur avec un utilisateur authentifié
   */
  constructor(user: Utilisateur, chatGateway: ChatGateway) {
    this.user = user;
    this.chatGateway = chatGateway; // Initialisation du gateway
    this._initDefaultChannels();
  }

  /**
   * Initialise les salons par défaut (salons publics prédéfinis)
   */
  private _initDefaultChannels(): void {
    const salonsParDefaut: Salon[] = [
      creerSalon('salon-general', '#général', this.user.id),
      creerSalon('salon-annonces', '#annonces', this.user.id),
      creerSalon('salon-aide', '#aide', this.user.id),
      creerSalon('salon-hasard', '#hasard', this.user.id),
    ];

    this.salons = salonsParDefaut;
  }

  /**
   * Obtient la liste complète de tous les salons publics disponibles
   */
  public getChannels(): Salon[] {
    return this.salons.filter((salon) => salon.visibilite === 'public');
  }

  /**
   * Obtient un salon spécifique par son nom
   */
  public getChannel(channelName: string): Salon | null {
    const nomNormalise = channelName.startsWith('#')
      ? channelName
      : '#' + channelName;
    return this.salons.find((salon) => salon.nom === nomNormalise) || null;
  }

  /**
   * Crée un nouveau salon public - Fonctionnalité demandée
   */
  public createChannel(channelName: string, topic?: string): Salon {
    const nom = channelName.startsWith('#') ? channelName : '#' + channelName;
    const nouveauSalon = creerSalon(
      `salon-${Date.now()}`,
      nom,
      this.user.id,
      'public'
    );

    this.salons.push(nouveauSalon);
    this.emit('channel:created', { channel: nouveauSalon, topic });

    return nouveauSalon;
  }

  /**
   * Rejoint un salon public - Fonctionnalité demandée
   */
  public joinChannel(channelName: string): Salon | null {
    const nomNormalise = channelName.startsWith('#')
      ? channelName
      : '#' + channelName;
    
    // Vérifie si le salon existe déjà dans la liste
    if (this.getChannel(nomNormalise)) {
      this.setActiveChannel(nomNormalise);
      return this.getChannel(nomNormalise);
    }

    // Crée un nouveau salon public s'il n'existe pas
    const nouveauSalon = creerSalon(
      `salon-${Date.now()}`,
      nomNormalise,
      this.user.id,
      'public'
    );

    this.salons.push(nouveauSalon);
    this.setActiveChannel(nomNormalise);
    this.emit('channel:joined', { channel: nouveauSalon });

    return nouveauSalon;
  }

  /**
   * Quitte un salon - Fonctionnalité demandée
   */
  public leaveChannel(channelName: string): boolean {
    const nomNormalise = channelName.startsWith('#')
      ? channelName
      : '#' + channelName;
    
    const index = this.salons.findIndex((salon) => salon.nom === nomNormalise);
    if (index !== -1) {
      const salon = this.salons[index];

      // Si le salon actif est quitté, changer de canal
      if (this.salonActifId === salon.nom) {
        this.salonActifId = null;
        this.emit('channel:left', { 
          channel: salon, 
          newChannelId: null 
        });
      } else {
        this.emit('channel:left', { 
          channel: salon, 
          newChannelId: this.salonActifId || null 
        });
      }

      this.salons.splice(index, 1);
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

    this.salonActifId = channel.nom;
    this.emit('channels:list', { channels: this.getChannels(), active: channel });
  }

  /**
   * Obtient le canal actuel
   */
  public getCurrentChannel(): Salon | null {
    return this.salonActifId
      ? this.getChannel(this.salonActifId) || null
      : null;
  }

  /**
   * Émet un événement
   */
  private emit(
    event: 'channels:list' | 'channel:created' | 'channel:joined' | 'channel:left',
    data: DonneesEvenement
  ): void {
    ChannelEvents.emit(event, data);
  }

  /**
   * Obtient l'événement de liste des canaux (utilisé pour synchronisation)
   */
  public getChannelsListEvent(): string {
    return ChannelEvents.ChannelsListUpdated;
  }
}