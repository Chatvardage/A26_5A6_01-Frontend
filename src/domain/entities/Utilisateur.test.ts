import { describe, expect, it } from 'vitest';
import { creerUtilisateur, validationPseudo } from './Utilisateur';

describe('creerUtilisateur', () => {
  it('crée un utilisateur avec id et pseudo', () => {
    expect(creerUtilisateur('u1', 'ariane')).toEqual({
      id: 'u1',
      pseudo: 'ariane',
    });
  });
});

describe('validationPseudo', () => {
  it('accepte un pseudo valide (lettres, chiffres, underscore, tiret)', () => {
    expect(validationPseudo('ariane_1')).toBe(true);
    expect(validationPseudo('a-b-c')).toBe(true);
  });

  it('accepte les longueurs limites (3 et 20 caractères)', () => {
    expect(validationPseudo('abc')).toBe(true);
    expect(validationPseudo('a'.repeat(20))).toBe(true);
  });

  it('refuse un pseudo trop court (< 3) ou trop long (> 20)', () => {
    expect(validationPseudo('ab')).toBe(false);
    expect(validationPseudo('a'.repeat(21))).toBe(false);
  });

  it('refuse les caractères non autorisés (espace, accents, symboles)', () => {
    expect(validationPseudo('nom avec espace')).toBe(false);
    expect(validationPseudo('éléonore')).toBe(false);
    expect(validationPseudo('ariane@1')).toBe(false);
  });
});
