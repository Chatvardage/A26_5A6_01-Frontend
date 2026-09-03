import { ClefsStockageLocal } from './ClefsStockageLocal';
import { enregistrerDansStockage, recupererDuStockage } from './StockageLocal';

export interface Canal {
  idCanal: string;
  nomCanal: string;
  estPublique: boolean;
  idUtilisateur: string[];
}

// sauvegarder un canal
export function enregistrerCanal(canal: Canal): void {
  const canaux = recupererCanaux();
  const index = canaux.findIndex((c) => c.idCanal === canal.idCanal);

  if (index !== -1) {
    canaux[index] = canal;
  } else {
    canaux.push(canal);
  }

  enregistrerDansStockage(ClefsStockageLocal.canaux, canaux);
}

// recupere canaux accessible par un utilisateur
export function recupererCanauxParUtilisateur(idUtilisateur: string): Canal[] {
  return recupererDuStockage<Canal[]>(ClefsStockageLocal.canaux, []).filter(
    (canal) => canal.idUtilisateur.includes(idUtilisateur)
  );
}

// recupere un canal par son id
export function recupererCanal(idCanal: string): Canal | undefined {
  return recupererCanaux().find((c) => c.idCanal === idCanal);
}

// recupere tous les canaux
export function recupererCanaux(): Canal[] {
  return recupererDuStockage<Canal[]>(ClefsStockageLocal.canaux, []);
}

//ajouter utilisateur à un canal
export function ajouterUtilisateurDansCanal(
  idCanal: string,
  idUtilisateur: string
): void {
  const canal = recupererCanal(idCanal);
  if (!canal) {
    console.error(`Canal introuvable : "${idCanal}"`);
    return;
  }

  if (!canal.idUtilisateur.includes(idUtilisateur)) {
    canal.idUtilisateur.push(idUtilisateur);
    enregistrerCanal(canal);
  }
}

//retirer utilisateur à un canal
export function retirerUtilisateurDuCanal(
  idCanal: string,
  idUtilisateur: string
): void {
  const canal = recupererCanal(idCanal);
  if (!canal) {
    console.error(`Canal introuvable : "${idCanal}"`);
    return;
  }

  canal.idUtilisateur = canal.idUtilisateur.filter(
    (id) => id !== idUtilisateur
  );
  enregistrerCanal(canal);
}

//retirer un canal
export function retirerCanal(idCanal: string): void {
  const canaux = recupererCanaux().filter((c) => c.idCanal !== idCanal);
  enregistrerDansStockage(ClefsStockageLocal.canaux, canaux);
}
