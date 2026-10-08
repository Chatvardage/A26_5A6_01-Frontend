declare global {
  type InactiviteApi = {
    creerMinuteurInactivite: (options?: {
      delaiMs?: number;
      estActif?: () => boolean;
      message?: (() => string) | string;
      notifier?: (message: string) => void;
      onExpire?: (() => Promise<void> | void) | undefined;
      setTimeoutFn?: (
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => number;
      clearTimeoutFn?: (id: number) => void;
    }) => {
      demarrer: () => void;
      arreter: () => void;
      reinitialiser: () => void;
    };
    initialiserPageInactivite: () => Promise<(() => void) | null>;
    stopper: () => void;
  };

  const electronAPI: {
    obtenirUtilisateurConnecte?: () => Promise<{ id: string } | null>;
    definirMotifRetourConnexion?: (motif: string) => Promise<string | undefined> | string | undefined;
    deconnexionSession?: () => Promise<void> | void;
    allerALaConnexion?: () => Promise<void> | void;
  };

  const I18n: {
    t: (cle: string) => string;
  };

  const Inactivite: InactiviteApi;
}

declare module './inactivite.js' {
  const moduleValue: unknown;
}

export {};
