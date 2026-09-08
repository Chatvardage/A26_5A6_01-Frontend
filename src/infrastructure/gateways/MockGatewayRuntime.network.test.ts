import { describe, expect, it, vi } from 'vitest';
import { MockGatewayRuntime } from './MockGatewayRuntime.js';

describe('MockGatewayRuntime - réseau et présence', () => {
  it('teste connecté -> déconnecté et met la présence hors ligne', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'test-user', pseudo: 'test-user' });
    expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');

    gateway.simulerCoupure();
    expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
    expect(gateway.obtenirPresences()['test-user']).toBe('hors-ligne');
  });

  it('émet reconnexion puis connecté en temps réel', async () => {
    vi.useFakeTimers();
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'test-user', pseudo: 'test-user' });
    gateway.simulerCoupure();
    const etats: string[] = [];
    gateway.on('etat-connexion', (etat: { statut: string }) =>
      etats.push(etat.statut)
    );

    const reconnexion = gateway.simulerReconnexion(1000);
    expect(gateway.obtenirEtatConnexion().statut).toBe('reconnexion');
    await vi.advanceTimersByTimeAsync(1000);
    await reconnexion;

    expect(etats).toEqual(['reconnexion', 'connecte']);
    expect(gateway.obtenirPresences()['test-user']).toBe('en-ligne');
    vi.useRealTimers();
  });

  it('permet de changer la présence pendant l’exécution et émet un événement', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u2', pseudo: 'alice' });
    const changements: Array<{ utilisateurId: string; statut: string }> = [];
    gateway.on(
      'presence',
      (presence: { utilisateurId: string; statut: string }) =>
        changements.push(presence)
    );
    gateway.modifierPresence({ utilisateurId: 'u2', statut: 'en-ligne' });
    expect(gateway.obtenirPresences().u2).toBe('en-ligne');
    expect(changements.at(-1)).toMatchObject({
      utilisateurId: 'u2',
      statut: 'en-ligne',
    });
  });

  it('refuse un changement de présence lorsque le réseau est déconnecté', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });
    gateway.simulerCoupure();

    expect(() =>
      gateway.modifierPresence({ utilisateurId: 'u1', statut: 'en-ligne' })
    ).toThrow('ERR_RESEAU_NON_CONNECTE');
  });

  it('ignore une reconnexion demandée lorsque le réseau est déjà connecté', async () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });

    const avant = gateway.obtenirEtatConnexion();
    const resultat = await gateway.simulerReconnexion(0);

    expect(resultat.statut).toBe('connecte');
    expect(resultat.reconnexions).toBe(avant.reconnexions);
    expect(gateway.obtenirPresences().u1).toBe('en-ligne');
  });

  it('ne compte pas une reconnexion impossible sans utilisateur connecté', async () => {
    const gateway = new MockGatewayRuntime();
    expect(gateway.obtenirEtatConnexion().reconnexions).toBe(0);

    await expect(gateway.simulerReconnexion(0)).rejects.toThrow(
      'ERR_AUCUN_UTILISATEUR_CONNECTE'
    );

    expect(gateway.obtenirEtatConnexion().reconnexions).toBe(0);
    expect(gateway.obtenirEtatConnexion().statut).toBe('deconnecte');
  });

  it('refuse les messages pendant une coupure réseau puis les accepte après reconnexion', async () => {
    vi.useFakeTimers();
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });

    gateway.simulerCoupure();
    expect(() =>
      gateway.envoyerMessage({
        salonId: 's1',
        utilisateurId: 'u1',
        contenu: 'Message hors réseau',
      })
    ).toThrow('ERR_RESEAU_NON_CONNECTE');

    expect(() =>
      gateway.envoyerMessagePrive({
        conversationId: 'u1:u2',
        utilisateurId: 'u1',
        contenu: 'DM hors réseau',
      })
    ).toThrow('ERR_RESEAU_NON_CONNECTE');

    const reconnexion = gateway.simulerReconnexion(500);
    expect(gateway.obtenirEtatConnexion().statut).toBe('reconnexion');
    await vi.advanceTimersByTimeAsync(500);
    await reconnexion;

    expect(() =>
      gateway.envoyerMessage({
        salonId: 's1',
        utilisateurId: 'u1',
        contenu: 'Message revenu en ligne',
      })
    ).not.toThrow();
    vi.useRealTimers();
  });

  it('applique la coupure et la reconnexion à l’utilisateur simulé sélectionné', async () => {
    vi.useFakeTimers();
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });

    gateway.simulerCoupure('u2');
    expect(gateway.obtenirPresences().u2).toBe('hors-ligne');
    expect(gateway.obtenirPresences().u1).toBe('en-ligne');

    const reconnexion = gateway.simulerReconnexion(100, 'u2');
    await vi.advanceTimersByTimeAsync(100);
    await reconnexion;

    expect(gateway.obtenirPresences().u2).toBe('en-ligne');
    expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
    vi.useRealTimers();
  });

  it('utilise l’utilisateur connecté si null est fourni explicitement', async () => {
    vi.useFakeTimers();
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });

    gateway.simulerCoupure(null);
    expect(gateway.obtenirPresences().u1).toBe('hors-ligne');

    const reconnexion = gateway.simulerReconnexion(100, null);
    await vi.advanceTimersByTimeAsync(100);
    await reconnexion;

    expect(gateway.obtenirPresences().u1).toBe('en-ligne');
    expect(gateway.obtenirEtatConnexion().statut).toBe('connecte');
    vi.useRealTimers();
  });

  it('refuse de modifier ou supprimer un ancien message après retrait d’un salon privé', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });
    const message = gateway.envoyerMessage({
      salonId: 's2',
      utilisateurId: 'u1',
      contenu: 'Message privé',
    });

    type SalonRuntime = { id: string; membreIds: string[] };
    type GatewayRuntimeInterne = { salons: SalonRuntime[] };
    const gatewayInterne = gateway as unknown as GatewayRuntimeInterne;
    const salon = gatewayInterne.salons.find((item) => item.id === 's2');
    expect(salon).toBeDefined();
    if (!salon) throw new Error('Salon de test introuvable');
    salon.membreIds = salon.membreIds.filter((id) => id !== 'u1');

    expect(() =>
      gateway.modifierMessage({
        messageId: message.id,
        utilisateurId: 'u1',
        contenu: 'Tentative après retrait',
      })
    ).toThrow('ERR_ACCES_REFUSE_SALON');

    expect(() =>
      gateway.supprimerMessage({ messageId: message.id, utilisateurId: 'u1' })
    ).toThrow('ERR_ACCES_REFUSE_SALON');
  });

  it('modifie et supprime uniquement les messages de leur auteur', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });
    const message = gateway.envoyerMessage({
      salonId: 's1',
      utilisateurId: 'u1',
      contenu: 'Avant',
    });

    const modifie = gateway.modifierMessage({
      messageId: message.id,
      utilisateurId: 'u1',
      contenu: 'Après',
    });
    expect(modifie.contenu).toBe('Après');
    expect(() =>
      gateway.supprimerMessage({ messageId: message.id, utilisateurId: 'u2' })
    ).toThrow('ERR_MESSAGE_NON_AUTORISE');

    expect(() =>
      gateway.supprimerMessage({ messageId: message.id, utilisateurId: 'u1' })
    ).not.toThrow();
  });

  it('bloque l’état de saisie hors connexion', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });
    gateway.simulerCoupure('u1');

    expect(() =>
      gateway.modifierEtatSaisie({
        conversationId: 's1',
        utilisateurId: 'u1',
        est_saisie: true,
      })
    ).toThrow('ERR_RESEAU_NON_CONNECTE');
  });

  it('refuse un message de salon de plus de 2000 caractères', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });

    expect(() =>
      gateway.envoyerMessage({
        salonId: 's1',
        utilisateurId: 'u1',
        contenu: 'x'.repeat(2001),
      })
    ).toThrow('ERR_MESSAGE_TROP_LONG');
  });

  it('refuse un message privé de plus de 2000 caractères', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });
    const conversation = gateway.demarrerConversationPrivee({
      utilisateurId: 'u1',
      autreUtilisateurId: 'u2',
    });

    expect(() =>
      gateway.envoyerMessagePrive({
        conversationId: conversation.id,
        utilisateurId: 'u1',
        contenu: 'x'.repeat(2001),
      })
    ).toThrow('ERR_MESSAGE_TROP_LONG');
  });

  it('refuse une modification de message de plus de 2000 caractères', () => {
    const gateway = new MockGatewayRuntime();
    gateway.connexion({ id: 'u1', pseudo: 'sam' });
    const message = gateway.envoyerMessage({
      salonId: 's1',
      utilisateurId: 'u1',
      contenu: 'Avant',
    });

    expect(() =>
      gateway.modifierMessage({
        messageId: message.id,
        utilisateurId: 'u1',
        contenu: 'x'.repeat(2001),
      })
    ).toThrow('ERR_MESSAGE_TROP_LONG');
  });
});
