import { describe, expect, it } from 'vitest';
import {
  AUTEUR_SYSTEME,
  creerMessage,
  creerMessageSysteme,
  estMessageSysteme,
  paginerAvant,
  trierMessagesParEnvoi,
} from './Message';

describe('creerMessage', () => {
  it("utilise l'heure actuelle par défaut pour `envoi` et 'texte' par défaut pour `type`", () => {
    const avant = Date.now();
    const message = creerMessage('m1', 'c1', 'u1', 'Salut!');
    expect(message.envoi).toBeGreaterThanOrEqual(avant);
    expect(message.type).toBe('texte');
  });

  it('accepte un `envoi` et un `type` explicites', () => {
    const message = creerMessage('m1', 'c1', 'u1', 'Salut!', 999, 'systeme');
    expect(message).toEqual({
      id: 'm1',
      conversationId: 'c1',
      auteurId: 'u1',
      contenu: 'Salut!',
      envoi: 999,
      type: 'systeme',
    });
  });
});

describe('creerMessageSysteme', () => {
  it("crée un message de type 'systeme' avec AUTEUR_SYSTEME comme auteur", () => {
    const message = creerMessageSysteme('m1', 'c1', 'Sam a rejoint le salon');
    expect(message.type).toBe('systeme');
    expect(message.auteurId).toBe(AUTEUR_SYSTEME);
    expect(message.contenu).toBe('Sam a rejoint le salon');
  });

  it('accepte un `envoi` explicite', () => {
    const message = creerMessageSysteme('m1', 'c1', 'contenu', 777);
    expect(message.envoi).toBe(777);
  });
});

describe('estMessageSysteme', () => {
  it('true pour un message système, false pour un message texte', () => {
    expect(estMessageSysteme(creerMessageSysteme('m1', 'c1', 'x'))).toBe(true);
    expect(estMessageSysteme(creerMessage('m2', 'c1', 'u1', 'x'))).toBe(false);
  });
});

describe('trierMessagesParEnvoi', () => {
  it('trie du plus ancien au plus récent', () => {
    const m1 = creerMessage('1', 'c1', 'u1', 'b', 200);
    const m2 = creerMessage('2', 'c1', 'u1', 'a', 100);
    expect(trierMessagesParEnvoi([m1, m2]).map((m) => m.id)).toEqual([
      '2',
      '1',
    ]);
  });

  it("ne modifie pas le tableau d'origine (immuabilité)", () => {
    const m1 = creerMessage('1', 'c1', 'u1', 'b', 200);
    const m2 = creerMessage('2', 'c1', 'u1', 'a', 100);
    const original = [m1, m2];
    trierMessagesParEnvoi(original);
    expect(original.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('retourne un tableau vide pour une entrée vide', () => {
    expect(trierMessagesParEnvoi([])).toEqual([]);
  });
});

describe('paginerAvant', () => {
  const messages = Array.from({ length: 10 }, (_, i) =>
    creerMessage(String(i), 'c1', 'u1', `msg${i}`, i)
  );

  it('sans beforeId, pagine à partir des messages les plus récents', () => {
    const page = paginerAvant(messages, undefined, 3);
    expect(page.map((m) => m.id)).toEqual(['7', '8', '9']);
  });

  it('avec un beforeId existant, retourne les `pageSize` messages qui le précèdent', () => {
    const page = paginerAvant(messages, '7', 3);
    expect(page.map((m) => m.id)).toEqual(['4', '5', '6']);
  });

  it("n'inclut jamais le message `beforeId` lui-même dans le résultat", () => {
    const page = paginerAvant(messages, '7', 3);
    expect(page.map((m) => m.id)).not.toContain('7');
  });

  it('si beforeId ne correspond à aucun message, retombe sur la fin', () => {
    const page = paginerAvant(messages, 'inconnu', 3);
    expect(page.map((m) => m.id)).toEqual(['7', '8', '9']);
  });

  it('borne startIndex à 0 quand pageSize dépasse le nombre de messages restants', () => {
    const page = paginerAvant(messages, '2', 10);
    expect(page.map((m) => m.id)).toEqual(['0', '1']);
  });

  it('retourne un tableau vide pour une entrée vide', () => {
    expect(paginerAvant([], undefined, 5)).toEqual([]);
  });

  it('retourne un tableau vide si pageSize vaut 0', () => {
    expect(paginerAvant(messages, undefined, 0)).toEqual([]);
  });
});
