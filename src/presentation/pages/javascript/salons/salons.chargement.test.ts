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

  it('un admin expulse le propriétaire en choisissant son successeur', async () => {
    const expulsions: unknown[] = [];
    const { document, window, erreurs } = await chargerPage({
      monRole: 'admin',
      autresReponses: {
        obtenirMembresServeur: () => ({
          membres: [
            { utilisateurId: 'bob', role: 'proprietaire' },
            { utilisateurId: 'zoe', role: 'membre' },
            { utilisateurId: 'moi', role: 'membre' },
          ],
          total: 3,
          suivant: null,
          utilisateurs: [
            { id: 'bob', pseudo: 'bob', alias: 'Bobby', avatar: null },
            { id: 'zoe', pseudo: 'zoe', alias: null, avatar: null },
            { id: 'moi', pseudo: 'moi', alias: null, avatar: null },
          ],
        }),
        expulserMembre: (donnees: unknown) => {
          expulsions.push(donnees);
          return {};
        },
      },
    });
    window.HTMLDialogElement.prototype.showModal ??= function () {};
    window.HTMLDialogElement.prototype.close ??= function () {};
    document.querySelector<HTMLElement>('#open-members')?.click();
    const boutons = () => [
      ...document.querySelectorAll<HTMLButtonElement>('#dialog-content button'),
    ];
    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('.member-row .member-action.danger')
      ).toHaveLength(2)
    );
    // Premier « Expulser » : celui du propriétaire (en tête de liste).
    document
      .querySelector<HTMLButtonElement>('.member-row .member-action.danger')
      ?.click();
    expect(document.querySelector('#dialog-title')?.textContent).toBe(
      'Expulser Bobby, propriétaire du serveur'
    );
    expect(boutons().map((bouton) => bouton.textContent)).toEqual(
      expect.arrayContaining([
        'Nommer propriétaire et expulser · zoe',
        'Nommer propriétaire et expulser · moi',
      ])
    );
    boutons()
      .find((bouton) => bouton.textContent?.endsWith('· zoe'))
      ?.click();
    await vi.waitFor(() =>
      expect(expulsions).toEqual([
        { serveurId: 'srv', utilisateurId: 'bob', nouveauProprietaire: 'zoe' },
      ])
    );
    expect(erreurs).toEqual([]);
  });

  it('rail : 10 serveurs, puis « voir plus » ; le serveur actif reste visible', async () => {
    const etat = etatInitial();
    // Le serveur actif (« srv ») est le 15e : il est affiché quand même.
    etat.serveurs = [
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        nom: `Serveur ${i}`,
        icone: null,
        parDefaut: false,
        salonIds: [],
      })),
      ...etat.serveurs,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`,
        nom: `Autre ${i}`,
        icone: null,
        parDefaut: false,
        salonIds: [],
      })),
    ];
    const { document, erreurs } = await chargerPage({
      autresReponses: { obtenirEtatSalons: etat },
    });
    const icones = () =>
      document.querySelectorAll('#server-rail .server-icon[data-serveur-id]');
    const plus = () =>
      document.querySelector<HTMLButtonElement>(
        '#server-rail .server-icon--more'
      );
    await vi.waitFor(() => expect(icones()).toHaveLength(11));
    expect(icones()[10].getAttribute('data-serveur-id')).toBe('srv');
    expect(plus()?.getAttribute('aria-label')).toBe(
      traductions.fr.servers.showMoreRail
    );
    // « Voir plus » juste avant le bouton « + » du rail.
    expect(plus()?.nextElementSibling?.id).toBe('open-create-channel-rail');
    plus()!.click();
    expect(icones()).toHaveLength(20);
    expect(icones()[14].getAttribute('data-serveur-id')).toBe('srv');
    expect(document.querySelectorAll('[data-serveur-id="srv"]')).toHaveLength(1);
    plus()!.click();
    expect(icones()).toHaveLength(25);
    expect(plus()).toBeNull();
    expect(erreurs).toEqual([]);
  });

  it('rail : garde la pagination quand le serveur actif est le dernier', async () => {
    const etat = etatInitial();
    etat.serveurs = [
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        nom: `Serveur ${i}`,
        icone: null,
        parDefaut: false,
        salonIds: [],
      })),
      ...etat.serveurs,
    ];
    const { document, erreurs } = await chargerPage({
      autresReponses: { obtenirEtatSalons: etat },
    });
    await vi.waitFor(() =>
      expect(document.querySelectorAll('#server-rail [data-serveur-id]')).toHaveLength(11)
    );
    expect(document.querySelector('#server-rail [data-serveur-id="srv"]')?.classList.contains('active')).toBe(true);
    document.querySelector<HTMLButtonElement>('#server-rail .server-icon--more')!.click();
    expect(document.querySelectorAll('#server-rail [data-serveur-id]')).toHaveLength(15);
    expect(document.querySelector('#server-rail .server-icon--more')).toBeNull();
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
      expect(marques).toEqual([
        { type: 'salon', conversationId: 'general', messageId: 'm1' },
      ])
    );
    expect(compteur('général')?.hidden).toBe(true);
    expect(compteur('autre')?.textContent).toBe('99+');
    // Compteur du serveur : somme de ses salons non lus (« autre » : 99+).
    const compteurServeur = document.querySelector<HTMLElement>(
      '.server-icon[data-serveur-id="srv"] .notif-count--rail'
    );
    expect(compteurServeur?.hidden).toBe(false);
    expect(compteurServeur?.textContent).toBe('99+');
  });

  it('un message reçu ailleurs incrémente le compteur ; dans le salon affiché, il est lu', async () => {
    const marques: unknown[] = [];
    const nonLus = {
      salons: {} as Record<string, number>,
      prives: {} as Record<string, number>,
    };
    const { document, rappels } = await chargerPage({
      autresReponses: {
        obtenirNonLus: () => nonLus,
        marquerConversationLue: (donnees: unknown) => {
          marques.push(donnees);
          return { nonLus: 0 };
        },
      },
    });
    nonLus.salons.autre = 1;
    nonLus.prives['bob:moi'] = 1;
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
      expect(marques).toEqual([
        { type: 'salon', conversationId: 'general', messageId: 'm3' },
      ])
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

  it('ignore une réponse de recherche dès une nouvelle saisie', async () => {
    let terminer!: (page: unknown) => void;
    const { document, window } = await chargerPage({
      autresReponses: {
        rechercherMessages: () =>
          new Promise((resoudre) => {
            terminer = resoudre;
          }),
      },
    });
    window.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    document.querySelector<HTMLElement>('#open-search')?.click();
    const dialogue =
      document.querySelector<HTMLDialogElement>('#search-dialog')!;
    const champ = dialogue.querySelector<HTMLInputElement>('.search-input')!;
    champ.value = 'ancien';
    champ.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(terminer).toBeTypeOf('function'));
    champ.value = 'nouveau';
    champ.dispatchEvent(new window.Event('input'));
    terminer({
      resultats: [
        {
          type: 'salon',
          conversationId: 'general',
          auteurNom: 'bob',
          message: message('m1', 'bob', 'ancien', 1),
        },
      ],
      curseurSuivant: 'ancien-curseur',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(dialogue.querySelectorAll('.search-result')).toHaveLength(0);
    expect(dialogue.querySelector<HTMLElement>('.search-more')?.hidden).toBe(
      true
    );
    // Annuler le délai encore en attente pour terminer ce scénario.
    champ.value = '';
    champ.dispatchEvent(new window.Event('input'));
  });

  it('recherche : dans le salon affiché, résultats surlignés et paginés', async () => {
    const recherches: unknown[] = [];
    const resultat = (id: string, contenu: string, date: number) => ({
      type: 'salon',
      conversationId: 'general',
      auteurNom: 'bob',
      message: message(id, 'bob', contenu, date),
    });
    const { document, window } = await chargerPage({
      autresReponses: {
        rechercherMessages: (donnees: { curseur?: string }) => {
          recherches.push(donnees);
          return donnees.curseur
            ? {
                resultats: [resultat('m0', 'vieux projet', 1)],
                curseurSuivant: null,
              }
            : {
                resultats: [resultat('m5', 'Le projet avance', 5)],
                curseurSuivant: 'suite',
              };
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
    expect(dialogue.querySelector('.search-title')?.textContent).toBe(
      'Rechercher dans # général'
    );
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
    expect(recherches).toEqual([
      { texte: 'projet', type: 'salon', conversationId: 'general' },
    ]);
    expect(dialogue.querySelector('mark')?.textContent).toBe('projet');

    dialogue.querySelector<HTMLElement>('.search-more')?.click();
    await vi.waitFor(() =>
      expect(dialogue.querySelectorAll('.search-result')).toHaveLength(2)
    );
    expect(recherches.at(-1)).toEqual({
      texte: 'projet',
      type: 'salon',
      conversationId: 'general',
      curseur: 'suite',
    });
    expect(dialogue.querySelector<HTMLElement>('.search-more')?.hidden).toBe(
      true
    );

    // Clic sur un résultat : le dialogue se ferme sur le salon.
    dialogue.querySelector<HTMLElement>('.search-result')?.click();
    expect(dialogue.open).toBe(false);

    // Même salon : la recherche précédente est gardée.
    document.querySelector<HTMLElement>('#open-search')?.click();
    expect(champ.value).toBe('projet');
    expect(dialogue.querySelectorAll('.search-result')).toHaveLength(2);
    dialogue.querySelector<HTMLElement>('.search-close')?.click();

    // Autre salon : on repart de zéro, dans ce salon.
    [...document.querySelectorAll<HTMLElement>('#channel-list button')]
      .find((b) => b.textContent?.includes('autre'))
      ?.click();
    document.querySelector<HTMLElement>('#open-search')?.click();
    expect(dialogue.querySelector('.search-title')?.textContent).toBe(
      'Rechercher dans # autre'
    );
    expect(champ.value).toBe('');
    expect(dialogue.querySelectorAll('.search-result')).toHaveLength(0);
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

  describe('non-lus et accusés de lecture', () => {
    it('« Vu par » sous le dernier message, mis à jour en temps réel', async () => {
      const { document, rappels } = await chargerPage({
        autresReponses: {
          obtenirLectures: {
            lecteurs: [
              { utilisateurId: 'alice', nom: 'alice', luJusqua: 1 },
              { utilisateurId: 'carla', nom: 'carla', luJusqua: 1 },
              { utilisateurId: 'dave', nom: 'dave', luJusqua: 0 },
              // L'auteur du message n'est jamais listé.
              { utilisateurId: 'bob', nom: 'bob', luJusqua: 1 },
            ],
          },
        },
      });
      const vuPar = () => document.querySelector('.read-receipt')?.textContent;
      await vi.waitFor(() => expect(vuPar()).toBe('Vu par alice, carla'));

      rappels.onLectureChange({
        type: 'salon',
        conversationId: 'general',
        utilisateurId: 'dave',
        nom: 'dave',
        luJusqua: 1,
        deMoi: false,
      });
      rappels.onLectureChange({
        type: 'salon',
        conversationId: 'general',
        utilisateurId: 'eve',
        nom: 'eve',
        luJusqua: 1,
        deMoi: false,
      });
      await vi.waitFor(() =>
        expect(vuPar()).toBe('Vu par eve, dave, alice et 1 autre')
      );
      rappels.onLectureChange({
        type: 'salon',
        conversationId: 'general',
        utilisateurId: 'zoe',
        nom: 'zoe',
        luJusqua: 1,
        deMoi: false,
      });
      await vi.waitFor(() =>
        expect(vuPar()).toBe('Vu par zoe, eve, dave et 2 autres')
      );

      // Autre salon, ou lecture d'un message plus ancien : sans effet.
      rappels.onLectureChange({
        type: 'salon',
        conversationId: 'autre',
        utilisateurId: 'yann',
        nom: 'yann',
        luJusqua: 9,
        deMoi: false,
      });
      expect(vuPar()).toBe('Vu par zoe, eve, dave et 2 autres');
    });

    it('séparateur « Nouveaux messages » au premier non-lu, pas de « Vu par » sans lecteur', async () => {
      const { document } = await chargerPage({
        autresReponses: {
          obtenirNonLus: { salons: { general: 1 }, prives: {} },
          obtenirLectures: { lecteurs: [] },
        },
      });
      await vi.waitFor(() =>
        expect(document.querySelector('.unread-separator')).not.toBeNull()
      );
      expect(
        document
          .querySelector('.unread-separator')
          ?.nextElementSibling?.querySelector('.text')?.textContent
      ).toBe('salut');
      expect(document.querySelector('.read-receipt')).toBeNull();
    });

    it('lu depuis un autre de mes appareils : les compteurs sont relus', async () => {
      const { rappels, appels } = await chargerPage();
      const avant = appels.obtenirNonLus;
      rappels.onLectureChange({
        type: 'salon',
        conversationId: 'autre',
        utilisateurId: 'moi',
        luJusqua: 1,
        deMoi: true,
      });
      await vi.waitFor(() => expect(appels.obtenirNonLus).toBe(avant + 1));
    });

    it('« Vu par » juste sous le message, au-dessus de Modifier / Supprimer', async () => {
      const etat = etatInitial();
      etat.salons[0].messages = [message('m1', 'moi', 'mon message', 1)];
      const { document } = await chargerPage({
        autresReponses: {
          obtenirEtatSalons: etat,
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

  describe('recherche : aller au message', () => {
    const page = (window: JSDOM['window']) => {
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
      };
    };
    const rechercherEtCliquer = async (
      document: Document,
      window: JSDOM['window']
    ) => {
      const dialogue =
        document.querySelector<HTMLDialogElement>('#search-dialog')!;
      const champ = dialogue.querySelector<HTMLInputElement>('.search-input')!;
      document.querySelector<HTMLElement>('#open-search')?.click();
      champ.value = 'vieux';
      champ.dispatchEvent(new window.Event('input'));
      await vi.waitFor(() =>
        expect(dialogue.querySelectorAll('.search-result')).toHaveLength(1)
      );
      dialogue.querySelector<HTMLElement>('.search-result')?.click();
    };
    const resultat = {
      type: 'salon',
      conversationId: 'general',
      auteurNom: 'bob',
      message: message('ancien', 'bob', 'un vieux message', 0),
    };

    it('charge l’historique jusqu’au message, puis le met en évidence', async () => {
      const etat = etatInitial();
      etat.salons[0].finHistorique = false;
      const demandes: unknown[] = [];
      const { document, window } = await chargerPage({
        autresReponses: {
          obtenirEtatSalons: etat,
          rechercherMessages: { resultats: [resultat], curseurSuivant: null },
          obtenirMessagesSalonAvant: (donnees: unknown) => {
            demandes.push(donnees);
            return {
              messages: [message('ancien', 'bob', 'un vieux message', 0)],
              finHistorique: true,
            };
          },
        },
      });
      page(window);
      await rechercherEtCliquer(document, window);

      await vi.waitFor(() =>
        expect(
          document
            .querySelector('[data-message-id="ancien"]')
            ?.classList.contains('message-cible')
        ).toBe(true)
      );
      expect(demandes).toEqual([
        expect.objectContaining({
          salonId: 'general',
          autourId: 'ancien',
          taille: 50,
        }),
        // Y a-t-il des messages plus récents ? (un seul suffit)
        expect.objectContaining({ apresId: 'ancien', taille: 50 }),
      ]);
      // Rien après la cible : la fenêtre rejoint les messages récents déjà
      // affichés, sans bouton « plus récents ».
      expect(textes(document)).toEqual(['un vieux message', 'salut']);
    });

    it('message disparu de l’historique : message d’erreur', async () => {
      const { document, window } = await chargerPage({
        autresReponses: {
          rechercherMessages: { resultats: [resultat], curseurSuivant: null },
        },
      });
      page(window);
      await rechercherEtCliquer(document, window);
      await vi.waitFor(() =>
        expect(document.querySelector('#toast')?.textContent).toBe(
          traductions.fr.search.messageNotFound
        )
      );
    });
  });
});

it('conserve les lecteurs reçus pendant la réponse HTTP initiale et compare leur position complète', async () => {
  let resoudre!: (valeur: unknown) => void;
  const { document, rappels } = await chargerPage({
    autresReponses: {
      obtenirLectures: () =>
        new Promise((r) => {
          resoudre = r;
        }),
    },
  });
  await vi.waitFor(() => expect(resoudre).toBeTypeOf('function'));
  await rappels.onLectureChange({
    type: 'salon',
    conversationId: 'general',
    utilisateurId: 'alice',
    nom: 'alice',
    luJusqua: 1,
    dernierMessageLuId: 'm1',
    deMoi: false,
  });
  expect(document.querySelector('.read-receipt')?.textContent).toBe(
    'Vu par alice'
  );
  resoudre({
    lecteurs: [
      { utilisateurId: 'alice', nom: 'alice', luJusqua: 0 },
      {
        utilisateurId: 'carla',
        nom: 'carla',
        luJusqua: 1,
        dernierMessageLuId: 'm0',
      },
    ],
  });
  await vi.waitFor(() =>
    expect(document.querySelector('.read-receipt')?.textContent).toBe(
      'Vu par alice'
    )
  );
  await rappels.onLectureChange({
    type: 'salon',
    conversationId: 'general',
    utilisateurId: 'alice',
    nom: 'alice',
    luJusqua: 1,
    dernierMessageLuId: 'm0',
    deMoi: false,
  });
  expect(document.querySelector('.read-receipt')?.textContent).toBe(
    'Vu par alice'
  );
});

it('recharge les lecteurs du salon ouvert après une reconnexion', async () => {
  let luJusqua = 0;
  const { document, rappels, appels } = await chargerPage({
    autresReponses: {
      obtenirLectures: () => ({
        lecteurs: [{ utilisateurId: 'alice', nom: 'alice', luJusqua }],
      }),
    },
  });
  await vi.waitFor(() => expect(appels.obtenirLectures).toBe(1));
  expect(document.querySelector('.read-receipt')).toBeNull();
  luJusqua = 1;
  await rappels.onSynchronisationRequise();
  await vi.waitFor(() =>
    expect(document.querySelector('.read-receipt')?.textContent).toBe(
      'Vu par alice'
    )
  );
  expect(appels.obtenirLectures).toBe(2);
});

it('recherche Salon : roue pendant un seul chargement puis pagination depuis la cible', async () => {
  let resoudre!: (page: unknown) => void;
  const demandes: unknown[] = [];
  const { document, window } = await chargerPage({
    autresReponses: {
      obtenirMessagesSalonAvant: (donnees: unknown) => {
        demandes.push(donnees);
        if (demandes.length === 1)
          return new Promise((resolve) => {
            resoudre = resolve;
          });
        return demandes.length === 2
          ? {
              messages: [message('m1', 'bob', 'salut', 1)],
              finHistorique: false,
            }
          : {
              messages: [message('m2', 'bob', 'suite', 2)],
              finHistorique: true,
            };
      },
    },
  });
  const attente = window.eval('allerAuMessageSalon("ancien")');
  expect(document.querySelector('.recherche-message-roue')).not.toBeNull();
  expect(document.querySelectorAll('[data-message-id]')).toHaveLength(0);
  await vi.waitFor(() => expect(demandes).toHaveLength(1));
  expect(demandes[0]).toMatchObject({ autourId: 'ancien', taille: 50 });
  resoudre({
    messages: [message('ancien', 'bob', 'Message ancien', 0)],
    finHistorique: true,
  });
  await attente;
  expect(document.querySelector('.recherche-message-roue')).toBeNull();
  expect(
    document
      .querySelector('[data-message-id="ancien"]')
      ?.classList.contains('message-cible')
  ).toBe(true);
  // Une page de messages plus récents arrive avec la cible.
  expect(document.querySelector('[data-message-id="m1"]')).not.toBeNull();
  expect(demandes[1]).toMatchObject({ apresId: 'ancien', taille: 50 });
  const bouton = [...document.querySelectorAll('button')].find(
    (element) => element.textContent === traductions.fr.history.loadNewer
  );
  bouton!.click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-message-id="m2"]')).not.toBeNull()
  );
  expect(demandes[2]).toMatchObject({ apresId: 'm1', taille: 50 });
  expect(
    [...document.querySelectorAll('button')].some(
      (element) => element.textContent === traductions.fr.history.loadNewer
    )
  ).toBe(false);
  expect(document.querySelectorAll('[data-message-id="ancien"]')).toHaveLength(
    1
  );
});

it.each([
  ['rien après la cible', () => ({ messages: [], finHistorique: true })],
  [
    'vérification en échec',
    () => {
      throw new Error('réseau');
    },
  ],
])(
  'recherche Salon : bouton « plus récents » selon la suite (%s)',
  async (cas, suite) => {
    let appel = 0;
    const { document, window } = await chargerPage({
      autresReponses: {
        obtenirMessagesSalonAvant: () =>
          ++appel === 1
            ? {
                messages: [message('ancien', 'bob', 'Message ancien', 0)],
                finHistorique: true,
              }
            : suite(),
      },
    });
    await window.eval('allerAuMessageSalon("ancien")');
    const bouton = [...document.querySelectorAll('button')].find(
      (element) => element.textContent === traductions.fr.history.loadNewer
    );
    // Échec : le bouton reste, la suite existe peut-être.
    expect(Boolean(bouton)).toBe(cas === 'vérification en échec');
  }
);
