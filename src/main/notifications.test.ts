// Le vrai module main est execute avec Electron simule : verifie la decision
// et la navigation au clic, sans pretendre observer le centre de notifications OS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function charger() {
  const show = vi.fn();
  const rappels: Record<string, () => void> = {};
  const canaux: Record<string, (donnees: unknown) => unknown> = {};
  const fenetre = {
    isDestroyed: () => false,
    isFocused: () => false,
    show: vi.fn(),
    focus: vi.fn(),
  };
  const etat = {
    mainWindow: fenetre,
    fenetreEstFocusee: false,
    activeConversationId: 'a:b',
    langueActuelle: 'fr',
    modeNotificationActuel: 'systeme',
  };
  const envoyerVersRenderer = vi.fn();
  class Notification {
    static isSupported() {
      return true;
    }
    show = show;
    on(nom: string, rappel: () => void) {
      rappels[nom] = rappel;
    }
  }
  const modules: Record<string, unknown> = {
    electron: { app: {}, nativeImage: {}, Notification },
    '../i18n/i18n.js': { t: (_langue: string, cle: string) => cle },
    './contexte': {
      etat,
      logDebugNotif: vi.fn(),
      cleanText: (texte: string) => texte,
      envoyerVersRenderer,
    },
    './securite': {
      exposerCanal: (nom: string, rappel: (donnees: unknown) => unknown) => {
        canaux[nom] = rappel;
      },
    },
    './fenetre': { APP_ICON_PATH: 'icone.png' },
  };
  runInNewContext(
    readFileSync(path.join(__dirname, 'notifications.js'), 'utf8'),
    {
      require: (nom: string) => modules[nom],
      module: { exports: {} },
      process: { platform: 'win32', env: {} },
      console,
    }
  );
  return { show, rappels, canaux, etat, fenetre, envoyerVersRenderer };
}

const message = { conversationId: 'a:b', contenu: 'Bonjour', type: 'prive' };
describe('Notifications du processus principal', () => {
  it('notifie hors focus et ouvre la conversation au clic', () => {
    const t = charger();
    expect(t.canaux['notification:message-received'](message)).toEqual({
      shown: true,
    });
    expect(t.show).toHaveBeenCalledOnce();
    t.rappels.click();
    expect(t.fenetre.focus).toHaveBeenCalledOnce();
    expect(t.envoyerVersRenderer).toHaveBeenCalledWith(
      'notifications:naviguer-vers-conversation',
      { type: 'prive', conversationId: 'a:b' }
    );
  });
  it('ne notifie pas la conversation deja lue au premier plan', () => {
    const t = charger();
    t.etat.fenetreEstFocusee = true;
    expect(t.canaux['notification:message-received'](message)).toEqual({
      shown: false,
    });
    expect(t.show).not.toHaveBeenCalled();
  });
  it.each(['aucune', 'discret'])(
    'respecte le mode %s meme si le renderer demande une notification',
    (mode) => {
      const t = charger();
      t.etat.modeNotificationActuel = mode;
      expect(t.canaux['notification:message-received'](message)).toEqual({
        shown: false,
      });
      expect(t.show).not.toHaveBeenCalled();
    }
  );
});
