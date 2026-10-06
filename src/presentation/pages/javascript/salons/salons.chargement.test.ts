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
    serveurs: [
      {
        id: 'srv',
        nom: 'Projet',
        icone: null,
        parDefaut: false,
        salonIds: ['general', 'autre'],
      },
    ],
    serveurActif: {
      id: 'srv',
      nom: 'Projet',
      icone: null,
      public: false,
      parDefaut: false,
      monRole,
      nombreMembres: 2,
      proprietaireId: 'bob',
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

async function chargerPage({
  monRole = 'membre',
  autresReponses = {} as Record<string, unknown>,
} = {}) {
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
    obtenirEtatsSaisie: [],
    obtenirEtatSalons: etatInitial(monRole),
    ...autresReponses,
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
        return (...args: unknown[]) => {
          appels[nom] = (appels[nom] ?? 0) + 1;
          const reponse = reponses[nom];
          // Réponse calculée à partir des arguments (ex. pagination).
          return Promise.resolve(
            typeof reponse === 'function'
              ? reponse(...args)
              : structuredClone(reponse)
          );
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
      onNavigateToConversation: (rappel: Rappel) => {
        rappels.onNavigateToConversation = rappel;
      },
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

  it('clic sur une notification : salon de ce serveur ouvert sur place, autre serveur rechargé', async () => {
    const demandes: unknown[] = [];
    const { rappels } = await chargerPage({
      autresReponses: {
        obtenirEtatSalons: (options: unknown) => {
          demandes.push(options);
          return etatInitial();
        },
      },
    });
    const avant = demandes.length;

    await rappels.onNavigateToConversation({
      type: 'salon',
      conversationId: 'autre',
    });
    expect(demandes).toHaveLength(avant);

    // Salon d'un autre serveur : rechargé avec ce salon, pour que le
    // runtime choisisse le serveur qui le contient.
    await rappels.onNavigateToConversation({
      type: 'salon',
      conversationId: 'salon-ailleurs',
    });
    await vi.waitFor(() => expect(demandes).toHaveLength(avant + 1));
    expect(demandes.at(-1)).toMatchObject({ salonId: 'salon-ailleurs' });
  });

  it('clic sur une notification privée : cible gardée par le processus main, puis navigation', async () => {
    const cibles: unknown[] = [];
    const pages: unknown[] = [];
    const { rappels } = await chargerPage({
      autresReponses: {
        definirCibleNavigation: (cible: unknown) => {
          cibles.push(cible);
          return true;
        },
        navigate: (page: unknown) => {
          pages.push(page);
        },
      },
    });

    await rappels.onNavigateToConversation({
      type: 'prive',
      conversationId: 'dm:moi:bob',
    });

    expect(cibles).toEqual([{ type: 'prive', id: 'dm:moi:bob' }]);
    expect(pages).toEqual(['message-prive.html']);
  });

  it('ouvre le salon laissé comme cible de navigation par l’autre page', async () => {
    const demandes: unknown[] = [];
    const typesDemandes: unknown[] = [];
    await chargerPage({
      autresReponses: {
        prendreCibleNavigation: (types: unknown) => {
          typesDemandes.push(types);
          return { type: 'salon', id: 'autre' };
        },
        obtenirEtatSalons: (options: unknown) => {
          demandes.push(options);
          // Le message est dans « autre » (le salon ouvert) : aucun non-lu
          // ailleurs, donc pas de badge dessiné (canvas absent de jsdom).
          const etat = etatInitial();
          etat.salons[0].messages = [];
          etat.salons[1].messages = [message('m9', 'bob', 'dans autre', 2)];
          return etat;
        },
      },
    });
    expect(typesDemandes).toEqual([['salon', 'ajout-serveur']]);
    expect(demandes[0]).toMatchObject({ salonId: 'autre' });
  });

  it('mémorise le rail avec le compte qui l’a affiché', async () => {
    const { window } = await chargerPage();
    await vi.waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem('chatvardage:rail-serveurs') ?? 'null'
        )
      ).toEqual({
        utilisateurId: 'moi',
        serveurs: [{ id: 'srv', nom: 'Projet', icone: null }],
      })
    );
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

  it('panneau des membres : chargé par pages, « Afficher plus »', async () => {
    const pages: Record<number, unknown> = {
      0: {
        membres: [
          { utilisateurId: 'bob', role: 'proprietaire' },
          { utilisateurId: 'moi', role: 'membre' },
        ],
        total: 3,
        suivant: 2,
        utilisateurs: [
          { id: 'bob', pseudo: 'bob', alias: 'Bobby', avatar: null },
          { id: 'moi', pseudo: 'moi', alias: null, avatar: null },
        ],
      },
      2: {
        membres: [{ utilisateurId: 'zoe', role: 'membre' }],
        total: 3,
        suivant: null,
        utilisateurs: [],
      },
    };
    const demandes: unknown[] = [];
    const { document, window, erreurs } = await chargerPage({
      autresReponses: {
        obtenirMembresServeur: (donnees: { decalage: number }) => {
          demandes.push(donnees);
          return pages[donnees.decalage];
        },
      },
    });
    window.HTMLDialogElement.prototype.showModal ??= function () {};

    document.querySelector<HTMLElement>('#open-members')?.click();
    const noms = () =>
      [...document.querySelectorAll('.member-row .member-name')].map(
        (element) => element.textContent
      );
    await vi.waitFor(() => expect(noms()).toEqual(['Bobby', 'moi (Moi)']));
    const plus = [...document.querySelectorAll('#dialog-content button')].find(
      (bouton) => bouton.textContent === 'Afficher plus de membres'
    ) as HTMLButtonElement;
    expect(plus.hidden).toBe(false);

    plus.click();
    // Membre inconnu (non résolu) : repli sur « utilisateur inconnu ».
    await vi.waitFor(() => expect(noms()).toHaveLength(3));
    expect(plus.hidden).toBe(true);
    expect(demandes).toEqual([
      { serveurId: 'srv', decalage: 0 },
      { serveurId: 'srv', decalage: 2 },
    ]);
    expect(erreurs).toEqual([]);
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

  it('non-lus : compteurs du serveur affichés, salon affiché marqué lu', async () => {
    const marques: unknown[] = [];
    const { document } = await chargerPage({
      autresReponses: {
        obtenirNonLus: { salons: { general: 2, autre: 120 }, prives: {} },
        marquerConversationLue: (donnees: unknown) => {
          marques.push(donnees);
          return { nonLus: 0 };
        },
      },
    });
    const compteur = (salonId: string) =>
      [...document.querySelectorAll('#channel-list button')]
        .find((b) => b.textContent?.includes(salonId))
        ?.querySelector<HTMLElement>('.notif-count');

    // Le salon affiché (général) est lu dès son affichage.
    await vi.waitFor(() =>
      expect(marques).toEqual([{ type: 'salon', conversationId: 'general' }])
    );
    expect(compteur('général')?.hidden).toBe(true);
    expect(compteur('autre')?.textContent).toBe('99+');
    expect(
      document.querySelector<HTMLElement>(
        '.server-icon[data-serveur-id="srv"] .notif-dot'
      )?.hidden
    ).toBe(false);
  });

  it('un message reçu ailleurs incrémente le compteur ; dans le salon affiché, il est lu', async () => {
    const marques: unknown[] = [];
    const { document, rappels } = await chargerPage({
      autresReponses: {
        marquerConversationLue: (donnees: unknown) => {
          marques.push(donnees);
          return { nonLus: 0 };
        },
      },
    });
    rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 'autre',
      serveurId: 'srv',
      message: message('m2', 'bob', 'ailleurs', 2),
    });
    rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 'general',
      serveurId: 'srv',
      message: message('m3', 'bob', 'ici', 3),
    });
    // Son propre message ne compte jamais.
    rappels.onNouveauMessage({
      conversationType: 'salon',
      salonId: 'autre',
      serveurId: 'srv',
      message: message('m4', 'moi', 'moi', 4),
    });
    rappels.onNouveauMessage({
      conversationType: 'dm',
      message: {
        ...message('d1', 'bob', 'privé', 5),
        conversationId: 'bob:moi',
      },
    });

    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll('#channel-list button')]
          .find((b) => b.textContent?.includes('autre'))
          ?.querySelector('.notif-count')?.textContent
      ).toBe('1')
    );
    await vi.waitFor(() =>
      expect(marques).toEqual([{ type: 'salon', conversationId: 'general' }])
    );
    expect(
      document.querySelector<HTMLElement>('#message-prive-btn .notif-dot')
        ?.hidden
    ).toBe(false);
  });

  it('mode « aucune » : compteurs masqués', async () => {
    const { document, window } = await chargerPage({
      autresReponses: {
        obtenirNonLus: { salons: { autre: 2 }, prives: {} },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- script non typé
    (window as any).NotifPrefs.definirMode('moi', 'aucune');
    window.eval('afficherSalons()');
    expect(
      [
        ...document.querySelectorAll<HTMLElement>('#channel-list .notif-count'),
      ].map((c) => c.hidden)
    ).toEqual([true, true]);
  });

  it('recherche : résultats surlignés, clic sur un salon ou une conversation privée', async () => {
    const recherches: unknown[] = [];
    const cibles: unknown[] = [];
    const pages: unknown[] = [];
    const resultatSalon = {
      type: 'salon',
      conversationId: 'autre',
      salonNom: 'autre',
      serveurId: 'srv',
      serveurNom: 'Projet',
      auteurNom: 'bob',
      message: message('ms', 'bob', 'Le projet avance', 10),
    };
    const resultatPrive = {
      type: 'prive',
      conversationId: 'bob:moi',
      interlocuteurId: 'bob',
      interlocuteurNom: null,
      auteurNom: null,
      message: {
        id: 'md',
        auteurId: 'bob',
        contenu: 'projet privé',
        envoi: 11,
      },
    };
    const { document, window } = await chargerPage({
      autresReponses: {
        rechercherMessages: (donnees: { curseur?: string }) => {
          recherches.push(donnees);
          return donnees.curseur
            ? { resultats: [resultatPrive], curseurSuivant: null }
            : { resultats: [resultatSalon], curseurSuivant: 'suite' };
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
    window.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    window.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const dialogue =
      document.querySelector<HTMLDialogElement>('#search-dialog')!;
    const champ = dialogue.querySelector<HTMLInputElement>('.search-input')!;
    const statut = dialogue.querySelector('.search-status')!;

    document.querySelector<HTMLElement>('#open-search')?.click();
    expect(dialogue.open).toBe(true);
    expect(statut.textContent).toBe(traductions.fr.search.prompt);

    // Un seul caractère : rien n'est demandé au serveur.
    champ.value = 'p';
    champ.dispatchEvent(new window.Event('input'));
    champ.value = 'projet';
    champ.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    );
    await vi.waitFor(() =>
      expect(dialogue.querySelectorAll('.search-result')).toHaveLength(1)
    );
    expect(recherches).toEqual([{ texte: 'projet' }]);
    const premier = dialogue.querySelector('.search-result')!;
    expect(premier.querySelector('.search-result-title')?.textContent).toBe(
      '# autre · Projet'
    );
    expect(premier.querySelector('mark')?.textContent).toBe('projet');

    dialogue.querySelector<HTMLElement>('.search-more')?.click();
    await vi.waitFor(() =>
      expect(dialogue.querySelectorAll('.search-result')).toHaveLength(2)
    );
    expect(recherches.at(-1)).toEqual({ texte: 'projet', curseur: 'suite' });
    expect(dialogue.querySelector<HTMLElement>('.search-more')?.hidden).toBe(
      true
    );

    // Salon de ce serveur : ouvert sur place.
    dialogue.querySelector<HTMLElement>('.search-result')?.click();
    expect(dialogue.open).toBe(false);
    await vi.waitFor(() =>
      expect(document.querySelector('#active-channel-name')?.textContent).toBe(
        '# autre'
      )
    );

    // Conversation privée : ouverte sur l'autre page.
    document.querySelector<HTMLElement>('#open-search')?.click();
    dialogue.querySelectorAll<HTMLElement>('.search-result')[1]?.click();
    await vi.waitFor(() => expect(pages).toEqual(['message-prive.html']));
    expect(cibles).toEqual([{ type: 'prive', id: 'bob:moi' }]);
  });

  it('recherche : aucun résultat, erreur et saisie trop courte', async () => {
    let echec = false;
    const { document, window } = await chargerPage({
      autresReponses: {
        rechercherMessages: () => {
          // Forme d'une erreur relayée par l'IPC d'Electron.
          if (echec)
            throw "Error invoking remote method 'messages:rechercher': Error: ERR_HTTP_503";
          return { resultats: [], curseurSuivant: null };
        },
      },
    });
    window.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    window.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const dialogue =
      document.querySelector<HTMLDialogElement>('#search-dialog')!;
    const champ = dialogue.querySelector<HTMLInputElement>('.search-input')!;
    const statut = dialogue.querySelector('.search-status')!;
    document.querySelector<HTMLElement>('#open-search')?.click();

    champ.value = 'rien';
    champ.dispatchEvent(new window.Event('input'));
    await vi.waitFor(() =>
      expect(statut.textContent).toBe(traductions.fr.search.noResults)
    );

    echec = true;
    champ.value = 'panne';
    champ.dispatchEvent(new window.Event('input'));
    await vi.waitFor(() =>
      expect(statut.textContent).toBe(traductions.fr.errors.ERR_HTTP_503)
    );

    champ.value = ' ';
    champ.dispatchEvent(new window.Event('input'));
    expect(statut.textContent).toBe(traductions.fr.search.prompt);
    champ.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));

    dialogue.querySelector<HTMLElement>('.search-close')?.click();
    expect(dialogue.open).toBe(false);
  });
});
