import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Modules CommonJS du processus main, chargés avec un faux `electron` placé
// dans le cache de require (même principe que
// RealGatewayRuntime.couverture.test.ts).
const requireLocal = createRequire(path.join(process.cwd(), 'package.json'));
const cheminElectron = requireLocal.resolve('electron');

type Gestionnaire = (evenement: unknown, donnees?: unknown) => unknown;
const canaux = new Map<string, Gestionnaire>();
let intercepteurEnTetes: (
  details: { url: string; responseHeaders: Record<string, string[]> },
  rappel: (reponse: unknown) => void
) => void;

const fauxElectron = {
  ipcMain: {
    handle: (nom: string, gestionnaire: Gestionnaire) =>
      canaux.set(nom, gestionnaire),
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: (rappel: typeof intercepteurEnTetes) => {
          intercepteurEnTetes = rappel;
        },
      },
    },
  },
  BrowserWindow: {},
  screen: {},
  shell: {},
};

let ancien: NodeJS.Module | undefined;

function charger(isDev: boolean) {
  const cheminSecurite = requireLocal.resolve('./src/main/securite.js');
  const cheminContexte = requireLocal.resolve('./src/main/contexte.js');
  delete requireLocal.cache[cheminSecurite];
  delete requireLocal.cache[cheminContexte];
  const ancienEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = isDev ? 'development' : 'test';
  try {
    return requireLocal('./src/main/securite.js');
  } finally {
    process.env.NODE_ENV = ancienEnv;
  }
}

beforeAll(() => {
  ancien = requireLocal.cache[cheminElectron];
  requireLocal.cache[cheminElectron] = {
    exports: fauxElectron,
  } as unknown as NodeJS.Module;
});

afterAll(() => {
  if (ancien) requireLocal.cache[cheminElectron] = ancien;
  else delete requireLocal.cache[cheminElectron];
});

describe('securite (processus main)', () => {
  it("n'accepte que les pages de l'app et la page de connexion buildée", () => {
    const s = charger(false);
    const page = pathToFileURL(path.join(s.APP_PAGES_ROOT, 'profil.html'));
    const voisin = pathToFileURL(`${s.APP_PAGES_ROOT}-evil/index.html`);

    expect(s.isAppUrl(page.href)).toBe(true);
    expect(s.isAppUrl(pathToFileURL(s.APP_LOGIN_PATH).href)).toBe(true);
    expect(s.isAppUrl(voisin.href)).toBe(false);
    expect(s.isAppUrl('file:///etc/passwd')).toBe(false);
    expect(s.isAppUrl('https://exemple.test/')).toBe(false);
    expect(s.isAppUrl('pas une url')).toBe(false);
    expect(s.isAppUrl('file://serveur/partage/x.html')).toBe(false);
    // Serveur de dev refusé hors développement.
    expect(s.isAppUrl(`http://localhost:${s.DEV_SERVER_PORT}/`)).toBe(false);
  });

  it("n'accepte le serveur de dev qu'en développement, port exact", () => {
    const s = charger(true);
    expect(s.isAppUrl(`http://localhost:${s.DEV_SERVER_PORT}/`)).toBe(true);
    expect(s.isAppUrl('http://localhost:9999/')).toBe(false);
    expect(s.isAppUrl(`http://localhost.evil.test:${s.DEV_SERVER_PORT}/`)).toBe(
      false
    );
  });

  it('reconnaît la page de connexion buildée, même encodée', () => {
    const s = charger(false);
    expect(s.isProdLoginFileUrl(pathToFileURL(s.APP_LOGIN_PATH).href)).toBe(
      true
    );
    expect(s.isProdLoginFileUrl('pas une url')).toBe(false);
    expect(s.isProdLoginFileUrl('https://exemple.test/')).toBe(false);
    expect(s.isProdLoginFileUrl('file://serveur/partage/x.html')).toBe(false);
    expect(
      s.isPathInsideAppPages(path.join(s.APP_PAGES_ROOT, 'index.html'))
    ).toBe(true);
  });

  it('vérifie la provenance des appels IPC', async () => {
    const s = charger(false);
    const depuisApp = {
      senderFrame: {
        url: pathToFileURL(path.join(s.APP_PAGES_ROOT, 'index.html')).href,
      },
    };
    const depuisAilleurs = { senderFrame: { url: 'https://exemple.test/' } };

    expect(s.isTrustedIpcEvent(depuisApp)).toBe(true);
    expect(s.isTrustedIpcEvent({})).toBe(false);
    expect(() => s.verifierProvenance({})).toThrow('Origine IPC non autorisée');

    const action = vi.fn((donnees) => ({ recu: donnees }));
    s.exposerCanal('test:canal', action);
    const gestionnaire = canaux.get('test:canal') as Gestionnaire;
    expect(await gestionnaire(depuisApp, { a: 1 })).toEqual({ recu: { a: 1 } });
    expect(await gestionnaire(depuisApp)).toEqual({ recu: {} });
    expect(() => gestionnaire(depuisAilleurs, {})).toThrow(
      'Origine IPC non autorisée'
    );
    expect(action).toHaveBeenCalledTimes(2);

    // Canal « tire et oublie » : valeur de refus au lieu d'une erreur, et
    // l'action n'est jamais appelée depuis une page non reconnue.
    const silencieuse = vi.fn(() => 'ok');
    s.exposerCanal('test:silencieux', silencieuse, { siRefuse: false });
    const silencieux = canaux.get('test:silencieux') as Gestionnaire;
    expect(await silencieux(depuisAilleurs, {})).toBe(false);
    expect(silencieuse).not.toHaveBeenCalled();
    expect(await silencieux(depuisApp, 'conv-1')).toBe('ok');
    expect(silencieuse).toHaveBeenCalledWith('conv-1');
  });

  it.each([
    [false, "script-src 'self';"],
    [true, "script-src 'self' 'unsafe-inline';"],
  ])(
    'applique la CSP à la seule page de connexion (dev = %s)',
    (isDev, attendu) => {
      const s = charger(isDev);
      s.configurerCsp();
      const urlConnexion = isDev
        ? `http://localhost:${s.DEV_SERVER_PORT}/`
        : pathToFileURL(s.APP_LOGIN_PATH).href;

      const rappel = vi.fn();
      intercepteurEnTetes(
        { url: urlConnexion, responseHeaders: { a: ['1'] } },
        rappel
      );
      const enTetes = rappel.mock.calls[0][0].responseHeaders;
      expect(enTetes.a).toEqual(['1']);
      expect(enTetes['Content-Security-Policy'][0]).toContain(attendu);

      const autre = vi.fn();
      intercepteurEnTetes(
        {
          url: pathToFileURL(path.join(s.APP_PAGES_ROOT, 'index.html')).href,
          responseHeaders: { a: ['1'] },
        },
        autre
      );
      expect(autre).toHaveBeenCalledWith({ responseHeaders: { a: ['1'] } });
    }
  );
});
