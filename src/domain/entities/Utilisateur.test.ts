import { describe, expect, it } from 'vitest';
import {
  creerUtilisateur,
  genererPseudoParDefaut,
  peutGererSalons,
  validationCourriel,
  validationMotDePasse,
  validationPseudo,
} from './Utilisateur';

describe('creerUtilisateur', () => {
  it('crée un utilisateur avec id et pseudo', () => {
    expect(creerUtilisateur('u1', 'ariane')).toEqual({
      id: 'u1',
      pseudo: 'ariane',
      courriel: undefined,
      role: undefined,
    });
  });

  it('crée un utilisateur avec courriel et rôle', () => {
    expect(
      creerUtilisateur('u1', 'ariane', 'ariane@example.com', 'moderateur')
    ).toEqual({
      id: 'u1',
      pseudo: 'ariane',
      courriel: 'ariane@example.com',
      role: 'moderateur',
    });
  });
});

describe('validationCourriel', () => {
  it('accepte un courriel plausible', () => {
    expect(validationCourriel('ariane@example.com')).toBe(true);
    expect(validationCourriel('  ariane@example.com  ')).toBe(true);
  });

  it('refuse un courriel sans @ ou sans domaine', () => {
    expect(validationCourriel('ariane')).toBe(false);
    expect(validationCourriel('ariane@')).toBe(false);
    expect(validationCourriel('@example.com')).toBe(false);
  });
});

describe('validationMotDePasse', () => {
  it('accepte un mot de passe de 8 caractères ou plus', () => {
    expect(validationMotDePasse('motdepasse')).toBe(true);
    expect(validationMotDePasse('a'.repeat(8))).toBe(true);
  });

  it('refuse un mot de passe trop court ou non-string', () => {
    expect(validationMotDePasse('a'.repeat(7))).toBe(false);
    expect(validationMotDePasse(undefined as unknown as string)).toBe(false);
  });
});

describe('genererPseudoParDefaut', () => {
  it("dérive un pseudo à partir de la partie locale du courriel", () => {
    expect(genererPseudoParDefaut('ariane@example.com')).toBe('ariane');
  });

  it('retire les caractères non autorisés', () => {
    expect(genererPseudoParDefaut('ariane.dupont+1@example.com')).toBe(
      'arianedupont1'
    );
  });

  it('complète jusqu\'à 3 caractères minimum', () => {
    expect(genererPseudoParDefaut('a@example.com')).toBe('a00');
  });

  it('tronque à 20 caractères maximum', () => {
    const local = 'a'.repeat(30);
    expect(genererPseudoParDefaut(`${local}@example.com`)).toHaveLength(20);
  });
});

describe('peutGererSalons', () => {
  it('retourne true pour un modérateur', () => {
    expect(peutGererSalons({ role: 'moderateur' })).toBe(true);
  });

  it('retourne true pour un admin', () => {
    expect(peutGererSalons({ role: 'admin' })).toBe(true);
  });

  it('retourne false pour un utilisateur régulier', () => {
    expect(peutGererSalons({ role: 'utilisateur' })).toBe(false);
  });

  it('retourne false si le rôle est inconnu (undefined/null)', () => {
    expect(peutGererSalons({ role: undefined })).toBe(false);
    expect(peutGererSalons(null)).toBe(false);
    expect(peutGererSalons(undefined)).toBe(false);
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
