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

const SCRIPTS = [
  'javascript/theme-browser.js',
  'javascript/notif-prefs.js',
  'javascript/i18n-browser.js',
  'javascript/chat-ui-shared.js',
  'javascript/logique-interface.js',
  // Chargé en type="module" dans la page ; il n'a ni import ni export, il
  // s'exécute donc à l'identique comme script classique.
  'javascript/message-prive.js',
];

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

async function chargerPage() {
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
        return () => {
          appels[nom] = (appels[nom] ?? 0) + 1;
          return Promise.resolve(structuredClone(reponses[nom]));
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

  for (const script of SCRIPTS) {
    const element = window.document.createElement('script');
    element.textContent = readFileSync(path.join(PAGES, script), 'utf8');
    window.document.body.appendChild(element);
  }
  // La page démarre sur DOMContentLoaded, déjà passé à l'injection.
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const document = window.document;
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
});
