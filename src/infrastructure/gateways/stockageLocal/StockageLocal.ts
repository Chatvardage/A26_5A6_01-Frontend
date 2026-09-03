// ----- Méthode générique localStorage -----

function estStockageDisponible(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  );
}

export function enregistrerDansStockage<T>(clef: string, valeur: T): void {
  if (!estStockageDisponible()) return;

  try {
    localStorage.setItem(clef, JSON.stringify(valeur));
  } catch (erreur) {
    console.error(
      `Erreur lors de l'enregistrement de la clef "${clef}" :`,
      erreur
    );
  }
}

export function recupererDuStockage<T>(clef: string, valeurParDefaut: T): T {
  if (!estStockageDisponible()) return valeurParDefaut;

  try {
    const donnees = localStorage.getItem(clef);
    return donnees ? (JSON.parse(donnees) as T) : valeurParDefaut;
  } catch (erreur) {
    console.error(
      `Erreur lors de la récupération de la clef "${clef}" :`,
      erreur
    );
    return valeurParDefaut;
  }
}
