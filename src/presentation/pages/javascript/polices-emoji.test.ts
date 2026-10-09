import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Emoji en couleur sous Linux/WSL (aucune police emoji installée) : police
// Twemoji embarquée, servie par l'app (CSP default-src 'self').
const pages = join(__dirname, '..');
const lire = (fichier: string) => readFileSync(join(pages, fichier), 'utf8');

describe('police des emoji', () => {
  it('est embarquée avec sa licence', () => {
    expect(statSync(join(pages, 'fonts/twemoji.woff2')).size).toBeGreaterThan(
      100_000
    );
    expect(lire('fonts/TWEMOJI-LICENSE.txt')).toContain(
      'SIL OPEN FONT LICENSE'
    );
  });

  it('est déclarée pour les seuls emoji et passe en premier sur toutes les pages', () => {
    const styles = lire('css/styles.css');
    const declaration = styles.slice(
      styles.indexOf('@font-face'),
      styles.indexOf('}', styles.indexOf('@font-face'))
    );
    expect(declaration).toContain("url('../fonts/twemoji.woff2')");
    expect(declaration).toContain('U+1F000-1FAFF');
    // Les lettres et chiffres gardent la police du système.
    expect(declaration).not.toMatch(/U\+00?(2|3|4|5|6|7)\d/);
    expect(existsSync(join(pages, 'css', '../fonts/twemoji.woff2'))).toBe(true);
    for (const feuille of ['css/styles.css', 'css/message-prive.css']) {
      expect(lire(feuille)).toMatch(/font-family:\s*'Twemoji',/);
    }
    expect(styles).toMatch(
      /button,\s*input,\s*textarea,\s*select \{\s*font-family: inherit;/
    );
  });
});
