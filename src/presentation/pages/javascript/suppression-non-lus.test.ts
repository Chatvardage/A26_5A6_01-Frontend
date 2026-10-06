import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import './notif-prefs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- script classique
const NotifPrefs = (window as any).NotifPrefs;

it.each(['salons', 'prives'])(
  'réconcilie tous les badges après une suppression hors cache sur la page %s',
  async (page) => {
    const chemin = page === 'salons' ? 'salons/temps-reel.js' : 'message-prive.js';
    const source = readFileSync(`src/presentation/pages/javascript/${chemin}`, 'utf8');
    const debut = source.indexOf('window.electronAPI.onMessageSupprimeChange(');
    const fermeture = page === 'salons' ? '\n});' : '\n  });';
    const branchement = source.slice(debut, source.indexOf(fermeture, debut) + fermeture.length);
    const obtenirNonLus = vi.fn().mockResolvedValue({ salons: { horsCache: 1 }, prives: { dm: 1 } });
    await NotifPrefs.chargerNonLus({ obtenirNonLus });
    obtenirNonLus.mockResolvedValue({ salons: {}, prives: {} });
    let finir!: (valeur: { salons: object; prives: object }) => void;
    const suppressionLocale = vi.fn(() => undefined); // Aucun message en cache.
    const rafraichir = vi.fn(() => {
      expect(NotifPrefs.totalNonLus()).toBe(0);
    });
    let traitement!: (message: { messageId: string }) => Promise<void>;
    runInNewContext(branchement, {
      window: { electronAPI: { obtenirNonLus, onMessageSupprimeChange: (fn: typeof traitement) => { traitement = fn; } } },
      ChatUiShared: { oublierEtatActionMessage: vi.fn() },
      NotifPrefs,
      appliquerMessageSalonSupprime: suppressionLocale,
      appliquerMessageSupprime: suppressionLocale,
      afficherSalons: rafraichir,
      actualiserBadgeMessagesPrives: rafraichir,
      renderConversationList: rafraichir,
      actualiserBadgeSalons: rafraichir,
      mettreAJourBadgeApplication: rafraichir,
    });
    obtenirNonLus.mockImplementationOnce(() => new Promise((resolve) => { finir = resolve; }));
    const attente = traitement({ messageId: 'supprime-hors-cache' });
    // Le rendu attend la réponse autoritaire, plutôt que de décrémenter à l'aveugle.
    await Promise.resolve();
    expect(rafraichir).not.toHaveBeenCalled();
    finir({ salons: {}, prives: {} });
    await attente;
    expect(suppressionLocale).toHaveBeenCalledWith('supprime-hors-cache');
    expect(rafraichir).toHaveBeenCalledTimes(3);
  }
);
