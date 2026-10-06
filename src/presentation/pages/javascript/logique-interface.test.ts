import { describe, expect, it } from 'vitest';
// Script classique : s'enregistre sur globalThis.LogiqueInterface.
import './logique-interface.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- script non typé
const L = (globalThis as any).LogiqueInterface;

const msg = (
  id: string,
  date: number,
  extra: Record<string, unknown> = {}
) => ({
  id,
  date,
  envoi: date,
  ...extra,
});

describe('logique-interface', () => {
  describe('fusion des messages', () => {
    it('fusionne ancien + récent sans doublon, trié, le plus récent gagne', () => {
      const anciens = [msg('a', 1), msg('b', 2, { contenu: 'vieux' })];
      const recents = [msg('b', 2, { contenu: 'neuf' }), msg('c', 3)];
      expect(L.fusionnerHistorique(anciens, recents, 'date')).toEqual([
        msg('a', 1),
        msg('b', 2, { contenu: 'neuf' }),
        msg('c', 3),
      ]);
    });

    it('insère les brouillons à leur place, sans toucher la liste sans brouillon', () => {
      const tries = [msg('a', 1), msg('b', 3), msg('c', 5)];
      expect(L.fusionnerAvecMessagesEnAttente(tries, [], 'envoi')).toBe(tries);
      const resultat = L.fusionnerAvecMessagesEnAttente(
        tries,
        [msg('x', 6), msg('y', 2), msg('z', 0)],
        'envoi'
      );
      expect(resultat.map((m: { id: string }) => m.id)).toEqual([
        'z',
        'a',
        'y',
        'b',
        'c',
        'x',
      ]);
      // Brouillon le plus ancien : les messages livrés suivent tous.
      expect(
        L.fusionnerAvecMessagesEnAttente(tries, [msg('y', 0)], 'envoi').map(
          (m: { id: string }) => m.id
        )
      ).toEqual(['y', 'a', 'b', 'c']);
      // Égalité de date : le message livré passe avant le brouillon.
      expect(
        L.fusionnerAvecMessagesEnAttente(
          [msg('a', 1)],
          [msg('y', 1)],
          'date'
        ).map((m: { id: string }) => m.id)
      ).toEqual(['a', 'y']);
    });

    it('ajoute, remplace et retire un message', () => {
      expect(L.contientMessage(undefined, 'a')).toBe(false);
      const liste = L.ajouterMessage(undefined, msg('b', 2), 'date');
      const avecA = L.ajouterMessage(liste, msg('a', 1), 'date');
      expect(avecA.map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
      // Déjà présent (écho temps réel d'un message envoyé) : même liste.
      expect(L.ajouterMessage(avecA, msg('a', 1), 'date')).toBe(avecA);

      const modifie = L.remplacerMessage(avecA, {
        id: 'b',
        contenu: 'modifié',
        modification: 9,
      });
      expect(modifie[1]).toEqual(
        msg('b', 2, { contenu: 'modifié', modification: 9 })
      );
      expect(modifie[0]).toBe(avecA[0]);
      expect(L.remplacerMessage(undefined, msg('x', 1))).toEqual([]);

      expect(
        L.retirerMessage(modifie, 'a').map((m: { id: string }) => m.id)
      ).toEqual(['b']);
      expect(L.retirerMessage(undefined, 'a')).toEqual([]);
    });
  });

  describe('défilement', () => {
    it('près du bas selon le seuil (80 px par défaut)', () => {
      const liste = (scrollTop: number) => ({
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop,
      });
      expect(L.SEUIL_PRES_DU_BAS_PX).toBe(80);
      expect(L.estPresDuBas(liste(600))).toBe(true);
      expect(L.estPresDuBas(liste(520))).toBe(true);
      expect(L.estPresDuBas(liste(519))).toBe(false);
      expect(L.estPresDuBas(liste(300), 400)).toBe(true);
      expect(L.estPresDuBas(null)).toBe(true);
    });

    it.each([
      [true, true, false, true],
      [true, false, true, true],
      [true, false, false, false],
      [false, true, true, false],
    ])(
      'affichée=%s, auteur=%s, en bas=%s → suivre=%s',
      (dansConversationAffichee, estAuteur, presDuBas, attendu) => {
        expect(
          L.doitSuivreNouveauMessage({
            dansConversationAffichee,
            estAuteur,
            presDuBas,
          })
        ).toBe(attendu);
      }
    );
  });

  describe('listes', () => {
    it('trie les conversations par activité récente', () => {
      const conversations = [
        { id: 'sans', messages: [] },
        { id: 'ancienne', lastMessage: { envoi: 1 } },
        { id: 'premier-message', messages: [{ envoi: 5 }] },
        { id: 'recente', lastMessage: { envoi: 9 } },
      ];
      expect(
        L.trierConversations(conversations).map((c: { id: string }) => c.id)
      ).toEqual(['recente', 'premier-message', 'ancienne', 'sans']);
      // Pas de modification de la liste d'origine.
      expect(conversations[0].id).toBe('sans');
    });
  });

  describe('contenu du serveur par défaut', () => {
    const [annonces, general] = Object.keys(L.SALONS_PAR_DEFAUT);

    it('traduit les salons par défaut non renommés seulement', () => {
      expect(L.cleNomSalon({ id: annonces, nom: 'annonces' })).toBe(
        'channels.defaultAnnouncements'
      );
      expect(L.cleNomSalon({ id: general, nom: 'général' })).toBe(
        'channels.defaultGeneral'
      );
      expect(L.cleNomSalon({ id: general, nom: 'discussion' })).toBeNull();
      expect(L.cleNomSalon({ id: 'autre', nom: 'annonces' })).toBeNull();
    });

    it('traduit le message de bienvenue tant qu’il n’est pas modifié', () => {
      expect(L.cleContenuMessage({ id: L.MESSAGE_BIENVENUE_ID })).toBe(
        'channels.welcomeMessage'
      );
      expect(
        L.cleContenuMessage({ id: L.MESSAGE_BIENVENUE_ID, modification: 5 })
      ).toBeNull();
      expect(L.cleContenuMessage({ id: 'm1' })).toBeNull();
    });
  });
});

describe('recherche de messages', () => {
  it('accepte de 2 à 100 caractères, espaces retirés', () => {
    expect(L.peutRechercher(' a ')).toBe(false);
    expect(L.peutRechercher(' ab ')).toBe(true);
    expect(L.peutRechercher('x'.repeat(100))).toBe(true);
    expect(L.peutRechercher('x'.repeat(101))).toBe(false);
    expect(L.peutRechercher(undefined)).toBe(false);
    expect([L.LONGUEUR_MIN_RECHERCHE, L.LONGUEUR_MAX_RECHERCHE]).toEqual([
      2, 100,
    ]);
  });

  it('extrait le texte autour du terme, avec « … » aux coupures', () => {
    expect(L.extraitAutour('court', 'ou')).toBe('court');
    expect(L.extraitAutour(null, 'x')).toBe('');
    const long = `${'a'.repeat(100)}PROJET${'b'.repeat(100)}`;
    expect(L.extraitAutour(long, 'projet', 5)).toBe('…aaaaaPROJETbbbbb…');
    expect(L.extraitAutour(long, 'absent', 5)).toBe('aaaaaaaaaaaaaaaa…');
    expect(L.extraitAutour(`PROJET${'b'.repeat(100)}`, 'projet', 5)).toBe(
      'PROJETbbbbbbbbbb…'
    );
    expect(L.extraitAutour(`${'a'.repeat(100)}PROJET`, 'projet', 5)).toBe(
      '…aaaaaPROJET'
    );
    expect(L.extraitAutour('x'.repeat(200), undefined, 5)).toBe('xxxxxxxxxx…');
  });

  it('découpe le texte en segments surlignés, sans tenir compte de la casse', () => {
    expect(L.decouperSurligne('Le Projet et le projet', 'projet')).toEqual([
      { texte: 'Le ', surligne: false },
      { texte: 'Projet', surligne: true },
      { texte: ' et le ', surligne: false },
      { texte: 'projet', surligne: true },
    ]);
    expect(L.decouperSurligne('un projet ici', 'PROJET')).toEqual([
      { texte: 'un ', surligne: false },
      { texte: 'projet', surligne: true },
      { texte: ' ici', surligne: false },
    ]);
    expect(L.decouperSurligne('projet', 'projet')).toEqual([
      { texte: 'projet', surligne: true },
    ]);
    expect(L.decouperSurligne('texte', '')).toEqual([
      { texte: 'texte', surligne: false },
    ]);
    expect(L.decouperSurligne(undefined, undefined)).toEqual([]);
  });
});
