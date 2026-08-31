import { describe, expect, it } from 'vitest';
import { creerPresence, estEnLigne } from './Presence';

describe('creerPresence', () => {
    it("utilise l'heure actuelle par défaut pour `vuLaDerniereFois`", () => {
        const avant = Date.now();
        const presence = creerPresence('u1', 'en-ligne');
        expect(presence.vuLaDerniereFois).toBeGreaterThanOrEqual(avant);
    });

    it('accepte un timestamp explicite', () => {
        const presence = creerPresence('u1', 'hors-ligne', 42);
        expect(presence).toEqual({ utilisateurId: 'u1', statut: 'hors-ligne', vuLaDerniereFois: 42 });
    });
});

describe('estEnLigne', () => {
    it('true pour le statut "en-ligne"', () => {
        expect(estEnLigne(creerPresence('u1', 'en-ligne'))).toBe(true);
    });

    it('false pour le statut "hors-ligne"', () => {
        expect(estEnLigne(creerPresence('u1', 'hors-ligne'))).toBe(false);
    });
});
