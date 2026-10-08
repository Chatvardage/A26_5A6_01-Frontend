import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Noyau du chargement d'une liste : aucune dépendance à React Native, à Expo ni à l'application (seulement
 * `react`). Le même fichier sert donc tel quel au client Web React ; seule la fonction qui transforme une
 * erreur en texte (`describeError`) est fournie par chaque application.
 */
export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; data: T };

type Settled<T> = Exclude<LoadState<T>, { status: 'loading' }>;
const LOADING = { status: 'loading' } as const;

/**
 * États : `loading` (première réponse attendue), `error` (raison + `retry`), `empty` (requête réussie sans
 * élément), `ready` (données). Un rafraîchissement garde la liste visible (`refreshing`) ; s'il échoue, la liste
 * reste affichée et `refreshError` porte la raison, avec `refresh` pour réessayer.
 * `load` doit être stable (useCallback) : un changement relance le chargement.
 */
export function useAsyncResource<T>(
  load: () => Promise<T>,
  isEmpty: (data: T) => boolean,
  describeError: (error: unknown) => string,
) {
  // Résultat de la dernière requête, lié au `load` qui l'a produit : un autre `load` redonne l'état « loading ».
  const [remote, setRemote] = useState<{ load: () => Promise<T>; state: Settled<T> } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestId = useRef(0);
  const isEmptyRef = useRef(isEmpty);
  const describeRef = useRef(describeError);
  useEffect(() => {
    isEmptyRef.current = isEmpty;
    describeRef.current = describeError;
  });

  const state: LoadState<T> = remote && remote.load === load ? remote.state : LOADING;

  const settle = useCallback(
    (data: T) => setRemote({ load, state: isEmptyRef.current(data) ? { status: 'empty' } : { status: 'ready', data } }),
    [load],
  );

  // Chargement initial ou réessai : l'état « loading » vient de la dérivation ci-dessus, aucun setState synchrone.
  const loadInto = useCallback(
    async (id: number, isCancelled: () => boolean = () => false) => {
      try {
        const data = await load();
        if (id !== requestId.current || isCancelled()) return;
        settle(data);
      } catch (error) {
        if (id !== requestId.current || isCancelled()) return;
        setRemote({ load, state: { status: 'error', message: describeRef.current(error) } });
      } finally {
        if (id === requestId.current) setRefreshing(false);
      }
    },
    [load, settle],
  );

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    void loadInto(id, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadInto]);

  const retry = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshError(null);
    setRemote(null);
    await loadInto(id);
  }, [loadInto]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshError(null);
    setRefreshing(true);
    try {
      settle(await load());
    } catch (error) {
      if (id !== requestId.current) return;
      const message = describeRef.current(error);
      // Un échec de rafraîchissement ne vide pas ce qui est déjà affiché : on garde la liste et on signale la raison.
      setRemote((prev) =>
        prev && prev.load === load && prev.state.status === 'ready' ? prev : { load, state: { status: 'error', message } },
      );
      setRefreshError(message);
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [load, settle]);

  return { state, refreshing, refreshError, retry, refresh };
}
