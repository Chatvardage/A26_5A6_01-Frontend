import type { ConversationId } from './Conversation.ts';

export interface Message {
    readonly id: string;
    readonly conversationId: ConversationId;
    readonly authorId: string;
    readonly content: string;
    readonly createdAt: number; // epoch ms
    readonly editedAt?: number;
}

export interface CreateMessageParams {
    id: string;
    conversationId: ConversationId;
    authorId: string;
    content: string;
    createdAt?: number;
}

export function createMessage(params: CreateMessageParams): Message {
    return {
        id: params.id,
        conversationId: params.conversationId,
        authorId: params.authorId,
        content: params.content,
        createdAt: params.createdAt ?? Date.now(),
    };
}

export function sortMessagesByDateAsc(messages: readonly Message[]): Message[] {
    return [...messages].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Pagination
 * pageSize = nombre de messages par page
 * beforeId = l'id du dernier message chargé au haut de la page, ou undefined si aucun message chargé de plus
 * messages = array de messages
 *
 * on charge d'abord les derniers messages, puis on remonte page par page en passant l'id du plus ancien
 * message affiché comme beforeId
 */
export function paginateBefore(
    messages: readonly Message[],
    beforeId: string | undefined,
    pageSize: number,
): Message[] {
    const sorted = sortMessagesByDateAsc(messages);
    const endIndex = beforeId ? sorted.findIndex((m) => m.id === beforeId) : sorted.length;
    const safeEnd = endIndex === -1 ? sorted.length : endIndex;
    const startIndex = Math.max(0, safeEnd - pageSize);
    return sorted.slice(startIndex, safeEnd);
}