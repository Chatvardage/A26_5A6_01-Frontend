import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it.each(['Dm', 'Salon'])(
  'annule le saut %s après un changement pendant la pagination',
  async (type) => {
    const dm = type === 'Dm';
    const chemin = dm ? 'messages-prives/affichage.js' : 'salons/affichage.js';
    const source = readFileSync(`src/presentation/pages/javascript/${chemin}`, 'utf8');
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
      ChatUiShared: { allerAuMessageAffiche: afficher },
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
    state.activeConversationId = 'autre';
    contexte.salonActifId = 'autre';
    finir(true);
    await attente;
    expect(charger).toHaveBeenCalledTimes(1);
    expect(afficher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
  }
);
