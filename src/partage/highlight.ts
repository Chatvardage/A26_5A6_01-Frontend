export type Segment = { text: string; match: boolean };

/**
 * Découpe `text` en segments, ceux qui contiennent `term` étant marqués (sans tenir compte de la casse
 * ni des accents de casse). Le terme est cherché littéralement : `%`, `_`, `.` n'ont pas de sens spécial.
 */
export function splitHighlight(text: string, term: string): Segment[] {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLocaleLowerCase();
  // Une casse qui change la longueur du texte (ex. « İ ») décalerait les positions : pas de surlignage.
  if (haystack.length !== text.length) return [{ text, match: false }];

  const segments: Segment[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) segments.push({ text: text.slice(from, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) segments.push({ text: text.slice(from), match: false });
  return segments.length ? segments : [{ text, match: false }];
}
