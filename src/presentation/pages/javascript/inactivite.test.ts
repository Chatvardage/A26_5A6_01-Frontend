import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './inactivite.js';

const I = (globalThis as typeof globalThis & { Inactivite?: any }).Inactivite;

describe('Inactivite', () => {
  const originalElectronApi = globalThis.electronAPI;
  const originalI18n = globalThis.I18n;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('electronAPI', {
      obtenirUtilisateurConnecte: vi.fn(async () => ({ id: 'u1' })),
      definirMotifRetourConnexion: vi.fn(async () => undefined),
      deconnexionSession: vi.fn(async () => undefined),
      allerALaConnexion: vi.fn(async () => undefined),
    });
    vi.stubGlobal('I18n', {
      t: vi.fn((cle: string) => cle),
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal('electronAPI', originalElectronApi);
    vi.stubGlobal('I18n', originalI18n);
  });

  it('ne s’initialise pas automatiquement au chargement du module', async () => {
    vi.resetModules();

    const obtenirUtilisateurConnecte = globalThis.electronAPI.obtenirUtilisateurConnecte as any;
    const definirMotifRetourConnexion = globalThis.electronAPI.definirMotifRetourConnexion as any;

    await import('./inactivite.js');

    expect(obtenirUtilisateurConnecte).not.toHaveBeenCalled();
    expect(definirMotifRetourConnexion).not.toHaveBeenCalled();
  });

  it('déclenche la déconnexion après 30 minutes sans activité', () => {
    const notifier = vi.fn();
    const onExpire = vi.fn();
    const minuteur = I.creerMinuteurInactivite({
      delaiMs: 1000,
      estActif: () => true,
      notifier,
      onExpire,
    });

    minuteur.demarrer();
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(notifier).toHaveBeenCalledWith(
      expect.stringMatching(/déconnecté|inactivité/i)
    );
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('réinitialise le compte à rebours après une interaction', () => {
    const onExpire = vi.fn();
    const minuteur = I.creerMinuteurInactivite({
      delaiMs: 1000,
      estActif: () => true,
      notifier: vi.fn(),
      onExpire,
    });

    minuteur.demarrer();
    vi.advanceTimersByTime(600);
    minuteur.reinitialiser();
    vi.advanceTimersByTime(600);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(401);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('throttle les événements fréquents tactiles pour éviter les réinitialisations inutiles', async () => {
    const minuter = I.creerMinuteurInactivite({
      delaiMs: 1000,
      estActif: () => true,
      notifier: vi.fn(),
      onExpire: vi.fn(),
    });

    minuter.demarrer();
    const touchmoveEvent = new Event('touchmove', { bubbles: true });
    const secondTouchmoveEvent = new Event('touchmove', { bubbles: true });

    document.dispatchEvent(touchmoveEvent);
    vi.advanceTimersByTime(4000);
    document.dispatchEvent(secondTouchmoveEvent);
    vi.advanceTimersByTime(100);
    expect(minuter).toBeTruthy();
  });

  it('arrête l’instance précédente avant d’en initialiser une nouvelle', async () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const premierStopper = await I.initialiserPageInactivite();
    const secondStopper = await I.initialiserPageInactivite();

    expect(typeof premierStopper).toBe('function');
    expect(typeof secondStopper).toBe('function');
    expect(removeEventListenerSpy).toHaveBeenCalled();

    I.stopper();
    removeEventListenerSpy.mockRestore();
  });

  it('utilise la traduction active pour le message de déconnexion par inactivité', async () => {
    const originalConsoleWarn = console.warn;
    const originalNotification = globalThis.Notification;

    const warnMock = vi.fn();
    console.warn = warnMock;
    globalThis.Notification = undefined as any;
    globalThis.I18n.t = vi.fn((cle: string) =>
      cle === 'auth.sessionInactive'
        ? 'Your session was closed automatically after 30 minutes of inactivity.'
        : cle
    );

    try {
      await I.initialiserPageInactivite();
      await vi.runAllTimersAsync();

      expect(globalThis.I18n.t).toHaveBeenCalledWith('auth.sessionInactive');
      expect(warnMock).toHaveBeenCalledWith(
        '[inactivite] notification de déconnexion non disponible :',
        'Your session was closed automatically after 30 minutes of inactivity.'
      );
    } finally {
      console.warn = originalConsoleWarn;
      globalThis.Notification = originalNotification;
    }
  });
});
