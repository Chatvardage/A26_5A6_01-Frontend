import { beforeEach, describe, expect, it, vi } from 'vitest';
// Script classique : s'enregistre sur window.NotifPrefs.
import './notif-prefs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- script non typé
const NotifPrefs = (window as any).NotifPrefs;

const installerStockageMemoire = () => {
  const donnees = new Map<string, string>();
  const stockage = {
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => {
      donnees.set(cle, String(valeur));
    },
    removeItem: (cle: string) => {
      donnees.delete(cle);
    },
    clear: () => {
      donnees.clear();
    },
    key: (index: number) => [...donnees.keys()][index] ?? null,
    get length() {
      return donnees.size;
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: stockage,
  });
};

describe('NotifPrefs : aperçu dans les notifications système', () => {
  beforeEach(() => {
    installerStockageMemoire();
  });

  it('affiche le contenu par défaut, masquable par utilisateur', () => {
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    expect(NotifPrefs.afficheApercu(null)).toBe(true);
    NotifPrefs.definirApercu('u1', false);
    expect(NotifPrefs.afficheApercu('u1')).toBe(false);
    expect(NotifPrefs.afficheApercu('u2')).toBe(true);
    NotifPrefs.definirApercu('u1', true);
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    NotifPrefs.definirApercu(null, false); // sans utilisateur : ignoré
  });

  it('masque le contenu envoyé à la notification système si demandé', async () => {
    const message = {
      type: 'prive',
      auteurId: 'bob',
      contenu: 'secret',
      conversationId: 'c',
    };
    const notifier = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await NotifPrefs.traiterMessageRecu(message, {
      utilisateurId: 'u1',
      notifierMessageSysteme: notifier,
    });
    expect(notifier).toHaveBeenLastCalledWith(message);

    NotifPrefs.definirApercu('u1', false);
    await NotifPrefs.traiterMessageRecu(message, {
      utilisateurId: 'u1',
      notifierMessageSysteme: notifier,
    });
    expect(notifier).toHaveBeenLastCalledWith({
      ...message,
      contenu: '',
      apercuMasque: true,
    });
  });

  it('stockage indisponible : contenu affiché, sans erreur', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('bloqué');
      },
    });
    expect(NotifPrefs.afficheApercu('u1')).toBe(true);
    expect(() => NotifPrefs.definirApercu('u1', false)).not.toThrow();
  });
});

const api = (nonLus: unknown = { salons: {}, prives: {} }) => ({
  obtenirNonLus: vi.fn().mockResolvedValue(nonLus),
  marquerConversationLue: vi.fn().mockResolvedValue({ nonLus: 0 }),
});

describe('NotifPrefs : compteurs de non-lus (copie de Message-Service)', () => {
  beforeEach(async () => {
    await NotifPrefs.chargerNonLus(api());
  });

  it('charge les compteurs du serveur et ignore les valeurs nulles', async () => {
    await NotifPrefs.chargerNonLus(
      api({ salons: { s1: 2, s2: 0 }, prives: { 'a:b': 5 } })
    );
    expect(NotifPrefs.nombreNonLus('salon', 's1')).toBe(2);
    expect(NotifPrefs.nombreNonLus('salon', 's2')).toBe(0);
    expect(NotifPrefs.nombreNonLus('prive', 'a:b')).toBe(5);
    expect(NotifPrefs.nombreNonLus('prive', 's1')).toBe(0);
    expect(NotifPrefs.nombreNonLus('inconnu', 's1')).toBe(0);
    expect(NotifPrefs.totalNonLus()).toBe(7);
    expect(NotifPrefs.totalNonLus({ type: 'prive' })).toBe(5);
    expect(
      NotifPrefs.totalNonLus({ type: 'salon', conversationIds: ['s1', 's3'] })
    ).toBe(2);

    // Réponse vide : tout est remis à zéro.
    await NotifPrefs.chargerNonLus(api(null));
    expect(NotifPrefs.totalNonLus()).toBe(0);
  });

  it('garde les compteurs actuels si le serveur ne répond pas', async () => {
    await NotifPrefs.chargerNonLus(api({ salons: { s1: 1 }, prives: {} }));
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await NotifPrefs.chargerNonLus({
      obtenirNonLus: vi.fn().mockRejectedValue(new Error('ERR_HTTP_503')),
    });
    expect(NotifPrefs.nombreNonLus('salon', 's1')).toBe(1);
    expect(avertir).toHaveBeenCalled();
  });

  it('compte les messages reçus et ignore un type ou un identifiant absent', () => {
    NotifPrefs.ajouterNonLu('prive', 'a:b');
    NotifPrefs.ajouterNonLu('prive', 'a:b');
    NotifPrefs.ajouterNonLu('prive', '');
    NotifPrefs.ajouterNonLu('autre', 'x');
    expect(NotifPrefs.nombreNonLus('prive', 'a:b')).toBe(2);
    expect(NotifPrefs.totalNonLus()).toBe(2);
  });

  it('marquer lu remet à zéro et prévient le serveur, seulement s’il y avait des non-lus', async () => {
    const serveur = api();
    NotifPrefs.marquerLu(serveur, 'salon', 's1');
    expect(serveur.marquerConversationLue).not.toHaveBeenCalled();

    NotifPrefs.ajouterNonLu('salon', 's1');
    NotifPrefs.marquerLu(serveur, 'salon', 's1');
    expect(NotifPrefs.nombreNonLus('salon', 's1')).toBe(0);
    await vi.waitFor(() =>
      expect(serveur.marquerConversationLue).toHaveBeenCalledWith({
        type: 'salon',
        conversationId: 's1',
      })
    );
  });

  it('un échec du marquage restaure le compteur et permet une nouvelle tentative', async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    NotifPrefs.ajouterNonLu('prive', 'a:b');
    NotifPrefs.marquerLu(
      { marquerConversationLue: vi.fn().mockRejectedValue(new Error('x')) },
      'prive',
      'a:b'
    );
    await vi.waitFor(() =>
      expect(avertir).toHaveBeenCalledWith(
        '[non-lus] marquage comme lu impossible :',
        expect.any(Error)
      )
    );
  });

  it('retente après échec et conserve les messages arrivés pendant la requête', async () => {
    const serveur = api();
    let rejeter!: (erreur: Error) => void;
    serveur.marquerConversationLue.mockImplementationOnce(
      () =>
        new Promise((_resoudre, rejet) => {
          rejeter = rejet;
        })
    );
    NotifPrefs.ajouterNonLu('salon', 'retry');
    NotifPrefs.marquerLu(serveur, 'salon', 'retry');
    await vi.waitFor(() =>
      expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1)
    );
    NotifPrefs.ajouterNonLu('salon', 'retry');
    NotifPrefs.marquerLu(serveur, 'salon', 'retry');
    expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1);
    rejeter(new Error('réseau'));
    await vi.waitFor(() =>
      expect(NotifPrefs.nombreNonLus('salon', 'retry')).toBe(2)
    );
    NotifPrefs.marquerLu(serveur, 'salon', 'retry');
    await vi.waitFor(() =>
      expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(2)
    );
    expect(NotifPrefs.nombreNonLus('salon', 'retry')).toBe(0);
  });

  it('affiche le compteur (99+ au-delà de 99), masqué à zéro ou si désactivé', () => {
    const element = document.createElement('span');
    NotifPrefs.remplirCompteur(element, 3);
    expect([element.hidden, element.textContent]).toEqual([false, '3']);
    NotifPrefs.remplirCompteur(element, 120);
    expect(element.textContent).toBe('99+');
    NotifPrefs.remplirCompteur(element, 4, false);
    expect([element.hidden, element.textContent]).toEqual([true, '']);
    NotifPrefs.remplirCompteur(element, 0);
    expect(element.hidden).toBe(true);
    NotifPrefs.remplirCompteur(null, 3); // sans élément : rien
    expect(NotifPrefs.libelleNonLus(99)).toBe('99');
  });
});

describe('marquage pendant une réception', () => {
  it('réconcilie la réponse et marque les messages arrivés en cours de requête', async () => {
    let resoudre!: (valeur: { nonLus: number }) => void;
    const serveur = api();
    serveur.marquerConversationLue.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resoudre = r;
        })
    );
    const surChangement = vi.fn();
    NotifPrefs.ajouterNonLu('salon', 'arrivee');
    NotifPrefs.marquerLu(serveur, 'salon', 'arrivee', {
      estAffichee: () => true,
      surChangement,
    });
    await vi.waitFor(() =>
      expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1)
    );
    NotifPrefs.ajouterNonLu('salon', 'arrivee');
    serveur.obtenirNonLus.mockResolvedValueOnce({
      salons: { arrivee: 1 },
      prives: {},
    });
    resoudre({ nonLus: 1 });
    await vi.waitFor(() =>
      expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(2)
    );
    expect(NotifPrefs.nombreNonLus('salon', 'arrivee')).toBe(0);
    expect(surChangement).toHaveBeenCalled();
  });
  it('conserve les non-lus si la conversation a été quittée ou le focus perdu', async () => {
    const serveur = api();
    serveur.marquerConversationLue.mockResolvedValueOnce({ nonLus: 2 });
    NotifPrefs.ajouterNonLu('prive', 'quittee');
    NotifPrefs.marquerLu(serveur, 'prive', 'quittee', {
      estAffichee: () => false,
    });
    serveur.obtenirNonLus.mockResolvedValueOnce({
      salons: {},
      prives: { quittee: 2 },
    });
    await vi.waitFor(() =>
      expect(NotifPrefs.nombreNonLus('prive', 'quittee')).toBe(2)
    );
    expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1);
  });

  it('retire un non-lu local déjà inclus par le PUT après avoir quitté la conversation', async () => {
    let resoudre!: (valeur: { nonLus: number }) => void;
    const serveur = api();
    serveur.marquerConversationLue.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resoudre = r;
        })
    );
    NotifPrefs.ajouterNonLu('prive', 'deja-lu');
    NotifPrefs.marquerLu(serveur, 'prive', 'deja-lu', {
      estAffichee: () => false,
    });
    await vi.waitFor(() =>
      expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1)
    );
    NotifPrefs.ajouterNonLu('prive', 'deja-lu');
    resoudre({ nonLus: 0 });
    await vi.waitFor(() =>
      expect(serveur.obtenirNonLus).toHaveBeenCalledTimes(1)
    );
    expect(NotifPrefs.nombreNonLus('prive', 'deja-lu')).toBe(0);
  });
});

it('ignore un ancien chargement qui répond après le plus récent', async () => {
  let resoudre!: (valeur: unknown) => void;
  const serveur = api();
  serveur.obtenirNonLus.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resoudre = r;
      })
  );
  const ancien = NotifPrefs.chargerNonLus(serveur);
  serveur.obtenirNonLus.mockResolvedValueOnce({
    salons: { recent: 2 },
    prives: {},
  });
  await NotifPrefs.chargerNonLus(serveur);
  resoudre({ salons: { recent: 0 }, prives: {} });
  await ancien;
  expect(NotifPrefs.nombreNonLus('salon', 'recent')).toBe(2);
});

it('redemande les compteurs si un message arrive après leur capture par le serveur', async () => {
  let resoudre!: (valeur: unknown) => void;
  const serveur = api();
  await NotifPrefs.chargerNonLus(serveur);
  serveur.obtenirNonLus.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resoudre = r;
      })
  );
  serveur.obtenirNonLus.mockResolvedValueOnce({
    salons: { nouveau: 1 },
    prives: {},
  });
  const enCours = NotifPrefs.chargerNonLus(serveur);
  NotifPrefs.ajouterNonLu('salon', 'nouveau');
  resoudre({ salons: {}, prives: {} });
  await enCours;
  expect(NotifPrefs.nombreNonLus('salon', 'nouveau')).toBe(1);
  expect(serveur.obtenirNonLus).toHaveBeenCalledTimes(3);
});

it('préserve les changements locaux si les deux réponses sont périmées', async () => {
  const serveur = api();
  await NotifPrefs.chargerNonLus(serveur);
  serveur.obtenirNonLus.mockImplementation(async () => {
    NotifPrefs.ajouterNonLu('prive', 'active');
    return { salons: {}, prives: {} };
  });
  await NotifPrefs.chargerNonLus(serveur);
  expect(NotifPrefs.nombreNonLus('prive', 'active')).toBe(2);
  expect(serveur.obtenirNonLus).toHaveBeenCalledTimes(3);
});

describe('chargement pendant un marquage', () => {
  it.each([true, false])(
    'ignore le compteur antérieur au PUT (succès : %s)',
    async (reussi) => {
      const serveur = api({ salons: { conflit: 4, autre: 2 }, prives: {} });
      await NotifPrefs.chargerNonLus(serveur);
      let finir!: (valeur: { nonLus: number }) => void;
      let echouer!: (erreur: Error) => void;
      serveur.marquerConversationLue.mockImplementationOnce(
        () =>
          new Promise((r, j) => {
            finir = r;
            echouer = j;
          })
      );
      const surChangement = vi.fn();
      NotifPrefs.marquerLu(serveur, 'salon', 'conflit', {
        estAffichee: () => false,
        surChangement,
      });
      await vi.waitFor(() =>
        expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1)
      );
      NotifPrefs.ajouterNonLu('salon', 'conflit');
      await NotifPrefs.chargerNonLus(serveur);
      expect(NotifPrefs.nombreNonLus('salon', 'conflit')).toBe(1);
      expect(NotifPrefs.nombreNonLus('salon', 'autre')).toBe(2);
      serveur.obtenirNonLus.mockResolvedValue({
        salons: { conflit: reussi ? 1 : 5 },
        prives: {},
      });
      if (reussi) finir({ nonLus: 1 });
      else echouer(new Error('réseau'));
      await vi.waitFor(() => expect(surChangement).toHaveBeenCalled());
      expect(NotifPrefs.nombreNonLus('salon', 'conflit')).toBe(reussi ? 1 : 5);
      expect(serveur.obtenirNonLus).toHaveBeenCalledTimes(3);
    }
  );
});

it('ne relance pas une lecture si le focus est perdu pendant la relecture des compteurs', async () => {
  const serveur = api({ salons: { attente: 1 }, prives: {} });
  await NotifPrefs.chargerNonLus(serveur);
  let finirPut!: (valeur: { nonLus: number }) => void;
  serveur.marquerConversationLue.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finirPut = r;
      })
  );
  let affichee = true;
  const changement = vi.fn();
  NotifPrefs.marquerLu(serveur, 'salon', 'attente', {
    estAffichee: () => affichee,
    surChangement: changement,
  });
  await vi.waitFor(() =>
    expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1)
  );
  await NotifPrefs.chargerNonLus(serveur);
  let finirGet!: (valeur: unknown) => void;
  serveur.obtenirNonLus.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finirGet = r;
      })
  );
  finirPut({ nonLus: 1 });
  await vi.waitFor(() =>
    expect(serveur.obtenirNonLus).toHaveBeenCalledTimes(3)
  );
  affichee = false;
  finirGet({ salons: { attente: 1 }, prives: {} });
  await vi.waitFor(() => expect(changement).toHaveBeenCalled());
  expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1);
  expect(NotifPrefs.nombreNonLus('salon', 'attente')).toBe(1);
});

it.each(['salon', 'prive'])(
  'borne la lecture %s au rendu et attend un nouveau rendu avant de relancer',
  async (type) => {
    const serveur = api();
    const conversationId = `rendu-${type}`;
    let resoudre!: (valeur: { nonLus: number }) => void;
    serveur.marquerConversationLue.mockImplementationOnce(() => new Promise((r) => { resoudre = r; }));
    NotifPrefs.ajouterNonLu(type, conversationId);
    const options = { messageId: 'affiche-1', estAffichee: () => true };
    NotifPrefs.marquerLu(serveur, type, conversationId, options);
    await vi.waitFor(() => expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1));
    expect(serveur.marquerConversationLue).toHaveBeenLastCalledWith({ type, conversationId, messageId: 'affiche-1' });
    // Le compteur peut connaître un message dont le rendu n'a pas encore eu lieu.
    NotifPrefs.ajouterNonLu(type, conversationId);
    resoudre({ nonLus: 1 });
    await vi.waitFor(() => expect(NotifPrefs.nombreNonLus(type, conversationId)).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1);
    // Le rendu suivant fournit une nouvelle borne, même pendant le PUT.
    let terminer!: (valeur: { nonLus: number }) => void;
    serveur.marquerConversationLue.mockImplementationOnce(() => new Promise((r) => { terminer = r; }));
    NotifPrefs.marquerLu(serveur, type, conversationId, { ...options, messageId: 'affiche-2' });
    await vi.waitFor(() => expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(2));
    NotifPrefs.ajouterNonLu(type, conversationId);
    NotifPrefs.marquerLu(serveur, type, conversationId, { ...options, messageId: 'affiche-3' });
    terminer({ nonLus: 1 });
    await vi.waitFor(() => expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(3));
    expect(serveur.marquerConversationLue).toHaveBeenLastCalledWith({ type, conversationId, messageId: 'affiche-3' });
    await vi.waitFor(() => expect(NotifPrefs.nombreNonLus(type, conversationId)).toBe(0));
  }
);
