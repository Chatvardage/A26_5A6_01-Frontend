import { describe, expect, it } from 'vitest';

import { groupResults } from './groupResults';
import type { SearchResult } from './search';

const result = (id: string, kind: 'dm' | 'room', serverName?: string): SearchResult => ({
  id,
  conversationId: `${kind}:x`,
  kind,
  senderId: 'u',
  content: id,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  serverName,
});

describe('groupResults', () => {
  it('place les messages privés en premier puis un groupe par serveur, ordre conservé', () => {
    const groups = groupResults([
      result('a', 'room', 'Chatvardage'),
      result('b', 'dm'),
      result('c', 'room', 'Équipe'),
      result('d', 'room', 'Chatvardage'),
      result('e', 'dm'),
      result('f', 'room'),
    ]);
    expect(groups.map((g) => [g.key, g.kind, g.title, g.data.map((r) => r.id)])).toEqual([
      ['dm', 'dm', undefined, ['b', 'e']],
      ['server:Chatvardage', 'server', 'Chatvardage', ['a', 'd']],
      ['server:Équipe', 'server', 'Équipe', ['c']],
      ['channels', 'channels', undefined, ['f']],
    ]);
  });

  it("n'inclut pas de groupe vide", () => {
    expect(groupResults([])).toEqual([]);
    expect(groupResults([result('a', 'room', 'S')]).map((g) => g.kind)).toEqual(['server']);
  });
});
