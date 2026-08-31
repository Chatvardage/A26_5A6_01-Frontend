import type { ConversationId } from './Conversation.ts';

/**
 * Représente la visibilité d'un salon de discussion (channel).
 * Un salon peut être soit public (accessible à tous), soit privé (accessible uniquement aux membres).
 */
export type Visibilite = 'public' | 'prive';

/**
 * Représente un salon de discussion (channel) dans le système.
 * Un salon a un identifiant unique, un nom, une visibilité (public ou privé),
 * un hôte (propriétaire) et une liste de membres.
 */
export interface Salon {
  readonly type: 'salon';
  readonly id: ConversationId;
  readonly nom: string;
  readonly visibilite: Visibilite;
  readonly hoteId: string;
  readonly membreIds: readonly string[];
  readonly membresInvites: readonly string[];
}

/**
 * Crée un nouveau salon de discussion (channel) avec les informations fournies.
 *
 * @param id Identifiant unique du salon
 * @param nom Nom du salon
 * @param hoteId Identifiant de l'hôte (propriétaire) du salon
 * @param visibilite Visibilité du salon ('public' ou 'prive')
 * @param membreIds Liste des identifiants des membres du salon (optionnel, par défaut contient uniquement l'hôte)
 *
 * @returns Un objet Salon représentant le salon créé
 */
export function creerSalon(
  id: ConversationId,
  nom: string,
  hoteId: string,
  visibilite: Visibilite = 'public',
  membreIds: readonly string[] = [hoteId]
): Salon {
  return {
    type: 'salon',
    id,
    nom,
    visibilite,
    hoteId,
    membreIds: membreIds.includes(hoteId) ? membreIds : [...membreIds, hoteId],
    membresInvites: [],
  };
}

/**
 * Vérifie si un utilisateur est membre d'un salon donné.
 *
 * @param salon Le salon à vérifier
 * @param utilisateurId L'identifiant de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est membre du salon, false sinon
 */
export function estMembre(salon: Salon, utilisateurId: string): boolean {
  return salon.membreIds.includes(utilisateurId);
}

/**
 * Vérifie si un utilisateur est invité à rejoindre un salon donné.
 *
 * @param salon Le salon à vérifier
 * @param utilisateurId L'identifiant de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est invité à rejoindre le salon, false sinon
 */
export function estInvite(salon: Salon, utilisateurId: string): boolean {
  return salon.membresInvites.includes(utilisateurId);
}

/**
 * Vérifie si un utilisateur est l'hôte (propriétaire) d'un salon donné.
 *
 * @param salon Le salon à vérifier
 * @param utilisateurId L'identifiant de l'utilisateur à vérifier
 *
 * @returns true si l'utilisateur est l'hôte du salon, false sinon
 */
export function estHote(salon: Salon, utilisateurId: string): boolean {
  return salon.hoteId === utilisateurId;
}

/**
 * Invite un utilisateur à rejoindre un salon donné.
 * Si l'utilisateur est déjà membre du salon, l'invitation n'est pas ajoutée.
 *
 * @param salon Le salon auquel l'utilisateur est invité
 * @param utilisateurId L'identifiant de l'utilisateur à inviter
 *
 * @returns un nouveau Salon avec l'invitation ajoutée, ou le même salon si déjà membre/invité.
 */
export function inviterMembre(salon: Salon, utilisateurId: string): Salon {
  if (estMembre(salon, utilisateurId) || estInvite(salon, utilisateurId))
    return salon;
  return { ...salon, membresInvites: [...salon.membresInvites, utilisateurId] };
}

/**
 * Permet à un utilisateur de rejoindre un salon donné.
 * Si l'utilisateur est déjà membre du salon, il ne peut pas rejoindre à nouveau.
 * Si le salon est privé et que l'utilisateur n'est pas invité, il ne peut pas rejoindre.
 *
 * @param salon Le salon que l'utilisateur souhaite rejoindre
 * @param utilisateurId L'identifiant de l'utilisateur qui souhaite rejoindre le salon
 *
 * @returns le nouveau Salon si l'utilisateur peut rejoindre, `undefined` sinon (déjà membre,
 * ou salon privé sans invitation).
 */
export function rejoindreSalon(
  salon: Salon,
  utilisateurId: string
): Salon | undefined {
  if (estMembre(salon, utilisateurId)) return undefined;
  const invite = estInvite(salon, utilisateurId);
  if (salon.visibilite === 'prive' && !invite) return undefined;
  return {
    ...salon,
    membreIds: [...salon.membreIds, utilisateurId],
    membresInvites: invite
      ? salon.membresInvites.filter((id) => id !== utilisateurId)
      : salon.membresInvites,
  };
}

/**
 * Permet à un utilisateur de quitter un salon donné.
 * Si l'utilisateur n'est pas membre du salon, il ne peut pas quitter.
 * Si l'utilisateur est l'hôte du salon, il ne peut pas quitter le salon.
 *
 * @param salon Le salon que l'utilisateur souhaite quitter
 * @param utilisateurId L'identifiant de l'utilisateur qui souhaite quitter le salon
 *
 * @returns nouveau Salon si l'utilisateur peut quitter, `undefined` sinon (pas membre ou hôte du salon).
 */
export function quitterSalon(
  salon: Salon,
  utilisateurId: string
): Salon | undefined {
  if (!estMembre(salon, utilisateurId)) return undefined;
  if (estHote(salon, utilisateurId)) return undefined;
  return {
    ...salon,
    membreIds: salon.membreIds.filter((id) => id !== utilisateurId),
  };
}

/**
 * Permet à l'hôte d'un salon de changer le nom du salon.
 *
 * @param salon Le salon dont le nom doit être changé
 * @param nouveauNom Le nouveau nom du salon
 * @param utilisateurId L'identifiant de l'utilisateur qui souhaite changer le nom du salon
 *
 * @return le nouveau Salon avec le nom changé si l'utilisateur est l'hôte, `undefined` sinon.
 */
export function changerNomSalon(
  salon: Salon,
  nouveauNom: string,
  utilisateurId: string
): Salon | undefined {
  if (!estHote(salon, utilisateurId)) return undefined;
  return { ...salon, nom: nouveauNom };
}

/**
 * Permet à l'hôte d'un salon de changer la visibilité du salon.
 *
 * @param salon Le salon dont la visibilité doit être changée
 * @param nouvelleVisibilite La nouvelle visibilité du salon ('public' ou 'prive')
 * @param utilisateurId L'identifiant de l'utilisateur qui souhaite changer la visibilité du salon
 *
 * @return le nouveau Salon avec la visibilité changée si l'utilisateur est l'hôte, `undefined` sinon.
 */
export function changerVisibiliteSalon(
  salon: Salon,
  nouvelleVisibilite: Visibilite,
  utilisateurId: string
): Salon | undefined {
  if (!estHote(salon, utilisateurId)) return undefined;
  return { ...salon, visibilite: nouvelleVisibilite };
}
