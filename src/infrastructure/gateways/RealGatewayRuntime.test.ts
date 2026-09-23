import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- module CommonJS sans déclaration de types (voir son en-tête : exécuté par Electron sans étape de compilation).
import { RealGatewayRuntime, creerDmId } from './RealGatewayRuntime.js';

/** Construit une fausse Response minimale compatible avec l'usage de `appelHttp`. */
function reponseJson(corps: unknown, statut = 200) {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: async () => corps,
  };
}

function creerFauxSocket() {
  const ecouteurs = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    connected: true,
    on(evenement: string, rappel: (...args: unknown[]) => void) {
      const liste = ecouteurs.get(evenement) ?? [];
      liste.push(rappel);
      ecouteurs.set(evenement, liste);
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
    _declencher(evenement: string, ...args: unknown[]) {
      for (const rappel of ecouteurs.get(evenement) ?? []) rappel(...args);
    },
  };
}

function creerRuntime() {
  const socket = creerFauxSocket();
  const runtime = new RealGatewayRuntime(
    { baseUrlHttp: 'http://gateway.test', baseUrlSocket: 'http://gateway.test' },
    {
      chargerJetonPersiste: vi.fn(() => null),
      sauvegarderJetonPersiste: vi.fn(),
      creerSocket: vi.fn(() => socket),
    }
  );
  return { runtime, socket };
}

const UTILISATEUR_BRUT = {
  id: 'u1',
  pseudo: 'ariane',
  courriel: 'ariane@example.com',
  role: 'utilisateur',
  cree_le: '2026-01-01T00:00:00.000Z',
  modifie_le: '2026-01-01T00:00:00.000Z',
};

describe('RealGatewayRuntime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('creerDmId', () => {
    it('trie et joint les deux ids', () => {
      expect(creerDmId('b', 'a')).toBe('a:b');
      expect(creerDmId('a', 'b')).toBe('a:b');
    });
  });

  describe('appelHttp', () => {
    it('lève ERR_RESEAU_INDISPONIBLE si le fetch échoue', async () => {
      const { runtime } = creerRuntime();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('network down'))
      );
      await expect(runtime.appelHttp('/api/health')).rejects.toThrow(
        'ERR_RESEAU_INDISPONIBLE'
      );
    });

    it('lève un code ERR_HTTP_<statut> stable sur une réponse en erreur', async () => {
      const { runtime } = creerRuntime();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(reponseJson({ erreur: 'pseudo pris' }, 409))
      );
      await expect(runtime.appelHttp('/api/auth/register')).rejects.toMatchObject(
        { message: 'ERR_HTTP_409', statut: 409, detail: 'pseudo pris' }
      );
    });

    it('retourne le JSON pour une réponse réussie', async () => {
      const { runtime } = creerRuntime();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseJson({ ok: true })));
      await expect(runtime.appelHttp('/api/health')).resolves.toEqual({ ok: true });
    });
  });

  describe('authentifier / inscrire', () => {
    it('authentifier envoie mot_de_passe (pas motDePasse) et ouvre la session', async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          reponseJson({ jeton: 'jwt-1', utilisateur: UTILISATEUR_BRUT })
        );
      vi.stubGlobal('fetch', fetchMock);

      const resultat = await runtime.authentifier({
        identifiant: 'ariane',
        motDePasse: 'secret123',
      });

      const [, options] = fetchMock.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        identifiant: 'ariane',
        mot_de_passe: 'secret123',
      });
      expect(resultat.utilisateur).toEqual({
        id: 'u1',
        pseudo: 'ariane',
        courriel: 'ariane@example.com',
        role: 'utilisateur',
      });
      expect(resultat.etatConnexion.statut).toBe('connecte');
    });

    it('inscrire retente avec un pseudo randomisé sur 409 puis réussit', async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(reponseJson({ erreur: 'pseudo pris' }, 409))
        .mockResolvedValueOnce(
          reponseJson({ jeton: 'jwt-2', utilisateur: UTILISATEUR_BRUT })
        )
        // Appel supplémentaire best-effort déclenché par demarrerPollPresence()
        // juste après l'ouverture de session (voir ouvrirSession) : non
        // pertinent pour ce test, on lui donne juste une réponse valide.
        .mockResolvedValue(reponseJson({ statutPresence: 'enLigne' }));
      vi.stubGlobal('fetch', fetchMock);

      await runtime.inscrire({
        courriel: 'ariane@example.com',
        motDePasse: 'secret123',
        pseudo: 'ariane',
      });

      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      const premierCorps = JSON.parse(fetchMock.mock.calls[0][1].body);
      const secondCorps = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(premierCorps.pseudo).toBe('ariane');
      expect(secondCorps.pseudo).not.toBe('ariane');
      expect(secondCorps.pseudo.length).toBeLessThanOrEqual(20);
    });

    it('inscrire relance immédiatement une erreur non-409 sans retenter', async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(reponseJson({ erreur: 'invalide' }, 400));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        runtime.inscrire({
          courriel: 'invalide',
          motDePasse: 'secret123',
          pseudo: 'ariane',
        })
      ).rejects.toMatchObject({ message: 'ERR_HTTP_400' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('mapperSalon', () => {
    it('résout creeParId depuis plusieurs noms de champ possibles', () => {
      const { runtime } = creerRuntime();
      expect(runtime.mapperSalon({ id: 's1', nom: 'a', visibilite: 'public', creePar: 'u1', membreIds: [], membresInvites: [] }).creeParId).toBe('u1');
      expect(runtime.mapperSalon({ id: 's1', nom: 'a', visibilite: 'public', createdBy: 'u2', membreIds: [], membresInvites: [] }).creeParId).toBe('u2');
      expect(runtime.mapperSalon({ id: 's1', nom: 'a', visibilite: 'public', hoteId: 'u3', membreIds: [], membresInvites: [] }).creeParId).toBe('u3');
    });
  });

  describe('mapperMessageSalon / mapperMessageDm', () => {
    it('mappe un message de salon et détecte une édition via updatedAt', () => {
      const { runtime } = creerRuntime();
      const cree = runtime.mapperMessageSalon({
        id: 'm1',
        authorId: 'u1',
        content: 'salut',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(cree).toEqual({ id: 'm1', auteurId: 'u1', contenu: 'salut', date: cree.date });
      expect(cree.modification).toBeUndefined();

      const modifie = runtime.mapperMessageSalon({
        id: 'm1',
        authorId: 'u1',
        content: 'salut !',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:05:00.000Z',
      });
      expect(modifie.modification).toBeDefined();
    });

    it('mappe un message DM et reconstruit conversationId', () => {
      const { runtime } = creerRuntime();
      const message = runtime.mapperMessageDm({
        id: 'm2',
        senderId: 'u2',
        recipientId: 'u1',
        content: 'yo',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(message.conversationId).toBe(creerDmId('u1', 'u2'));
      expect(message.auteurId).toBe('u2');
      expect(message.contenu).toBe('yo');
    });
  });

  describe('modifierMessage / supprimerMessage (routage par index)', () => {
    it("lève ERR_MESSAGE_INTROUVABLE si le message n'a jamais été vu", async () => {
      const { runtime } = creerRuntime();
      runtime.etatConnexion.statut = 'connecte';
      await expect(
        runtime.modifierMessage({ messageId: 'inconnu', contenu: 'x' })
      ).rejects.toThrow('ERR_MESSAGE_INTROUVABLE');
    });

    it('route un message de salon vers /api/messages/rooms/:roomId/:id', async () => {
      const { runtime } = creerRuntime();
      runtime.etatConnexion.statut = 'connecte';
      runtime.indexMessages.set('m1', { type: 'salon', roomId: 's1' });
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson({
          id: 'm1',
          authorId: 'u1',
          content: 'edit',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      await runtime.modifierMessage({ messageId: 'm1', contenu: 'edit' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://gateway.test/api/messages/rooms/s1/m1');
      expect(options.method).toBe('PATCH');
    });

    it('route un message DM vers /api/messages/:id', async () => {
      const { runtime } = creerRuntime();
      runtime.etatConnexion.statut = 'connecte';
      runtime.indexMessages.set('m2', { type: 'dm' });
      const fetchMock = vi.fn().mockResolvedValue(reponseJson({ deleted: true }, 200));
      vi.stubGlobal('fetch', fetchMock);

      await runtime.supprimerMessage({ messageId: 'm2' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://gateway.test/api/messages/m2');
      expect(options.method).toBe('DELETE');
      expect(runtime.indexMessages.has('m2')).toBe(false);
    });
  });

  describe('autreParticipantDm', () => {
    it("retourne l'autre participant selon l'utilisateur courant", () => {
      const { runtime } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      expect(runtime.autreParticipantDm(creerDmId('u1', 'u2'))).toBe('u2');
      expect(runtime.autreParticipantDm(creerDmId('u2', 'u1'))).toBe('u2');
    });
  });

  describe('obtenirPresences', () => {
    it('affiche hors-ligne par défaut pour les autres, en-ligne pour soi', () => {
      const { runtime } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.enregistrerUtilisateurConnu({ id: 'autre', pseudo: 'autre' });
      const presences = runtime.obtenirPresences();
      expect(presences.autre).toBe('hors-ligne');
      expect(presences.moi).toBe('en-ligne');
    });
  });

  describe('deconnexion', () => {
    it('réinitialise tous les caches (pas de fuite vers la session suivante)', async () => {
      const { runtime } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'bob' });
      runtime.presences.u2 = 'en-ligne';
      runtime.indexMessages.set('m1', { type: 'dm' });
      runtime.salonsRejoints.add('s1');
      runtime.partenairesDmConnus.add('u2');
      runtime.etatsSaisie.push({ conversationId: 's1', utilisateurId: 'u2', est_saisie: true });

      await runtime.deconnexion();

      expect(runtime.utilisateursConnus.size).toBe(0);
      expect(runtime.presences).toEqual({});
      expect(runtime.indexMessages.size).toBe(0);
      expect(runtime.salonsRejoints.size).toBe(0);
      expect(runtime.partenairesDmConnus.size).toBe(0);
      expect(runtime.etatsSaisie).toEqual([]);
      expect(runtime.utilisateurConnecte).toBeNull();
    });
  });

  describe('obtenirEtat', () => {
    it("ne marque comme déjà rejoint que les salons dont on est réellement membre", async () => {
      const { runtime } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/rooms/invitations/me')) return Promise.resolve(reponseJson([]));
        if (url === 'http://gateway.test/api/rooms') {
          return Promise.resolve(
            reponseJson([
              { id: 's1', nom: 'public-membre', visibilite: 'public', membreIds: ['moi'], membresInvites: [] },
              { id: 's2', nom: 'public-pas-membre', visibilite: 'public', membreIds: ['autre'], membresInvites: [] },
            ])
          );
        }
        if (url.includes('/history')) return Promise.resolve(reponseJson([]));
        if (url.includes('/api/users/lookup')) return Promise.resolve(reponseJson([]));
        return Promise.resolve(reponseJson([]));
      });
      vi.stubGlobal('fetch', fetchMock);

      await runtime.obtenirEtat();

      expect(runtime.salonsRejoints.has('s1')).toBe(true);
      expect(runtime.salonsRejoints.has('s2')).toBe(false);
    });
  });

  describe('événements temps réel (Socket.IO)', () => {
    it('un message de salon entrant met à jour l\'index et émet "message-recu"', () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      runtime.connecterSocket();
      const recus: unknown[] = [];
      runtime.on('message-recu', (payload: unknown) => recus.push(payload));

      socket._declencher('room-message.created', {
        id: 'm1',
        roomId: 's1',
        authorId: 'u2',
        content: 'salut',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(recus).toHaveLength(1);
      expect(runtime.indexMessages.get('m1')).toEqual({ type: 'salon', roomId: 's1' });
    });

    it('un événement typing met à jour le cache local des états de saisie', () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      runtime.connecterSocket();

      socket._declencher('typing', { userId: 'u2', scope: 'room', targetId: 's1', isTyping: true });

      expect(runtime.obtenirEtatsSaisie('s1')).toEqual([
        { conversationId: 's1', utilisateurId: 'u2', est_saisie: true },
      ]);
    });
  });
});
