/**
 * Rôle global d'un utilisateur, attribué par le service d'authentification
 * (jamais choisi ni modifiable côté client).
 *
 * La modération des serveurs et salons ne dépend PAS de ce rôle global mais
 * du rôle de l'utilisateur dans chaque serveur (voir `Serveur.ts`) : le
 * modérateur n'existe qu'à l'intérieur d'un serveur. Seul `admin` a des
 * droits partout (et l'accès au Dashboard).
 */
export type RoleUtilisateur = 'admin' | 'utilisateur';

/**
 * Représente un utilisateur dans le système.
 *
 * `courriel` est optionnel : un utilisateur créé côté renderer avant
 * l'appel réseau (ex. ancien flux "pseudo seul") n'en a pas forcément.
 * Un utilisateur inscrit via `inscription` (voir AuthGateway.ts) en a
 * toujours un — c'est le backend qui fait foi pour cette valeur.
 *
 * `role` est optionnel pour la même raison (ex. un membre d'un salon connu
 * seulement par son id/pseudo via `membreIds`, avant résolution complète) ;
 * l'utilisateur courant (celui qui a une session ouverte) en a toujours un,
 * retourné par le backend à la connexion/inscription/`GET /auth/me`.
 */
export interface Utilisateur {
  readonly id: string;
  readonly pseudo: string;
  readonly courriel?: string;
  readonly role?: RoleUtilisateur;
}

/**
 * Crée un nouvel utilisateur avec un identifiant unique et un pseudo.
 * @param id L'identifiant unique de l'utilisateur
 * @param pseudo Le pseudo de l'utilisateur
 * @param courriel Le courriel de l'utilisateur, si connu à la création.
 * @param role Le rôle global de l'utilisateur, si connu à la création.
 * @returns Un objet Utilisateur
 */
export function creerUtilisateur(
  id: string,
  pseudo: string,
  courriel?: string,
  role?: RoleUtilisateur
): Utilisateur {
  return {
    id: id,
    pseudo: pseudo,
    courriel: courriel,
    role: role,
  };
}

/**
 * Fonction de validation du courriel utilisé à l'inscription et à la
 * connexion (voir LoginPage/InscriptionPage). Volontairement simple (pas de
 * RFC 5322 complet) : le format exact importe peu ici, c'est le backend qui
 * validera réellement l'adresse (existence, confirmation, etc.) une fois le
 * service d'authentification branché.
 *
 * @param courriel Le courriel à valider.
 * @returns true si le format est plausible, false sinon.
 */
export function validationCourriel(courriel: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel.trim());
}

/**
 * Fonction de validation du mot de passe à l'inscription. Règle minimale
 * (8 caractères ou plus), alignée sur Authentification (voir
 * RealGatewayRuntime.js pour l'appel réel) ; le serveur reste la référence.
 *
 * @param motDePasse Le mot de passe à valider.
 * @returns true si le mot de passe respecte la règle minimale, false sinon.
 */
export function validationMotDePasse(motDePasse: string): boolean {
  return typeof motDePasse === 'string' && motDePasse.length >= 8;
}

/**
 * Dérive un pseudo par défaut à partir de la partie locale d'un courriel
 * (avant le '@'), pour l'écran d'inscription : l'utilisateur ne choisit pas
 * son pseudo à l'inscription (seulement courriel + mot de passe), il pourra
 * le changer plus tard sur une autre page (page profil — pas encore prête,
 * voir le commentaire dans InscriptionPage.tsx). Ne garde que les caractères
 * autorisés par `validationPseudo`, et complète/tronque pour respecter la
 * longueur (3 à 20 caractères) attendue par le domaine.
 *
 * @param courriel Le courriel dont on dérive le pseudo par défaut.
 * @returns Un pseudo par défaut respectant `validationPseudo`.
 */
export function genererPseudoParDefaut(courriel: string): string {
  // split() renvoie toujours au moins un élément (la chaîne entière s'il n'y
  // a pas de « @ »).
  const partieLocale = courriel.split('@')[0];
  const nettoye = partieLocale.replace(/[^a-zA-Z0-9_-]/g, '');
  const complete = nettoye.padEnd(3, '0');
  return complete.slice(0, 20);
}

/**
 * Fonction de validation du pseudo (username) d'un utilisateur.
 * Le pseudo doit contenir entre 3 et 20 caractères, et ne peut contenir que des lettres, des chiffres,
 * des underscores (_) et des tirets (-).
 *
 * À RAJOUTER : Vérifier que le pseudo est unique dans la base de données.
 * @param username Le pseudo à valider
 * @returns true si le pseudo est valide, false sinon
 */
export function validationPseudo(username: string): boolean {
  return /^[a-zA-Z0-9_-]{3,20}$/.test(username);
}
