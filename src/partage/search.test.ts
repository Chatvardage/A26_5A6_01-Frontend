import { describe, expect, it } from 'vitest';

import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, normalizeQuery } from './search';

describe('normalizeQuery', () => {
  it('retire les espaces et refuse un texte trop court', () => {
    expect(normalizeQuery('  ab  ')).toBe('ab');
    expect(normalizeQuery(' a ')).toBeNull();
    expect(normalizeQuery('')).toBeNull();
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(normalizeQuery('x'.repeat(150))).toHaveLength(MAX_QUERY_LENGTH);
  });
});
