/**
 * Représente un utilisateur dans le système.
 */
export interface Utilisateur {
  readonly id: string;
  readonly pseudo: string;
}

/**
 * Crée un nouvel utilisateur avec un identifiant unique et un pseudo.
 * @param id L'identifiant unique de l'utilisateur
 * @param pseudo Le pseudo de l'utilisateur
 * @returns Un objet Utilisateur
 */
export function creerUtilisateur(id: string, pseudo: string): Utilisateur {
  return {
    id: id,
    pseudo: pseudo,
  };
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
