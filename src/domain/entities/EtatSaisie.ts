/**
 * EtatSaise represente l'état de saisie d'un utilisateur dans une conversation.
 * Il contient l'identifiant de la conversation, l'identifiant de l'utilisateur, un booléen indiquant si l'utilisateur
 * est en train d'écrire, et un timestamp de la dernière actualisation de cet état.
 */
export interface EtatSaisie {
  readonly idConversation: string;
  readonly idUtilisateur: string;
  readonly enTrainDEcrire: boolean;
  readonly actualisation: number;
}

/**
 * Délai d'expiration de l'état de saisie en millisecondes.
 * Si l'état de saisie n'est pas actualisé dans ce délai, il est considéré comme expiré.
 */
export const DELAI_EXPIRATION_MS = 4000;

/**
 * Crée un nouvel objet EtatSaisie pour un utilisateur donné dans une conversation.
 *
 * @param idConversation L'identifiant unique de la conversation
 * @param idUtilisateur L'identifiant unique de l'utilisateur
 * @param enTrainDEcrire Un booléen indiquant si l'utilisateur est en train d'écrire
 * @param actualisation Le timestamp actuel en millisecondes (epoch ms) représentant le moment de la création de l'état
 * de saisie. Par défaut, il est défini à l'heure actuelle.
 *
 * @returns Un objet EtatSaisie représentant l'état de saisie de l'utilisateur dans la conversation
 */
export function creerEtatSaisie(
  idConversation: string,
  idUtilisateur: string,
  enTrainDEcrire: boolean,
  actualisation: number = Date.now()
): EtatSaisie {
  return {
    idConversation: idConversation,
    idUtilisateur: idUtilisateur,
    enTrainDEcrire: enTrainDEcrire,
    actualisation: actualisation,
  };
}

/**
 * Vérifie si l'état de saisie d'un utilisateur a expiré en fonction du délai d'expiration défini.
 *
 * @param etat L'objet EtatSaisie de l'utilisateur à vérifier
 * @param maintenant Le timestamp actuel en millisecondes (epoch ms) représentant le moment de la vérification. Par
 * défaut, il est défini à l'heure actuelle.
 *
 * @returns true si l'état de saisie a expiré, false sinon
 */
export function etatDEcritureExpire(
  etat: EtatSaisie,
  maintenant: number = Date.now()
): boolean {
  return maintenant - etat.actualisation > DELAI_EXPIRATION_MS;
}

/**
 * Vérifie si un utilisateur est activement en train d'écrire dans une conversation en fonction de son état de saisie.
 * Un utilisateur est considéré comme activement en train d'écrire si son état de saisie indique qu'il est en train
 * d'écrire et que cet état n'a pas expiré.
 *
 * @param etat L'objet EtatSaisie de l'utilisateur à vérifier
 * @param maintenant Le timestamp actuel en millisecondes (epoch ms) représentant le moment de la vérification. Par
 * défaut, il est défini à l'heure actuelle.
 *
 * @returns true si l'utilisateur est activement en train d'écrire, false sinon
 */
export function estActivementEnTrainDEcrire(
  etat: EtatSaisie,
  maintenant: number = Date.now()
): boolean {
  return etat.enTrainDEcrire && !etatDEcritureExpire(etat, maintenant);
}

/**
 * Retourne les idUtilisateur actuellement en train d'écrire dans une conversation donnée.
 *
 * @param etats liste des états de saisie à filtrer
 * @param idConversation identifiant de la conversation pour laquelle on veut savoir qui est en train d'écrire
 * @param maintenant timestamp actuel en millisecondes (epoch ms) représentant le moment de la vérification. Par
 * défaut, il est défini à l'heure actuelle.
 * @param exclureUtilisateurId à passer pour ne jamais afficher l'utilisateur courant à lui-même.
 *
 * @returns liste des idUtilisateur actuellement en train d'écrire dans la conversation donnée
 */
export function utilisateursEnTrainDecrire(
  etats: readonly EtatSaisie[],
  idConversation: string,
  maintenant: number = Date.now(),
  exclureUtilisateurId?: string
): string[] {
  return etats
    .filter((etat) => etat.idConversation === idConversation)
    .filter((etat) => etat.idUtilisateur !== exclureUtilisateurId)
    .filter((etat) => estActivementEnTrainDEcrire(etat, maintenant))
    .map((etat) => etat.idUtilisateur);
}
