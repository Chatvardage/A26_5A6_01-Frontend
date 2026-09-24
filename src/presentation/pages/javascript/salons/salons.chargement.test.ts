import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Test d'intégration de la page des salons (index.html) : tous ses scripts
// classiques sont exécutés DANS L'ORDRE d'index.html, comme de vrais
// <script> (même portée globale partagée que dans Electron), avec une fausse
// API Electron. Vérifie le contrat du découpage de renderer.js (aucune
// référence cassée au chargement) et le comportement temps réel de la page.

const PAGES = path.resolve(__dirname, '../..');
const RACINE = path.resolve(PAGES, '../../..');
const traductions = JSON.parse(
  readFileSync(path.join(RACINE, 'src/i18n/translations.json'), 'utf8')
);

// Même ordre que index.html (theme-browser.js est chargé dans <head>).
const SCRIPTS = [
  'javascript/theme-browser.js',
  'javascript/notif-prefs.js',
  'javascript/i18n-browser.js',
  'javascript/chat-ui-shared.js',
  'javascript/logique-interface.js',
  'javascript/salons/etat.js',
  'javascript/salons/historique.js',
  'javascript/salons/affichage.js',
  'javascript/salons/dialogues.js',
  'javascript/salons/session.js',
  'javascript/salons/temps-reel.js',
  '../../../renderer.js',
];

const message = (
  id: string,
  auteurId: string,
  contenu: string,
  date: number
) => ({
  id,
  auteurId,
  contenu,
  date,
});

function etatInitial(monRole = 'membre') {
  return {
    utilisateurs: [
      { id: 'moi', pseudo: 'moi', alias: null, avatar: null },
      { id: 'bob', pseudo: 'bob', alias: null, avatar: null },
    ],
    serveurs: [{ id: 'srv', nom: 'Projet', icone: null, parDefaut: false }],
    serveurActif: {
      id: 'srv',
      nom: 'Projet',
      icone: null,
      public: false,
      parDefaut: false,
      monRole,
      nombreMembres: 2,
      proprietaireId: 'bob',
      membres: [
        { utilisateurId: 'bob', role: 'proprietaire' },
        { utilisateurId: 'moi', role: monRole },
      ],
      invitations: [],
      salonIds: ['general', 'autre'],
    },
    salons: [
      {
        id: 'general',
        serveurId: 'srv',
        nom: 'général',
        visibilite: 'public',
        peutEcrire: true,
        messages: [message('m1', 'bob', 'salut', 1)],
        finHistorique: true,
      },
      {
        id: 'autre',
        serveurId: 'srv',
        nom: 'autre',
        visibilite: 'public',
        peutEcrire: true,
        messages: [],
        finHistorique: true,
      },
    ],
    invitations: [],
  };
}

type Rappel = (donnees?: unknown) => unknown;

// Pages ouvertes par les tests, fermées après chacun (minuteurs de la page).
const pagesOuvertes: JSDOM[] = [];

async function chargerPage({ monRole = 'membre' } = {}) {
  const erreurs: unknown[] = [];
  const consoleVirtuelle = new VirtualConsole();
  consoleVirtuelle.on('jsdomError', (erreur) => erreurs.push(erreur));

  const html = readFileSync(path.join(PAGES, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // http (et non file://) : jsdom refuse sessionStorage aux origines
    // opaques, contrairement à Electron.
    url: 'http://localhost/index.html',
    virtualConsole: consoleVirtuelle,
  });
  pagesOuvertes.push(dom);
  const { window } = dom;

  // Fausse API Electron : les méthodes connues renvoient des données de
  // test, toute autre méthode résout `undefined` ; les on*() mémorisent
  // leur rappel pour que le test puisse simuler un événement.
  const rappels: Record<string, Rappel> = {};
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
    obtenirResumesConversationsPrivees: [],
    obtenirEtatsSaisie: [],
    obtenirEtatSalons: etatInitial(monRole),
  };
  const appels: Record<string, number> = {};
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
      messageReceived: vi.fn(() => Promise.resolve({ shown: true })),
    },
  });

  for (const script of SCRIPTS) {
    const element = window.document.createElement('script');
    element.textContent = readFileSync(path.join(PAGES, script), 'utf8');
    window.document.body.appendChild(element);
  }

  const document = window.document;
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll('#message-list .message-row')
    ).toHaveLength(1)
  );
  return { window, document, rappels, appels, erreurs };
}

const textes = (document: Document) =>
  [...document.querySelectorAll('#message-list .message-row .text')].map(
    (element) => element.textContent
  );

describe('page des salons (scripts découpés)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const page of pagesOuvertes.splice(0)) page.window.close();
  });

  it('se charge sans erreur et affiche le serveur, les salons et les messages', async () => {
    const { document, erreurs } = await chargerPage();
    expect(erreurs).toEqual([]);
    expect(document.querySelector('#server-name')?.textContent).toBe('Projet');
    expect(
      [...document.querySelectorAll('#channel-list button')].map((b) =>
        b.textContent?.trim()
      )
    ).toEqual(['# général', '# autre']);
    expect(textes(document)).toEqual(['salut']);
    // Rail : icône du serveur mémorisée pour la page suivante.
    expect(
      document.querySelector('.server-icon[data-serveur-id="srv"]')
    ).not.toBeNull();
  });

  it('ajoute un message reçu sans recharger toute la page', async () => {
    const { document, rappels, appels } = await chargerPage();
    const avant = appels.obtenirEtatSalons;
    await rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 'general',
      serveurId: 'srv',
      message: message('m2', 'bob', 'nouveau', 2),
    });
    await vi.waitFor(() =>
      expect(textes(document)).toEqual(['salut', 'nouveau'])
    );
    // Même message reçu deux fois (écho) : pas de doublon.
    await rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 'general',
      serveurId: 'srv',
      message: message('m2', 'bob', 'nouveau', 2),
    });
    expect(textes(document)).toEqual(['salut', 'nouveau']);
    expect(appels.obtenirEtatSalons).toBe(avant);
  });

  it('applique sur place un message modifié puis supprimé', async () => {
    const { document, rappels, appels } = await chargerPage();
    const avant = appels.obtenirEtatSalons;
    rappels.onMessageModifieChange({
      ...message('m1', 'bob', 'corrigé', 1),
      modification: 5,
    });
    await vi.waitFor(() => expect(textes(document)).toEqual(['corrigé']));
    expect(document.querySelector('.edited-label')).not.toBeNull();

    // Message inconnu (privé, autre serveur) : ignoré.
    rappels.onMessageModifieChange(message('inconnu', 'bob', 'x', 1));
    rappels.onMessageSupprimeChange({ messageId: 'inconnu' });
    expect(textes(document)).toEqual(['corrigé']);

    rappels.onMessageSupprimeChange({ messageId: 'm1' });
    await vi.waitFor(() => expect(textes(document)).not.toContain('corrigé'));
    expect(appels.obtenirEtatSalons).toBe(avant);
  });

  it('un message d’un auteur inconnu recharge la page (pseudo à résoudre)', async () => {
    const { rappels, appels } = await chargerPage();
    const avant = appels.obtenirEtatSalons;
    await rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 'general',
      serveurId: 'srv',
      message: message('m3', 'inconnu', 'coucou', 3),
    });
    expect(appels.obtenirEtatSalons).toBe(avant + 1);
  });

  it('invitation masquée pour un simple membre, visible pour un modérateur', async () => {
    const membre = await chargerPage({ monRole: 'membre' });
    expect(
      membre.document.querySelector<HTMLElement>('#open-invite-user')?.hidden
    ).toBe(true);
    const modo = await chargerPage({ monRole: 'moderateur' });
    expect(
      modo.document.querySelector<HTMLElement>('#open-invite-user')?.hidden
    ).toBe(false);
  });
});
