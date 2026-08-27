/**
 * Modèle Presence — état en ligne/hors ligne d'un utilisateur.
 * MockGateway émettra des mises à jour de PresenceState sur un flux d'événements.
 */
export type Statut = 'enligne' | 'horsligne';

export interface Presence {
    readonly idUtilisateur: string;
    readonly statut: Statut;
    readonly vuLaDerniereFois: number; // en minutes
}

export function creerPresence(
    idUtilisateur: string,
    statut: Statut,
    vuLaDerniereFois: number = Date.now(),
): Presence {
    return { idUtilisateur, statut, vuLaDerniereFois };
}

export function estEnLigne(presence: Presence): boolean {
    return presence.status === 'enligne';
}