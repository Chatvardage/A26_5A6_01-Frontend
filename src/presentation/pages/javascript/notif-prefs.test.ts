import { beforeEach, describe, expect, it, vi } from 'vitest';
// Script classique : s'enregistre sur window.NotifPrefs.
import './notif-prefs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- script non typé
const NotifPrefs = (window as any).NotifPrefs;

describe('NotifPrefs : aperçu dans les notifications système', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('affiche le contenu par défaut, masquable par utilisateur', () => {
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    expect(NotifPrefs.afficheApercu(null)).toBe(true);
    NotifPrefs.definirApercu('u1', false);
    expect(NotifPrefs.afficheApercu('u1')).toBe(false);
    expect(NotifPrefs.afficheApercu('u2')).toBe(true);
    NotifPrefs.definirApercu('u1', true);
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    NotifPrefs.definirApercu(null, false); // sans utilisateur : ignoré
  });

  it('masque le contenu envoyé à la notification système si demandé', async () => {
    const message = {
      type: 'prive',
      auteurId: 'bob',
      contenu: 'secret',
      conversationId: 'c',
    };
    const notifier = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await NotifPrefs.traiterMessageRecu(message, {
      utilisateurId: 'u1',
      notifierMessageSysteme: notifier,
    });
    expect(notifier).toHaveBeenLastCalledWith(message);

    NotifPrefs.definirApercu('u1', false);
    await NotifPrefs.traiterMessageRecu(message, {
      utilisateurId: 'u1',
      notifierMessageSysteme: notifier,
    });
    expect(notifier).toHaveBeenLastCalledWith({
      ...message,
      contenu: '',
      apercuMasque: true,
    });
  });

  it('stockage indisponible : contenu affiché, sans erreur', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    expect(() => NotifPrefs.definirApercu('u1', false)).not.toThrow();
    vi.restoreAllMocks();
  });
});
