/**
 * État de la connexion de l'application au serveur. Il peut être l'un des trois états suivants :
 * 'connecte' : l'utilisateur est actuellement connecté.
 * 'deconnecte' : l'utilisateur n'est pas connecté.
 * 'reconnexion' : l'utilisateur est en train de se reconnecter après une déconnexion.
 */
export type Etat = 'connecte' | 'deconnecte' | 'reconnexion';

/**
 * Représente l'état de la connexion  de l'application au serveur.
 * Contient le statut de la connexion, le timestamp depuis lequel l'état est actif, et éventuellement le nombre de
 * reconnexions.
 */
/**
 * Raison pour laquelle la connexion n'est pas établie :
 * 'hors-ligne' : le système d'exploitation n'a pas de réseau (aucune tentative n'est faite).
 * 'serveur-injoignable' : le réseau est là, mais le serveur ne répond pas (tentatives avec délai croissant).
 */
export type CauseDeconnexion = 'hors-ligne' | 'serveur-injoignable';

export interface EtatConnexion {
  readonly statut: Etat;
  readonly depuis: number;
  readonly reconnexions?: number;
  /** Absente quand statut === 'connecte'. */
  readonly cause?: CauseDeconnexion;
  /** Timestamp (epoch ms) de la prochaine tentative planifiée, si une est planifiée. */
  readonly prochaineTentative?: number;
}

/**
 * Crée un nouvel objet EtatConnexion pour un utilisateur donné.
 *
 * @param statut Le statut de la connexion ('connecte', 'deconnecte' ou 'reconnexion')
 * @param depuis Le timestamp actuel en millisecondes (epoch ms) représentant le moment de la création de l'état de
 * connexion. Par défaut, il est défini à l'heure actuelle.
 * @param reconnexions Le nombre de reconnexions effectuées par l'utilisateur (optionnel)
 *
 * @returns Un objet EtatConnexion représentant l'état de la connexion de l'utilisateur
 */
export function creerEtatConnexion(
  statut: Etat,
  depuis: number = Date.now(),
  reconnexions?: number
): EtatConnexion {
  return {
    statut: statut,
    depuis: depuis,
    reconnexions: reconnexions,
  };
}

/**
 * Vérifie si un utilisateur est actuellement connecté en fonction de son état de connexion.
 *
 * @param etat L'objet EtatConnexion de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est connecté, false sinon
 */
export function estConnecte(etat: EtatConnexion): boolean {
  return etat.statut === 'connecte';
}

/**
 * Vérifie si un utilisateur est actuellement déconnecté en fonction de son état de connexion.
 *
 * @param etat L'objet EtatConnexion de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est déconnecté, false sinon
 */
export function estDeconnecte(etat: EtatConnexion): boolean {
  return etat.statut === 'deconnecte';
}

/**
 * Vérifie si un utilisateur est actuellement en train de se reconnecter en fonction de son état de connexion.
 *
 * @param etat L'objet EtatConnexion de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est en train de se reconnecter, false sinon
 */
export function estEnReconnexion(etat: EtatConnexion): boolean {
  return etat.statut === 'reconnexion';
}

/**
 * Nombre de secondes (arrondi au supérieur, jamais négatif) avant la prochaine tentative de reconnexion, ou null si
 * aucune tentative n'est planifiée.
 *
 * @param etat L'état de connexion
 * @param maintenant Le timestamp courant (epoch ms), par défaut Date.now()
 */
export function secondesAvantTentative(
  etat: EtatConnexion,
  maintenant: number = Date.now()
): number | null {
  if (etat.prochaineTentative === undefined) return null;
  return Math.max(0, Math.ceil((etat.prochaineTentative - maintenant) / 1000));
}
