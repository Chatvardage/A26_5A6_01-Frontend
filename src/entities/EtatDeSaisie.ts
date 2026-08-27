/**
 * Modèle TypingState — indicateur « en train d'écrire ».
 * conversationId pointe soit vers un Channel.id, soit vers un DirectMessageThread.id
 * (voir conversation.model.ts pour l'identifiant générique de conversation).
 */
export interface EtatDeSaisie {
    readonly idConversation: string;
    readonly idUtilisateur: string;
    readonly enTrainDEcrire: boolean;
    readonly actualiseA: number; // epoch ms
}

/** Durée après laquelle un état "typing" est considéré périmé si aucun refresh n'arrive. */
export const TYPING_TIMEOUT_MS = 4000;

export function createTypingState(
    idConversation: string,
    idUtilisateur: string,
    enTrainDEcrire: boolean,
    actualiseA: number = Date.now(),
): EtatDeSaisie {
    return { idConversation, idUtilisateur, enTrainDEcrire, actualiseA };
}

export function isTypingExpired(state: EtatDeSaisie, now: number = Date.now()): boolean {
    return now - state.actualiseA > TYPING_TIMEOUT_MS;
}