/**
 * Rôle effectif d'un utilisateur dans un serveur, du plus fort au plus
 * faible, tel que calculé par Room-Service (`monRole`) :
 * - `admin` : administrateur global de Chatvardage, droits partout ;
 * - `proprietaire` : créateur du serveur ;
 * - `moderateur` / `membre` : rôle attribué dans ce serveur.
 * `null` : pas membre (simple aperçu d'un serveur public).
 *
 * Mêmes règles que `src/servers/permissions.ts` de Room-Service, qui fait
 * foi : ces fonctions ne servent qu'à masquer les actions indisponibles
 * dans l'interface. Dupliquées dans chat-ui-shared.js (script classique,
 * sans import possible — même raison que creerDmId).
 */
export type RoleServeur = 'admin' | 'proprietaire' | 'moderateur' | 'membre';

const RANG: Record<RoleServeur, number> = {
  membre: 1,
  moderateur: 2,
  proprietaire: 3,
  admin: 4,
};

export function rangRole(role: RoleServeur | null | undefined): number {
  return role ? RANG[role] : 0;
}

/** Créer / modifier / supprimer des salons, expulser, voir les invitations. */
export function peutModererServeur(
  role: RoleServeur | null | undefined
): boolean {
  return rangRole(role) >= RANG.moderateur;
}

/** Renommer, rendre public/privé, supprimer le serveur, nommer des modérateurs. */
export function peutGererServeur(
  role: RoleServeur | null | undefined
): boolean {
  return rangRole(role) >= RANG.proprietaire;
}

/** Expulser : modérateur minimum et strictement au-dessus de la cible. */
export function peutExpulser(
  acteur: RoleServeur | null | undefined,
  cible: RoleServeur | null | undefined
): boolean {
  return peutModererServeur(acteur) && rangRole(acteur) > rangRole(cible);
}

/** Initiales affichées quand un serveur n'a pas d'icône (ex. « Projet final » -> « PF »). */
export function initialesServeur(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  return mots
    .slice(0, 2)
    .map((mot) => mot.charAt(0).toUpperCase())
    .join('');
}
