import { describe, expect, it } from 'vitest';
import {
  creerEtatConnexion,
  estConnecte,
  estDeconnecte,
  estEnReconnexion,
} from './EtatConnexion';

describe('creerEtatConnexion', () => {
  it("utilise l'heure actuelle par défaut pour `depuis`", () => {
    const avant = Date.now();
    const etat = creerEtatConnexion('connecte');
    const apres = Date.now();
    expect(etat.depuis).toBeGreaterThanOrEqual(avant);
    expect(etat.depuis).toBeLessThanOrEqual(apres);
  });

  it('accepte un `depuis` explicite et un nombre de reconnexions', () => {
    const etat = creerEtatConnexion('reconnexion', 12345, 3);
    expect(etat).toEqual({
      statut: 'reconnexion',
      depuis: 12345,
      reconnexions: 3,
    });
  });

  it('laisse `reconnexions` undefined si non fourni', () => {
    const etat = creerEtatConnexion('deconnecte', 999);
    expect(etat.reconnexions).toBeUndefined();
  });
});

describe('estConnecte', () => {
  it('true seulement pour le statut "connecte"', () => {
    expect(estConnecte(creerEtatConnexion('connecte'))).toBe(true);
    expect(estConnecte(creerEtatConnexion('deconnecte'))).toBe(false);
    expect(estConnecte(creerEtatConnexion('reconnexion'))).toBe(false);
  });
});

describe('estDeconnecte', () => {
  it('true seulement pour le statut "deconnecte"', () => {
    expect(estDeconnecte(creerEtatConnexion('deconnecte'))).toBe(true);
    expect(estDeconnecte(creerEtatConnexion('connecte'))).toBe(false);
    expect(estDeconnecte(creerEtatConnexion('reconnexion'))).toBe(false);
  });
});

describe('estEnReconnexion', () => {
  it('true seulement pour le statut "reconnexion"', () => {
    expect(estEnReconnexion(creerEtatConnexion('reconnexion'))).toBe(true);
    expect(estEnReconnexion(creerEtatConnexion('connecte'))).toBe(false);
    expect(estEnReconnexion(creerEtatConnexion('deconnecte'))).toBe(false);
  });
});
