import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchInput, SearchPage, SearchResult } from './search';
import { useSearchResults } from './useSearch';

const describeError = (error: unknown) => `raison : ${(error as Error).message}`;
const search = vi.fn<(input: SearchInput) => Promise<SearchPage>>();

const result = (id: string): SearchResult => ({
  id,
  conversationId: 'room:33333333-3333-4333-8333-333333333333',
  kind: 'room',
  senderId: 'u',
  content: `texte ${id}`,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
});

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset();
});
afterEach(() => vi.useRealTimers());

const setup = (conversationId?: string) => renderHook(() => useSearchResults({ search, describeError }, conversationId));
type Hook = ReturnType<typeof setup>;
const type = (hook: Hook, text: string) => act(async () => hook.result.current.setQuery(text));
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(400)));

describe('useSearchResults', () => {
  it('reste inactif sans saisie, puis signale un texte trop court sans requête', async () => {
    const hook = setup();
    expect(hook.result.current.status).toBe('idle');
    await type(hook, ' a ');
    await settle();
    expect(hook.result.current.status).toBe('tooShort');
    expect(search).not.toHaveBeenCalled();
  });

  it('attend la fin de la frappe, puis affiche les résultats', async () => {
    search.mockResolvedValue({ results: [result('a'), result('b')], nextCursor: 'c1' });
    const hook = setup();
    await type(hook, 'bo');
    expect(hook.result.current.status).toBe('loading');
    await type(hook, 'bon');
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(search).not.toHaveBeenCalled();
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: 'bon', conversationId: undefined }));
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.term).toBe('bon');
    expect(hook.result.current.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(hook.result.current.hasMore).toBe(true);
  });

  it('signale un résultat vide, puis revient à « inactif » en effaçant', async () => {
    search.mockResolvedValue({ results: [], nextCursor: null });
    const hook = setup();
    await type(hook, 'rien');
    await settle();
    expect(hook.result.current.status).toBe('empty');
    expect(hook.result.current.hasMore).toBe(false);
    expect(hook.result.current.results).toEqual([]);
    await type(hook, '');
    expect(hook.result.current.status).toBe('idle');
  });

  it('limite la recherche à la conversation donnée', async () => {
    search.mockResolvedValue({ results: [result('a')], nextCursor: null });
    const hook = setup('dm:22222222-2222-4222-8222-222222222222');
    await type(hook, 'bonjour');
    await settle();
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'dm:22222222-2222-4222-8222-222222222222' }));
  });

  it("affiche la raison fournie par l'application et permet de réessayer", async () => {
    search.mockRejectedValueOnce(new Error('web hors service'));
    search.mockResolvedValueOnce({ results: [result('a')], nextCursor: null });
    const hook = setup();
    await type(hook, 'bonjour');
    await settle();
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.errorMessage).toBe('raison : web hors service');
    await act(async () => hook.result.current.retry());
    expect(hook.result.current.status).toBe('loading');
    await settle();
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.errorMessage).toBeNull();
  });

  it("ignore la réponse d'une requête annulée par une saisie plus récente", async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    search.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)));
    search.mockResolvedValueOnce({ results: [result('b')], nextCursor: null });
    const hook = setup();
    await type(hook, 'premier');
    await settle();
    await type(hook, 'second');
    await settle();
    await act(async () => rejectFirst(new Error('aborted')));
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.results.map((r) => r.id)).toEqual(['b']);
  });

  it("ignore aussi la réponse réussie d'une requête annulée par une saisie plus récente", async () => {
    let resolveFirst: (page: SearchPage) => void = () => undefined;
    search.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    search.mockResolvedValueOnce({ results: [result('b')], nextCursor: null });
    const hook = setup();
    await type(hook, 'premier');
    await settle();
    await type(hook, 'second');
    await settle();
    await act(async () => resolveFirst({ results: [result('périmé')], nextCursor: null }));
    expect(hook.result.current.results.map((r) => r.id)).toEqual(['b']);
  });

  it('utilise le délai de frappe choisi même si les fonctions sont recréées à chaque rendu', async () => {
    const calls: string[] = [];
    const hook = renderHook(() =>
      useSearchResults({
        search: async ({ q }) => {
          calls.push(q);
          throw new Error('web hors service');
        },
        describeError: (error) => `Web : ${(error as Error).message}`,
        debounceMs: 50,
      }),
    );
    await act(async () => hook.result.current.setQuery('bonjour'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
    expect(calls).toEqual([]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(60)));
    expect(calls).toEqual(['bonjour']);
    expect(hook.result.current.errorMessage).toBe('Web : web hors service');
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(calls).toEqual(['bonjour']);
  });
});

describe('useSearchResults : pagination', () => {
  const start = async () => {
    search.mockResolvedValueOnce({ results: [result('a'), result('b')], nextCursor: 'c1' });
    const hook = setup();
    await type(hook, 'bonjour');
    await settle();
    return hook;
  };

  it("charge la page suivante sans doublon et s'arrête à la fin", async () => {
    const hook = await start();
    search.mockResolvedValueOnce({ results: [result('b'), result('c')], nextCursor: null });
    await act(async () => hook.result.current.loadMore());
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'bonjour', cursor: 'c1' }));
    expect(hook.result.current.results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(hook.result.current.hasMore).toBe(false);
    await act(async () => hook.result.current.loadMore());
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('ne lance pas deux chargements simultanés', async () => {
    const hook = await start();
    let resolve: (page: SearchPage) => void = () => undefined;
    search.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await act(async () => {
      void hook.result.current.loadMore();
      void hook.result.current.loadMore();
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(hook.result.current.loadingMore).toBe(true);
    await act(async () => resolve({ results: [result('z')], nextCursor: null }));
    expect(hook.result.current.loadingMore).toBe(false);
  });

  it('garde les résultats affichés quand la page suivante échoue, puis permet de réessayer', async () => {
    const hook = await start();
    search.mockRejectedValueOnce(new Error('réseau'));
    await act(async () => hook.result.current.loadMore());
    expect(hook.result.current.moreError).toBe('raison : réseau');
    expect(hook.result.current.results).toHaveLength(2);
    search.mockResolvedValueOnce({ results: [result('c')], nextCursor: null });
    await act(async () => hook.result.current.loadMore());
    expect(hook.result.current.moreError).toBeNull();
    expect(hook.result.current.results).toHaveLength(3);
  });

  it('ne fait rien sans page suivante ni résultats', async () => {
    search.mockResolvedValueOnce({ results: [result('a')], nextCursor: null });
    const hook = setup();
    await act(async () => hook.result.current.loadMore());
    await type(hook, 'bonjour');
    await settle();
    await act(async () => hook.result.current.loadMore());
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('abandonne une page tardive quand la recherche a changé', async () => {
    const hook = await start();
    let resolve: (page: SearchPage) => void = () => undefined;
    search.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await act(async () => void hook.result.current.loadMore());
    search.mockResolvedValueOnce({ results: [result('n')], nextCursor: null });
    await type(hook, 'autre');
    await settle();
    await act(async () => resolve({ results: [result('tard')], nextCursor: null }));
    expect(hook.result.current.results.map((r) => r.id)).toEqual(['n']);
  });
});
