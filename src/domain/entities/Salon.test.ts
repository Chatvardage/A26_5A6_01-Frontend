import { describe, expect, it } from 'vitest';
import {
    changerNomSalon,
    changerVisibiliteSalon,
    creerSalon,
    estHote,
    estInvite,
    estMembre,
    inviterMembre,
    quitterSalon,
    rejoindreSalon,
} from './Salon';

describe('creerSalon', () => {
    it("est public par défaut et ne contient que l'hôte comme membre", () => {
        const salon = creerSalon('c1', 'général', 'u1');
        expect(salon.type).toBe('salon');
        expect(salon.visibilite).toBe('public');
        expect(salon.membreIds).toEqual(['u1']);
        expect(salon.membresInvites).toEqual([]);
    });

    it("ajoute l'hôte à membreIds s'il n'y est pas déjà", () => {
        const salon = creerSalon('c1', 'général', 'u1', 'public', ['u2']);
        expect(salon.membreIds).toEqual(['u2', 'u1']);
    });

    it("ne duplique pas l'hôte s'il est déjà dans membreIds", () => {
        const salon = creerSalon('c1', 'général', 'u1', 'public', ['u1', 'u2']);
        expect(salon.membreIds).toEqual(['u1', 'u2']);
    });

    it('accepte une visibilité explicite', () => {
        const salon = creerSalon('c1', 'privé', 'u1', 'prive');
        expect(salon.visibilite).toBe('prive');
    });
});

describe('estMembre / estInvite / estHote', () => {
    const salon = inviterMembre(creerSalon('c1', 'général', 'u1'), 'u2');

    it('estMembre distingue les membres des non-membres', () => {
        expect(estMembre(salon, 'u1')).toBe(true);
        expect(estMembre(salon, 'u2')).toBe(false);
    });

    it('estInvite distingue les invités des non-invités', () => {
        expect(estInvite(salon, 'u2')).toBe(true);
        expect(estInvite(salon, 'u1')).toBe(false);
    });

    it("estHote distingue l'hôte des autres", () => {
        expect(estHote(salon, 'u1')).toBe(true);
        expect(estHote(salon, 'u2')).toBe(false);
    });
});

describe('inviterMembre', () => {
    it('ajoute une invitation et retourne un nouveau Salon', () => {
        const salon = creerSalon('c1', 'général', 'u1');
        const invite = inviterMembre(salon, 'u2');
        expect(invite).not.toBe(salon);
        expect(invite.membresInvites).toEqual(['u2']);
    });

    it('retourne la même référence si déjà membre', () => {
        const salon = creerSalon('c1', 'général', 'u1');
        expect(inviterMembre(salon, 'u1')).toBe(salon);
    });

    it("retourne la même référence si déjà invité (pas de doublon)", () => {
        const salon = inviterMembre(creerSalon('c1', 'général', 'u1'), 'u2');
        const reinvite = inviterMembre(salon, 'u2');
        expect(reinvite).toBe(salon);
        expect(reinvite.membresInvites).toEqual(['u2']);
    });
});

describe('rejoindreSalon', () => {
    it('un salon public peut être rejoint sans invitation', () => {
        const salon = creerSalon('c1', 'général', 'u1', 'public');
        const resultat = rejoindreSalon(salon, 'u2');
        expect(resultat?.membreIds).toEqual(['u1', 'u2']);
        expect(resultat?.membresInvites).toEqual([]);
    });

    it('un salon privé refuse un utilisateur non invité', () => {
        const salon = creerSalon('c1', 'privé', 'u1', 'prive');
        expect(rejoindreSalon(salon, 'u2')).toBeUndefined();
    });

    it("un salon privé accepte un utilisateur invité et retire l'invitation", () => {
        const salon = inviterMembre(creerSalon('c1', 'privé', 'u1', 'prive'), 'u2');
        const resultat = rejoindreSalon(salon, 'u2');
        expect(resultat?.membreIds).toEqual(['u1', 'u2']);
        expect(resultat?.membresInvites).toEqual([]);
    });

    it('refuse un utilisateur déjà membre', () => {
        const salon = creerSalon('c1', 'général', 'u1');
        expect(rejoindreSalon(salon, 'u1')).toBeUndefined();
    });
});

describe('quitterSalon', () => {
    it('retire un membre régulier', () => {
        const salon = rejoindreSalon(creerSalon('c1', 'général', 'u1'), 'u2')!;
        const resultat = quitterSalon(salon, 'u2');
        expect(resultat?.membreIds).toEqual(['u1']);
    });

    it("refuse si l'utilisateur n'est pas membre", () => {
        const salon = creerSalon('c1', 'général', 'u1');
        expect(quitterSalon(salon, 'u2')).toBeUndefined();
    });

    it("refuse si l'utilisateur est l'hôte", () => {
        const salon = creerSalon('c1', 'général', 'u1');
        expect(quitterSalon(salon, 'u1')).toBeUndefined();
    });
});

describe('changerNomSalon', () => {
    it("l'hôte peut changer le nom", () => {
        const salon = creerSalon('c1', 'ancien nom', 'u1');
        const resultat = changerNomSalon(salon, 'nouveau nom', 'u1');
        expect(resultat?.nom).toBe('nouveau nom');
        expect(salon.nom).toBe('ancien nom'); // original inchangé
    });

    it('un non-hôte ne peut pas changer le nom', () => {
        const salon = rejoindreSalon(creerSalon('c1', 'nom', 'u1'), 'u2')!;
        expect(changerNomSalon(salon, 'pirate', 'u2')).toBeUndefined();
    });
});

describe('changerVisibiliteSalon', () => {
    it('l\'hôte peut changer la visibilité', () => {
        const salon = creerSalon('c1', 'général', 'u1', 'public');
        const resultat = changerVisibiliteSalon(salon, 'prive', 'u1');
        expect(resultat?.visibilite).toBe('prive');
        expect(salon.visibilite).toBe('public'); // original inchangé
    });

    it('un non-hôte ne peut pas changer la visibilité', () => {
        const salon = rejoindreSalon(creerSalon('c1', 'général', 'u1'), 'u2')!;
        expect(changerVisibiliteSalon(salon, 'prive', 'u2')).toBeUndefined();
    });
});
