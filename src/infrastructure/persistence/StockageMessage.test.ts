import { describe, expect, beforeEach, test } from 'vitest';
import {
  enregistrerMessage,
  recupererMessages,
  retirerMessage,
} from './StockageMessage';
import { ClefsStockageLocal } from './ClefsStockageLocal';

beforeEach(() => {
  localStorage.clear();
});

// ----- Messages -----

describe('Messages', () => {
  test('enregistre un message avec une date générée automatiquement', () => {
    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u1',
    });

    const messages = recupererMessages('c1');

    expect(messages).toHaveLength(1);
    expect(messages[0].date).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('respecte une date fournie manuellement', () => {
    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u1',
      date: '01/01/24 10:00:00',
    });

    expect(recupererMessages('c1')[0].date).toBe('01/01/24 10:00:00');
  });

  test('met à jour un message existant plutôt que de le dupliquer', () => {
    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u1',
      date: '01/01/24 10:00:00',
    });

    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u2',
      date: '01/01/24 10:00:00',
    });

    const messages = recupererMessages('c1');

    expect(messages).toHaveLength(1);
    expect(messages[0].idExpediteur).toBe('u2');
  });

  test('retourne les messages triés du plus ancien au plus récent', () => {
    enregistrerMessage({
      idMessage: 'm2',
      idCanal: 'c1',
      idExpediteur: 'u1',
      date: '02/01/24 10:00:00',
    });

    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u1',
      date: '01/01/24 10:00:00',
    });

    enregistrerMessage({
      idMessage: 'm3',
      idCanal: 'c1',
      idExpediteur: 'u1',
      date: '03/01/24 10:00:00',
    });

    const messages = recupererMessages('c1');

    expect(messages.map((m) => m.idMessage)).toEqual(['m1', 'm2', 'm3']);
  });

  test('les messages sont isolés par canal', () => {
    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u1',
    });

    enregistrerMessage({
      idMessage: 'm2',
      idCanal: 'c2',
      idExpediteur: 'u1',
    });

    expect(recupererMessages('c1')).toHaveLength(1);
    expect(recupererMessages('c2')).toHaveLength(1);
  });

  test("retire un message d'un canal", () => {
    enregistrerMessage({
      idMessage: 'm1',
      idCanal: 'c1',
      idExpediteur: 'u1',
    });

    enregistrerMessage({
      idMessage: 'm2',
      idCanal: 'c1',
      idExpediteur: 'u1',
    });

    retirerMessage('c1', 'm1');

    expect(recupererMessages('c1').map((m) => m.idMessage)).toEqual(['m2']);
  });

  test('gère une date invalide sans heure', () => {
    const messages = [
      {
        idMessage: 'm1',
        idCanal: 'c1',
        idExpediteur: 'u1',
        date: '01/01/24',
      },
    ];

    localStorage.setItem(
      ClefsStockageLocal.messages('c1'),
      JSON.stringify(messages)
    );

    const resultat = recupererMessages('c1');

    expect(resultat).toHaveLength(1);
    expect(resultat[0].idMessage).toBe('m1');
  });

  test('gère une date contenant des valeurs non numériques', () => {
    const messages = [
      {
        idMessage: 'm1',
        idCanal: 'c1',
        idExpediteur: 'u1',
        date: 'XX/01/24 10:00:00',
      },
    ];

    localStorage.setItem(
      ClefsStockageLocal.messages('c1'),
      JSON.stringify(messages)
    );

    const resultat = recupererMessages('c1');

    expect(resultat).toHaveLength(1);
    expect(resultat[0].idMessage).toBe('m1');
  });

  test("retourne un timestamp de 0 si la date ne contient pas d'espace", () => {
    const messages = [
      {
        idMessage: 'm1',
        idCanal: 'c1',
        idExpediteur: 'u1',
        date: '01/01/24', // Pas de partie heure (split(' ') produit 1 seul élément)
      },
      {
        idMessage: 'm2',
        idCanal: 'c1',
        idExpediteur: 'u1',
        date: '02/01/24 10:00:00',
      },
    ];

    localStorage.setItem(
      ClefsStockageLocal.messages('c1'),
      JSON.stringify(messages)
    );

    const resultat = recupererMessages('c1');

    // Le message m1 avec timestamp 0 doit être placé en premier lors du tri
    expect(resultat.map((m) => m.idMessage)).toEqual(['m1', 'm2']);
  });

  test("retourne un timestamp de 0 si un composant de la date n'est pas un nombre", () => {
    const messages = [
      {
        idMessage: 'm1',
        idCanal: 'c1',
        idExpediteur: 'u1',
        date: 'XX/01/24 10:00:00', // Un des éléments produit NaN
      },
      {
        idMessage: 'm2',
        idCanal: 'c1',
        idExpediteur: 'u1',
        date: '01/01/24 10:00:00',
      },
    ];

    localStorage.setItem(
      ClefsStockageLocal.messages('c1'),
      JSON.stringify(messages)
    );

    const resultat = recupererMessages('c1');

    expect(resultat.map((m) => m.idMessage)).toEqual(['m1', 'm2']);
  });
});
