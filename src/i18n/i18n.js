'use strict';

// Un seul fichier de données (translations.json) est la source de vérité ;
// ce module n'est qu'une petite fonction de lookup, dupliquée en apparence
// entre le monde CommonJS (main.js, preload.js, renderer.js — exécutés tels
// quels par Node/Electron, sans build) et le monde TypeScript/Vite (voir
// i18n.d.ts, qui permet à `import { t } from '.../i18n.js'` de fonctionner
// et d'être typé côté React sans dupliquer les traductions elles-mêmes).
const translations = require('./translations.json');

const LANGUE_PAR_DEFAUT = 'fr';
const LANGUES_SUPPORTEES = ['fr', 'en'];

/**
 * Traduit une clé pointée (ex. "channels.send") dans la langue donnée.
 * Retourne la clé elle-même si elle est introuvable (filet de sécurité :
 * un texte visiblement "brut" en cas d'oubli de traduction est préférable
 * à un plantage ou un texte vide).
 *
 * @param {string} langue 'fr' ou 'en' (voir LANGUES_SUPPORTEES)
 * @param {string} cle Clé pointée, ex. "auth.join"
 * @param {Record<string, string|number>} [params] Valeurs à substituer aux "{xxx}" du texte
 * @returns {string}
 */
function t(langue, cle, params) {
  const dictionnaire = translations[langue] || translations[LANGUE_PAR_DEFAUT];
  const brut = cle
    .split('.')
    .reduce(
      (acc, partie) =>
        acc && typeof acc === 'object' ? acc[partie] : undefined,
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

module.exports = { t, LANGUE_PAR_DEFAUT, LANGUES_SUPPORTEES };
