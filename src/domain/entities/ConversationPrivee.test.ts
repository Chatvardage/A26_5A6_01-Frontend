import { describe, expect, it } from 'vitest';
import {
  creerConversationPrivee,
  creerDmId,
  trouverAutreParticipant,
} from './ConversationPrivee';

describe('creerDmId', () => {
  it("génère le même id peu importe l'ordre des deux utilisateurs", () => {
    expect(creerDmId('u1', 'u2')).toBe(creerDmId('u2', 'u1'));
  });

  it('joint les deux ids triés avec un séparateur ":"', () => {
    expect(creerDmId('b', 'a')).toBe('a:b');
  });
});

describe('creerConversationPrivee', () => {
  it("crée une conversation de type 'privee' avec les deux participants dans l'ordre donné", () => {
    const conv = creerConversationPrivee('u1', 'u2');
    expect(conv.type).toBe('privee');
    expect(conv.participantIds).toEqual(['u1', 'u2']);
    expect(conv.id).toBe(creerDmId('u1', 'u2'));
    expect(typeof conv.creation).toBe('number');
  });
});

describe('trouverAutreParticipant', () => {
  it("retourne l'autre participant, peu importe lequel des deux on passe", () => {
    const conv = creerConversationPrivee('u1', 'u2');
    expect(trouverAutreParticipant(conv, 'u1')).toBe('u2');
    expect(trouverAutreParticipant(conv, 'u2')).toBe('u1');
  });

  it("retourne undefined si l'id donné ne fait pas partie de la conversation", () => {
    const conv = creerConversationPrivee('u1', 'u2');
    expect(trouverAutreParticipant(conv, 'u3')).toBeUndefined();
  });
});
