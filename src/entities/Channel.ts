import type { ConversationId } from './Conversation.ts';

export type ChannelVisibility = 'public' | 'private';

export interface Channel {
    readonly id: ConversationId;
    readonly name: string;
    readonly visibility: ChannelVisibility;
    readonly ownerId: string;
    readonly memberIds: readonly string[];
}

export interface CreateChannelParams {
    id: string;
    name: string;
    ownerId: string;
    visibility?: ChannelVisibility;
    memberIds?: readonly string[];
}

export function createChannel(params: CreateChannelParams): Channel {
    const memberIds = params.memberIds ?? [params.ownerId];
    return {
        id: params.id,
        name: params.name,
        visibility: params.visibility ?? 'public',
        ownerId: params.ownerId,
        memberIds: memberIds.includes(params.ownerId) ? memberIds : [...memberIds, params.ownerId],
    };
}

export function isMember(channel: Channel, userId: string): boolean {
    return channel.memberIds.includes(userId);
}

/** Invite un nouveau membre
 * Si déjà membre, retourne le channel, sinon ajoute le membre puis retourne le channel */
export function inviteMember(channel: Channel, userId: string): Channel {
    if (isMember(channel, userId)) return channel;
    return { ...channel, memberIds: [...channel.memberIds, userId] };
}