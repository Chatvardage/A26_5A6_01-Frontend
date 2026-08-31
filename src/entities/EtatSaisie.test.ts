import { describe, expect, it } from 'vitest';
import {
    DELAI_EXPIRATION_MS,
    creerEtatSaisie,
    estActivementEnTrainDEcrire,
    etatDEcritureExpire,
    utilisateursEnTrainDecrire,
} from './EtatSaisie';

describe('creerEtatSaisie', () => {
    it("utilise l'heure actuelle par défaut pour `actualisation`", () => {
        const avant = Date.now();
        const etat = creerEtatSaisie('c1', 'u1', true);
        expect(etat.actualisation).toBeGreaterThanOrEqual(avant);
    });

    it('accepte une `actualisation` explicite', () => {
        const etat = creerEtatSaisie('c1', 'u1', true, 500);
        expect(etat).toEqual({
            idConversation: 'c1',
            idUtilisateur: 'u1',
            enTrainDEcrire: true,
            actualisation: 500,
        });
    });
});

describe('etatDEcritureExpire', () => {
    it("n'est pas expiré exactement au délai (comparaison stricte)", () => {
        const etat = creerEtatSaisie('c1', 'u1', true, 0);
        expect(etatDEcritureExpire(etat, DELAI_EXPIRATION_MS)).toBe(false);
    });

    it('est expiré juste après le délai', () => {
        const etat = creerEtatSaisie('c1', 'u1', true, 0);
        expect(etatDEcritureExpire(etat, DELAI_EXPIRATION_MS + 1)).toBe(true);
    });

    it("n'est pas expiré bien avant le délai", () => {
        const etat = creerEtatSaisie('c1', 'u1', true, 1000);
        expect(etatDEcritureExpire(etat, 1500)).toBe(false);
    });
});

describe('estActivementEnTrainDEcrire', () => {
    it('true si en train d\'écrire et non expiré', () => {
        const etat = creerEtatSaisie('c1', 'u1', true, 1000);
        expect(estActivementEnTrainDEcrire(etat, 1500)).toBe(true);
    });

    it("false si enTrainDEcrire est false, même si non expiré", () => {
        const etat = creerEtatSaisie('c1', 'u1', false, 1000);
        expect(estActivementEnTrainDEcrire(etat, 1500)).toBe(false);
    });

    it('false si expiré, même si enTrainDEcrire est true', () => {
        const etat = creerEtatSaisie('c1', 'u1', true, 0);
        expect(estActivementEnTrainDEcrire(etat, DELAI_EXPIRATION_MS + 1)).toBe(false);
    });
});

describe('utilisateursEnTrainDecrire', () => {
    const maintenant = 100_000;
    const etats = [
        creerEtatSaisie('c1', 'u1', true, maintenant), // actif
        creerEtatSaisie('c1', 'u2', true, maintenant - DELAI_EXPIRATION_MS - 1), // expiré
        creerEtatSaisie('c1', 'u3', false, maintenant), // pas en train d'écrire
        creerEtatSaisie('c2', 'u4', true, maintenant), // mauvaise conversation
    ];

    it('ne retient que les utilisateurs actifs de la bonne conversation', () => {
        expect(utilisateursEnTrainDecrire(etats, 'c1', maintenant)).toEqual(['u1']);
    });

    it("exclut l'utilisateur passé dans exclureUtilisateurId", () => {
        expect(utilisateursEnTrainDecrire(etats, 'c1', maintenant, 'u1')).toEqual([]);
    });

    it('retourne un tableau vide pour une conversation sans état de saisie', () => {
        expect(utilisateursEnTrainDecrire(etats, 'c3', maintenant)).toEqual([]);
    });

    it('retourne un tableau vide pour une liste vide', () => {
        expect(utilisateursEnTrainDecrire([], 'c1', maintenant)).toEqual([]);
    });
});
