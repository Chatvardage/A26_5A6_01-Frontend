import type { ConversationId } from './Conversation.ts';

/**
 * Modèle ConversationPrivee — représente une conversation privée (DM) entre deux utilisateurs.
 */
export interface ConversationPrivee {
    readonly type: 'privee';
    readonly id: ConversationId;
    readonly participantIds: readonly [string, string];
    readonly creation: number;
}

/**
 * Crée un identifiant unique pour une conversation privée entre deux utilisateurs.
 * L'identifiant est généré en triant les identifiants des deux utilisateurs et en les joignant avec un séparateur ':'.
 *
 * @param utilisateurAId ID du premier utilisateur
 * @param utilisateurBId ID du deuxième utilisateur
 *
 * @returns Un identifiant unique pour la conversation privée entre les deux utilisateurs
 */
export function creerDmId(utilisateurAId: string, utilisateurBId: string): string {
    return [utilisateurAId, utilisateurBId].sort().join(':');
}

/**
 * Crée un objet ConversationPrivee représentant une conversation privée entre deux utilisateurs.
 * L'identifiant de la conversation est généré à partir des identifiants des deux utilisateurs.
 *
 * @param utilisateurAId ID du premier user
 * @param utilisateurBId ID du deuxième user
 *
 * @returns Un objet ConversationPrivee représentant la conversation privée entre les deux utilisateurs
 */
export function creerConversationPrivee(
    utilisateurAId: string,
    utilisateurBId: string,
): ConversationPrivee {
    return {
        type: 'privee',
        id: creerDmId(utilisateurAId, utilisateurBId),
        participantIds: [utilisateurAId, utilisateurBId],
        creation: Date.now(),
    };
}

/**
 * Récupère l'identifiant de l'autre participant dans une conversation privée (DM) donnée.
 *
 * @param conversationPrivee L'objet ConversationPrivee représentant la conversation privée
 * @param utilisateurId L'identifiant de l'utilisateur pour lequel on veut trouver l'autre participant
 *
 * @returns L'identifiant de l'autre participant si trouvé, sinon undefined
 */
export function trouverAutreParticipant(conversationPrivee: ConversationPrivee, utilisateurId: string): string | undefined {
    if (!conversationPrivee.participantIds.includes(utilisateurId)) return undefined;
    return conversationPrivee.participantIds.find((id) => id !== utilisateurId);
}