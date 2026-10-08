import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './inactivite.js';

const I = (globalThis as typeof globalThis & { Inactivite?: any }).Inactivite;

describe('Inactivite', () => {
  it('ne s’initialise pas automatiquement au chargement du module', async () => {
    vi.resetModules();

    const originalElectronApi = globalThis.electronAPI;
    const originalI18n = globalThis.I18n;

    const obtenirUtilisateurConnecte = vi.fn(async () => ({ id: 'u1' }));
    const definirMotifRetourConnexion = vi.fn(async () => undefined);
    const deconnexionSession = vi.fn(async () => undefined);
    const allerALaConnexion = vi.fn(async () => undefined);

    globalThis.electronAPI = {
      obtenirUtilisateurConnecte,
      definirMotifRetourConnexion,
      deconnexionSession,
      allerALaConnexion,
    } as any;
    globalThis.I18n = {
      t: vi.fn((cle: string) => cle),
    } as any;

    await import('./inactivite.js');

    expect(obtenirUtilisateurConnecte).not.toHaveBeenCalled();

    globalThis.electronAPI = originalElectronApi;
    globalThis.I18n = originalI18n;
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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

  it('arrête l’instance précédente avant d’en initialiser une nouvelle', async () => {
    const originalElectronApi = globalThis.electronAPI;
    const originalI18n = globalThis.I18n;

    globalThis.electronAPI = {
      obtenirUtilisateurConnecte: vi.fn(async () => ({ id: 'u1' })),
      definirMotifRetourConnexion: vi.fn(async () => undefined),
      deconnexionSession: vi.fn(async () => undefined),
      allerALaConnexion: vi.fn(async () => undefined),
    } as any;
    globalThis.I18n = {
      t: vi.fn((cle: string) => cle),
    } as any;

    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const premierStopper = await I.initialiserPageInactivite();
    const secondStopper = await I.initialiserPageInactivite();

    expect(typeof premierStopper).toBe('function');
    expect(typeof secondStopper).toBe('function');
    expect(removeEventListenerSpy).toHaveBeenCalled();

    I.stopper();

    globalThis.electronAPI = originalElectronApi;
    globalThis.I18n = originalI18n;
    removeEventListenerSpy.mockRestore();
  });

  it('utilise la traduction active pour le message de déconnexion par inactivité', async () => {
    const originalConsoleWarn = console.warn;
    const originalNotification = globalThis.Notification;
    const originalElectronApi = globalThis.electronAPI;
    const originalI18n = globalThis.I18n;

    const warnMock = vi.fn();
    console.warn = warnMock;
    globalThis.Notification = undefined as any;
    globalThis.electronAPI = {
      obtenirUtilisateurConnecte: vi.fn(async () => ({ id: 'u1' })),
      definirMotifRetourConnexion: vi.fn(async () => undefined),
      deconnexionSession: vi.fn(async () => undefined),
      allerALaConnexion: vi.fn(async () => undefined),
    } as any;
    globalThis.I18n = {
      t: vi.fn((cle: string) =>
        cle === 'auth.sessionInactive'
          ? 'Your session was closed automatically after 30 minutes of inactivity.'
          : cle
      ),
    } as any;

    await I.initialiserPageInactivite();
    await vi.runAllTimersAsync();

    expect(globalThis.I18n.t).toHaveBeenCalledWith('auth.sessionInactive');
    expect(warnMock).toHaveBeenCalledWith(
      '[inactivite] notification de déconnexion non disponible :',
      'Your session was closed automatically after 30 minutes of inactivity.'
    );

    console.warn = originalConsoleWarn;
    globalThis.Notification = originalNotification;
    globalThis.electronAPI = originalElectronApi;
    globalThis.I18n = originalI18n;
  });
});
