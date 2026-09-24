import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    // socket.timeout(ms).emit(...) : même socket, `emit` reste espionnable.
    timeout: vi.fn(function (this: unknown) {
      return this;
    }),
    disconnect: vi.fn(),
    _declencher(evenement: string, ...args: unknown[]) {
      for (const rappel of ecouteurs.get(evenement) ?? []) rappel(...args);
    },
  };
}

function creerRuntime() {
  const socket = creerFauxSocket();
  const runtime = new RealGatewayRuntime(
    {
      baseUrlHttp: 'http://gateway.test',
      baseUrlSocket: 'http://gateway.test',
    },
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
      await expect(
        runtime.appelHttp('/api/auth/register')
      ).rejects.toMatchObject({
        message: 'ERR_HTTP_409',
        statut: 409,
        detail: 'pseudo pris',
      });
    });

    it('retourne le JSON pour une réponse réussie', async () => {
      const { runtime } = creerRuntime();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(reponseJson({ ok: true }))
      );
      await expect(runtime.appelHttp('/api/health')).resolves.toEqual({
        ok: true,
      });
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

    it("inscrire ne retente qu'une fois sur 409 (courriel probablement déjà utilisé)", async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(reponseJson({ erreur: 'déjà utilisé' }, 409));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        runtime.inscrire({
          courriel: 'pris@example.com',
          motDePasse: 'secret123',
          pseudo: 'pris',
        })
      ).rejects.toMatchObject({ message: 'ERR_HTTP_409' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const brut = {
      id: 'c1',
      serveurId: 'srv',
      nom: 'général',
      position: 0,
      acces: 'tous',
      ecriture: 'moderateurs',
      peutEcrire: false,
      creePar: 'owner',
    };

    it('salon ouvert : écriture selon Room-Service, sans liste de membres', () => {
      const { runtime } = creerRuntime();
      const salon = runtime.mapperSalon(brut);
      expect(salon).toMatchObject({
        id: 'c1',
        serveurId: 'srv',
        visibilite: 'public',
        peutEcrire: false,
        creeParId: 'owner',
      });
      expect(salon).not.toHaveProperty('membreIds');
    });

    it('salon réservé aux modérateurs : cadenas', () => {
      const { runtime } = creerRuntime();
      expect(
        runtime.mapperSalon({
          ...brut,
          acces: 'moderateurs',
          creePar: undefined,
        })
      ).toMatchObject({ visibilite: 'prive', creeParId: null });
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
      expect(cree).toEqual({
        id: 'm1',
        auteurId: 'u1',
        contenu: 'salut',
        date: cree.date,
      });
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
      const fetchMock = vi
        .fn()
        .mockResolvedValue(reponseJson({ deleted: true }, 200));
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
      runtime.etatsSaisie.push({
        conversationId: 's1',
        utilisateurId: 'u2',
        est_saisie: true,
      });

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

  describe('obtenirEtat (serveurs)', () => {
    const serveur = (id: string, salonIds: string[], extra = {}) => ({
      id,
      nom: id,
      icone: null,
      public: false,
      parDefaut: false,
      proprietaireId: null,
      monRole: 'membre',
      nombreMembres: 1,
      membres: [{ utilisateurId: 'moi', role: 'membre' }],
      invitations: [],
      salons: salonIds.map((salonId, position) => ({
        id: salonId,
        serveurId: id,
        nom: salonId,
        position,
        acces: 'tous',
        ecriture: 'tous',
        peutEcrire: true,
        creePar: null,
      })),
      ...extra,
    });

    function preparer() {
      const { runtime } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const chemin = url.replace('http://gateway.test', '').split('?')[0];
        if (chemin === '/api/servers') {
          return Promise.resolve(
            reponseJson([
              serveur('chatvardage', ['annonces', 'general'], {
                parDefaut: true,
              }),
              serveur('projet', ['equipe']),
            ])
          );
        }
        if (chemin === '/api/servers/invitations/me') {
          return Promise.resolve(
            reponseJson([
              {
                serveur: {
                  id: 'autre',
                  nom: 'Autre',
                  public: false,
                  nombreMembres: 2,
                },
                invitePar: 'u9',
                inviteLe: '2026-01-01T00:00:00.000Z',
              },
            ])
          );
        }
        return Promise.resolve(reponseJson([]));
      });
      vi.stubGlobal('fetch', fetchMock);
      return { runtime, fetchMock };
    }

    it('par défaut : premier serveur, ses salons avec messages, invitations aux serveurs', async () => {
      const { runtime, fetchMock } = preparer();

      const etat = await runtime.obtenirEtat();

      expect(etat.serveurActif).toMatchObject({
        id: 'chatvardage',
        parDefaut: true,
      });
      expect(etat.serveurs.map((s: { id: string }) => s.id)).toEqual([
        'chatvardage',
        'projet',
      ]);
      expect(etat.salons.map((s: { id: string }) => s.id)).toEqual([
        'annonces',
        'general',
      ]);
      expect(etat.salons[0]).toMatchObject({
        messages: [],
        finHistorique: true,
      });
      expect(etat.invitations).toEqual([
        {
          id: 'autre',
          nom: 'Autre',
          public: false,
          nombreMembres: 2,
          invitePar: 'u9',
        },
      ]);
      // Historique chargé seulement pour les salons du serveur actif.
      const historiques = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/history')
      );
      expect(historiques).toHaveLength(2);
    });

    it('rejoint les rooms Socket.IO des salons de TOUS les serveurs', async () => {
      const { runtime } = preparer();
      await runtime.obtenirEtat();
      expect([...runtime.salonsRejoints].sort()).toEqual([
        'annonces',
        'equipe',
        'general',
      ]);
      expect(runtime.salonVersServeur.get('equipe')).toBe('projet');
    });

    it('serveurId, ou le serveur contenant salonId (ouverture depuis une notification)', async () => {
      const { runtime } = preparer();
      expect(
        (await runtime.obtenirEtat({ serveurId: 'projet' })).serveurActif.id
      ).toBe('projet');
      expect(
        (await runtime.obtenirEtat({ salonId: 'equipe' })).serveurActif.id
      ).toBe('projet');
      expect(
        (await runtime.obtenirEtat({ serveurId: 'inconnu' })).serveurActif.id
      ).toBe('chatvardage');
    });

    it('session.revoquee : vérifie la session (socket courant seulement)', () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      const verifier = vi
        .spyOn(runtime, 'verifierSessionApres401')
        .mockResolvedValue(undefined);
      runtime.connecterSocket();

      socket._declencher('session.revoquee');
      expect(verifier).toHaveBeenCalledTimes(1);

      // Socket remplacé : l'événement tardif de l'ancien est ignoré.
      runtime.socket = null;
      socket._declencher('session.revoquee');
      expect(verifier).toHaveBeenCalledTimes(1);
    });

    it('oublie une room retirée par le serveur, pour pouvoir la rejoindre de nouveau', () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.connecterSocket();
      socket._declencher('connexion.prete');
      runtime.rejoindreSocketSalon('equipe');
      socket.emit.mockClear();

      socket._declencher('room-message.revoked', null);
      socket._declencher('room-message.revoked', { roomId: 'equipe' });
      runtime.rejoindreSocketSalon('equipe');

      expect(socket.emit).toHaveBeenCalledWith(
        'room-message.join',
        { roomId: 'equipe' },
        expect.any(Function)
      );
    });

    it('garde une room confirmée par le serveur, oublie une room refusée ou sans réponse', () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.connecterSocket();
      socket._declencher('connexion.prete');
      runtime.rejoindreSocketSalon('ok');
      runtime.rejoindreSocketSalon('refuse');
      runtime.rejoindreSocketSalon('lent');
      const ack = (roomId: string) =>
        socket.emit.mock.calls.find(
          ([evt, payload]) =>
            evt === 'room-message.join' && payload.roomId === roomId
        )![2];

      ack('ok')(null, { joined: true });
      ack('refuse')(null, undefined);
      ack('lent')(new Error('operation has timed out'));

      expect(socket.timeout).toHaveBeenCalledWith(8000);
      expect([...runtime.roomsSocketRejointes]).toEqual(['ok']);
    });

    it("ignore l'accusé de réception d'un ancien socket", () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.connecterSocket();
      socket._declencher('connexion.prete');
      runtime.rejoindreSocketSalon('equipe');
      const [, , ack] = socket.emit.mock.calls.find(
        ([evt]) => evt === 'room-message.join'
      )!;
      runtime.socket = creerFauxSocket();

      ack(new Error('operation has timed out'));

      expect(runtime.roomsSocketRejointes.has('equipe')).toBe(true);
    });

    it('résout les pseudos par lots de 100 (limite de /api/users/lookup)', async () => {
      const { runtime } = creerRuntime();
      runtime.jeton = 'jeton';
      const ids = Array.from({ length: 205 }, (_, i) => `u${i}`);
      const fetchMock = vi.fn(async (url: string) => {
        const lot = new URL(url).searchParams.get('ids')!.split(',');
        if (lot.includes('u100')) return reponseJson({ erreur: 'panne' }, 500);
        return reponseJson(lot.map((id) => ({ id, pseudo: `p-${id}` })));
      });
      vi.stubGlobal('fetch', fetchMock);

      await runtime.resoudrePseudosInconnus(ids);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const tailles = fetchMock.mock.calls.map(
        ([url]) => new URL(url).searchParams.get('ids')!.split(',').length
      );
      expect(tailles).toEqual([100, 100, 5]);
      // Le lot en erreur n'empêche pas les autres d'être résolus.
      expect(runtime.utilisateursConnus.get('u0')?.pseudo).toBe('p-u0');
      expect(runtime.utilisateursConnus.has('u100')).toBe(false);
      expect(runtime.utilisateursConnus.get('u204')?.pseudo).toBe('p-u204');
    });

    it('résumés de conversations privées : un seul appel, dernier message seulement', async () => {
      const { runtime } = creerRuntime();
      expect(await runtime.obtenirResumesConversationsPrivees()).toEqual([]);

      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson([
          {
            otherUserId: 'u2',
            lastMessage: {
              id: 'm9',
              senderId: 'u2',
              recipientId: 'moi',
              content: 'salut',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        ])
      );
      vi.stubGlobal('fetch', fetchMock);

      const resumes = await runtime.obtenirResumesConversationsPrivees();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        '/api/messages/conversations'
      );
      expect(resumes).toEqual([
        {
          id: 'moi:u2',
          lastMessage: expect.objectContaining({
            id: 'm9',
            auteurId: 'u2',
            contenu: 'salut',
          }),
        },
      ]);
      expect(runtime.partenairesDmConnus.has('u2')).toBe(true);
      expect(runtime.indexMessages.get('m9')).toEqual({ type: 'dm' });
    });

    it('un message entrant indique son serveur (pastille du rail)', async () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.salonVersServeur.set('equipe', 'projet');
      runtime.connecterSocket();
      const recus: { serveurId?: string }[] = [];
      runtime.on('message-recu', (payload: { serveurId?: string }) =>
        recus.push(payload)
      );
      socket._declencher('room-message.created', {
        id: 'm1',
        roomId: 'equipe',
        authorId: 'u2',
        content: 'salut',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(recus[0].serveurId).toBe('projet');
    });
  });

  describe('serveurs et salons : appels HTTP', () => {
    it.each([
      [
        'creerServeur',
        { nom: 'P', public: true },
        'POST',
        '/api/servers',
        { nom: 'P', public: true },
      ],
      [
        'modifierServeur',
        { serveurId: 's', nom: 'N', icone: null },
        'PATCH',
        '/api/servers/s',
        { nom: 'N', icone: '' },
      ],
      ['rejoindreServeur', 's', 'POST', '/api/servers/s/join', undefined],
      [
        'expulserMembre',
        { serveurId: 's', utilisateurId: 'u' },
        'DELETE',
        '/api/servers/s/members/u',
        undefined,
      ],
      [
        'changerRoleMembre',
        { serveurId: 's', utilisateurId: 'u', role: 'moderateur' },
        'PATCH',
        '/api/servers/s/members/u',
        { role: 'moderateur' },
      ],
      [
        'inviter',
        { serveurId: 's', utilisateurId: 'u' },
        'POST',
        '/api/servers/s/invitations',
        { utilisateurId: 'u' },
      ],
      [
        'accepterInvitation',
        { serveurId: 's' },
        'POST',
        '/api/servers/s/invitations/accept',
        undefined,
      ],
      [
        'modifierSalon',
        { salonId: 'c', acces: 'moderateurs' },
        'PATCH',
        '/api/channels/c',
        { acces: 'moderateurs' },
      ],
    ])('%s', async (methode, argument, verbe, chemin, corps) => {
      const { runtime } = creerRuntime();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          reponseJson({ id: 'x', serveurId: 's', membres: [] })
        );
      vi.stubGlobal('fetch', fetchMock);
      await (runtime as Record<string, (a: unknown) => Promise<unknown>>)[
        methode
      ](argument);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`http://gateway.test${chemin}`);
      expect(options.method).toBe(verbe);
      expect(
        options.body === undefined ? undefined : JSON.parse(options.body)
      ).toEqual(corps);
    });

    it('decouvrirServeurs : filtre optionnel par nom', async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi.fn().mockResolvedValue(reponseJson([]));
      vi.stubGlobal('fetch', fetchMock);
      await runtime.decouvrirServeurs('  pro ');
      await runtime.decouvrirServeurs('');
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'http://gateway.test/api/servers/decouvrir?q=pro',
        'http://gateway.test/api/servers/decouvrir',
      ]);
    });

    it('creerSalon rejoint la room Socket.IO du nouveau salon', async () => {
      const { runtime } = creerRuntime();
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            reponseJson({ id: 'c9', serveurId: 's', nom: 'x', acces: 'tous' })
          )
      );
      const salon = await runtime.creerSalon({ serveurId: 's', nom: 'x' });
      expect(salon.id).toBe('c9');
      expect(runtime.salonsRejoints.has('c9')).toBe(true);
      expect(runtime.salonVersServeur.get('c9')).toBe('s');
    });

    it('supprimerSalon / quitterServeur / supprimerServeur / refuserInvitation', async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi.fn().mockResolvedValue(reponseJson({}, 204));
      vi.stubGlobal('fetch', fetchMock);
      runtime.salonsRejoints.add('c1');
      await runtime.supprimerSalon('c1');
      await runtime.quitterServeur('s');
      await runtime.supprimerServeur('s');
      await runtime.refuserInvitation({ serveurId: 's' });
      expect(runtime.salonsRejoints.has('c1')).toBe(false);
      expect(
        fetchMock.mock.calls.map(([url, o]) => `${o.method} ${url}`)
      ).toEqual([
        'DELETE http://gateway.test/api/channels/c1',
        'POST http://gateway.test/api/servers/s/leave',
        'DELETE http://gateway.test/api/servers/s',
        'POST http://gateway.test/api/servers/s/invitations/refuse',
      ]);
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
      expect(runtime.indexMessages.get('m1')).toEqual({
        type: 'salon',
        roomId: 's1',
      });
    });

    it('un événement typing met à jour le cache local des états de saisie', () => {
      const { runtime, socket } = creerRuntime();
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      runtime.connecterSocket();

      socket._declencher('typing', {
        userId: 'u2',
        scope: 'room',
        targetId: 's1',
        isTyping: true,
      });

      expect(runtime.obtenirEtatsSaisie('s1')).toEqual([
        { conversationId: 's1', utilisateurId: 'u2', est_saisie: true },
      ]);
    });
  });
  describe('configModifier (avatar)', () => {
    it("envoie l'avatar et le renvoie mappé", async () => {
      const { runtime } = creerRuntime();
      const avatar = 'data:image/webp;base64,AAAA';
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson({
          theme: 'sombre',
          langue: 'fr',
          statutPresence: 'enLigne',
          modeNotification: 'systeme',
          alias: null,
          avatar,
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      const config = await runtime.configModifier({ avatar });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ avatar });
      expect(config.avatar).toBe(avatar);
    });

    it('traduit un avatar null en chaîne vide (retrait côté serveur)', async () => {
      const { runtime } = creerRuntime();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(reponseJson({ avatar: null }));
      vi.stubGlobal('fetch', fetchMock);
      const config = await runtime.configModifier({ avatar: null });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        avatar: '',
      });
      expect(config.avatar).toBeNull();
    });
  });

  describe('profils publics et présence des autres', () => {
    function runtimeConnecte() {
      const { runtime } = creerRuntime();
      runtime.jeton = 'jwt';
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      return runtime;
    }

    it('charge avatar et présence effective, et émet les changements', async () => {
      const runtime = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson([
          {
            idUtilisateur: 'u2',
            alias: 'Bob',
            avatar: 'data:image/png;base64,AA',
            actif: true,
          },
        ])
      );
      vi.stubGlobal('fetch', fetchMock);
      const presences: unknown[] = [];
      runtime.on('presence', (p: unknown) => presences.push(p));

      await runtime.chargerProfilsPublics(['u2', 'u3', 'u1']);

      // Jamais soi-même dans la requête.
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://gateway.test/api/config-utilisateur/publiques?ids=u2,u3'
      );
      expect(runtime.presences).toEqual({ u2: 'en-ligne', u3: 'hors-ligne' });
      expect(presences).toEqual([
        expect.objectContaining({ utilisateurId: 'u2', statut: 'en-ligne' }),
        expect.objectContaining({ utilisateurId: 'u3', statut: 'hors-ligne' }),
      ]);
      runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'bob' });
      expect(
        runtime.obtenirUtilisateurs().find((u: { id: string }) => u.id === 'u2')
      ).toMatchObject({
        avatar: 'data:image/png;base64,AA',
        alias: 'Bob',
      });
    });

    it("sans avatar (inclureAvatar=false) garde l'avatar déjà connu", async () => {
      const runtime = runtimeConnecte();
      runtime.profilsPublics.set('u2', {
        alias: null,
        avatar: 'data:image/png;base64,AA',
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          reponseJson([{ idUtilisateur: 'u2', alias: null, actif: false }])
        );
      vi.stubGlobal('fetch', fetchMock);
      const modifies: unknown[] = [];
      runtime.on('profils-publics', (ids: unknown) => modifies.push(ids));

      await runtime.chargerProfilsPublics(['u2'], { inclureAvatar: false });

      expect(fetchMock.mock.calls[0][0]).toContain('&inclureAvatar=false');
      expect(runtime.profilsPublics.get('u2').avatar).toBe(
        'data:image/png;base64,AA'
      );
      expect(modifies).toEqual([]);
    });

    it("émet 'profils-publics' quand un avatar change", async () => {
      const runtime = runtimeConnecte();
      runtime.profilsPublics.set('u2', { alias: null, avatar: null });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          reponseJson([
            {
              idUtilisateur: 'u2',
              alias: null,
              avatar: 'data:image/png;base64,BB',
              actif: false,
            },
          ])
        )
      );
      const modifies: unknown[] = [];
      runtime.on('profils-publics', (ids: unknown) => modifies.push(ids));
      await runtime.chargerProfilsPublics(['u2']);
      expect(modifies).toEqual([['u2']]);
    });

    it('découpe les requêtes par lots de 100 ids', async () => {
      const runtime = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(reponseJson([]));
      vi.stubGlobal('fetch', fetchMock);
      await runtime.chargerProfilsPublics(
        Array.from({ length: 150 }, (_, i) => `x${i}`)
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('le poll renvoie un signe de vie si notre statut est en ligne', async () => {
      vi.useFakeTimers();
      const runtime = runtimeConnecte();
      const fetchMock = vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          reponseJson(
            url.endsWith('/api/config-utilisateur')
              ? {
                  statutPresence: 'enLigne',
                  vuLaDerniereFois: '2026-01-01T00:00:00.000Z',
                }
              : {}
          )
        )
      );
      vi.stubGlobal('fetch', fetchMock);
      runtime.demarrerPollPresence();
      await vi.advanceTimersByTimeAsync(0);
      const put = fetchMock.mock.calls.find(([, o]) => o?.method === 'PUT');
      expect(put?.[0]).toBe(
        'http://gateway.test/api/config-utilisateur/presence'
      );
      expect(JSON.parse(put?.[1].body)).toEqual({ statut: 'enLigne' });
      runtime.arreterPollPresence();
      vi.useRealTimers();
    });

    it("le poll n'envoie rien si on a choisi hors ligne", async () => {
      vi.useFakeTimers();
      const runtime = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson({
          statutPresence: 'horsLigne',
          vuLaDerniereFois: '2026-01-01T00:00:00.000Z',
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      runtime.demarrerPollPresence();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(
        false
      );
      runtime.arreterPollPresence();
      vi.useRealTimers();
    });
  });

  describe('nouveau message privé : suggestions et recherche', () => {
    function runtimeConnecte() {
      const { runtime } = creerRuntime();
      runtime.jeton = 'jwt';
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      runtime.enregistrerUtilisateurConnu(runtime.utilisateurConnecte);
      return runtime;
    }

    // Répond selon l'URL, comme le Gateway réel.
    function routes(table: Record<string, unknown>) {
      return vi.fn().mockImplementation((url: string) => {
        const chemin = url.replace('http://gateway.test', '').split('?')[0];
        return Promise.resolve(reponseJson(table[chemin] ?? []));
      });
    }

    it('suggère les premiers membres de mes serveurs et les interlocuteurs connus, sans soi-même', async () => {
      const runtime = runtimeConnecte();
      runtime.partenairesDmConnus.add('u4');
      const page = (membres: string[]) => ({
        membres: membres.map((utilisateurId) => ({
          utilisateurId,
          role: 'membre',
        })),
        total: membres.length,
        suivant: null,
      });
      const table = routes({
        '/api/servers': [
          { id: 's1', salons: [] },
          { id: 's2', salons: [] },
          { id: 's3', salons: [] },
          { id: 's4', salons: [] },
        ],
        '/api/servers/s1/members': page(['u1', 'u2']),
        '/api/servers/s2/members': page(['u3', 'u2']),
        // s3 : réponse sans membres ; s4 : panne réseau (ignorée).
        '/api/users/lookup': [
          { id: 'u2', pseudo: 'zed' },
          { id: 'u3', pseudo: 'bob' },
          { id: 'u4', pseudo: 'carl' },
        ],
        '/api/config-utilisateur/publiques': [
          { idUtilisateur: 'u2', alias: 'Alice', avatar: null, actif: true },
        ],
      });
      const fetchMock = vi.fn((url: string) =>
        url.includes('/api/servers/s4/members')
          ? Promise.reject(new Error('réseau'))
          : table(url)
      );
      vi.stubGlobal('fetch', fetchMock);

      const suggestions = await runtime.obtenirSuggestionsDm();

      // Trié par nom affiché (alias prioritaire) : Alice, bob, carl.
      expect(suggestions.map((u: { id: string }) => u.id)).toEqual([
        'u2',
        'u3',
        'u4',
      ]);
      expect(suggestions[0]).toMatchObject({
        pseudo: 'zed',
        alias: 'Alice',
        present: true,
      });
      // Seulement les premiers membres de chaque serveur.
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('/api/servers/s1/members?limite=20')
        )
      ).toBe(true);
    });

    it('membres d’un serveur par pages, avec les utilisateurs résolus', async () => {
      const runtime = runtimeConnecte();
      const fetchMock = routes({
        '/api/servers/srv/members': {
          membres: [
            { utilisateurId: 'u1', role: 'proprietaire' },
            { utilisateurId: 'u2', role: 'membre' },
          ],
          total: 3,
          suivant: 2,
        },
        '/api/users/lookup': [
          { id: 'u1', pseudo: 'ana' },
          { id: 'u2', pseudo: 'ben' },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const page = await runtime.obtenirMembresServeur({ serveurId: 'srv' });

      expect(page).toMatchObject({ total: 3, suivant: 2 });
      expect(page.utilisateurs.map((u: { id: string }) => u.id).sort()).toEqual(
        ['u1', 'u2']
      );
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        '/api/servers/srv/members?decalage=0&limite=50'
      );

      await runtime.obtenirMembresServeur({
        serveurId: 'srv',
        decalage: 2,
        limite: 10,
      });
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('decalage=2&limite=10')
        )
      ).toBe(true);
    });

    it('membresParmi : lesquels sont déjà membres (100 ids au plus)', async () => {
      const runtime = runtimeConnecte();
      const fetchMock = routes({
        '/api/servers/srv/members': {
          membres: [{ utilisateurId: 'u2', role: 'membre' }],
          total: 1,
          suivant: null,
        },
      });
      vi.stubGlobal('fetch', fetchMock);

      expect(await runtime.membresParmi({ serveurId: 'srv', ids: [] })).toEqual(
        []
      );
      expect(await runtime.membresParmi({ serveurId: 'srv' })).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();

      const ids = [
        'u1',
        'u2',
        'u2',
        '',
        ...Array.from({ length: 150 }, (_, i) => `x${i}`),
      ];
      expect(await runtime.membresParmi({ serveurId: 'srv', ids })).toEqual([
        'u2',
      ]);
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('/api/servers/srv/members?ids=u1,u2,x0');
      expect(url.split('?ids=')[1].split(',')).toHaveLength(100);
    });

    it('obtenirMembresServeur sans argument : valeurs par défaut', async () => {
      const runtime = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        routes({
          '/api/servers/undefined/members': {
            membres: [],
            total: 0,
            suivant: null,
          },
        })
      );
      await expect(runtime.obtenirMembresServeur()).resolves.toMatchObject({
        membres: [],
        utilisateurs: [],
      });
    });

    it('recherche par pseudo via /api/users/search et enregistre les résultats', async () => {
      const runtime = runtimeConnecte();
      const fetchMock = routes({
        '/api/users/search': [
          { id: 'u1', pseudo: 'ariane' },
          { id: 'u5', pseudo: 'arnaud' },
        ],
      });
      vi.stubGlobal('fetch', fetchMock);

      const resultats = await runtime.rechercherUtilisateurs('  ar ');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://gateway.test/api/users/search?q=ar&limit=20'
      );
      // Soi-même retiré des résultats.
      expect(resultats.map((u: { id: string }) => u.id)).toEqual(['u5']);
      expect(runtime.utilisateursConnus.has('u5')).toBe(true);
    });

    it("n'appelle pas le serveur pour une recherche vide", async () => {
      const runtime = runtimeConnecte();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect(await runtime.rechercherUtilisateurs('   ')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('présence en temps réel', () => {
    function runtimeConnecte() {
      const { runtime, socket } = creerRuntime();
      runtime.jeton = 'jwt';
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.connecterSocket();
      // Socket authentifié côté Message-Service.
      socket._declencher('connexion.prete');
      return { runtime, socket };
    }

    it("applique immédiatement un 'presence.changed' reçu et émet 'presence'", () => {
      const { runtime, socket } = runtimeConnecte();
      const recues: unknown[] = [];
      runtime.on('presence', (p: unknown) => recues.push(p));

      socket._declencher('presence.changed', {
        userId: 'u2',
        statut: 'en-ligne',
      });
      socket._declencher('presence.changed', {
        userId: 'u2',
        statut: 'en-ligne',
      });
      socket._declencher('presence.changed', {
        userId: 'u2',
        statut: 'absent',
      });
      socket._declencher('presence.changed', null);

      expect(runtime.presences.u2).toBe('en-ligne');
      // Un seul événement : doublon et payloads invalides ignorés.
      expect(recues).toEqual([
        expect.objectContaining({ utilisateurId: 'u2', statut: 'en-ligne' }),
      ]);
    });

    it('un « hors ligne » en temps réel prime sur le sondage pendant 100 s', async () => {
      vi.useFakeTimers();
      const { runtime, socket } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            reponseJson([{ idUtilisateur: 'u2', alias: null, actif: true }])
          )
      );

      socket._declencher('presence.changed', {
        userId: 'u2',
        statut: 'hors-ligne',
      });
      await runtime.chargerProfilsPublics(['u2'], { inclureAvatar: false });
      expect(runtime.presences.u2).toBe('hors-ligne');

      // Passé ce délai, le serveur fait de nouveau foi.
      vi.advanceTimersByTime(100_001);
      await runtime.chargerProfilsPublics(['u2'], { inclureAvatar: false });
      expect(runtime.presences.u2).toBe('en-ligne');

      // Un retour « en ligne » en temps réel lève la priorité aussitôt.
      socket._declencher('presence.changed', {
        userId: 'u2',
        statut: 'hors-ligne',
      });
      socket._declencher('presence.changed', {
        userId: 'u2',
        statut: 'en-ligne',
      });
      await runtime.chargerProfilsPublics(['u2'], { inclureAvatar: false });
      expect(runtime.presences.u2).toBe('en-ligne');
      vi.useRealTimers();
    });

    it('annonce sa présence après un changement, et à la (re)connexion du socket', async () => {
      const { runtime, socket } = runtimeConnecte();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseJson({}, 204)));
      runtime.etatConnexion.statut = 'connecte';

      await runtime.modifierPresence({ statut: 'hors-ligne' });
      expect(socket.emit).toHaveBeenCalledWith('presence.update', {
        statut: 'hors-ligne',
      });

      socket.emit.mockClear();
      // 'connect' seul ne suffit pas : le serveur refuserait l'annonce tant
      // que le socket n'est pas authentifié ('connexion.prete').
      socket._declencher('connect');
      expect(socket.emit).not.toHaveBeenCalledWith(
        'presence.update',
        expect.anything()
      );
      socket._declencher('connexion.prete');
      expect(socket.emit).toHaveBeenCalledWith('presence.update', {
        statut: 'hors-ligne',
      });
    });

    it("l'instantané met hors ligne les connus absents de la liste (partis juste avant)", () => {
      const { runtime } = runtimeConnecte();
      runtime.enregistrerUtilisateurConnu({ id: 'parti', pseudo: 'parti' });
      runtime.presences.parti = 'en-ligne'; // vu en ligne par le sondage
      runtime.presences.moi = 'en-ligne';
      const recues: unknown[] = [];
      runtime.on('presence', (p: unknown) => recues.push(p));

      runtime.traiterInstantanePresence({ enLigne: ['present', 'moi'] });

      expect(runtime.presences).toMatchObject({
        parti: 'hors-ligne',
        present: 'en-ligne',
        moi: 'en-ligne', // sa propre présence n'est pas touchée
      });
      expect(recues).toHaveLength(2);
    });

    it('tant que le socket est connecté, le sondage ne remet pas « en ligne » un absent de la liste', async () => {
      const { runtime, socket } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          reponseJson([
            { idUtilisateur: 'parti', alias: null, actif: true },
            { idUtilisateur: 'present', alias: null, actif: true },
          ])
        )
      );
      runtime.traiterInstantanePresence({ enLigne: ['present'] });

      await runtime.chargerProfilsPublics(['parti', 'present'], {
        inclureAvatar: false,
      });
      expect(runtime.presences).toMatchObject({
        parti: 'hors-ligne',
        present: 'en-ligne',
      });

      // Les événements suivants tiennent la liste à jour.
      socket._declencher('presence.changed', {
        userId: 'parti',
        statut: 'en-ligne',
      });
      socket._declencher('presence.changed', {
        userId: 'present',
        statut: 'hors-ligne',
      });
      await runtime.chargerProfilsPublics(['parti', 'present'], {
        inclureAvatar: false,
      });
      expect(runtime.presences).toMatchObject({
        parti: 'en-ligne',
        present: 'hors-ligne',
      });
    });

    it('socket coupé : la liste temps réel est abandonnée (retour au sondage)', () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.traiterInstantanePresence({ enLigne: ['u2'] });
      expect(runtime.enLigneTempsReel).not.toBeNull();
      socket._declencher('disconnect');
      expect(runtime.enLigneTempsReel).toBeNull();

      runtime.traiterInstantanePresence({ enLigne: ['u2'] });
      runtime.fermerSocket();
      expect(runtime.enLigneTempsReel).toBeNull();
    });

    it('ignore un instantané invalide', () => {
      const { runtime } = runtimeConnecte();
      runtime.traiterInstantanePresence({ enLigne: 'u2' });
      runtime.traiterInstantanePresence({ enLigne: [1] });
      runtime.traiterInstantanePresence(null);
      expect(runtime.enLigneTempsReel).toBeNull();
    });

    describe('presence.suivre (abonnement aux utilisateurs connus)', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      // Socket pas encore connecté (contrairement à runtimeConnecte).
      const preparer = () => {
        const { runtime, socket } = creerRuntime();
        runtime.jeton = 'jwt';
        runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
        return { runtime, socket };
      };
      const appelsSuivre = (socket: ReturnType<typeof creerFauxSocket>) =>
        socket.emit.mock.calls.filter(([e]) => e === 'presence.suivre');

      it('après connexion.prete : suit les connus (sans soi), applique la réponse', () => {
        const { runtime, socket } = preparer();
        runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'deux' });
        runtime.enregistrerUtilisateurConnu({ id: 'u3', pseudo: 'trois' });
        runtime.presences.u3 = 'en-ligne';
        runtime.connecterSocket();
        socket._declencher('connexion.prete');

        const [[, donnees, ack]] = appelsSuivre(socket);
        expect(donnees).toEqual({ ids: ['u2', 'u3'] });
        expect(socket.timeout).toHaveBeenCalledWith(8000);
        ack(null, { enLigne: ['u2'] });
        expect(runtime.presences).toMatchObject({
          u2: 'en-ligne',
          u3: 'hors-ligne',
        });

        // Même liste : rien n'est renvoyé.
        runtime.suivrePresence();
        expect(appelsSuivre(socket)).toHaveLength(1);
      });

      it('regroupe les nouveaux utilisateurs, et retente après un refus', () => {
        vi.useFakeTimers();
        const { runtime, socket } = preparer();
        runtime.connecterSocket();
        socket._declencher('connexion.prete');
        const [[, , premierAck]] = appelsSuivre(socket);
        premierAck(null, { enLigne: [] });

        runtime.enregistrerUtilisateurConnu({ id: 'a', pseudo: 'a' });
        runtime.enregistrerUtilisateurConnu({ id: 'b', pseudo: 'b' });
        runtime.enregistrerUtilisateurConnu({ id: 'a', pseudo: 'a2' });
        expect(appelsSuivre(socket)).toHaveLength(1);
        vi.advanceTimersByTime(1100);
        expect(appelsSuivre(socket)).toHaveLength(2);
        expect(appelsSuivre(socket)[1][1]).toEqual({ ids: ['a', 'b'] });

        // Refus (trop rapproché) : redemandé plus tard.
        appelsSuivre(socket)[1][2](new Error('timeout'));
        vi.advanceTimersByTime(1100);
        expect(appelsSuivre(socket)).toHaveLength(3);
      });

      it('sans socket prêt : rien ; réponse d’un ancien socket ignorée', () => {
        vi.useFakeTimers();
        const { runtime, socket } = preparer();
        runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'deux' });
        runtime.suivrePresence();
        expect(appelsSuivre(socket)).toHaveLength(0);

        runtime.connecterSocket();
        socket._declencher('connexion.prete');
        const [[, , ack]] = appelsSuivre(socket);
        runtime.planifierSuiviPresence();
        runtime.fermerSocket();
        ack(null, { enLigne: ['u2'] });
        expect(runtime.presences.u2).toBeUndefined();
        vi.advanceTimersByTime(2000);
        expect(appelsSuivre(socket)).toHaveLength(1);
      });

      it('500 utilisateurs suivis au plus, les plus récents', () => {
        const { runtime, socket } = preparer();
        for (let i = 0; i < 520; i += 1) {
          runtime.utilisateursConnus.set(`u${i}`, {
            id: `u${i}`,
            pseudo: `u${i}`,
          });
        }
        runtime.connecterSocket();
        socket._declencher('connexion.prete');
        const ids = appelsSuivre(socket)[0][1].ids;
        expect(ids).toHaveLength(500);
        expect(ids[0]).toBe('u20');
      });
    });

    it("n'annonce rien tant que sa présence est inconnue ou le socket fermé", () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.annoncerPresence();
      runtime.presences.moi = 'en-ligne';
      socket.connected = false;
      runtime.annoncerPresence();
      expect(socket.emit).not.toHaveBeenCalledWith(
        'presence.update',
        expect.anything()
      );
    });
  });

  describe('serveurs et profils en temps réel', () => {
    function runtimeConnecte() {
      const { runtime, socket } = creerRuntime();
      runtime.jeton = 'jwt';
      runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
      runtime.connecterSocket();
      // Socket authentifié côté Message-Service.
      socket._declencher('connexion.prete');
      return { runtime, socket };
    }

    it("relaie 'serveur.change' aux pages, et ignore un événement invalide", () => {
      const { runtime, socket } = runtimeConnecte();
      const recus: unknown[] = [];
      runtime.on('serveur-change', (e: unknown) => recus.push(e));

      socket._declencher('serveur.change', {
        serveurId: 's1',
        raison: 'expulse',
        cibleId: 'moi',
      });
      socket._declencher('serveur.change', {
        serveurId: 's1',
        raison: 'salons',
        cibleId: null,
      });
      socket._declencher('serveur.change', { serveurId: 1, raison: 'salons' });
      socket._declencher('serveur.change', null);

      expect(recus).toEqual([
        { serveurId: 's1', raison: 'expulse', cibleId: 'moi' },
        { serveurId: 's1', raison: 'salons', cibleId: null },
      ]);
    });

    it('serveur par défaut : ignore un changement de membre qui ne nous vise pas', () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.serveurs.set('defaut', { id: 'defaut', parDefaut: true });
      runtime.serveurs.set('projet', { id: 'projet', parDefaut: false });
      const recus: unknown[] = [];
      runtime.on('serveur-change', (e: unknown) => recus.push(e));
      const moi = runtime.utilisateurConnecte.id;

      socket._declencher('serveur.change', {
        serveurId: 'defaut',
        raison: 'membres',
        cibleId: 'autre',
      });
      socket._declencher('serveur.change', {
        serveurId: 'defaut',
        raison: 'membres',
        cibleId: moi,
      });
      socket._declencher('serveur.change', {
        serveurId: 'projet',
        raison: 'membres',
        cibleId: 'autre',
      });
      socket._declencher('serveur.change', {
        serveurId: 'defaut',
        raison: 'salons',
        cibleId: null,
      });

      expect(recus).toEqual([
        { serveurId: 'defaut', raison: 'membres', cibleId: moi },
        { serveurId: 'projet', raison: 'membres', cibleId: 'autre' },
        { serveurId: 'defaut', raison: 'salons', cibleId: null },
      ]);
    });

    it("annonce 'profil.update' après un changement d'alias, d'avatar ou de pseudo (pas de thème)", async () => {
      const { runtime, socket } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          reponseJson({
            theme: 'sombre',
            alias: 'A',
            avatar: null,
            id: 'moi',
            pseudo: 'neuf',
          })
        )
      );
      await runtime.configModifier({ theme: 'clair' });
      expect(socket.emit).not.toHaveBeenCalledWith('profil.update');
      await runtime.configModifier({ alias: 'A' });
      await runtime.configModifier({ avatar: null });
      await runtime.profilModifierPseudo('neuf');
      expect(
        socket.emit.mock.calls.filter(([e]) => e === 'profil.update')
      ).toHaveLength(3);
    });

    it("recharge le profil d'un utilisateur affiché et signale un pseudo changé", async () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'ancien' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) =>
          Promise.resolve(
            reponseJson(
              url.includes('/api/users/lookup')
                ? [{ id: 'u2', pseudo: 'nouveau' }]
                : [
                    {
                      idUtilisateur: 'u2',
                      alias: null,
                      avatar: null,
                      actif: false,
                    },
                  ]
            )
          )
        )
      );
      const modifies: unknown[] = [];
      runtime.on('profils-publics', (ids: unknown) => modifies.push(ids));

      socket._declencher('profil.changed', { userId: 'u2' });
      await vi.waitFor(() => expect(modifies).toEqual([['u2']]));
      expect(runtime.utilisateursConnus.get('u2').pseudo).toBe('nouveau');
    });

    it("ignore 'profil.changed' pour soi-même, un inconnu ou un payload invalide", () => {
      const { runtime, socket } = runtimeConnecte();
      const rafraichir = vi.spyOn(runtime, 'rafraichirProfil');
      socket._declencher('profil.changed', { userId: 'moi' });
      socket._declencher('profil.changed', { userId: 'jamais-vu' });
      socket._declencher('profil.changed', { userId: 42 });
      expect(rafraichir).not.toHaveBeenCalled();
    });
  });

  describe('reconnexion automatique', () => {
    // Un socket neuf à chaque tentative, pour vérifier qu'une reconnexion
    // ouvre bien un nouveau socket.
    function creerRuntimeMultiSockets() {
      const sockets: ReturnType<typeof creerFauxSocket>[] = [];
      const runtime = new RealGatewayRuntime(
        {
          baseUrlHttp: 'http://gateway.test',
          baseUrlSocket: 'http://gateway.test',
        },
        {
          chargerJetonPersiste: vi.fn(() => null),
          sauvegarderJetonPersiste: vi.fn(),
          creerSocket: vi.fn(() => {
            const socket = creerFauxSocket();
            sockets.push(socket);
            return socket;
          }),
        }
      );
      runtime.jeton = 'jwt';
      runtime.utilisateurConnecte = { id: 'u1', pseudo: 'ariane' };
      return { runtime, sockets };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(reponseJson({ status: 'ok' }))
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("un connect_error planifie une nouvelle tentative (plus de blocage sur 'reconnexion')", () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();

      sockets[0]._declencher('connect_error', new Error('refused'));
      expect(runtime.obtenirEtatConnexion()).toMatchObject({
        statut: 'reconnexion',
        cause: 'serveur-injoignable',
      });
      expect(runtime.obtenirEtatConnexion().prochaineTentative).toBeGreaterThan(
        Date.now()
      );

      vi.advanceTimersByTime(1000);
      expect(sockets).toHaveLength(2);

      sockets[1]._declencher('connect');
      expect(runtime.obtenirEtatConnexion()).toMatchObject({
        statut: 'connecte',
        reconnexions: 1,
      });
      expect(runtime.obtenirEtatConnexion().cause).toBeUndefined();
    });

    it('double le délai à chaque échec, plafonné', () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();
      const delais: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        sockets[sockets.length - 1]._declencher(
          'connect_error',
          new Error('x')
        );
        delais.push(
          runtime.obtenirEtatConnexion().prochaineTentative - Date.now()
        );
        vi.advanceTimersByTime(delais[delais.length - 1]);
      }
      expect(delais).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    });

    it("disconnect puis connect_error ne planifient qu'une seule tentative", () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();
      sockets[0]._declencher('disconnect');
      sockets[0]._declencher('connect_error', new Error('x'));
      vi.advanceTimersByTime(1000);
      expect(sockets).toHaveLength(2);
    });

    it("hors ligne côté OS : 'deconnecte' sans tentative, puis reconnexion immédiate au retour", () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();
      sockets[0]._declencher('connect');

      runtime.signalerReseauSysteme(false);
      expect(runtime.obtenirEtatConnexion()).toMatchObject({
        statut: 'deconnecte',
        cause: 'hors-ligne',
      });
      expect(sockets[0].disconnect).toHaveBeenCalled();
      vi.advanceTimersByTime(60000);
      expect(sockets).toHaveLength(1);

      runtime.signalerReseauSysteme(true);
      expect(sockets).toHaveLength(2);
      expect(runtime.obtenirEtatConnexion().statut).toBe('reconnexion');
    });

    it('reconnecterMaintenant saute le délai en cours', () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();
      sockets[0]._declencher('connect_error', new Error('x'));
      runtime.reconnecterMaintenant();
      expect(sockets).toHaveLength(2);
      // L'ancienne tentative planifiée est annulée.
      vi.advanceTimersByTime(1000);
      expect(sockets).toHaveLength(2);
    });

    it('un battement de cœur en échec force une reconnexion', async () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();
      sockets[0]._declencher('connect');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

      await vi.advanceTimersByTimeAsync(15000);

      expect(sockets[0].disconnect).toHaveBeenCalled();
      expect(runtime.obtenirEtatConnexion().statut).toBe('reconnexion');
    });

    it('une déconnexion volontaire annule toute reconnexion', async () => {
      const { runtime, sockets } = creerRuntimeMultiSockets();
      runtime.connecterSocket();
      sockets[0]._declencher('connect_error', new Error('x'));
      await runtime.deconnexion();
      vi.advanceTimersByTime(60000);
      expect(sockets).toHaveLength(1);
      expect(runtime.obtenirEtatConnexion().statut).toBe('deconnecte');
    });
  });

  describe('restaurerSession', () => {
    it('conserve le jeton persisté si le serveur est injoignable', async () => {
      const sauvegarder = vi.fn();
      const runtime = new RealGatewayRuntime(
        {
          baseUrlHttp: 'http://gateway.test',
          baseUrlSocket: 'http://gateway.test',
        },
        {
          chargerJetonPersiste: vi.fn(() => 'jwt'),
          sauvegarderJetonPersiste: sauvegarder,
          creerSocket: vi.fn(() => creerFauxSocket()),
        }
      );
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
      expect(await runtime.restaurerSession()).toBeNull();
      expect(sauvegarder).not.toHaveBeenCalled();
    });

    it('purge le jeton persisté sur 401', async () => {
      const sauvegarder = vi.fn();
      const runtime = new RealGatewayRuntime(
        {
          baseUrlHttp: 'http://gateway.test',
          baseUrlSocket: 'http://gateway.test',
        },
        {
          chargerJetonPersiste: vi.fn(() => 'jwt'),
          sauvegarderJetonPersiste: sauvegarder,
          creerSocket: vi.fn(() => creerFauxSocket()),
        }
      );
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseJson({}, 401)));
      expect(await runtime.restaurerSession()).toBeNull();
      expect(sauvegarder).toHaveBeenCalledWith(null);
    });
  });
});
