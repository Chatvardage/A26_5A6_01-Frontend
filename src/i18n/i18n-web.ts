import translations from './translations.json';

// Variante ESM de i18n.js, pour le côté React/Vite : Rollup (utilisé par
// `vite build` en production) traite les fichiers .js du code source comme
// des modules ES natifs, pas du CommonJS — un `require()`/`module.exports`
// y échoue au build (même si `tsc` et le serveur de dev Vite l'acceptent
// tous les deux, d'où le bug qui n'apparaît qu'à `vite build`). Les DONNÉES
// (translations.json) restent la seule source de vérité, partagée avec
// i18n.js ; seule cette petite fonction de lookup est dupliquée, pour
// exister nativement dans les deux systèmes de modules du projet (CommonJS
// pour main.js/preload.js/renderer.js, ESM pour React/Vite).
export const LANGUE_PAR_DEFAUT = 'fr' as const;
export const LANGUES_SUPPORTEES: readonly string[] = ['fr', 'en'];

/**
 * Traduit une clé pointée (ex. "channels.send") dans la langue donnée.
 * Retourne la clé elle-même si elle est introuvable (filet de sécurité).
 */
export function t(
  langue: string,
  cle: string,
  params?: Record<string, string | number>
): string {
  const table = translations as Record<string, unknown>;
  const dictionnaire =
    (table[langue] as Record<string, unknown> | undefined) ??
    (table[LANGUE_PAR_DEFAUT] as Record<string, unknown>);

  const brut = cle
    .split('.')
    .reduce<unknown>(
      (acc, partie) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[partie]
          : undefined,
      dictionnaire
    );

  let texte = typeof brut === 'string' ? brut : cle;

  if (params) {
    for (const cleParam of Object.keys(params)) {
      texte = texte.split(`{${cleParam}}`).join(String(params[cleParam]));
    }
  }

  return texte;
}
