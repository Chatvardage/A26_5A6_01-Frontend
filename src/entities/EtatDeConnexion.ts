/**
 * Modèle NetworkStatus — état de la connexion au "serveur" (mock pour l'instant).
 * Alimente l'icône de connectivité (MVP #7) et la logique de reconnexion simulée.
 */
export type TypeDEtat = 'connecte' | 'deconnecte' | 'en reconnexion';

export interface EtatDeConnexion {
    readonly statut: EtatDeConnexion;
    readonly depuis: number; // epoch ms depuis lequel ce statut est actif
    readonly reconnexions?: number; // nombre de tentatives en cours (si 'reconnecting')
}

export function creerEtatDeConnexion(
    statut: EtatDeConnexion,
    depuis: number = Date.now(),
    reconnexions?: number,
): EtatDeConnexion {
    return { statut, depuis, reconnexions };
}

export function estConnecte(state: TypeDEtat): boolean {
    return state.statut === 'connecte';
}