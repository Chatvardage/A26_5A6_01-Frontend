/**
 * Statut d'un utilisateur dans le système.
 * 'en-ligne' : l'utilisateur est actuellement connecté et actif.
 * 'hors-ligne' : l'utilisateur n'est pas connecté ou n'est pas actif.
 */
export type Statut = 'en-ligne' | 'hors-ligne';

/**
 * Représente la présence d'un utilisateur dans le système.
 * Contient l'identifiant de l'utilisateur, son statut et le timestamp de sa dernière activité.
 */
export interface Presence {
  readonly utilisateurId: string;
  readonly statut: Statut;
  readonly vuLaDerniereFois: number;
}

/**
 * Crée un nouvel objet Presence pour un utilisateur donné.
 *
 * @param utilisateurId L'identifiant unique de l'utilisateur
 * @param statut Le statut de l'utilisateur ('en-ligne' ou 'hors-ligne')
 * @param maintenant Le timestamp actuel en millisecondes (epoch ms) représentant le moment de la création de la présence.
 * Par défaut, il est défini à l'heure actuelle.
 *
 * @returns Un objet Presence représentant la présence de l'utilisateur
 */
export function creerPresence(
  utilisateurId: string,
  statut: Statut,
  maintenant: number = Date.now()
): Presence {
  return {
    utilisateurId: utilisateurId,
    statut: statut,
    vuLaDerniereFois: maintenant,
  };
}

/**
 * Vérifie si un utilisateur est en ligne en fonction de son objet Presence.
 *
 * @param presence L'objet Presence de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est en ligne, false sinon
 */
export function estEnLigne(presence: Presence): boolean {
  return presence.statut === 'en-ligne';
}
