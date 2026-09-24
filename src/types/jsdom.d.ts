// Types minimaux de jsdom (déjà présent comme environnement de test de
// Vitest, sans @types/jsdom) : seulement ce qu'utilisent les tests
// d'intégration des pages (voir salons.chargement.test.ts).
declare module 'jsdom' {
  export class VirtualConsole {
    on(evenement: string, rappel: (erreur: unknown) => void): this;
  }

  export interface OptionsJSDOM {
    runScripts?: 'dangerously' | 'outside-only';
    pretendToBeVisual?: boolean;
    url?: string;
    virtualConsole?: VirtualConsole;
  }

  export class JSDOM {
    constructor(html: string, options?: OptionsJSDOM);
    readonly window: Window & typeof globalThis;
  }
}
