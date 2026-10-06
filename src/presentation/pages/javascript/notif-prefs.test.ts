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
    await vi.waitFor(() =>
      expect(NotifPrefs.nombreNonLus('prive', 'quittee')).toBe(2)
    );
    expect(serveur.marquerConversationLue).toHaveBeenCalledTimes(1);
  });
});
