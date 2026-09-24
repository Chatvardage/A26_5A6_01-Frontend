import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module CommonJS sans déclaration de types (voir son en-tête) : un import
// par ligne, pour que chaque @ts-expect-error vise bien sa ligne.
// @ts-expect-error -- pas de déclaration de types
import { RealGatewayRuntime } from './RealGatewayRuntime.js';
// @ts-expect-error -- pas de déclaration de types
import { chargerJetonPersiste } from './RealGatewayRuntime.js';
// @ts-expect-error -- pas de déclaration de types
import { sauvegarderJetonPersiste } from './RealGatewayRuntime.js';

// Compléments de RealGatewayRuntime.test.ts : chemins moins fréquents
// (erreurs, repli, événements temps réel, persistance du jeton), pour que
// ce fichier — le vrai client réseau de l'app — reste couvert à 100 %.

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
  const sockets: Array<ReturnType<typeof creerFauxSocket>> = [];
  const runtime = new RealGatewayRuntime(
    {
      baseUrlHttp: 'http://gateway.test',
      baseUrlSocket: 'http://gateway.test',
    },
    {
      chargerJetonPersiste: vi.fn(() => null),
      sauvegarderJetonPersiste: vi.fn(),
      creerSocket: vi.fn(() => {
        const nouveau = creerFauxSocket();
        sockets.push(nouveau);
        return nouveau;
      }),
    }
  );
  return { runtime, sockets, socket: () => sockets[sockets.length - 1] };
}

/** Runtime avec une session ouverte (utilisateur `moi`), sans réseau. */
function runtimeConnecte() {
  const outils = creerRuntime();
  outils.runtime.jeton = 'jwt';
  outils.runtime.utilisateurConnecte = { id: 'moi', pseudo: 'moi' };
  outils.runtime.etatConnexion = {
    statut: 'connecte',
    depuis: 0,
    reconnexions: 0,
  };
  return outils;
}

const messageBrut = (surcharges: Record<string, unknown> = {}) => ({
  id: 'm1',
  senderId: 'u2',
  recipientId: 'moi',
  content: 'salut',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...surcharges,
});

describe('RealGatewayRuntime (couverture complémentaire)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('persistance du jeton sur disque', () => {
    // Même cache de modules que le require('electron') de
    // RealGatewayRuntime.js (résolu depuis la racine du projet).
    const requireLocal = createRequire(
      path.join(process.cwd(), 'package.json')
    );
    const cheminElectron = requireLocal.resolve('electron');
    let dossier: string;
    let ancien: NodeJS.Module | undefined;

    /** Faux `safeStorage` : « chiffre » en inversant la chaîne. */
    const coffre = (disponible = true) => ({
      isEncryptionAvailable: vi.fn(() => disponible),
      encryptString: vi.fn((texte: string) =>
        Buffer.from([...texte].reverse().join(''))
      ),
      decryptString: vi.fn((tampon: Buffer) =>
        [...tampon.toString()].reverse().join('')
      ),
    });

    const simulerElectron = (safeStorage?: unknown) => {
      requireLocal.cache[cheminElectron] = {
        exports: { app: { getPath: () => dossier }, safeStorage },
      } as unknown as NodeJS.Module;
    };

    beforeEach(() => {
      dossier = mkdtempSync(path.join(tmpdir(), 'cv-session-'));
      ancien = requireLocal.cache[cheminElectron];
      simulerElectron();
    });
    afterEach(() => {
      if (ancien) requireLocal.cache[cheminElectron] = ancien;
      else delete requireLocal.cache[cheminElectron];
      rmSync(dossier, { recursive: true, force: true });
    });

    const fichier = () => path.join(dossier, 'session.json');
    const lire = () => JSON.parse(readFileSync(fichier(), 'utf8'));

    it('chiffre le jeton : jamais en clair dans le fichier', () => {
      simulerElectron(coffre());
      sauvegarderJetonPersiste('jwt-secret');
      const contenu = readFileSync(fichier(), 'utf8');
      expect(contenu).not.toContain('jwt-secret');
      expect(lire()).toEqual({
        jetonChiffre: Buffer.from('terces-twj').toString('base64'),
      });
      expect(chargerJetonPersiste()).toBe('jwt-secret');
      if (process.platform !== 'win32') {
        expect(statSync(fichier()).mode & 0o777).toBe(0o600);
      }
    });

    it('sans chiffrement disponible : repli en clair, efface à la déconnexion', () => {
      expect(chargerJetonPersiste()).toBeNull();
      simulerElectron(coffre(false));
      sauvegarderJetonPersiste('jwt-1');
      expect(lire()).toEqual({ jeton: 'jwt-1' });
      expect(chargerJetonPersiste()).toBe('jwt-1');
      sauvegarderJetonPersiste(null);
      expect(existsSync(fichier())).toBe(false);
    });

    it('migre un ancien jeton en clair vers le format chiffré', () => {
      writeFileSync(fichier(), JSON.stringify({ jeton: 'ancien-jwt' }), {
        mode: 0o644,
      });
      simulerElectron(coffre());
      expect(chargerJetonPersiste()).toBe('ancien-jwt');
      expect(lire()).toHaveProperty('jetonChiffre');
      expect(readFileSync(fichier(), 'utf8')).not.toContain('ancien-jwt');
      if (process.platform !== 'win32') {
        expect(statSync(fichier()).mode & 0o777).toBe(0o600);
      }
    });

    it('jeton chiffré illisible : reconnexion demandée (null)', () => {
      writeFileSync(fichier(), JSON.stringify({ jetonChiffre: 'AAAA' }));
      // Trousseau indisponible (autre session, keyring absent…).
      simulerElectron(coffre(false));
      expect(chargerJetonPersiste()).toBeNull();
      // Déchiffrement en erreur (trousseau changé).
      const enErreur = coffre();
      enErreur.decryptString.mockImplementation(() => {
        throw new Error('clé inconnue');
      });
      simulerElectron(enErreur);
      expect(chargerJetonPersiste()).toBeNull();
      // Déchiffré, mais vide.
      const vide = coffre();
      vide.decryptString.mockReturnValue('');
      simulerElectron(vide);
      expect(chargerJetonPersiste()).toBeNull();
    });

    it('ignore un fichier sans jeton exploitable', () => {
      writeFileSync(fichier(), JSON.stringify({ jeton: '' }));
      expect(chargerJetonPersiste()).toBeNull();
      writeFileSync(fichier(), JSON.stringify({ jeton: 42 }));
      expect(chargerJetonPersiste()).toBeNull();
      writeFileSync(fichier(), JSON.stringify({ jetonChiffre: '' }));
      expect(chargerJetonPersiste()).toBeNull();
    });

    it("journalise une écriture impossible sans lever d'erreur", () => {
      const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
      requireLocal.cache[cheminElectron] = {
        exports: {
          app: { getPath: () => path.join(dossier, 'inexistant', 'profond') },
        },
      } as unknown as NodeJS.Module;
      expect(() => sauvegarderJetonPersiste('jwt')).not.toThrow();
      expect(journal).toHaveBeenCalled();
    });

    it('utilise la persistance réelle par défaut', () => {
      const runtime = new RealGatewayRuntime({
        baseUrlHttp: 'http://g.test',
        baseUrlSocket: 'http://g.test',
      });
      expect(runtime.chargerJetonPersiste).toBe(chargerJetonPersiste);
      expect(runtime.sauvegarderJetonPersiste).toBe(sauvegarderJetonPersiste);
      expect(typeof runtime.creerSocket).toBe('function');
    });
  });

  describe('abonnements et HTTP', () => {
    it("se désabonne d'un événement", () => {
      const { runtime } = creerRuntime();
      const a = vi.fn();
      const b = vi.fn();
      const desabonnerA = runtime.on('x', a);
      runtime.on('x', b);
      desabonnerA();
      runtime.emettre('x', 1);
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledWith(1);
      // Désabonnement d'un type devenu vide : sans erreur.
      runtime.ecouteurs.delete('x');
      expect(() => desabonnerA()).not.toThrow();
    });

    it("garde le code HTTP si le corps d'erreur n'est pas du JSON", async () => {
      const { runtime } = creerRuntime();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('pas du json');
          },
        })
      );
      await expect(runtime.appelHttp('/x')).rejects.toMatchObject({
        message: 'ERR_HTTP_502',
        statut: 502,
        detail: undefined,
      });
    });

    it('refuse une action réseau hors connexion', () => {
      const { runtime } = creerRuntime();
      expect(() => runtime.verifierReseauConnecte()).toThrow(
        'ERR_RESEAU_NON_CONNECTE'
      );
    });

    it('enregistre un utilisateur connu avec des valeurs de repli', () => {
      const { runtime } = creerRuntime();
      runtime.enregistrerUtilisateurConnu(null);
      runtime.enregistrerUtilisateurConnu({ pseudo: 'sans-id' });
      runtime.enregistrerUtilisateurConnu({ id: 'u1' });
      expect(runtime.utilisateursConnus.get('u1')).toEqual({
        id: 'u1',
        pseudo: 'u1',
        role: undefined,
      });
      runtime.enregistrerUtilisateurConnu({
        id: 'u1',
        pseudo: 'alice',
        role: 'admin',
      });
      runtime.enregistrerUtilisateurConnu({ id: 'u1' });
      expect(runtime.utilisateursConnus.get('u1')).toEqual({
        id: 'u1',
        pseudo: 'alice',
        role: 'admin',
      });
      expect(runtime.obtenirUtilisateurs()).toEqual([
        { id: 'u1', pseudo: 'alice', role: 'admin', alias: null, avatar: null },
      ]);
    });
  });

  describe('profil et session', () => {
    it('lit, modifie et supprime le compte', async () => {
      const { runtime, sockets } = runtimeConnecte();
      const brut = {
        id: 'moi',
        pseudo: 'moi2',
        courriel: 'm@x.test',
        role: 'utilisateur',
      };
      // Signature complète (url, options) pour lire le corps envoyé.
      const fetchMock = vi.fn<
        (
          url: string,
          options?: { method?: string; body?: string }
        ) => Promise<ReturnType<typeof reponseJson>>
      >(async (url) =>
        url.endsWith('/api/auth/login')
          ? reponseJson({ jeton: 'jwt-neuf', utilisateur: brut })
          : reponseJson(brut)
      );
      vi.stubGlobal('fetch', fetchMock);
      const corps = (i: number) =>
        JSON.parse(fetchMock.mock.calls[i][1]?.body ?? '{}');

      expect(await runtime.profilObtenir()).toEqual(brut);
      expect(runtime.obtenirUtilisateurConnecte()).toEqual(brut);

      // Sans nouveau mot de passe : pas de renouvellement du jeton.
      await runtime.profilModifierCompte({ motDePasseActuel: 'actuel' });
      expect(corps(1)).toEqual({ mot_de_passe_actuel: 'actuel' });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await runtime.profilModifierCompte({
        motDePasse: 'nouveau123',
        motDePasseActuel: 'actuel',
      });
      expect(corps(2)).toEqual({
        mot_de_passe_actuel: 'actuel',
        mot_de_passe: 'nouveau123',
      });
      // Jeton révoqué par le changement : reconnexion avec le nouveau mot
      // de passe, nouveau jeton persisté, socket rouvert.
      expect(String(fetchMock.mock.calls[3][0])).toContain('/api/auth/login');
      expect(corps(3)).toEqual({
        identifiant: 'm@x.test',
        mot_de_passe: 'nouveau123',
      });
      expect(runtime.jeton).toBe('jwt-neuf');
      expect(runtime.sauvegarderJetonPersiste).toHaveBeenCalledWith('jwt-neuf');
      expect(sockets).toHaveLength(1);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => null,
      });
      await runtime.profilSupprimerCompte('actuel');
      expect(fetchMock.mock.calls[4][1]?.method).toBe('DELETE');
      expect(runtime.obtenirUtilisateurConnecte()).toBeNull();
    });

    it('suppression du compte : présence suspendue pendant l’appel, reprise en cas d’échec', async () => {
      const { runtime } = runtimeConnecte();
      runtime.minuteurPollPresence = setInterval(() => undefined, 60_000);
      const demarrer = vi
        .spyOn(runtime, 'demarrerPollPresence')
        .mockImplementation(() => undefined);
      let pollPendantAppel: unknown = 'non appelé';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, options?: { method?: string }) => {
          if (options?.method !== 'DELETE') {
            // Vérification de session après le 401 : jeton toujours valide.
            return reponseJson({ id: 'moi', pseudo: 'moi' });
          }
          pollPendantAppel = runtime.minuteurPollPresence;
          return reponseJson({ erreur: 'mot de passe actuel incorrect' }, 401);
        })
      );

      await expect(runtime.profilSupprimerCompte('faux')).rejects.toThrow();
      expect(pollPendantAppel).toBeNull();
      // Le compte existe toujours : la présence reprend.
      expect(demarrer).toHaveBeenCalledTimes(1);
      expect(runtime.obtenirUtilisateurConnecte()).not.toBeNull();
    });

    it('mot de passe changé mais reconnexion impossible : code dédié', async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.endsWith('/api/auth/login')
            ? reponseJson({ erreur: 'trop de tentatives' }, 429)
            : reponseJson({ id: 'moi', pseudo: 'moi', courriel: 'm@x.test' })
        )
      );
      await expect(
        runtime.profilModifierCompte({
          motDePasse: 'nouveau123',
          motDePasseActuel: 'actuel',
        })
      ).rejects.toThrow('ERR_RECONNEXION_REQUISE');
      expect(runtime.jeton).toBe('jwt');
    });

    it('restaurerSession : rien à restaurer sans jeton', async () => {
      const { runtime } = creerRuntime();
      expect(await runtime.restaurerSession()).toBeNull();
    });

    it('configModifier : retire l’avatar et annonce les changements publics seulement', async () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.connecterSocket();
      socket()._declencher('connexion.prete');
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson({
          theme: 'clair',
          langue: 'fr',
          statutPresence: 'horsLigne',
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      await runtime.configModifier({ avatar: null, alias: 'A' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        avatar: '',
        alias: 'A',
      });
      expect(socket().emit).toHaveBeenCalledWith('profil.update');

      socket().emit.mockClear();
      await runtime.configModifier({
        theme: 'clair',
        langue: 'fr',
        modeNotification: 'aucune',
      });
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        theme: 'clair',
        langue: 'fr',
        modeNotification: 'aucune',
      });
      expect(socket().emit).not.toHaveBeenCalled();
    });
  });

  describe('événements temps réel', () => {
    it('relaie les messages privés et de salon reçus, modifiés et supprimés', () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.connecterSocket();
      const recus: Array<[string, unknown]> = [];
      for (const type of [
        'message-recu',
        'message-modifie',
        'message-supprime',
      ]) {
        runtime.on(type, (donnees: unknown) => recus.push([type, donnees]));
      }
      const s = socket();
      s._declencher('private-message.created', messageBrut());
      s._declencher(
        'private-message.updated',
        messageBrut({ updatedAt: '2026-01-02T00:00:00.000Z' })
      );
      s._declencher('private-message.deleted', { id: 'm1' });
      s._declencher('room-message.updated', {
        id: 'r1',
        roomId: 'salon',
        authorId: 'u2',
        content: 'modifié',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
      s._declencher('room-message.deleted', { id: 'r1' });

      expect(recus.map(([type]) => type)).toEqual([
        'message-recu',
        'message-modifie',
        'message-supprime',
        'message-modifie',
        'message-supprime',
      ]);
      expect(recus[1][1]).toMatchObject({
        id: 'm1',
        conversationId: 'moi:u2',
        modification: new Date('2026-01-02T00:00:00.000Z').getTime(),
      });
      expect(runtime.partenairesDmConnus.has('u2')).toBe(true);
      expect(runtime.indexMessages.has('m1')).toBe(false);
      expect(runtime.indexMessages.has('r1')).toBe(false);
    });

    it("ignore les événements d'un ancien socket", () => {
      const { runtime, sockets } = runtimeConnecte();
      runtime.connecterSocket();
      const ancien = sockets[0];
      runtime.connecterSocket();
      const planifier = vi.spyOn(runtime, 'planifierReconnexion');
      ancien._declencher('connexion.prete');
      expect(runtime.socketPret).toBe(false);
      ancien._declencher('connect');
      ancien._declencher('disconnect');
      ancien._declencher('connect_error');
      expect(planifier).not.toHaveBeenCalled();
    });

    it('état de saisie : ignoré sans utilisateur, mis à jour sinon', () => {
      const { runtime } = creerRuntime();
      runtime.traiterSaisieEntrante({
        scope: 'room',
        targetId: 's1',
        userId: 'u2',
      });
      runtime.traiterSaisieEntrante(null);
      expect(runtime.etatsSaisie).toEqual([]);

      runtime.utilisateurConnecte = { id: 'moi' };
      runtime.traiterSaisieEntrante({
        scope: 'dm',
        userId: 'u2',
        isTyping: true,
      });
      runtime.traiterSaisieEntrante({
        scope: 'dm',
        userId: 'u2',
        isTyping: false,
      });
      expect(runtime.obtenirEtatsSaisie({ conversationId: 'moi:u2' })).toEqual([
        { conversationId: 'moi:u2', utilisateurId: 'u2', est_saisie: false },
      ]);
      expect(runtime.obtenirEtatsSaisie('moi:u2')).toHaveLength(1);
      expect(runtime.obtenirEtatsSaisie(undefined)).toEqual([]);
    });

    it('modifierEtatSaisie : salon ou DM, refusé sans socket connecté', async () => {
      const { runtime, socket } = runtimeConnecte();
      await expect(
        runtime.modifierEtatSaisie({ conversationId: 's1', est_saisie: true })
      ).rejects.toThrow('ERR_RESEAU_NON_CONNECTE');

      runtime.connecterSocket();
      expect(
        await runtime.modifierEtatSaisie({
          conversationId: 's1',
          est_saisie: 1,
        })
      ).toEqual({
        conversationId: 's1',
        utilisateurId: 'moi',
        est_saisie: true,
      });
      await runtime.modifierEtatSaisie({
        conversationId: 'moi:u2',
        est_saisie: false,
      });
      expect(socket().emit).toHaveBeenCalledWith('typing', {
        scope: 'room',
        targetId: 's1',
        isTyping: true,
      });
      expect(socket().emit).toHaveBeenCalledWith('typing', {
        scope: 'dm',
        targetId: 'u2',
        isTyping: false,
      });

      socket().connected = false;
      await expect(
        runtime.modifierEtatSaisie({ conversationId: 's1', est_saisie: true })
      ).rejects.toThrow('ERR_RESEAU_NON_CONNECTE');
      runtime.utilisateurConnecte = null;
      socket().connected = true;
      expect(
        (
          await runtime.modifierEtatSaisie({
            conversationId: 's1',
            est_saisie: true,
          })
        ).utilisateurId
      ).toBeUndefined();
    });
  });

  describe('messages privés', () => {
    it('historique paginé, conversations et envoi', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn(
        async (url: string, options?: { method?: string }) => {
          if (url.includes('/api/messages/conversations')) {
            return reponseJson([
              { otherUserId: 'u2', lastMessage: messageBrut() },
            ]);
          }
          if (url.includes('/api/messages/history/')) {
            return reponseJson(url.includes('u3') ? [] : [messageBrut()]);
          }
          if (url.includes('/api/users/lookup')) {
            return reponseJson([{ id: 'u2', pseudo: 'bob' }]);
          }
          if (url.includes('/publiques')) return reponseJson([]);
          if (options?.method === 'POST') {
            return reponseJson(
              messageBrut({ id: 'm2', senderId: 'moi', recipientId: 'u3' })
            );
          }
          return reponseJson([]);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      const page = await runtime.obtenirMessagesPriveesAvant({
        conversationId: 'moi:u2',
        avantId: 'm0',
        taille: 1,
      });
      expect(page.finHistorique).toBe(false);
      expect(String(fetchMock.mock.calls[0][0])).toContain('cursor=m0');

      runtime.partenairesDmConnus.add('u3');
      const conversations = await runtime.obtenirConversationsPrivees();
      expect(conversations.map((c: { id: string }) => c.id)).toEqual([
        'moi:u2',
        'moi:u3',
      ]);
      expect(conversations[0].otherUser.pseudo).toBe('bob');
      // u3 : aucun message, pas de pseudo résolu.
      expect(conversations[1]).toMatchObject({
        lastMessage: null,
        otherUser: { pseudo: 'u3' },
      });

      const conversation = await runtime.demarrerConversationPrivee({
        autreUtilisateurId: 'u3',
      });
      expect(conversation.id).toBe('moi:u3');

      const envoye = await runtime.envoyerMessagePrive({
        conversationId: 'moi:u3',
        contenu: 'yo',
      });
      expect(envoye).toMatchObject({ id: 'm2', auteurId: 'moi' });
      expect(runtime.indexMessages.get('m2')).toEqual({ type: 'dm' });
    });

    it('conversations : erreur remontée si la liste serveur échoue', async () => {
      const { runtime } = runtimeConnecte();
      runtime.partenairesDmConnus.add('u2');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => reponseJson({ erreur: 'x' }, 500))
      );
      await expect(runtime.obtenirConversationsPrivees()).rejects.toThrow(
        'ERR_HTTP_500'
      );
    });

    it('conversation dont l’historique échoue : gardée, avec son dernier message', async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/conversations')) {
            return reponseJson([
              {
                otherUserId: 'casse',
                lastMessage: messageBrut({ id: 'dernier', senderId: 'casse' }),
              },
            ]);
          }
          if (url.includes('/history/'))
            return reponseJson({ erreur: 'x' }, 500);
          if (url.includes('/api/users/lookup'))
            return reponseJson({ erreur: 'x' }, 500);
          return reponseJson([]);
        })
      );
      const [conversation] = await runtime.obtenirConversationsPrivees();
      expect(conversation).toMatchObject({
        messages: [],
        finHistorique: false,
        lastMessage: { id: 'dernier' },
        // Pseudo non résolu : signalé pour que la page redemande.
        otherUser: { id: 'casse', pseudo: 'casse', pseudoInconnu: true },
      });
    });

    it('trie les conversations par dernier message, sans message en dernier', async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/conversations')) {
            return reponseJson([
              {
                otherUserId: 'ancien',
                lastMessage: messageBrut({
                  id: 'x',
                  senderId: 'ancien',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                }),
              },
              {
                otherUserId: 'recent',
                lastMessage: messageBrut({
                  id: 'y',
                  senderId: 'recent',
                  createdAt: '2026-03-01T00:00:00.000Z',
                  updatedAt: '2026-03-01T00:00:00.000Z',
                }),
              },
            ]);
          }
          // Historique vide : le dernier message connu (liste) sert de repli.
          return reponseJson([]);
        })
      );
      runtime.partenairesDmConnus.add('vide');
      const ids = (await runtime.obtenirConversationsPrivees()).map(
        (c: { id: string }) => c.id
      );
      // Identifiants triés par creerDmId ('ancien' < 'moi').
      expect(ids).toEqual(['moi:recent', 'ancien:moi', 'moi:vide']);
    });
  });

  describe('réponses vides et variantes', () => {
    const vide = () => ({ ok: true, status: 204, json: async () => null });

    it('tolère des réponses 204 et des erreurs de chargement des profils', async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(vide()));
      await runtime.resoudrePseudosInconnus(['u2']);
      await runtime.chargerProfilsPublics(['u2']);
      expect(runtime.presences.u2).toBe('hors-ligne');
      expect(await runtime.rechercherUtilisateurs('bo')).toEqual([]);
      expect(await runtime.obtenirResumesConversationsPrivees()).toEqual([]);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseJson({}, 500)));
      await runtime.chargerProfilsPublics(['u3']);
      expect(runtime.profilsPublics.has('u3')).toBe(false);
    });

    it('recherche vide ou non fournie : aucun appel', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect(await runtime.rechercherUtilisateurs(undefined)).toEqual([]);
      expect(await runtime.rechercherUtilisateurs('   ')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('restaure une session valide', async () => {
      const { runtime } = creerRuntime();
      runtime.chargerJetonPersiste = vi.fn(() => 'jwt-persiste');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(reponseJson({ id: 'moi', pseudo: 'moi' }))
      );
      const resultat = await runtime.restaurerSession();
      expect(resultat.utilisateur).toMatchObject({ id: 'moi' });
      expect(runtime.jeton).toBe('jwt-persiste');
      runtime.arreterPollPresence();
    });

    it("rafraichirProfil : pas d'événement si le pseudo n'a pas changé", async () => {
      const { runtime } = runtimeConnecte();
      runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'bob' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.includes('/lookup')
            ? reponseJson([{ id: 'u2', pseudo: 'bob' }])
            : reponseJson([])
        )
      );
      const evenements = vi.fn();
      runtime.on('profils-publics', evenements);
      await runtime.rafraichirProfil('u2');
      expect(evenements).not.toHaveBeenCalled();
    });

    it('reconnexion du socket : rejoint les salons et rattrape les photos', () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.salonsRejoints.add('s1');
      runtime.connecterSocket();
      socket()._declencher('connect');
      expect(runtime.avatarsARafraichir).toBe(false);
      socket()._declencher('connect');
      expect(runtime.avatarsARafraichir).toBe(true);
      // Salons rejoints seulement une fois le socket authentifié.
      expect(socket().emit).not.toHaveBeenCalledWith(
        'room-message.join',
        expect.anything(),
        expect.anything()
      );
      socket()._declencher('connexion.prete');
      expect(socket().emit).toHaveBeenCalledWith(
        'room-message.join',
        { roomId: 's1' },
        expect.any(Function)
      );
      runtime.arreterBattementCoeur();
    });

    it('obtenirEtat sans aucun serveur', async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          reponseJson(url.includes('invitations') ? [] : [])
        )
      );
      const etat = await runtime.obtenirEtat();
      expect(etat.serveurActif).toBeNull();
      expect(etat.salons).toEqual([]);
    });

    it('serveurs, salons et messages : variantes des appels', async () => {
      const { runtime } = runtimeConnecte();
      const serveur = {
        id: 'srv',
        nom: 'Projet',
        public: false,
        parDefaut: false,
        monRole: 'proprietaire',
        nombreMembres: 1,
        invitations: [],
        salons: [{ id: 's1', serveurId: 'srv', nom: 'général', acces: 'tous' }],
      };
      const salonBrut = { id: 's1', serveurId: 'srv', nom: 'x', acces: 'tous' };
      const fetchMock = vi.fn(
        async (url: string, options?: { method?: string; body?: string }) => {
          if (url.endsWith('/api/servers')) return reponseJson([serveur]);
          if (url.includes('/history')) {
            return reponseJson([
              {
                id: 'r1',
                roomId: 's1',
                authorId: 'moi',
                content: 'a',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ]);
          }
          if (url.includes('/api/channels/')) return reponseJson(salonBrut);
          if (
            url.includes('/api/messages/rooms/') &&
            options?.method === 'POST'
          ) {
            return reponseJson({
              id: 'r2',
              roomId: 's1',
              authorId: 'moi',
              content: 'b',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            });
          }
          return reponseJson({});
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      expect(await runtime.obtenirServeurs()).toEqual([
        expect.objectContaining({ id: 'srv', salonIds: ['s1'] }),
      ]);
      const page = await runtime.obtenirMessagesSalonAvant({
        salonId: 's1',
        avantId: 'r0',
      });
      expect(page.messages[0].id).toBe('r1');
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('cursor=r0'))
      ).toBe(true);
      // Les auteurs des messages chargés sont résolus (nom, photo).
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        '/api/users/lookup?ids=moi'
      );

      await runtime.modifierServeur({ serveurId: 'srv', icone: null });
      await runtime.modifierServeur({
        serveurId: 'srv',
        nom: 'N',
        public: true,
        icone: 'data:x',
      });
      const corps = (i: number) =>
        JSON.parse(fetchMock.mock.calls.at(i)?.[1]?.body ?? '{}');
      expect(corps(-2)).toEqual({ icone: '' });
      expect(corps(-1)).toEqual({ nom: 'N', public: true, icone: 'data:x' });

      await runtime.decouvrirServeurs(undefined);
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toMatch(/decouvrir$/);
      await runtime.decouvrirServeurs(' pro ');
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('?q=pro');

      await runtime.modifierSalon({ salonId: 's1' });
      expect(corps(-1)).toEqual({});
      await runtime.modifierSalon({
        salonId: 's1',
        nom: 'n',
        acces: 'moderateurs',
        ecriture: 'tous',
      });
      expect(corps(-1)).toEqual({
        nom: 'n',
        acces: 'moderateurs',
        ecriture: 'tous',
      });

      const envoye = await runtime.envoyerMessage({
        salonId: 's1',
        contenu: 'b',
      });
      expect(envoye).toMatchObject({ id: 'r2', auteurId: 'moi' });
      expect(runtime.indexMessages.get('r2')).toEqual({
        type: 'salon',
        roomId: 's1',
      });
    });

    it("hydrate un salon sans messages si l'historique échoue", async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseJson({}, 500)));
      expect(await runtime.hydraterSalonAvecMessages({ id: 's1' })).toEqual({
        id: 's1',
        messages: [],
        finHistorique: true,
      });
    });

    it('modifier et supprimer un message privé ou de salon', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn(async (url: string) =>
        url.includes('/rooms/')
          ? reponseJson({
              id: 'r1',
              roomId: 's1',
              authorId: 'moi',
              content: 'x',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            })
          : reponseJson(messageBrut({ senderId: 'moi', recipientId: 'u2' }))
      );
      vi.stubGlobal('fetch', fetchMock);
      runtime.indexMessages.set('m1', { type: 'dm' });
      runtime.indexMessages.set('r1', { type: 'salon', roomId: 's1' });

      expect(
        (await runtime.modifierMessage({ messageId: 'm1', contenu: 'x' })).id
      ).toBe('m1');
      expect(
        (await runtime.modifierMessage({ messageId: 'r1', contenu: 'x' }))
          .modification
      ).toBeDefined();
      await expect(
        runtime.supprimerMessage({ messageId: 'inconnu' })
      ).rejects.toThrow('ERR_MESSAGE_INTROUVABLE');
      await runtime.supprimerMessage({ messageId: 'r1' });
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        '/api/messages/rooms/s1/r1'
      );
      expect(runtime.indexMessages.has('r1')).toBe(false);
    });

    it("autreParticipantDm : l'autre est en premier ou en second", () => {
      const { runtime } = runtimeConnecte();
      expect(runtime.autreParticipantDm('aaa:moi')).toBe('aaa');
      expect(runtime.autreParticipantDm('moi:zzz')).toBe('zzz');
    });
  });

  describe('présence', () => {
    it('passe hors ligne, présences sans session', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(reponseJson({}));
      vi.stubGlobal('fetch', fetchMock);
      const presence = await runtime.modifierPresence({ statut: 'hors-ligne' });
      expect(presence.statut).toBe('hors-ligne');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        statut: 'horsLigne',
      });

      runtime.utilisateurConnecte = null;
      runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'b' });
      expect(runtime.obtenirPresences()).toEqual({ u2: 'hors-ligne' });
    });

    it('le sondage ne fait rien sans session et ne réannonce pas un statut inchangé', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(
        reponseJson({
          statutPresence: 'horsLigne',
          vuLaDerniereFois: '2026-01-01T00:00:00.000Z',
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      runtime.presences.moi = 'hors-ligne';
      const annoncer = vi.spyOn(runtime, 'annoncerPresence');
      runtime.demarrerPollPresence();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      runtime.arreterPollPresence();
      expect(annoncer).not.toHaveBeenCalled();

      fetchMock.mockClear();
      runtime.utilisateurConnecte = null;
      runtime.demarrerPollPresence();
      runtime.arreterPollPresence();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reconnexion et réseau', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("planifierReconnexion : rien sans session, attente si l'OS est hors ligne", () => {
      const { runtime } = creerRuntime();
      runtime.planifierReconnexion();
      expect(runtime.minuteurReconnexion).toBeNull();

      const { runtime: connecte } = runtimeConnecte();
      connecte.horsLigneSysteme = true;
      connecte.planifierReconnexion();
      expect(connecte.obtenirEtatConnexion()).toMatchObject({
        statut: 'deconnecte',
        cause: 'hors-ligne',
      });
    });

    it('une tentative planifiée est abandonnée si la session a été fermée entre-temps', () => {
      const { runtime } = runtimeConnecte();
      runtime.planifierReconnexion();
      runtime.utilisateurConnecte = null;
      const connecter = vi.spyOn(runtime, 'connecterSocket');
      vi.runOnlyPendingTimers();
      expect(connecter).not.toHaveBeenCalled();
    });

    it('reconnecterMaintenant : sans session, hors ligne, ou cause par défaut', () => {
      const { runtime } = creerRuntime();
      expect(runtime.reconnecterMaintenant().statut).toBe('deconnecte');

      const { runtime: horsLigne } = runtimeConnecte();
      horsLigne.horsLigneSysteme = true;
      expect(horsLigne.reconnecterMaintenant()).toMatchObject({
        statut: 'deconnecte',
        cause: 'hors-ligne',
      });

      const { runtime: connecte } = runtimeConnecte();
      connecte.reconnecterMaintenant();
      expect(connecte.obtenirEtatConnexion()).toMatchObject({
        statut: 'reconnexion',
        cause: 'serveur-injoignable',
      });
    });

    it('signalerReseauSysteme : hors ligne deux fois, sans session, retour en ligne', () => {
      const { runtime } = creerRuntime();
      runtime.signalerReseauSysteme(false);
      runtime.signalerReseauSysteme(false);
      expect(runtime.obtenirEtatConnexion().cause).toBeUndefined();
      const reconnecter = vi.spyOn(runtime, 'reconnecterMaintenant');
      runtime.signalerReseauSysteme(true);
      expect(reconnecter).toHaveBeenCalledTimes(1);
      runtime.signalerReseauSysteme(true);
      expect(reconnecter).toHaveBeenCalledTimes(1);
    });

    it('signalerReveil : reconnecte seulement une session active non fermée', () => {
      const { runtime } = runtimeConnecte();
      const reconnecter = vi.spyOn(runtime, 'reconnecterMaintenant');
      runtime.signalerReveil();
      expect(reconnecter).toHaveBeenCalledTimes(1);
      runtime.fermetureVoulue = true;
      runtime.signalerReveil();
      runtime.fermetureVoulue = false;
      runtime.utilisateurConnecte = null;
      runtime.signalerReveil();
      expect(reconnecter).toHaveBeenCalledTimes(1);
    });

    it('battement de cœur : ignoré hors connexion, socket remplacé ou réponse en erreur', async () => {
      const { runtime } = runtimeConnecte();
      runtime.connecterSocket();
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', fetchMock);
      const planifier = vi.spyOn(runtime, 'planifierReconnexion');

      runtime.etatConnexion.statut = 'reconnexion';
      runtime.demarrerBattementCoeur();
      await vi.advanceTimersByTimeAsync(15000);
      expect(fetchMock).not.toHaveBeenCalled();

      runtime.etatConnexion.statut = 'connecte';
      fetchMock.mockImplementationOnce(async () => {
        runtime.socket = creerFauxSocket();
        return { ok: false, status: 503 };
      });
      await vi.advanceTimersByTimeAsync(15000);
      expect(planifier).not.toHaveBeenCalled();

      runtime.connecterSocket();
      await vi.advanceTimersByTimeAsync(15000);
      expect(planifier).toHaveBeenCalled();
      runtime.arreterBattementCoeur();
    });

    it('fetchAvecDelai : abandonne la requête après le délai', async () => {
      const { runtime } = runtimeConnecte();
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, options: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              signal = options.signal;
              options.signal.addEventListener('abort', () =>
                reject(new Error('abort'))
              );
            })
        )
      );
      const requete = runtime.fetchAvecDelai('http://g.test/api/health', 1000);
      const echec = expect(requete).rejects.toThrow('abort');
      await vi.advanceTimersByTimeAsync(1000);
      await echec;
      expect(signal?.aborted).toBe(true);
    });
  });

  describe('derniers cas', () => {
    it('modifierServeur sans icône : champ absent du corps', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(reponseJson({}));
      vi.stubGlobal('fetch', fetchMock);
      await runtime.modifierServeur({ serveurId: 'srv', nom: 'N' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ nom: 'N' });
    });

    it('trie ensemble des conversations sans aucun message', async () => {
      const { runtime } = runtimeConnecte();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => reponseJson([]))
      );
      runtime.partenairesDmConnus.add('a');
      runtime.partenairesDmConnus.add('b');
      const conversations = await runtime.obtenirConversationsPrivees();
      expect(conversations).toHaveLength(2);
      expect(
        conversations.every(
          (c: { lastMessage: unknown }) => c.lastMessage === null
        )
      ).toBe(true);
    });

    it('passe en ligne', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = vi.fn().mockResolvedValue(reponseJson({}));
      vi.stubGlobal('fetch', fetchMock);
      await runtime.modifierPresence({ statut: 'en-ligne' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        statut: 'enLigne',
      });
    });

    it('battement de cœur réussi : la connexion est gardée', async () => {
      vi.useFakeTimers();
      const { runtime } = runtimeConnecte();
      runtime.connecterSocket();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200 })
      );
      const planifier = vi.spyOn(runtime, 'planifierReconnexion');
      runtime.demarrerBattementCoeur();
      await vi.advanceTimersByTimeAsync(15000);
      expect(planifier).not.toHaveBeenCalled();
      runtime.arreterBattementCoeur();
    });
  });

  describe("repli si 'connexion.prete' n'arrive jamais", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    const annonces = (s: ReturnType<typeof creerFauxSocket>) =>
      s.emit.mock.calls.filter(([evt]) => evt === 'presence.update').length;

    it('ancien Message-Service : prêt quand même au bout de 5 s', () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.presences.moi = 'en-ligne';
      runtime.salonsRejoints.add('s1');
      runtime.connecterSocket();
      socket()._declencher('connect');
      expect(runtime.socketPret).toBe(false);

      vi.advanceTimersByTime(4999);
      expect(runtime.socketPret).toBe(false);
      vi.advanceTimersByTime(1);
      expect(runtime.socketPret).toBe(true);
      expect(annonces(socket())).toBe(1);
      expect(socket().emit).toHaveBeenCalledWith(
        'room-message.join',
        { roomId: 's1' },
        expect.any(Function)
      );
      runtime.arreterBattementCoeur();
    });

    it("'connexion.prete' reçu à temps annule le repli (pas de double annonce)", () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.presences.moi = 'en-ligne';
      runtime.connecterSocket();
      socket()._declencher('connect');
      socket()._declencher('connexion.prete');
      vi.advanceTimersByTime(10000);
      expect(annonces(socket())).toBe(1);
      runtime.arreterBattementCoeur();
    });

    it('socket remplacé ou fermé entre-temps : le repli ne fait rien', () => {
      const { runtime, sockets } = runtimeConnecte();
      runtime.presences.moi = 'en-ligne';
      runtime.connecterSocket();
      const premier = sockets[0];
      premier._declencher('connect');
      // Remplacé sans passer par fermerSocket (minuteur toujours armé).
      runtime.socket = creerFauxSocket();
      vi.advanceTimersByTime(5000);
      expect(runtime.socketPret).toBe(false);

      runtime.connecterSocket();
      runtime.socket._declencher('connect');
      runtime.fermerSocket();
      vi.advanceTimersByTime(5000);
      expect(runtime.socketPret).toBe(false);
      expect(annonces(premier)).toBe(0);
      runtime.arreterBattementCoeur();
    });

    it('socket marqué prêt avant la fin du délai : le repli ne refait rien', () => {
      const { runtime, socket } = runtimeConnecte();
      runtime.presences.moi = 'en-ligne';
      runtime.connecterSocket();
      socket()._declencher('connect');
      // Prêt par un autre chemin sans annuler le minuteur.
      runtime.socketPret = true;
      vi.advanceTimersByTime(5000);
      expect(annonces(socket())).toBe(0);
      runtime.arreterBattementCoeur();
    });
  });

  describe('session expirée en cours d’utilisation', () => {
    /** fetch : 401 sur l'appel métier, `me` pour GET /api/auth/me. */
    const stubFetch = (me: () => Promise<unknown>) => {
      const fetchMock = vi.fn(async (url: string) =>
        url.endsWith('/api/auth/me') ? me() : reponseJson({ erreur: 'x' }, 401)
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };

    it('jeton refusé : session fermée et « session-expiree » émis', async () => {
      const { runtime } = runtimeConnecte();
      stubFetch(async () => reponseJson({ erreur: 'jeton révoqué' }, 401));
      const expiree = vi.fn();
      runtime.on('session-expiree', expiree);

      await expect(runtime.appelHttp('/api/servers')).rejects.toThrow(
        'ERR_HTTP_401'
      );
      await vi.waitFor(() => expect(expiree).toHaveBeenCalledTimes(1));
      expect(runtime.obtenirUtilisateurConnecte()).toBeNull();
      expect(runtime.sauvegarderJetonPersiste).toHaveBeenCalledWith(null);
    });

    it('jeton toujours valide (ex. mot de passe actuel incorrect) : rien', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = stubFetch(async () => reponseJson({ id: 'moi' }));
      const expiree = vi.fn();
      runtime.on('session-expiree', expiree);

      // Même réponse qu'un PATCH /api/auth/me au mot de passe actuel erroné.
      await expect(runtime.appelHttp('/api/users/lookup')).rejects.toThrow();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await Promise.resolve();
      expect(expiree).not.toHaveBeenCalled();
      expect(runtime.obtenirUtilisateurConnecte()).not.toBeNull();
    });

    it('connexion, inscription ou aucune session : pas de vérification', async () => {
      const { runtime } = runtimeConnecte();
      const fetchMock = stubFetch(async () => reponseJson({}, 401));
      await expect(runtime.appelHttp('/api/auth/login')).rejects.toThrow();
      await expect(runtime.appelHttp('/api/auth/register')).rejects.toThrow();
      runtime.utilisateurConnecte = null;
      await expect(runtime.appelHttp('/api/servers')).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('une seule vérification à la fois ; réseau coupé : rien à conclure', async () => {
      const { runtime } = runtimeConnecte();
      let terminer!: () => void;
      const fetchMock = stubFetch(
        () =>
          new Promise((_resolve, reject) => {
            terminer = () => reject(new Error('réseau'));
          })
      );
      const expiree = vi.fn();
      runtime.on('session-expiree', expiree);

      await expect(runtime.appelHttp('/api/a')).rejects.toThrow();
      await expect(runtime.appelHttp('/api/b')).rejects.toThrow();
      // 2 appels métier + 1 seule vérification.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      terminer();
      await vi.waitFor(() =>
        expect(runtime.verificationSessionEnCours).toBe(false)
      );
      expect(expiree).not.toHaveBeenCalled();
    });

    it('jeton remplacé pendant la vérification (reconnexion) : rien', async () => {
      const { runtime } = runtimeConnecte();
      stubFetch(async () => {
        runtime.jeton = 'nouveau-jwt';
        return reponseJson({}, 401);
      });
      const expiree = vi.fn();
      runtime.on('session-expiree', expiree);
      await expect(runtime.appelHttp('/api/servers')).rejects.toThrow();
      await vi.waitFor(() =>
        expect(runtime.verificationSessionEnCours).toBe(false)
      );
      expect(expiree).not.toHaveBeenCalled();
    });
  });

  describe('sondage de présence avec le temps réel actif', () => {
    it('ne réinterroge pas les autres, sauf pour rattraper les photos', async () => {
      const { runtime } = runtimeConnecte();
      runtime.enregistrerUtilisateurConnu({ id: 'u2', pseudo: 'b' });
      runtime.socketPret = true;
      runtime.enLigneTempsReel = new Set(['u2']);
      const fetchMock = vi.fn(async (url: string) =>
        reponseJson(
          url.includes('/publiques')
            ? []
            : {
                statutPresence: 'enLigne',
                vuLaDerniereFois: '2026-01-01T00:00:00.000Z',
              }
        )
      );
      vi.stubGlobal('fetch', fetchMock);
      const publiques = () =>
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes('/publiques')
        );

      runtime.demarrerPollPresence();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      runtime.arreterPollPresence();
      // Signe de vie envoyé (config + PUT presence), mais pas de /publiques.
      expect(publiques()).toHaveLength(0);

      runtime.avatarsARafraichir = true;
      runtime.demarrerPollPresence();
      await vi.waitFor(() => expect(publiques()).toHaveLength(1));
      runtime.arreterPollPresence();
      expect(String(publiques()[0][0])).not.toContain('inclureAvatar=false');
    });
  });
});
