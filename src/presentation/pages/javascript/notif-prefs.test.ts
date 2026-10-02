import { beforeEach, describe, expect, it, vi } from 'vitest';
// Script classique : s'enregistre sur window.NotifPrefs.
import './notif-prefs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- script non typé
const NotifPrefs = (window as any).NotifPrefs;

const installerStockageMemoire = () => {
  const donnees = new Map<string, string>();
  const stockage = {
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { donnees.set(cle, String(valeur)); },
    removeItem: (cle: string) => { donnees.delete(cle); },
    clear: () => { donnees.clear(); },
    key: (index: number) => [...donnees.keys()][index] ?? null,
    get length() { return donnees.size; },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: stockage,
  });
};

describe('NotifPrefs : aperçu dans les notifications système', () => {
  beforeEach(() => {
    installerStockageMemoire();
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
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('bloqué'); },
    });
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    expect(() => NotifPrefs.definirApercu('u1', false)).not.toThrow();
  });
});
