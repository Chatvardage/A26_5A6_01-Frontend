import type { ConversationId } from './Conversation.ts';

export interface DirectMessage {
    readonly id: ConversationId;
    readonly participantIds: readonly [string, string];
}

/**
 * Cette fonction génère un identifiant unique pour une conversation privée (DM) entre deux utilisateurs,
 * peu importe l'ordre dans lequel on lui passe leurs ids.
 */
export function makeDmId(userAId: string, userBId: string): string {
    return [userAId, userBId].sort().join(':');
}

/**
 *
 * @param userAId ID du premier user
 * @param userBId ID du deuxième user
 */
export function createDirectMessageThread(
    userAId: string,
    userBId: string,
): DirectMessage {
    return {
        id: makeDmId(userAId, userBId),
        participantIds: [userAId, userBId],
    };
}

/**
 * Fonction pour retrouver l'id de l'autre participant
 *
 * @param dm
 * @param userId
 */
export function getOtherParticipant(dm: DirectMessage, userId: string): string | undefined {
    return dm.participantIds.find((id) => id !== userId);
}