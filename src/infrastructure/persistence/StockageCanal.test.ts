import { describe, expect, beforeEach, test } from 'vitest';
import {
  enregistrerCanal,
  recupererCanaux,
  recupererCanal,
  retirerCanal,
  ajouterUtilisateurDansCanal,
  retirerUtilisateurDuCanal,
  recupererCanauxParUtilisateur,
  Canal,
} from './StockageCanal';

beforeEach(() => {
  localStorage.clear();
});

// ----- Canaux -----

describe('Canaux', () => {
  const canal1: Canal = {
    idCanal: 'c1',
    nomCanal: 'Canal 1',
    estPublique: true,
    idUtilisateur: ['u1'],
  };
  const canal2: Canal = {
    idCanal: 'c2',
    nomCanal: 'Canal 2',
    estPublique: false,
    idUtilisateur: ['u2'],
  };

  test('enregistre et récupère un canal', () => {
    enregistrerCanal(canal1);
    expect(recupererCanal('c1')).toEqual(canal1);
  });

  test('met à jour un canal existant plutôt que de le dupliquer', () => {
    enregistrerCanal(canal1);
    enregistrerCanal({ ...canal1, estPublique: false });

    const canaux = recupererCanaux();
    expect(canaux).toHaveLength(1);
    expect(canaux[0].estPublique).toBe(false);
  });

  test('retire un canal', () => {
    enregistrerCanal(canal1);
    enregistrerCanal(canal2);
    retirerCanal('c1');

    expect(recupererCanaux()).toEqual([canal2]);
  });

  test('recupererCanal retourne undefined si absent', () => {
    expect(recupererCanal('inconnu')).toBeUndefined();
  });
});

// ----- Utilisateurs dans un canal -----

describe('Utilisateurs dans un canal', () => {
  const canal1: Canal = {
    idCanal: 'c1',
    estPublique: true,
    idUtilisateur: ['u1'],
    nomCanal: '',
  };

  test('ajoute un utilisateur au canal', () => {
    enregistrerCanal(canal1);
    ajouterUtilisateurDansCanal('c1', 'u2');

    expect(recupererCanal('c1')?.idUtilisateur).toEqual(['u1', 'u2']);
  });

  test("n'ajoute pas de doublon si l'utilisateur est déjà présent", () => {
    enregistrerCanal(canal1);
    ajouterUtilisateurDansCanal('c1', 'u1');

    expect(recupererCanal('c1')?.idUtilisateur).toEqual(['u1']);
  });

  test('retire un utilisateur du canal', () => {
    enregistrerCanal(canal1);
    retirerUtilisateurDuCanal('c1', 'u1');

    expect(recupererCanal('c1')?.idUtilisateur).toEqual([]);
  });

  test("ne fait rien si le canal n'existe pas", () => {
    expect(() => ajouterUtilisateurDansCanal('inconnu', 'u1')).not.toThrow();
    expect(() => retirerUtilisateurDuCanal('inconnu', 'u1')).not.toThrow();
  });

  test('récupère les canaux contenant un utilisateur donné', () => {
    enregistrerCanal({
      idCanal: 'c1',
      estPublique: true,
      idUtilisateur: ['u1', 'u2'],
      nomCanal: '',
    });
    enregistrerCanal({
      idCanal: 'c2',
      estPublique: false,
      idUtilisateur: ['u2'],
      nomCanal: '',
    });
    enregistrerCanal({
      idCanal: 'c3',
      estPublique: true,
      idUtilisateur: ['u3'],
      nomCanal: '',
    });

    const resultat = recupererCanauxParUtilisateur('u2');
    expect(resultat.map((c) => c.idCanal)).toEqual(['c1', 'c2']);
  });
});
