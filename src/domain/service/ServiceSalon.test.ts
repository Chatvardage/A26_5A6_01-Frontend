import { ChannelEvents, ServiceChannel } from './ServiceSalon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Utilisateur } from '../entities/Utilisateur';
import type { ChatGateway } from '../../infrastructure/gateways/ChatGateway';

describe('ServiceChannel', () => {
  let mockUser: Utilisateur;
  let mockChatGateway: ChatGateway;
  let service: ServiceChannel;

  beforeEach(() => {
    mockUser = { id: 'user-123', nom: 'TestUser' } as unknown as Utilisateur;
    mockChatGateway = {} as unknown as ChatGateway;

    service = new ServiceChannel(mockUser, mockChatGateway);
  });

  describe('Initialisation', () => {
    it('devrait initialiser les salons par défaut', () => {
      const channels = service.getChannels();
      expect(channels.length).toBe(4);
      expect(channels.map(c => c.nom)).toEqual(['#général', '#annonces', '#aide', '#hasard']);
    });
  });

  describe('getChannel', () => {
    it('devrait retourner un salon existant avec le préfixe #', () => {
      const channel = service.getChannel('#général');
      expect(channel).toBeDefined();
      expect(channel?.nom).toBe('#général');
    });

    it('devrait normaliser le nom en ajoutant le # manquant', () => {
      const channel = service.getChannel('général');
      expect(channel).toBeDefined();
      expect(channel?.nom).toBe('#général');
    });

    it('devrait retourner null si le salon n\'existe pas', () => {
      const channel = service.getChannel('#inexistant');
      expect(channel).toBeNull();
    });
  });

  describe('createChannel', () => {
    it('devrait créer, ajouter et retourner un nouveau salon', () => {
      const channel = service.createChannel('nouveau-salon', 'Sujet test');
      
      expect(channel.nom).toBe('#nouveau-salon');
      expect(channel.hoteId).toBe('user-123');
      expect(channel.visibilite).toBe('public');
      
      const channels = service.getChannels();
      expect(channels).toContainEqual(channel);
    });

    it('devrait conserver le préfixe # fourni dans le nom', () => {
      const channel = service.createChannel('#salon-prefixed');

      expect(channel.nom).toBe('#salon-prefixed');
    });
  });

  describe('joinChannel', () => {
    it('devrait rejoindre un salon existant et le définir comme actif', () => {
      const channel = service.joinChannel('aide');
      
      expect(channel?.nom).toBe('#aide');
      expect(service.getCurrentChannel()?.nom).toBe('#aide');
    });

    it('devrait créer et rejoindre un salon s\'il n\'existe pas', () => {
      const channel = service.joinChannel('salon-secret');
      
      expect(channel?.nom).toBe('#salon-secret');
      expect(service.getCurrentChannel()?.nom).toBe('#salon-secret');
      
      const channels = service.getChannels();
      expect(channels.some(c => c.nom === '#salon-secret')).toBeTruthy();
    });
  });

  describe('leaveChannel', () => {
    it('devrait quitter un salon existant, le retirer de la liste et retourner true', () => {
      const result = service.leaveChannel('général');
      
      expect(result).toBe(true);
      expect(service.getChannel('général')).toBeNull();
    });

    it('devrait désactiver le salon s\'il était le salon actif', () => {
      service.joinChannel('aide');
      expect(service.getCurrentChannel()?.nom).toBe('#aide');
      
      service.leaveChannel('aide');
      expect(service.getCurrentChannel()).toBeNull();
    });

    it('devrait conserver le salon actif si un autre salon est quitté', () => {
      service.joinChannel('aide');

      expect(service.leaveChannel('général')).toBe(true);
      expect(service.getCurrentChannel()?.nom).toBe('#aide');
    });

    it('devrait accepter un nom de salon déjà préfixé', () => {
      expect(service.leaveChannel('#général')).toBe(true);
      expect(service.getChannel('#général')).toBeNull();
    });

    it('devrait retourner false si le salon n\'existe pas', () => {
      const result = service.leaveChannel('salon-fantome');
      expect(result).toBe(false);
    });
  });

  describe('événements', () => {
    it('devrait appeler puis retirer un écouteur', () => {
      const donneesRecues: Record<string, unknown>[] = [];
      const ecouter = (donnees: Record<string, unknown>) => {
        donneesRecues.push(donnees);
      };
      const autreDonneesRecues: Record<string, unknown>[] = [];
      const autreEcouter = (donnees: Record<string, unknown>) => {
        autreDonneesRecues.push(donnees);
      };
      const retirer = ChannelEvents.on('test', ecouter);
      const retirerAutre = ChannelEvents.on('test', autreEcouter);

      ChannelEvents.emit('test', { valeur: 1 });
      retirer();
      retirerAutre();
      ChannelEvents.emit('test', { valeur: 2 });

      expect(donneesRecues).toEqual([{ valeur: 1 }]);
      expect(autreDonneesRecues).toEqual([{ valeur: 1 }]);
    });

    it('devrait ignorer un événement sans écouteur', () => {
      expect(() => ChannelEvents.emit('sans-ecouteur', {})).not.toThrow();
    });
  });

  describe('getChannelsListEvent', () => {
    it('devrait retourner le nom de l événement de liste', () => {
      expect(service.getChannelsListEvent()).toBe('channels:list');
    });
  });

  describe('setActiveChannel', () => {
    it('devrait refuser un salon inexistant', () => {
      expect(() => {
        (service as unknown as { setActiveChannel: (nom: string) => void }).setActiveChannel(
          '#inexistant'
        );
      }).toThrow('Canal inexistant : #inexistant');
    });

    it('devrait retourner null si le salon actif est introuvable', () => {
      (service as unknown as { salonActifId: string }).salonActifId =
        '#supprime';

      expect(service.getCurrentChannel()).toBeNull();
    });
  });
});