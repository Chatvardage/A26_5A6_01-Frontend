import { ClefsStockageLocal } from './ClefsStockageLocal';
import { enregistrerDansStockage, recupererDuStockage } from './StockageLocal';

export interface Message {
  idMessage: string;
  idCanal: string;
  idExpediteur: string;
  date: string; // format jj/mm/aa HH:MM:SS
}

// obtenir la date du message
function obtenirDateFormatee(): string {
  const maintenant = new Date();

  const jj = String(maintenant.getDate()).padStart(2, '0');
  const mm = String(maintenant.getMonth() + 1).padStart(2, '0');
  const aa = String(maintenant.getFullYear()).slice(-2);
  const HH = String(maintenant.getHours()).padStart(2, '0');
  const MM = String(maintenant.getMinutes()).padStart(2, '0');
  const SS = String(maintenant.getSeconds()).padStart(2, '0');

  return `${jj}/${mm}/${aa} ${HH}:${MM}:${SS}`;
}

//enrergistre un message
export function enregistrerMessage(
  message: Omit<Message, 'date'> & { date?: string }
): void {
  const messageAvecDate: Message = {
    ...message,
    date: message.date ?? obtenirDateFormatee(),
  };

  const messages = recupererMessages(messageAvecDate.idCanal);
  const index = messages.findIndex(
    (m) => m.idMessage === messageAvecDate.idMessage
  );

  if (index !== -1) {
    messages[index] = messageAvecDate;
  } else {
    messages.push(messageAvecDate);
  }

  enregistrerDansStockage(
    ClefsStockageLocal.messages(messageAvecDate.idCanal),
    messages
  );
}

//convertit une date en Timestamp
function convertirDateEnTimestamp(date: string): number {
  // Format attendu : jj/mm/aa HH:MM:SS
  const [partieDate, partieHeure] = date.split(' ');
  if (!partieDate || !partieHeure) return 0;

  const [jj, mm, aa] = partieDate.split('/').map(Number);
  const [HH, MM, SS] = partieHeure.split(':').map(Number);
  if ([jj, mm, aa, HH, MM, SS].some((n) => Number.isNaN(n))) return 0;

  const anneeComplete = 2000 + aa; // suppose 20XX
  return new Date(anneeComplete, mm - 1, jj, HH, MM, SS).getTime();
}

//recupere les message d'un certain canal
export function recupererMessages(idCanal: string): Message[] {
  const messages = recupererDuStockage<Message[]>(
    ClefsStockageLocal.messages(idCanal),
    []
  );

  return messages.sort(
    (a, b) =>
      convertirDateEnTimestamp(a.date) - convertirDateEnTimestamp(b.date)
  );
}

//retire un message d'un certain canal
export function retirerMessage(idCanal: string, idMessage: string): void {
  const messages = recupererMessages(idCanal).filter(
    (m) => m.idMessage !== idMessage
  );
  enregistrerDansStockage(ClefsStockageLocal.messages(idCanal), messages);
}
