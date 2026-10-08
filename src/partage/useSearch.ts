import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeQuery, type SearchInput, type SearchPage, type SearchResult } from './search';

const DEFAULT_DEBOUNCE_MS = 350;

export type SearchStatus = 'idle' | 'tooShort' | 'loading' | 'ready' | 'empty' | 'error';

type Remote =
  | { key: string; status: 'ready'; results: SearchResult[]; nextCursor: string | null }
  | { key: string; status: 'error'; message: string };

function appendUnique(current: SearchResult[], page: SearchResult[]): SearchResult[] {
  const seen = new Set(current.map((r) => r.id));
  return [...current, ...page.filter((r) => !seen.has(r.id))];
}

/**
 * Recherche avec délai de frappe (hook commun au mobile et au Web : seule la dépendance `search` change) : une saisie plus récente annule la requête en vol et ignore sa
 * réponse. `conversationId` limite la recherche à la conversation affichée.
 */
export type SearchDependencies = {
  /** Appel de recherche de l'application (REST). */
  search: (input: SearchInput) => Promise<SearchPage>;
  /** Transforme une erreur en texte affichable (traduit par chaque application). */
  describeError: (error: unknown) => string;
  debounceMs?: number;
};

export function useSearchResults({ search, describeError, debounceMs = DEFAULT_DEBOUNCE_MS }: SearchDependencies, conversationId?: string) {
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const moreRequest = useRef(false);
  const moreController = useRef<AbortController | null>(null);
  // Les dépendances sont lues par référence : une fonction recréée à chaque rendu ne relance pas la recherche.
  const deps = useRef({ search, describeError });
  useEffect(() => {
    deps.current = { search, describeError };
  });

  const normalized = normalizeQuery(query);
  const key = `${conversationId ?? ''}|${normalized ?? ''}|${attempt}`;

  useEffect(() => {
    if (!normalized) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      deps.current.search({ q: normalized, conversationId, signal: controller.signal }).then(
        (page) => {
          if (!controller.signal.aborted) setRemote({ key, status: 'ready', results: page.results, nextCursor: page.nextCursor });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setRemote({ key, status: 'error', message: deps.current.describeError(error) });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
      moreController.current?.abort();
      moreRequest.current = false;
      setLoadingMore(false);
      setMoreError(null);
    };
  }, [normalized, conversationId, key, debounceMs]);

  const current = remote?.key === key ? remote : null;
  let status: SearchStatus;
  if (!normalized) status = query.trim() ? 'tooShort' : 'idle';
  else if (!current) status = 'loading';
  else if (current.status === 'error') status = 'error';
  else status = current.results.length ? 'ready' : 'empty';

  const results = current?.status === 'ready' ? current.results : [];
  const nextCursor = current?.status === 'ready' ? current.nextCursor : null;

  const loadMore = useCallback(async () => {
    if (!normalized || !current || current.status !== 'ready' || !current.nextCursor || moreRequest.current) return;
    moreRequest.current = true;
    setLoadingMore(true);
    setMoreError(null);
    // Annulé avec la recherche (nouvelle saisie, démontage) : la requête réseau est interrompue, pas seulement ignorée.
    const controller = new AbortController();
    moreController.current = controller;
    try {
      const page = await deps.current.search({ q: normalized, conversationId, cursor: current.nextCursor, signal: controller.signal });
      if (controller.signal.aborted) return;
      // Non annulée : la clé n'a pas changé et `moreRequest` exclut toute autre page en vol, `current` est donc à jour.
      setRemote({ ...current, results: appendUnique(current.results, page.results), nextCursor: page.nextCursor });
    } catch (error) {
      if (!controller.signal.aborted) setMoreError(deps.current.describeError(error));
    } finally {
      // Après annulation, le cleanup a déjà tout remis à zéro : ne pas toucher à une éventuelle requête plus récente.
      if (!controller.signal.aborted) {
        moreRequest.current = false;
        setLoadingMore(false);
      }
    }
  }, [normalized, conversationId, current]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    query,
    setQuery,
    status,
    /** Texte réellement recherché (sans espaces superflus), pour surligner les résultats. */
    term: normalized ?? '',
    results,
    hasMore: nextCursor !== null,
    errorMessage: current?.status === 'error' ? current.message : null,
    loadingMore,
    moreError,
    loadMore,
    retry,
  };
}
