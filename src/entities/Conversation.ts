import type { Salon } from './Salon.ts';
import type { ConversationPrivee } from './ConversationPrivee.ts';

/**
 * Représente une conversation dans le système, qui peut être soit un salon de discussion (channel) soit une
 * conversation privée (DM).
 */
export type Conversation = Salon | ConversationPrivee;

/**
 * Représente l'identifiant unique d'une conversation dans le système.
 * Il est utilisé pour identifier de manière unique une conversation entre plusieurs utilisateurs.
 */
export type ConversationId = string;