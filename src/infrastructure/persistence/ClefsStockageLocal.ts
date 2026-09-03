//liste des clefs pour le stockage local

export const ClefsStockageLocal = {
  utilisateurs: 'conversation.utilisateurs',
  canaux: 'conversation.canaux',
  messages: (idCanal: string) => `conversation.messages.${idCanal}`,
};
