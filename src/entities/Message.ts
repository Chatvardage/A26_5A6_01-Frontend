import type { ConversationId } from './Conversation.ts';

/**
 * Représente le type d'un message dans le système.
 * Un message peut être soit un message texte envoyé par un utilisateur, soit un message système généré par le système.
 */
export type TypeMessage = 'texte' | 'systeme';

/**
 * Constante représentant l'identifiant de l'auteur système pour les messages générés par le système.
 */
export const AUTEUR_SYSTEME = 'systeme';

/**
 * Modèle Message — représente un message envoyé dans une conversation (channel ou DM).
 */
export interface Message {
    readonly id: string;
    readonly conversationId: ConversationId;
    readonly auteurId: string;
    readonly contenu: string;
    readonly type: TypeMessage;
    readonly envoi: number;
    readonly modification?: number;
}

/**
 * Crée un message avec les propriétés données.
 *
 * @param id Identifiant unique du message
 * @param conversationId Identifiant de la conversation à laquelle le message appartient
 * @param auteurId Identifiant de l'auteur du message
 * @param contenu Contenu textuel du message
 * @param envoi Timestamp d'envoi du message (optionnel, par défaut à l'heure actuelle)
 * @param type Type du message ('texte' ou 'systeme', par défaut 'texte')
 *
 * @returns Un objet Message
 */
export function creerMessage(
    id: string,
    conversationId: ConversationId,
    auteurId: string,
    contenu: string,
    envoi?: number,
    type: TypeMessage = 'texte'
) : Message {
    return {
        id: id,
        conversationId: conversationId,
        auteurId: auteurId,
        contenu: contenu,
        envoi: envoi ?? Date.now(),
        type: type
    };
}

/**
 * Crée un message système avec les propriétés données.
 *
 * @param id Identifiant unique du message
 * @param conversationId Identifiant de la conversation à laquelle le message appartient
 * @param contenu Contenu textuel du message
 * @param envoi Timestamp d'envoi du message (optionnel, par défaut à l'heure actuelle)
 *
 * @returns Un objet Message de type 'systeme'
 */
export function creerMessageSysteme(
    id: string,
    conversationId: ConversationId,
    contenu: string,
    envoi?: number,
): Message {
    return creerMessage(id, conversationId, AUTEUR_SYSTEME, contenu, envoi, 'systeme');
}

/**
 * Vérifie si un message est un message système.
 *
 * @param message Le message à vérifier
 *
 * @returns true si le message est de type 'systeme', false sinon
 */
export function estMessageSysteme(message: Message): boolean {
    return message.type === 'systeme';
}

/**
 * Trie les messages par date d'envoi (du plus ancien au plus récent).
 *
 * @param messages Un tableau de messages à trier
 *
 * @returns Un nouveau tableau de messages triés par date d'envoi
 */
export function trierMessagesParEnvoi(messages: readonly Message[]): Message[] {
    return [...messages].sort((a, b) => a.envoi - b.envoi);
}

/**
 * Pagine les messages avant un certain identifiant de message.
 *
 * Retourne une page de `pageSize` messages qui précèdent immédiatement `beforeId`, triés du plus ancien au plus
 * récent (pagination "charger plus ancien"). Si `beforeId` est absent, on pagine à partir de la fin (les messages
 * les plus récents). Si `beforeId` ne correspond à aucun message (ex. déjà supprimé), on retombe aussi sur la fin
 * plutôt que de planter. `startIndex` est borné à 0 pour ne pas dépasser le début du tableau quand il reste moins
 * de `pageSize` messages plus anciens.
 *
 * @param messages Un tableau de messages à paginer
 * @param beforeId Identifiant du message avant lequel paginer (optionnel)
 * @param pageSize Nombre maximum de messages à retourner
 *
 * @returns Un tableau de messages paginés avant l'identifiant donné
 */
export function paginerAvant(
    messages: readonly Message[],
    beforeId: string | undefined,
    pageSize: number,
): Message[] {
    const sorted = trierMessagesParEnvoi(messages);
    const endIndex = beforeId ? sorted.findIndex((m) => m.id === beforeId) : sorted.length;
    const safeEnd = endIndex === -1 ? sorted.length : endIndex;
    const startIndex = Math.max(0, safeEnd - pageSize);
    return sorted.slice(startIndex, safeEnd);
}