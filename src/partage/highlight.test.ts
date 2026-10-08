import { describe, expect, it } from 'vitest';

import { splitHighlight } from './highlight';

describe('splitHighlight', () => {
  it('marque chaque occurrence sans tenir compte de la casse', () => {
    expect(splitHighlight('Bonjour, bonjour le monde', 'BONJOUR')).toEqual([
      { text: 'Bonjour', match: true },
      { text: ', ', match: false },
      { text: 'bonjour', match: true },
      { text: ' le monde', match: false },
    ]);
  });

  it('cherche le terme littéralement', () => {
    expect(splitHighlight('50% de remise (a.b)', '%')).toEqual([
      { text: '50', match: false },
      { text: '%', match: true },
      { text: ' de remise (a.b)', match: false },
    ]);
    expect(splitHighlight('axb a.b', 'a.b')).toEqual([
      { text: 'axb ', match: false },
      { text: 'a.b', match: true },
    ]);
  });

  it('retourne le texte entier sans terme ou sans occurrence', () => {
    expect(splitHighlight('texte', '  ')).toEqual([{ text: 'texte', match: false }]);
    expect(splitHighlight('texte', 'zz')).toEqual([{ text: 'texte', match: false }]);
    expect(splitHighlight('', 'a')).toEqual([{ text: '', match: false }]);
  });

  it('ne surligne pas quand la casse change la longueur du texte', () => {
    expect(splitHighlight('İstanbul', 'i')).toEqual([{ text: 'İstanbul', match: false }]);
  });
});
