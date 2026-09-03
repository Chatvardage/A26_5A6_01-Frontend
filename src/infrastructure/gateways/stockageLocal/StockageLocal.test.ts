
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { 
  enregistrerCanal,
  recupererCanaux,
  recupererCanal,
  retirerCanal,
  ajouterUtilisateurDansCanal,
  retirerUtilisateurDuCanal,
  Canal} from "./StockageCanal";
import { 
    enregistrerMessage,
  recupererMessages,
  retirerMessage,
 } from "./StockageMessage";
import { 
  enregistrerUtilisateur,
  recupererUtilisateurs,
  recupererUtilisateurParId,
  retirerUtilisateur,
  Utilisateur, } from "./StockageUtilisateur";
import { ClefsStockageLocal } from "./ClefsStockageLocal";


beforeEach(() => {
  localStorage.clear();
});

// ----- Stockage indisponible (window.localStorage supprimé) -----

describe("Stockage indisponible", () => {
  const localStorageOriginal = window.localStorage;

  afterEach(() => {
    // Restaure localStorage après chaque test de cette section
    Object.defineProperty(window, "localStorage", {
      value: localStorageOriginal,
      writable: true,
      configurable: true,
    });
  });

  function supprimerLocalStorage(): void {
    // @ts-expect-error - suppression volontaire pour simuler l'indisponibilité
    delete window.localStorage;
  }

  test("enregistrer ne lance pas d'erreur si localStorage est indisponible", () => {
    supprimerLocalStorage();
    const utilisateur: Utilisateur = { identifiant: "alice", idUtilisateur: "u1", etat: "en ligne" };

    expect(() => enregistrerUtilisateur(utilisateur)).not.toThrow();
  });

  test("récupérer retourne la valeur par défaut si localStorage est indisponible", () => {
    supprimerLocalStorage();

    expect(recupererUtilisateurs()).toEqual([]);
    expect(recupererCanaux()).toEqual([]);
    expect(recupererMessages("c1")).toEqual([]);
  });

  test("retirer ne lance pas d'erreur si localStorage est indisponible", () => {
    supprimerLocalStorage();

    expect(() => retirerUtilisateur("u1")).not.toThrow();
    expect(() => retirerCanal("c1")).not.toThrow();
    expect(() => retirerMessage("c1", "m1")).not.toThrow();
  });
});

// ----- Clé absente dans localStorage -----

describe("Clé absente dans localStorage", () => {
  test("recupererUtilisateurs retourne un tableau vide si la clé n'existe pas", () => {
    expect(localStorage.getItem(ClefsStockageLocal.utilisateurs)).toBeNull();
    expect(recupererUtilisateurs()).toEqual([]);
  });

  test("recupererCanaux retourne un tableau vide si la clé n'existe pas", () => {
    expect(localStorage.getItem(ClefsStockageLocal.canaux)).toBeNull();
    expect(recupererCanaux()).toEqual([]);
  });

  test("recupererMessages retourne un tableau vide si la clé n'existe pas", () => {
    expect(localStorage.getItem(ClefsStockageLocal.messages("c1"))).toBeNull();
    expect(recupererMessages("c1")).toEqual([]);
  });
});

// ----- JSON invalide -----

describe("JSON invalide", () => {
  let espionConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    espionConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    espionConsoleError.mockRestore();
  });

  test("recupererUtilisateurs retourne la valeur par défaut si le JSON est corrompu", () => {
    localStorage.setItem(ClefsStockageLocal.utilisateurs, "{ json invalide !!");

    expect(recupererUtilisateurs()).toEqual([]);
    expect(espionConsoleError).toHaveBeenCalled();
  });

  test("recupererCanaux retourne la valeur par défaut si le JSON est corrompu", () => {
    localStorage.setItem(ClefsStockageLocal.canaux, "{ json invalide !!");

    expect(recupererCanaux()).toEqual([]);
    expect(espionConsoleError).toHaveBeenCalled();
  });

  test("recupererMessages retourne la valeur par défaut si le JSON est corrompu", () => {
    localStorage.setItem(ClefsStockageLocal.messages("c1"), "{ json invalide !!");

    expect(recupererMessages("c1")).toEqual([]);
    expect(espionConsoleError).toHaveBeenCalled();
  });
});

// ----- Utilisateur / canal / message absent -----

describe("Éléments absents", () => {
  test("recupererUtilisateurParId retourne undefined si l'utilisateur n'existe pas", () => {
    expect(recupererUtilisateurParId("inconnu")).toBeUndefined();
  });

  test("recupererCanal retourne undefined si le canal n'existe pas", () => {
    expect(recupererCanal("inconnu")).toBeUndefined();
  });

  test("recupererMessages retourne un tableau vide si le canal n'a aucun message", () => {
    expect(recupererMessages("canal-vide")).toEqual([]);
  });
});

// ----- Mise à jour d'un élément déjà existant -----

describe("Mise à jour d'un élément existant", () => {
  test("enregistrerUtilisateur met à jour au lieu de dupliquer", () => {
    const utilisateur: Utilisateur = { identifiant: "alice", idUtilisateur: "u1", etat: "en ligne" };
    enregistrerUtilisateur(utilisateur);
    enregistrerUtilisateur({ ...utilisateur, etat: "absent" });

    const utilisateurs = recupererUtilisateurs();
    expect(utilisateurs).toHaveLength(1);
    expect(utilisateurs[0].etat).toBe("absent");
  });

  test("enregistrerCanal met à jour au lieu de dupliquer", () => {
    const canal: Canal = {
        idCanal: "c1", estPublique: true, idUtilisateur: ["u1"],
        nomCanal: ""
    };
    enregistrerCanal(canal);
    enregistrerCanal({ ...canal, estPublique: false });

    const canaux = recupererCanaux();
    expect(canaux).toHaveLength(1);
    expect(canaux[0].estPublique).toBe(false);
  });

  test("enregistrerMessage met à jour au lieu de dupliquer", () => {
    enregistrerMessage({ idMessage: "m1", idCanal: "c1", idExpediteur: "u1", date: "01/01/24 10:00:00" });
    enregistrerMessage({ idMessage: "m1", idCanal: "c1", idExpediteur: "u2", date: "01/01/24 10:00:00" });

    const messages = recupererMessages("c1");
    expect(messages).toHaveLength(1);
    expect(messages[0].idExpediteur).toBe("u2");
  });
});

// ----- Suppression d'un élément non présent -----

describe("Suppression d'un élément non présent", () => {
  test("retirerUtilisateur ne lance pas d'erreur et ne modifie rien si l'id est inconnu", () => {
    const utilisateur: Utilisateur = { identifiant: "alice", idUtilisateur: "u1", etat: "en ligne" };
    enregistrerUtilisateur(utilisateur);

    expect(() => retirerUtilisateur("inconnu")).not.toThrow();
    expect(recupererUtilisateurs()).toEqual([utilisateur]);
  });

  test("retirerCanal ne lance pas d'erreur et ne modifie rien si l'id est inconnu", () => {
    const canal: Canal = {
        idCanal: "c1", estPublique: true, idUtilisateur: ["u1"],
        nomCanal: ""
    };
    enregistrerCanal(canal);

    expect(() => retirerCanal("inconnu")).not.toThrow();
    expect(recupererCanaux()).toEqual([canal]);
  });

  test("retirerMessage ne lance pas d'erreur et ne modifie rien si l'id est inconnu", () => {
    enregistrerMessage({ idMessage: "m1", idCanal: "c1", idExpediteur: "u1", date: "01/01/24 10:00:00" });

    expect(() => retirerMessage("c1", "inconnu")).not.toThrow();
    expect(recupererMessages("c1")).toHaveLength(1);
  });
});

// ----- Branche console.error / early return -----

describe("Branche console.error / early return", () => {
  let espionConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    espionConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    espionConsoleError.mockRestore();
  });

  test("ajouterUtilisateurDansCanal loggue une erreur et ne fait rien si le canal n'existe pas", () => {
    ajouterUtilisateurDansCanal("canal-inconnu", "u1");

    expect(espionConsoleError).toHaveBeenCalled();
    expect(recupererCanal("canal-inconnu")).toBeUndefined();
  });

  test("retirerUtilisateurDuCanal loggue une erreur et ne fait rien si le canal n'existe pas", () => {
    retirerUtilisateurDuCanal("canal-inconnu", "u1");

    expect(espionConsoleError).toHaveBeenCalled();
    expect(recupererCanal("canal-inconnu")).toBeUndefined();
  });

  test("enregistrerDansStockage loggue une erreur si setItem lance une exception", () => {
    const espionSetItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota dépassé");
    });

    expect(() =>
      enregistrerUtilisateur({ identifiant: "alice", idUtilisateur: "u1", etat: "en ligne" })
    ).not.toThrow();
    expect(espionConsoleError).toHaveBeenCalled();

    espionSetItem.mockRestore();
  });

});
