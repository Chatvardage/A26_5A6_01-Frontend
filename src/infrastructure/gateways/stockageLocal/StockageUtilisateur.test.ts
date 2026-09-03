import { describe, expect, beforeEach, test} from 'vitest';
import { 
  enregistrerUtilisateur,
  recupererUtilisateurs,
  recupererUtilisateurParId,
  retirerUtilisateur,
  Utilisateur, } from "./StockageUtilisateur";



 beforeEach(() => {
  localStorage.clear();
});

// ----- Utilisateurs -----

describe("Utilisateurs", () => {
  const utilisateur1: Utilisateur = { identifiant: "alice", idUtilisateur: "u1", etat: "en ligne" };
  const utilisateur2: Utilisateur = { identifiant: "bob", idUtilisateur: "u2", etat: "absent" };

    test("enregistre et récupère un utilisateur", () => {
    enregistrerUtilisateur(utilisateur1);
    expect(recupererUtilisateurs()).toEqual([utilisateur1]);
  });

  test("met à jour un utilisateur existant plutôt que de le dupliquer", () => {
    enregistrerUtilisateur(utilisateur1);
    enregistrerUtilisateur({ ...utilisateur1, etat: "absent" });

    const utilisateurs = recupererUtilisateurs();
    expect(utilisateurs).toHaveLength(1);
    expect(utilisateurs[0].etat).toBe("absent");
  });

  test("récupère un utilisateur par son id", () => {
    enregistrerUtilisateur(utilisateur1);
    enregistrerUtilisateur(utilisateur2);

    expect(recupererUtilisateurParId("u2")).toEqual(utilisateur2);
    expect(recupererUtilisateurParId("inconnu")).toBeUndefined();
  });

  test("retire un utilisateur", () => {
    enregistrerUtilisateur(utilisateur1);
    enregistrerUtilisateur(utilisateur2);
    retirerUtilisateur("u1");

    expect(recupererUtilisateurs()).toEqual([utilisateur2]);
  });
  });