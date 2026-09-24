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
      autresReponses: { obtenirEtatSalons: () => new Promise(() => {}) },
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
});
