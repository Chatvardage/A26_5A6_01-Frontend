import { ClefsStockageLocal } from './ClefsStockageLocal';
import { enregistrerDansStockage, recupererDuStockage } from './StockageLocal';

//composant d'un utilisateur
export interface Utilisateur {
  idUtilisateur: string;
  identifiant: string;
  etat: string;
}
// recupere tous les utilisateurs
export function recupererUtilisateurs(): Utilisateur[] {
  return recupererDuStockage<Utilisateur[]>(
    ClefsStockageLocal.utilisateurs,
    []
  );
}

// Enregistrer un utilisateur
export function enregistrerUtilisateur(utilisateur: Utilisateur): void {
  const utilisateurs = recupererUtilisateurs();
  const index = utilisateurs.findIndex(
    (u) => u.idUtilisateur === utilisateur.idUtilisateur
  );

  if (index !== -1) {
    utilisateurs[index] = utilisateur;
  } else {
    utilisateurs.push(utilisateur);
  }

  enregistrerDansStockage(ClefsStockageLocal.utilisateurs, utilisateurs);
}
// Récupérer un utilisateur par son identifiant
export function recupererUtilisateurParId(
  idUtilisateur: string
): Utilisateur | undefined {
  return recupererUtilisateurs().find((u) => u.idUtilisateur === idUtilisateur);
}

// Récuperer un utilisateur par son id

//retirer un utilisateur
export function retirerUtilisateur(idUtilisateur: string): void {
  const utilisateurs = recupererUtilisateurs().filter(
    (u) => u.idUtilisateur !== idUtilisateur
  );
  enregistrerDansStockage(ClefsStockageLocal.utilisateurs, utilisateurs);
}
