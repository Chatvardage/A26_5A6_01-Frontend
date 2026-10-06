import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Test d'intégration de la page des messages privés (message-prive.html) :
// ses scripts sont exécutés dans l'ordre de la page avec une fausse API
// Electron, pour vérifier qu'un message reçu, envoyé, modifié ou supprimé
// est appliqué à sa conversation SANS recharger toutes les conversations.

const PAGES = path.resolve(__dirname, '..');
const RACINE = path.resolve(PAGES, '../../..');
const traductions = JSON.parse(
  readFileSync(path.join(RACINE, 'src/i18n/translations.json'), 'utf8')
);

// Scripts de la page, dans l'ordre réel de message-prive.html (lu dans le
// fichier : un script ajouté à la page est donc aussi chargé ici).
const SCRIPTS = [
  ...readFileSync(path.join(PAGES, 'message-prive.html'), 'utf8').matchAll(
    /<script src="([^"]+)"><\/script>/g
  ),
].map(([, src]) => src);

const dm = (id: string, auteurId: string, contenu: string, envoi: number) => ({
  id,
  conversationId: 'bob:moi',
  auteurId,
  contenu,
  envoi,
});

const conversations = () => [
  {
    id: 'bob:moi',
    participantIds: ['moi', 'bob'],
    otherUser: {
      id: 'bob',
      pseudo: 'bob',
      present: true,
      alias: null,
      avatar: null,
    },
    messages: [dm('m1', 'bob', 'salut', 1)],
    finHistorique: true,
    lastMessage: dm('m1', 'bob', 'salut', 1),
  },
];

type Rappel = (donnees?: unknown) => unknown;
const pagesOuvertes: JSDOM[] = [];

async function chargerPage({
  demarrer = true,
  attendreMessages = true,
  autresReponses = {} as Record<string, unknown>,
  avantScripts = (() => {}) as (window: JSDOM['window']) => void,
} = {}) {
  const erreurs: unknown[] = [];
  const consoleVirtuelle = new VirtualConsole();
  consoleVirtuelle.on('jsdomError', (erreur) => erreurs.push(erreur));
  const dom = new JSDOM(
    readFileSync(path.join(PAGES, 'message-prive.html'), 'utf8'),
    {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      // http (et non file://) : jsdom refuse sessionStorage aux origines opaques.
      url: 'http://localhost/message-prive.html',
      virtualConsole: consoleVirtuelle,
    }
  );
  pagesOuvertes.push(dom);
  const { window } = dom;

  // jsdom ne fournit pas l'API native <dialog>. L'application l'utilise
  // réellement dans Electron/Chromium; le test reproduit donc ce contrat.
  if (window.HTMLDialogElement) {
    window.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    window.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
  }

  const rappels: Record<string, Rappel> = {};
  const appels: Record<string, number> = {};
  const reponses: Record<string, unknown> = {
    obtenirDictionnairesI18n: traductions,
    obtenirLangue: 'fr',
    obtenirLangueParDefaut: 'fr',
    obtenirTheme: 'sombre',
    obtenirUtilisateurConnecte: {
      id: 'moi',
      pseudo: 'moi',
      role: 'utilisateur',
    },
    obtenirPreferences: {
      theme: 'sombre',
      langue: 'fr',
      modeNotification: 'systeme',
    },
    obtenirEtatReseau: { statut: 'connecte' },
    obtenirPresences: {},
    obtenirEtatsSaisie: [],
    obtenirUtilisateurs: [],
    obtenirEtatSalons: { serveurs: [], salons: [] },
    obtenirServeurs: [],
    obtenirConversationsPrivees: conversations(),
    envoyerMessagePrive: dm('m9', 'moi', 'envoyé', 9),
    ...autresReponses,
  };
  const api = new Proxy(
    {},
    {
      get: (_cible, nom: string) => {
        if (nom.startsWith('on')) {
          return (rappel: Rappel) => {
            rappels[nom] = rappel;
            return () => {};
          };
        }
        return (...args: unknown[]) => {
          appels[nom] = (appels[nom] ?? 0) + 1;
          const reponse = reponses[nom];
          // Réponse calculée (peut échouer) : voir les tests d'erreur.
          if (typeof reponse === 'function') {
            return Promise.resolve().then(() => reponse(...args));
          }
          return Promise.resolve(structuredClone(reponse));
        };
      },
    }
  );
  Object.assign(window, {
    electronAPI: api,
    notifications: {
      isWindowFocused: () => Promise.resolve(true),
      setActiveConversation: () => Promise.resolve(true),
      setBadgeCount: () => Promise.resolve(true),
      messageReceived: () => Promise.resolve({ shown: true }),
    },
  });

  avantScripts(window);
  // Sans démarrage : tous les scripts sauf le point d'entrée.
  const scripts = demarrer
    ? SCRIPTS
    : SCRIPTS.filter((script) => script !== 'javascript/message-prive.js');
  for (const script of scripts) {
    const element = window.document.createElement('script');
    element.textContent = readFileSync(path.join(PAGES, script), 'utf8');
    window.document.body.appendChild(element);
  }
  const document = window.document;
  if (!demarrer) return { window, document, rappels, appels, erreurs };
  // La page démarre sur DOMContentLoaded, déjà passé à l'injection.
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  if (!attendreMessages) return { window, document, rappels, appels, erreurs };
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll('#message-list .message-row .text')
    ).toHaveLength(1)
  );
  return { window, document, rappels, appels, erreurs };
}

const textes = (document: Document) =>
  [...document.querySelectorAll('#message-list .message-row .text')].map(
    (element) => element.textContent
  );

describe('page des messages privés', () => {
  it('rattrape par REST un DM manque pendant la coupure sans nouveau message socket', async () => {
    let messages = conversations();
    const { rappels, document, appels } = await chargerPage({
      autresReponses: { obtenirConversationsPrivees: () => messages },
    });
    const avant = appels.obtenirConversationsPrivees;
    messages = [
      {
        ...messages[0],
        messages: [
          ...messages[0].messages,
          dm('manque', 'bob', 'pendant la coupure', 2),
        ],
      },
    ];
    await rappels.onSynchronisationRequise();
    expect(appels.obtenirConversationsPrivees).toBeGreaterThan(avant);
    expect(textes(document)).toContain('pendant la coupure');
  });

  afterEach(() => {
    for (const page of pagesOuvertes.splice(0)) page.window.close();
  });

  it('ne lance rien pendant le chargement des scripts (contrat du découpage)', async () => {
    // messages-prives/*.js ne font que déclarer (aucun appel, aucun
    // abonnement) : seul message-prive.js démarre la page.
    const { rappels, appels, erreurs } = await chargerPage({ demarrer: false });
    expect(erreurs).toEqual([]);
    expect(appels).toEqual({});
    expect(rappels).toEqual({});
  });

  it('rail en cache : affiché pour le même compte, jamais celui d’un autre compte', async () => {
    const cache = (utilisateurId: string) => (window: JSDOM['window']) =>
      window.localStorage.setItem(
        'chatvardage:rail-serveurs',
        JSON.stringify({
          utilisateurId,
          serveurs: [{ id: 'srv-cache', nom: 'En cache', icone: null }],
        })
      );
    const icone = '.server-icon[data-serveur-id="srv-cache"]';

    const autre = await chargerPage({ avantScripts: cache('ancien-compte') });
    expect(autre.document.querySelector(icone)).toBeNull();
    // Cache d'un autre compte : effacé (puis réécrit pour le compte courant
    // quand le rail arrive du réseau).
    expect(
      autre.window.localStorage.getItem('chatvardage:rail-serveurs') ?? ''
    ).not.toContain('ancien-compte');

    // Même compte, réseau encore en attente : le rail vient du cache.
    const moi = await chargerPage({
      avantScripts: cache('moi'),
      autresReponses: { obtenirServeurs: () => new Promise(() => {}) },
    });
    await vi.waitFor(() =>
      expect(moi.document.querySelector(icone)).not.toBeNull()
    );
  });

  it('cibles de navigation gardées par le processus main (pas sessionStorage)', async () => {
    const typesDemandes: unknown[] = [];
    const cibles: unknown[] = [];
    const pages: unknown[] = [];
    const { document } = await chargerPage({
      autresReponses: {
        prendreCibleNavigation: (types: unknown) => {
          typesDemandes.push(types);
          return { type: 'prive', id: 'bob:moi' };
        },
        definirCibleNavigation: (cible: unknown) => {
          cibles.push(cible);
          return true;
        },
        navigate: (page: unknown) => {
          pages.push(page);
        },
      },
    });
    expect(typesDemandes).toEqual([['prive']]);

    // « + » du rail : ouvrir l'ajout de serveur sur la page des salons.
    document
      .getElementById('open-create-channel-rail')
      ?.dispatchEvent(new document.defaultView!.MouseEvent('click'));
    await vi.waitFor(() => expect(pages).toEqual(['index.html']));
    expect(cibles).toEqual([{ type: 'ajout-serveur' }]);
  });

  it('se charge sans erreur et affiche la conversation', async () => {
    const { document, erreurs } = await chargerPage();
    expect(erreurs).toEqual([]);
    expect(
      document.querySelector('.conversation[data-conversation-id="bob:moi"]')
    ).not.toBeNull();
    expect(textes(document)).toEqual(['salut']);
  });

  it('message reçu, modifié puis supprimé : appliqué sans tout recharger', async () => {
    const { document, rappels, appels } = await chargerPage();
    const avant = appels.obtenirConversationsPrivees;

    await rappels.onNouveauMessage({
      conversationType: 'dm',
      message: dm('m2', 'bob', 'nouveau', 2),
    });
    await vi.waitFor(() =>
      expect(textes(document)).toEqual(['salut', 'nouveau'])
    );

    await rappels.onMessageModifieChange({
      ...dm('m2', 'bob', 'corrigé', 2),
      modification: 3,
    });
    await vi.waitFor(() =>
      expect(textes(document)).toEqual(['salut', 'corrigé'])
    );

    // Message de salon (sans conversationId) : ignoré par cette page.
    await rappels.onMessageModifieChange({
      id: 'r1',
      auteurId: 'bob',
      contenu: 'x',
      date: 1,
    });
    await rappels.onMessageSupprimeChange({ messageId: 'r1' });

    await rappels.onMessageSupprimeChange({ messageId: 'm2' });
    await vi.waitFor(() => expect(textes(document)).toEqual(['salut']));

    expect(appels.obtenirConversationsPrivees).toBe(avant);
  });

  it('un message d’un nouvel interlocuteur recharge les conversations une fois', async () => {
    const { rappels, appels } = await chargerPage();
    const avant = appels.obtenirConversationsPrivees;
    await rappels.onNouveauMessage({
      conversationType: 'dm',
      message: {
        ...dm('m5', 'alice', 'bonjour', 5),
        conversationId: 'alice:moi',
      },
    });
    expect(appels.obtenirConversationsPrivees).toBe(avant + 1);
  });

  it('mon envoi utilise la réponse du serveur, sans rechargement', async () => {
    const { window, document, appels } = await chargerPage();
    const avant = appels.obtenirConversationsPrivees;
    const champ = document.querySelector<HTMLInputElement>('#message-input');
    champ!.value = 'envoyé';
    document
      .querySelector('#message-form')!
      .dispatchEvent(new window.Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(textes(document)).toEqual(['salut', 'envoyé'])
    );
    expect(appels.envoyerMessagePrive).toBe(1);
    expect(appels.obtenirConversationsPrivees).toBe(avant);
  });

  it('liste des conversations en échec : erreur affichée, puis nouvel essai automatique', async () => {
    let essais = 0;
    const { document, erreurs } = await chargerPage({
      attendreMessages: false,
      autresReponses: {
        obtenirConversationsPrivees: () => {
          essais += 1;
          // Forme réelle d'une erreur IPC d'Electron côté page.
          if (essais === 1) {
            throw "Error invoking remote method 'obtenir-conversations-privees': Error: ERR_RESEAU_INDISPONIBLE";
          }
          return conversations();
        },
      },
    });

    await vi.waitFor(() =>
      expect(
        document.querySelector('#toast')?.classList.contains('error')
      ).toBe(true)
    );
    expect(document.querySelector('#toast')?.textContent).toContain(
      'Impossible de joindre le serveur'
    );
    // Nouvel essai ~5 s plus tard : la conversation apparaît.
    await vi.waitFor(
      () =>
        expect(
          document.querySelector(
            '.conversation[data-conversation-id="bob:moi"]'
          )
        ).not.toBeNull(),
      { timeout: 8000 }
    );
    expect(essais).toBe(2);
    expect(erreurs).toEqual([]);
  }, 15000);

  it('pseudo pas encore résolu : redemandé plus tard, sans message d’erreur', async () => {
    let essais = 0;
    const { document } = await chargerPage({
      autresReponses: {
        obtenirConversationsPrivees: () => {
          essais += 1;
          const liste = conversations();
          if (essais === 1) {
            (liste[0] as { otherUser: Record<string, unknown> }).otherUser = {
              ...liste[0].otherUser,
              pseudo: 'id-brut',
              pseudoInconnu: true,
            };
          }
          return liste;
        },
      },
    });
    await vi.waitFor(() => expect(essais).toBe(2), { timeout: 8000 });
    expect(
      document.querySelector('#toast')?.classList.contains('error')
    ).not.toBe(true);
  }, 15000);

  it('met à jour en direct la présence dans le sélecteur même sans conversation existante', async () => {
    const { document, rappels, erreurs } = await chargerPage({
      autresReponses: {
        obtenirSuggestionsDm: [
          {
            id: 'alice',
            pseudo: 'alice',
            present: false,
            alias: null,
            avatar: null,
          },
        ],
      },
    });

    (document.getElementById('open-new-dm') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('.user-choice[data-user-id="alice"]')
      ).not.toBeNull()
    );

    const avatar = document.querySelector(
      '.user-choice[data-user-id="alice"] .avatar'
    ) as HTMLElement;
    expect(avatar.classList.contains('offline')).toBe(true);
    expect(avatar.title).toBe(traductions.fr.dm.offline);

    rappels.onPresenceChange?.({ utilisateurId: 'alice', statut: 'en-ligne' });
    expect(avatar.classList.contains('offline')).toBe(false);
    expect(avatar.title).toBe(traductions.fr.dm.online);

    rappels.onPresenceChange?.({
      utilisateurId: 'alice',
      statut: 'hors-ligne',
    });
    expect(avatar.classList.contains('offline')).toBe(true);
    expect(avatar.title).toBe(traductions.fr.dm.offline);
    expect(erreurs).toEqual([]);
  });

  it('non-lus : compteur par conversation, conversation affichée marquée lue', async () => {
    const marques: unknown[] = [];
    const deuxConversations = () => [
      ...conversations(),
      {
        ...conversations()[0],
        id: 'carla:moi',
        otherUser: {
          ...conversations()[0].otherUser,
          id: 'carla',
          pseudo: 'carla',
        },
        messages: [],
        lastMessage: null,
      },
    ];
    const { document, rappels } = await chargerPage({
      autresReponses: {
        obtenirConversationsPrivees: deuxConversations(),
        obtenirNonLus: {
          salons: { s1: 1 },
          prives: { 'bob:moi': 2, 'carla:moi': 4 },
        },
        obtenirServeurs: [
          { id: 'srv', nom: 'Projet', icone: null, salonIds: ['s1'] },
          { id: 'calme', nom: 'Calme', icone: null, salonIds: ['s2'] },
        ],
        marquerConversationLue: (donnees: unknown) => {
          marques.push(donnees);
          return { nonLus: 0 };
        },
      },
    });
    const compteur = (id: string) =>
      document.querySelector<HTMLElement>(
        `.conversation[data-conversation-id="${id}"] .notif-count`
      );
    await vi.waitFor(() =>
      expect(marques).toEqual([{ type: 'prive', conversationId: 'bob:moi' }])
    );
    expect(compteur('bob:moi')?.hidden).toBe(true);
    expect(compteur('carla:moi')?.textContent).toBe('4');
    // Pastille du serveur qui a un salon non lu, pas de l'autre.
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          '.server-icon[data-serveur-id="srv"] .notif-dot'
        )?.hidden
      ).toBe(false)
    );
    expect(
      document.querySelector<HTMLElement>(
        '.server-icon[data-serveur-id="calme"] .notif-dot'
      )?.hidden
    ).toBe(true);

    // Message reçu dans une autre conversation : un non-lu de plus.
    await rappels.onNouveauMessage({
      conversationType: 'dm',
      message: {
        ...dm('m2', 'carla', 'coucou', 2),
        conversationId: 'carla:moi',
      },
    });
    await vi.waitFor(() =>
      expect(compteur('carla:moi')?.textContent).toBe('5')
    );
    // Message de salon : pastille de son serveur.
    await rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 's2',
      serveurId: 'calme',
      message: { id: 'ms', auteurId: 'bob', contenu: 'x', date: 3 },
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          '.server-icon[data-serveur-id="calme"] .notif-dot'
        )?.hidden
      ).toBe(false)
    );
  });

  it('recherche : dans la conversation affichée seulement', async () => {
    const recherches: unknown[] = [];
    const { document, window } = await chargerPage({
      autresReponses: {
        rechercherMessages: (donnees: unknown) => {
          recherches.push(donnees);
          return {
            resultats: [
              {
                type: 'prive',
                conversationId: 'bob:moi',
                auteurNom: 'bob',
                message: dm('m1', 'bob', 'salut toi', 1),
              },
            ],
            curseurSuivant: null,
          };
        },
      },
    });
    const dialogue =
      document.querySelector<HTMLDialogElement>('#search-dialog')!;
    const champ = dialogue.querySelector<HTMLInputElement>('.search-input')!;
    document.getElementById('open-search')?.click();
    expect(dialogue.querySelector('.search-title')?.textContent).toBe(
      'Rechercher dans bob'
    );
    champ.value = 'salut';
    champ.dispatchEvent(new window.Event('input'));
    await vi.waitFor(() =>
      expect(dialogue.querySelectorAll('.search-result')).toHaveLength(1)
    );
    expect(recherches).toEqual([
      { texte: 'salut', type: 'prive', conversationId: 'bob:moi' },
    ]);
    expect(dialogue.querySelector('.search-result-meta')?.textContent).toMatch(
      /^bob · /
    );

    dialogue.querySelector<HTMLElement>('.search-result')?.click();
    expect(dialogue.hasAttribute('open')).toBe(false);
  });

  it('recherche sans conversation affichée : champ désactivé, rien n’est cherché', async () => {
    const { document, appels } = await chargerPage({
      attendreMessages: false,
      autresReponses: { obtenirConversationsPrivees: [] },
    });
    await vi.waitFor(() => expect(appels.obtenirConversationsPrivees).toBe(1));
    const dialogue =
      document.querySelector<HTMLDialogElement>('#search-dialog')!;
    document.getElementById('open-search')?.click();
    expect(
      dialogue.querySelector<HTMLInputElement>('.search-input')?.disabled
    ).toBe(true);
    expect(dialogue.querySelector('.search-title')?.textContent).toBe(
      traductions.fr.search.title
    );
    expect(dialogue.querySelector('.search-status')?.textContent).toBe(
      traductions.fr.search.noConversation
    );
    expect(appels.rechercherMessages).toBeUndefined();
  });

  describe('non-lus et accusés de lecture', () => {
    const conversationAvec = (messages: ReturnType<typeof dm>[]) => [
      { ...conversations()[0], messages, lastMessage: messages.at(-1) },
    ];
    const lignes = (document: Document) =>
      [...document.querySelectorAll('#message-list > *')].map((element) =>
        element.classList.contains('unread-separator')
          ? '---'
          : (element.querySelector('.text')?.textContent ?? '')
      );

    it('✓ distribué puis ✓✓ lu en temps réel, « Lu » sous mon dernier message', async () => {
      const { document, rappels } = await chargerPage({
        attendreMessages: false,
        autresReponses: {
          obtenirConversationsPrivees: conversationAvec([
            dm('m1', 'bob', 'salut', 1),
            dm('m2', 'moi', 'ça va ?', 2),
            dm('m3', 'moi', 'et toi ?', 3),
          ]),
          obtenirLectures: {
            lecteurs: [{ utilisateurId: 'bob', nom: 'bob', luJusqua: 2 }],
          },
        },
      });
      await vi.waitFor(() =>
        expect(document.querySelectorAll('.read-status')).toHaveLength(2)
      );
      const statuts = () =>
        [...document.querySelectorAll('.read-status')].map(
          (e) => e.textContent
        );
      const ligne = () => document.querySelector('.read-receipt')?.textContent;
      expect(statuts()).toEqual(['✓✓', '✓']);
      expect(ligne()).toBe(traductions.fr.readReceipts.delivered);
      // La ligne est sous mon dernier message.
      expect(
        document
          .querySelector('.read-receipt')
          ?.closest('.message-row')
          ?.querySelector('.text')?.textContent
      ).toBe('et toi ?');

      await rappels.onLectureChange({
        type: 'prive',
        conversationId: 'bob:moi',
        utilisateurId: 'bob',
        nom: 'bob',
        luJusqua: 3,
        deMoi: false,
      });
      await vi.waitFor(() => expect(statuts()).toEqual(['✓✓', '✓✓']));
      expect(ligne()).toBe(traductions.fr.readReceipts.read);

      // Lecture d'une autre conversation : sans effet ici.
      await rappels.onLectureChange({
        type: 'prive',
        conversationId: 'carla:moi',
        utilisateurId: 'carla',
        luJusqua: 1,
        deMoi: false,
      });
      expect(statuts()).toEqual(['✓✓', '✓✓']);
    });

    it('séparateur « Nouveaux messages » gardé après le marquage comme lu', async () => {
      const { document, appels } = await chargerPage({
        attendreMessages: false,
        autresReponses: {
          obtenirConversationsPrivees: conversationAvec([
            dm('m1', 'bob', 'salut', 1),
            dm('m2', 'moi', 'ça va ?', 2),
            dm('m3', 'bob', 'oui', 3),
            dm('m4', 'bob', 'et toi ?', 4),
          ]),
          obtenirNonLus: { salons: {}, prives: { 'bob:moi': 2 } },
          obtenirLectures: { lecteurs: [] },
        },
      });
      await vi.waitFor(() => expect(appels.marquerConversationLue).toBe(1));
      await vi.waitFor(() =>
        expect(lignes(document)).toEqual([
          '',
          'salut',
          'ça va ?',
          '---',
          'oui',
          'et toi ?',
        ])
      );
      // Pas encore de ligne « Lu » : le dernier message n'est pas le mien.
      expect(document.querySelector('.read-receipt')).toBeNull();
    });

    it('lu depuis un autre de mes appareils : les compteurs sont relus', async () => {
      const { rappels, appels } = await chargerPage();
      const avant = appels.obtenirNonLus;
      await rappels.onLectureChange({
        type: 'prive',
        conversationId: 'bob:moi',
        utilisateurId: 'moi',
        luJusqua: 1,
        deMoi: true,
      });
      await vi.waitFor(() => expect(appels.obtenirNonLus).toBe(avant + 1));
    });

    it('« Lu » juste sous le message, au-dessus de Modifier / Supprimer', async () => {
      const { document } = await chargerPage({
        attendreMessages: false,
        autresReponses: {
          obtenirConversationsPrivees: conversationAvec([
            dm('m1', 'moi', 'mon message', 1),
          ]),
          obtenirLectures: {
            lecteurs: [{ utilisateurId: 'bob', nom: 'bob', luJusqua: 1 }],
          },
        },
      });
      await vi.waitFor(() =>
        expect(document.querySelector('.read-receipt')).not.toBeNull()
      );
      const corps = document.querySelector('.message-row .message-body')!;
      const ordre = [...corps.children].map((e) => e.className.split(' ')[0]);
      expect(ordre.indexOf('read-receipt')).toBe(ordre.indexOf('text') + 1);
      expect(ordre.at(-1)).not.toBe('read-receipt');
    });
  });

  it('recherche : charge l’historique jusqu’au message choisi et le met en évidence', async () => {
    const demandes: unknown[] = [];
    const { document, window } = await chargerPage({
      autresReponses: {
        obtenirConversationsPrivees: [
          { ...conversations()[0], finHistorique: false },
        ],
        rechercherMessages: {
          resultats: [
            {
              type: 'prive',
              conversationId: 'bob:moi',
              auteurNom: 'bob',
              message: dm('ancien', 'bob', 'un vieux message', 0),
            },
          ],
          curseurSuivant: null,
        },
        obtenirMessagesPriveesAvant: (donnees: unknown) => {
          demandes.push(donnees);
          return {
            messages: [dm('ancien', 'bob', 'un vieux message', 0)],
            finHistorique: true,
          };
        },
      },
    });
    const dialogue =
      document.querySelector<HTMLDialogElement>('#search-dialog')!;
    const champ = dialogue.querySelector<HTMLInputElement>('.search-input')!;
    document.getElementById('open-search')?.click();
    champ.value = 'vieux';
    champ.dispatchEvent(new window.Event('input'));
    await vi.waitFor(() =>
      expect(dialogue.querySelectorAll('.search-result')).toHaveLength(1)
    );
    dialogue.querySelector<HTMLElement>('.search-result')?.click();

    await vi.waitFor(() =>
      expect(
        document
          .querySelector('[data-message-id="ancien"]')
          ?.classList.contains('message-cible')
      ).toBe(true)
    );
    expect(demandes).toEqual([
      expect.objectContaining({ avantId: 'm1', taille: 100 }),
    ]);
    expect(textes(document)).toEqual(['un vieux message', 'salut']);
  });
});

it('fusionne un accusé reçu pendant le chargement initial, sans confondre deux messages de même date', async () => {
  let resoudre!: (valeur: unknown) => void;
  const cs = conversations();
  cs[0].messages = [
    dm('m1', 'moi', 'premier', 1),
    dm('m2', 'moi', 'second', 1),
  ];
  const { document, rappels, appels } = await chargerPage({
    attendreMessages: false,
    autresReponses: {
      obtenirConversationsPrivees: cs,
      obtenirLectures: () =>
        new Promise((r) => {
          resoudre = r;
        }),
    },
  });
  await vi.waitFor(() => expect(appels.obtenirLectures).toBe(1));
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.read-status')).toHaveLength(2)
  );
  await rappels.onLectureChange({
    type: 'prive',
    conversationId: 'bob:moi',
    utilisateurId: 'bob',
    nom: 'bob',
    luJusqua: 1,
    dernierMessageLuId: 'm1',
    deMoi: false,
  });
  const statuts = () =>
    [...document.querySelectorAll('.read-status')].map((e) => e.textContent);
  expect(statuts()).toEqual(['✓✓', '✓']);
  resoudre({
    lecteurs: [
      {
        utilisateurId: 'bob',
        nom: 'bob',
        luJusqua: 0,
        dernierMessageLuId: 'ancien',
      },
    ],
  });
  await vi.waitFor(() => expect(statuts()).toEqual(['✓✓', '✓']));
  await rappels.onLectureChange({
    type: 'prive',
    conversationId: 'bob:moi',
    utilisateurId: 'bob',
    nom: 'bob',
    luJusqua: 1,
    dernierMessageLuId: 'm2',
    deMoi: false,
  });
  expect(statuts()).toEqual(['✓✓', '✓✓']);
  await rappels.onLectureChange({
    type: 'prive',
    conversationId: 'bob:moi',
    utilisateurId: 'bob',
    nom: 'bob',
    luJusqua: 1,
    dernierMessageLuId: 'm1',
    deMoi: false,
  });
  expect(statuts()).toEqual(['✓✓', '✓✓']);
});

it('recharge les coches de la conversation ouverte après une reconnexion', async () => {
  let luJusqua = 0;
  const cs = conversations();
  cs[0].messages = [dm('m1', 'moi', 'salut', 1)];
  const { document, rappels } = await chargerPage({
    autresReponses: {
      obtenirConversationsPrivees: cs,
      obtenirLectures: () => ({
        lecteurs: [{ utilisateurId: 'bob', nom: 'bob', luJusqua }],
      }),
    },
  });
  await vi.waitFor(() =>
    expect(document.querySelector('.read-status')?.textContent).toBe('✓')
  );
  luJusqua = 1;
  await rappels.onSynchronisationRequise();
  await vi.waitFor(() =>
    expect(document.querySelector('.read-status')?.textContent).toBe('✓✓')
  );
});
