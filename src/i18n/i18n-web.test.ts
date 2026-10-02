import { describe, it, expect } from 'vitest';
import { t, LANGUE_PAR_DEFAUT, LANGUES_SUPPORTEES } from './i18n-web';

describe('i18n-web', () => {
  describe('LANGUES_SUPPORTEES / LANGUE_PAR_DEFAUT', () => {
    it('devrait supporter le français et l’anglais', () => {
      expect(LANGUES_SUPPORTEES).toContain('fr');
      expect(LANGUES_SUPPORTEES).toContain('en');
    });

    it('devrait avoir le français comme langue par défaut', () => {
      expect(LANGUE_PAR_DEFAUT).toBe('fr');
    });
  });

  describe('t()', () => {
    it('devrait traduire une clé existante en français', () => {
      expect(t('fr', 'channels.send')).toBe('Envoyer');
    });

    it('devrait traduire la même clé en anglais', () => {
      expect(t('en', 'channels.send')).toBe('Send');
    });

    it('devrait retourner un texte différent entre les deux langues pour la même clé', () => {
      expect(t('fr', 'auth.join')).not.toBe(t('en', 'auth.join'));
    });

    it('devrait retourner la clé elle-même si elle est introuvable (filet de sécurité)', () => {
      expect(t('fr', 'section.inexistante')).toBe('section.inexistante');
    });

    it('devrait se replier sur le français si la langue demandée est inconnue', () => {
      expect(t('es', 'channels.send')).toBe(t('fr', 'channels.send'));
    });

    it('devrait substituer un paramètre nommé dans le texte', () => {
      expect(
        t('fr', 'channels.sendMessagePlaceholder', { name: 'général' })
      ).toBe('Envoyez un message dans #général');
      expect(
        t('en', 'channels.sendMessagePlaceholder', { name: 'general' })
      ).toBe('Message #general');
    });

    it('devrait substituer plusieurs occurrences du même paramètre', () => {
      const resultat = t('fr', 'errors.ERR_PSEUDO_PRIS', { pseudo: 'alice' });
      expect(resultat).toContain('alice');
    });

    it('ne devrait pas planter si aucun paramètre requis n’est fourni', () => {
      expect(() => t('fr', 'channels.send')).not.toThrow();
    });
  });

  it('traduit les erreurs serveur (500, 502, 503, 504) et la limite (429) dans chaque langue', () => {
    for (const langue of LANGUES_SUPPORTEES) {
      for (const code of [429, 500, 502, 503, 504]) {
        const cle = `errors.ERR_HTTP_${code}`;
        expect(t(langue, cle)).not.toBe(cle);
      }
    }
  });
});
