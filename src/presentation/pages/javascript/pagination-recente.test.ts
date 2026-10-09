import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function sourceFonction(type: string, nom: string) {
  const chemin = type === 'Dm' ? 'messages-prives' : 'salons';
  const source = readFileSync(
    `src/presentation/pages/javascript/${chemin}/affichage.js`,
    'utf8'
  );
  const debut = source.indexOf(`async function ${nom}(`);
  return source.slice(debut, source.indexOf('\n}', debut) + 2);
}

function fusionReelle() {
  const contexte: { LogiqueInterface?: { fusionnerHistorique: unknown } } = {};
  runInNewContext(
    readFileSync(
      'src/presentation/pages/javascript/logique-interface.js',
      'utf8'
    ),
    contexte
  );
  return contexte.LogiqueInterface!.fusionnerHistorique;
}

it('le saut puis la pagination salon conservent le tri et le dernier curseur', async () => {
  const obtenir = vi
    .fn()
    .mockResolvedValueOnce({
      messages: [{ id: 'cible', date: 20 }],
      finHistorique: true,
    })
    .mockResolvedValueOnce({
      messages: [
        { id: 'recent', date: 40 },
        { id: 'milieu', date: 30 },
      ],
      finHistorique: false,
    })
    .mockResolvedValueOnce({
      messages: [
        { id: 'dernier', date: 60 },
        { id: 'avant-dernier', date: 50 },
      ],
      finHistorique: true,
    });
  const contexte = {
    salonActifId: 's',
    etatHistoriqueSalon: {
      messagesAnciens: [] as { id: string; date: number }[],
    },
    window: { electronAPI: { obtenirMessagesSalonAvant: obtenir } },
    fusionnerHistorique: fusionReelle(),
    ChatUiShared: {
      afficherChargementRecherche: vi.fn(),
      allerAuMessageAffiche: vi.fn(),
    },
    el: { messages: {} },
    afficherMessages: vi.fn(),
    notifier: vi.fn(),
    t: (cle: string) => cle,
    messageErreur: (e: Error) => e.message,
  };
  const fonctions = runInNewContext(
    `${sourceFonction('Salon', 'allerAuMessageSalon')};
     ${sourceFonction('Salon', 'chargerMessagesPlusRecentsSalon')};
     ({ sauter: allerAuMessageSalon, charger: chargerMessagesPlusRecentsSalon })`,
    contexte
  );
  await fonctions.sauter('cible');
  expect(contexte.etatHistoriqueSalon.messagesAnciens.map((m) => m.id)).toEqual(
    ['cible', 'milieu', 'recent']
  );
  await fonctions.charger();
  expect(obtenir.mock.calls[2][0]).toEqual({
    salonId: 's',
    apresId: 'recent',
    taille: 50,
  });
  expect(contexte.etatHistoriqueSalon.messagesAnciens.map((m) => m.id)).toEqual(
    ['cible', 'milieu', 'recent', 'avant-dernier', 'dernier']
  );
  expect(contexte.notifier).not.toHaveBeenCalled();
});

it.each(['Dm', 'Salon'])(
  'la pagination récente %s ignore un historique vidé',
  async (type) => {
    const historique = {
      ancreId: 'supprime',
      messagesAnciens: [],
      enChargement: false,
    };
    const obtenir = vi.fn();
    const notifier = vi.fn();
    const contexte = {
      state: { activeConversationId: 'c' },
      salonActifId: 'c',
      [`etatHistorique${type}`]: historique,
      window: {
        electronAPI: {
          obtenirMessagesPriveesAvant: obtenir,
          obtenirMessagesSalonAvant: obtenir,
        },
      },
      renderActiveConversation: vi.fn(),
      afficherMessages: vi.fn(),
      notifier,
      messageErreur: (e: Error) => e.message,
    };
    const nom = `chargerMessagesPlusRecents${type}`;
    const charger = runInNewContext(
      `${sourceFonction(type, nom)}; ${nom}`,
      contexte
    );
    await charger();
    expect(obtenir).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
    expect(historique.enChargement).toBe(false);
  }
);
