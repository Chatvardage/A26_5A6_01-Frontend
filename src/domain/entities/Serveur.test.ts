import { describe, expect, it } from 'vitest';
import {
  initialesServeur,
  peutExpulser,
  peutGererServeur,
  peutModererServeur,
  rangRole,
} from './Serveur';

describe('rôles de serveur', () => {
  it('ordonne membre < moderateur < proprietaire < admin', () => {
    expect(
      [null, 'membre', 'moderateur', 'proprietaire', 'admin'].map((role) =>
        rangRole(role as never)
      )
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('modérer : modérateur minimum', () => {
    expect(peutModererServeur('membre')).toBe(false);
    expect(peutModererServeur('moderateur')).toBe(true);
    expect(peutModererServeur(undefined)).toBe(false);
  });

  it('gérer le serveur : propriétaire ou admin', () => {
    expect(peutGererServeur('moderateur')).toBe(false);
    expect(peutGererServeur('proprietaire')).toBe(true);
    expect(peutGererServeur('admin')).toBe(true);
  });

  it('expulser : strictement au-dessus de la cible', () => {
    expect(peutExpulser('moderateur', 'membre')).toBe(true);
    expect(peutExpulser('moderateur', 'moderateur')).toBe(false);
    expect(peutExpulser('proprietaire', 'moderateur')).toBe(true);
    expect(peutExpulser('membre', null)).toBe(false);
  });
});

describe('initialesServeur', () => {
  it('prend la première lettre des deux premiers mots', () => {
    expect(initialesServeur('projet final de session')).toBe('PF');
    expect(initialesServeur('  Chatvardage ')).toBe('C');
    expect(initialesServeur('')).toBe('');
  });
});
