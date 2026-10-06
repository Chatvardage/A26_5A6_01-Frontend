import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './inactivite.js';

const I = (globalThis as typeof globalThis & { Inactivite?: any }).Inactivite;

describe('Inactivite', () => {
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
});
