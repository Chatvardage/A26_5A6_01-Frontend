import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it.each([
  ['Dm', false],
  ['Salon', false],
  ['Dm', true],
  ['Salon', true],
] as const)(
  'annule le saut %s après navigation ou réouverture (%s) pendant la pagination',
  async (type, reouverture) => {
    const dm = type === 'Dm';
    const chemin = dm ? 'messages-prives/affichage.js' : 'salons/affichage.js';
    const source = readFileSync(
      `src/presentation/pages/javascript/${chemin}`,
      'utf8'
    );
    const debut = source.indexOf(
      `async function allerAuMessage${type}(messageId) {`
    );
    const fonction = source.slice(debut, source.indexOf('\n}', debut) + 2);
    let finir!: (valeur: boolean) => void;
    const charger = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          finir = r;
        })
    );
    const afficher = vi.fn();
    const notifier = vi.fn();
    const state = { activeConversationId: 'initiale' };
    const contexte = {
      state,
      salonActifId: 'initiale',
      trouverConversation: () => ({
        id: state.activeConversationId,
        messages: [],
      }),
      salonActif: () => ({ id: contexte.salonActifId, messages: [] }),
      etatHistoriqueDm: {},
      etatHistoriqueSalon: {},
      LogiqueInterface: { contientMessage: () => false },
      chargerMessagesPlusAnciensDm: charger,
      chargerMessagesPlusAnciensSalon: charger,
      PAGES_MAX_SAUT: 20,
      PAGES_MAX_SAUT_DM: 20,
      TAILLE_PAGE_SAUT: 100,
      TAILLE_PAGE_SAUT_DM: 100,
      ChatUiShared: {
        allerAuMessageAffiche: afficher,
        afficherChargementRecherche: vi.fn(),
      },
      window: {
        electronAPI: {
          obtenirMessagesPriveesAvant: charger,
          obtenirMessagesSalonAvant: charger,
        },
      },
      renderActiveConversation: vi.fn(),
      afficherMessages: vi.fn(),
      messageErreur: (e: Error) => e.message,
      messageList: {},
      el: { messages: {} },
      notifier,
      t: (cle: string) => cle,
    };
    const sauter = runInNewContext(
      `${fonction}; allerAuMessage${type}`,
      contexte
    );
    const attente = sauter('ancien');
    expect(charger).toHaveBeenCalledTimes(1);
    if (reouverture) {
      contexte.etatHistoriqueDm = {};
      contexte.etatHistoriqueSalon = {};
    } else {
      state.activeConversationId = 'autre';
      contexte.salonActifId = 'autre';
    }
    finir(true);
    await attente;
    expect(charger).toHaveBeenCalledTimes(1);
    expect(afficher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
  }
);

it.each(['Dm', 'Salon'])(
  'partage la pagination %s déjà en cours avec le saut',
  async (type) => {
    const chemin =
      type === 'Dm' ? 'messages-prives/affichage.js' : 'salons/affichage.js';
    const source = readFileSync(
      `src/presentation/pages/javascript/${chemin}`,
      'utf8'
    );
    const debut = source.indexOf(
      `const paginationsEnCours${type} = new Map();`
    );
    const fin = source.indexOf(
      `async function executerPagination${type}`,
      debut
    );
    let finir!: (valeur: boolean) => void;
    const executer = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          finir = r;
        })
    );
    const contexte = {
      state: { activeConversationId: 'initiale' },
      salonActifId: 'initiale',
      [`etatHistorique${type}`]: {},
      [`executerPagination${type}`]: executer,
    };
    const charger = runInNewContext(
      `${source.slice(debut, fin)}; chargerMessagesPlusAnciens${type}`,
      contexte
    );
    const defilement = charger();
    const saut = charger({ taille: 100 });
    expect(saut).toBe(defilement);
    expect(executer).toHaveBeenCalledTimes(1);
    finir(true);
    await expect(saut).resolves.toBe(true);
    charger();
    expect(executer).toHaveBeenCalledTimes(2);
    finir(false);
  }
);

it('annule le saut DM si la conversation change pendant son ouverture', async () => {
  const source = readFileSync(
    'src/presentation/pages/javascript/message-prive.js',
    'utf8'
  );
  const debut = source.indexOf('const ouvrirConversation = async (cible) => {');
  const fin = source.indexOf('\n  };', debut) + 5;
  let finir!: () => void;
  const state = { activeConversationId: '' };
  const sauter = vi.fn();
  const contexte = {
    state,
    renderActiveConversation: () =>
      new Promise<void>((r) => {
        finir = r;
      }),
    renderConversationList: vi.fn(),
    mettreAJourBadgeApplication: vi.fn(),
    allerAuMessageDm: sauter,
  };
  const ouvrir = runInNewContext(
    `${source.slice(debut, fin)}; ouvrirConversation`,
    contexte
  );
  const attente = ouvrir({
    type: 'prive',
    conversationId: 'initiale',
    messageId: 'ancien',
  });
  state.activeConversationId = 'autre';
  finir();
  await attente;
  expect(sauter).not.toHaveBeenCalled();
});

it.each(['Dm', 'Salon'])(
  'isole les paginations %s après réouverture de la même conversation',
  async (type) => {
    const dm = type === 'Dm';
    const source = readFileSync(
      `src/presentation/pages/javascript/${dm ? 'messages-prives/affichage.js' : 'salons/affichage.js'}`,
      'utf8'
    );
    const debut = source.indexOf(
      `const paginationsEnCours${type} = new Map();`
    );
    const fin =
      source.indexOf(
        '\n}',
        source.indexOf(`async function executerPagination${type}`, debut)
      ) + 2;
    const historique = {
      conversationId: 'c',
      salonId: 'c',
      messagesAnciens: [{ id: 'ancien-curseur' }],
      enChargement: false,
      finHistorique: false,
    };
    const nouveau = { ...historique, messagesAnciens: [], enChargement: false };
    const reponses: Array<
      (valeur: { messages: { id: string }[]; finHistorique: boolean }) => void
    > = [];
    const obtenir = vi.fn((donnees: unknown) => {
      void donnees;
      return new Promise<{
        messages: { id: string }[];
        finHistorique: boolean;
      }>((r) => {
        reponses.push(r);
      });
    });
    const rendre = vi.fn();
    const notifier = vi.fn();
    const conversation = { id: 'c', messages: [{ id: 'recent' }] };
    const contexte = {
      state: {
        activeConversationId: 'c',
        currentUserId: 'moi',
        conversations: [conversation],
      },
      salonActifId: 'c',
      utilisateurActuelId: 'moi',
      salonActif: () => conversation,
      [`etatHistorique${type}`]: historique,
      renderActiveConversation: rendre,
      afficherMessages: rendre,
      fusionnerHistoriqueDm: (a: unknown[], b: unknown[]) => [...a, ...b],
      fusionnerHistorique: (a: unknown[], b: unknown[]) => [...a, ...b],
      window: {
        electronAPI: {
          obtenirMessagesPriveesAvant: obtenir,
          obtenirMessagesSalonAvant: obtenir,
        },
      },
      notifier,
      messageErreur: (e: unknown) => String(e),
    };
    const charger = runInNewContext(
      `${source.slice(debut, fin)}; chargerMessagesPlusAnciens${type}`,
      contexte
    );
    const ancienne = charger();
    await Promise.resolve();
    contexte[`etatHistorique${type}`] = nouveau;
    const recente = charger();
    await Promise.resolve();
    expect(recente).not.toBe(ancienne);
    expect(obtenir).toHaveBeenCalledTimes(2);
    expect(obtenir.mock.calls[0][0]).toEqual(
      expect.objectContaining({ avantId: 'ancien-curseur' })
    );
    expect(obtenir.mock.calls[1][0]).toEqual(
      expect.objectContaining({ avantId: 'recent' })
    );
    const rendusAvant = rendre.mock.calls.length;
    reponses[0]({ messages: [{ id: 'trop-ancien' }], finHistorique: true });
    await expect(ancienne).resolves.toBe(false);
    expect(nouveau).toEqual(
      expect.objectContaining({
        messagesAnciens: [],
        finHistorique: false,
        enChargement: true,
      })
    );
    expect(rendre).toHaveBeenCalledTimes(rendusAvant);
    expect(charger()).toBe(recente); // L'ancienne réponse ne libère pas la nouvelle requête.
    reponses[1]({
      messages: [{ id: 'page-intermediaire' }],
      finHistorique: false,
    });
    await expect(recente).resolves.toBe(true);
    expect(nouveau.messagesAnciens).toEqual([{ id: 'page-intermediaire' }]);
    expect(nouveau.enChargement).toBe(false);
    expect(notifier).not.toHaveBeenCalled();
  }
);
