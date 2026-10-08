/**
 * Types et règles de la recherche de messages, communs au client mobile et au client Web : aucune dépendance
 * à React Native, à Expo ni à l'application.
 */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

export type SearchResult = {
  id: string;
  /** `dm:<interlocuteur>` ou `room:<salon>`. */
  conversationId: string;
  kind: 'dm' | 'room';
  senderId: string;
  senderName?: string;
  /** Pseudo de l'interlocuteur (message privé) ou `#nom` du salon ; absent si le nom n'a pas pu être résolu. */
  conversationTitle?: string;
  /** Nom du serveur d'un salon ; absent pour un message privé ou si la liste des serveurs est indisponible. */
  serverName?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

/** Une page de résultats, triés du plus récent au plus ancien (ordre fourni par le serveur, jamais retrié par le client). */
export type SearchPage = { results: SearchResult[]; nextCursor: string | null };

export type SearchInput = {
  q: string;
  cursor?: string | null;
  /** Limite la recherche à une conversation (`dm:…` ou `room:…`) ; absent : toutes les conversations accessibles. */
  conversationId?: string;
  limit?: number;
  signal?: AbortSignal;
};

/**
 * Texte de recherche normalisé (espaces retirés), ou `null` s'il est trop court : aucune requête ne part alors.
 * Un texte de plus de `MAX_QUERY_LENGTH` caractères est tronqué sans signal : l'interface qui veut prévenir
 * l'utilisateur doit limiter elle-même la saisie (`maxLength`) ou comparer avec `text.trim().length`.
 */
export function normalizeQuery(text: string): string | null {
  const q = text.trim();
  return q.length >= MIN_QUERY_LENGTH ? q.slice(0, MAX_QUERY_LENGTH) : null;
}
