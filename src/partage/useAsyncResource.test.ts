import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAsyncResource } from './useAsyncResource';

// Le noyau est indépendant de l'application : la raison d'une erreur est fournie par l'appelant.
const describeError = (error: unknown) => `raison : ${(error as Error).message}`;
const isEmpty = (list: string[]) => list.length === 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

describe('useAsyncResource : les cinq états', () => {
  it('1. chargement tant que la première réponse n’est pas arrivée', async () => {
    const first = deferred<string[]>();
    const load = () => first.promise;
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    expect(result.current.state).toEqual({ status: 'loading' });
    expect(result.current.refreshing).toBe(false);
    await act(async () => first.resolve(['a']));
    expect(result.current.state).toEqual({ status: 'ready', data: ['a'] });
  });

  it('2. erreur avec une raison utile, puis réessai qui repasse par le chargement', async () => {
    const second = deferred<string[]>();
    const load = vi.fn().mockRejectedValueOnce(new Error('serveur indisponible')).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', message: 'raison : serveur indisponible' }),
    );
    expect(result.current.refreshError).toBeNull();
    let retried!: Promise<void>;
    await act(async () => {
      retried = result.current.retry();
    });
    expect(result.current.state).toEqual({ status: 'loading' });
    await act(async () => {
      second.resolve(['a']);
      await retried;
    });
    expect(result.current.state).toEqual({ status: 'ready', data: ['a'] });
  });

  it('3. vide quand la requête réussit sans élément', async () => {
    const load = async () => [];
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }));
  });

  it('4. succès avec les données', async () => {
    const load = async () => ['a', 'b'];
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: ['a', 'b'] }));
  });

  it('5. rafraîchissement : la liste reste visible pendant la mise à jour puis se met à jour', async () => {
    const second = deferred<string[]>();
    const load = vi.fn().mockResolvedValueOnce(['a']).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    let refreshed!: Promise<void>;
    await act(async () => {
      refreshed = result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);
    expect(result.current.state).toEqual({ status: 'ready', data: ['a'] });
    await act(async () => {
      second.resolve(['a', 'b']);
      await refreshed;
    });
    expect(result.current.refreshing).toBe(false);
    expect(result.current.state).toEqual({ status: 'ready', data: ['a', 'b'] });
  });
});

describe('useAsyncResource : échec d’un rafraîchissement', () => {
  it('garde la liste, donne la raison et permet de réessayer', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(['a'])
      .mockRejectedValueOnce(new Error('réseau coupé'))
      .mockResolvedValueOnce(['a', 'b']);
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => result.current.refresh());
    expect(result.current.state).toEqual({ status: 'ready', data: ['a'] });
    expect(result.current.refreshError).toBe('raison : réseau coupé');
    expect(result.current.refreshing).toBe(false);
    await act(async () => result.current.refresh());
    expect(result.current.refreshError).toBeNull();
    expect(result.current.state).toEqual({ status: 'ready', data: ['a', 'b'] });
  });

  it('passe en erreur si le rafraîchissement échoue alors que la liste était vide', async () => {
    const load = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() => expect(result.current.state.status).toBe('empty'));
    await act(async () => result.current.refresh());
    expect(result.current.state).toEqual({ status: 'error', message: 'raison : 503' });
  });

  it('ignore la réponse d’une requête remplacée par une plus récente', async () => {
    const slow = deferred<string[]>();
    const load = vi.fn().mockResolvedValueOnce(['a']).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(['fresh']);
    const { result } = renderHook(() => useAsyncResource(load, isEmpty, describeError));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => void result.current.refresh());
    await act(async () => result.current.refresh());
    await act(async () => slow.reject(new Error('trop tard')));
    expect(result.current.state).toEqual({ status: 'ready', data: ['fresh'] });
    expect(result.current.refreshError).toBeNull();
  });

  it('relance le chargement quand `load` change', async () => {
    const { result, rerender } = renderHook(
      ({ load }: { load: () => Promise<string[]> }) => useAsyncResource(load, isEmpty, describeError),
      { initialProps: { load: async () => ['a'] } },
    );
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: ['a'] }));
    rerender({ load: async () => ['b'] });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: ['b'] }));
  });

  it('ignore une réponse (succès ou échec) arrivée après le démontage', async () => {
    const ok = deferred<string[]>();
    const ko = deferred<string[]>();
    const first = renderHook(() => useAsyncResource(() => ok.promise, isEmpty, describeError));
    const second = renderHook(() => useAsyncResource(() => ko.promise, isEmpty, describeError));
    first.unmount();
    second.unmount();
    await act(async () => {
      ok.resolve(['a']);
      ko.reject(new Error('trop tard'));
    });
    expect(first.result.current.state).toEqual({ status: 'loading' });
    expect(second.result.current.state).toEqual({ status: 'loading' });
  });

  it('ignore la réponse (succès ou échec) d’un ancien `load` remplacé par un nouveau', async () => {
    const slowOk = deferred<string[]>();
    const slowKo = deferred<string[]>();
    const fresh = async () => ['fresh'];
    const { result, rerender } = renderHook(
      ({ load }: { load: () => Promise<string[]> }) => useAsyncResource(load, isEmpty, describeError),
      { initialProps: { load: () => slowOk.promise } },
    );
    rerender({ load: fresh });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: ['fresh'] }));
    await act(async () => slowOk.resolve(['ancien']));
    expect(result.current.state).toEqual({ status: 'ready', data: ['fresh'] });
    const other = renderHook(
      ({ load }: { load: () => Promise<string[]> }) => useAsyncResource(load, isEmpty, describeError),
      { initialProps: { load: () => slowKo.promise } },
    );
    other.rerender({ load: fresh });
    await waitFor(() => expect(other.result.current.state).toEqual({ status: 'ready', data: ['fresh'] }));
    await act(async () => slowKo.reject(new Error('ancien échec')));
    expect(other.result.current.state).toEqual({ status: 'ready', data: ['fresh'] });
  });
});
