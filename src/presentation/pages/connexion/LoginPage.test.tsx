import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage, gererFocusTrapRetourSession } from './LoginPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('../../../i18n/i18n-web', () => ({
  LANGUES_SUPPORTEES: ['fr', 'en'],
  t: (_langue: string, cle: string) =>
    cle === 'errors.ERR_IDENTIFIANTS_INVALIDES' ? 'Identifiants invalides' : cle,
}));

describe('LoginPage', () => {
  const resultatAuthentification = {
    utilisateur: { id: 'u1', pseudo: 'alice' },
    etatConnexion: { statut: 'connecte' as const, depuis: Date.now() },
  };

  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        allerAuTableauDeBord: vi.fn(async () => undefined),
      },
      configurable: true,
    });
  });

  it('affiche le dialog de confirmation de session inactive avec le texte et le bouton', () => {
    const onMessageRetourConfirme = vi.fn();
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => resultatAuthentification,
      },
      langue: 'fr',
      changerLangue: vi.fn(),
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionInactive',
      messageRetourConfirmable: true,
      onMessageRetourConfirme,
    };

    render(React.createElement(LoginPage, props));

    const popup = screen.getByRole('alertdialog');
    expect(popup).toBeTruthy();
    expect(popup.textContent).toContain('auth.sessionInactive');
    expect(screen.getByText('auth.sessionInactiveDismissHint')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'auth.sessionInactiveConfirm',
      })
    ).toBeTruthy();
  });

  it('confirme le retour de session via le bouton de confirmation', () => {
    const onMessageRetourConfirme = vi.fn();
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => resultatAuthentification,
      },
      langue: 'fr',
      changerLangue: vi.fn(),
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionInactive',
      messageRetourConfirmable: true,
      onMessageRetourConfirme,
    };

    render(React.createElement(LoginPage, props));

    fireEvent.click(screen.getByRole('button', { name: 'auth.sessionInactiveConfirm' }));
    expect(onMessageRetourConfirme).toHaveBeenCalledTimes(1);
  });

  it('confirme le retour de session quand la touche Escape est pressée', () => {
    const onMessageRetourConfirme = vi.fn();
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => resultatAuthentification,
      },
      langue: 'fr',
      changerLangue: vi.fn(),
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionInactive',
      messageRetourConfirmable: true,
      onMessageRetourConfirme,
    };

    render(React.createElement(LoginPage, props));

    fireEvent.click(screen.getByRole('button', { name: 'auth.sessionInactiveConfirm' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onMessageRetourConfirme).toHaveBeenCalledTimes(2);
  });

  it('change la langue au clic sur le bouton de langue', () => {
    const changerLangue = vi.fn();
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => resultatAuthentification,
      },
      langue: 'fr',
      changerLangue,
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionInactive',
      messageRetourConfirmable: true,
      onMessageRetourConfirme: vi.fn(),
    };

    render(React.createElement(LoginPage, props));

    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(changerLangue).toHaveBeenCalledWith('en');
  });

  it('ferme le dialogue au clic sur l’overlay de retour de session', () => {
    const onMessageRetourConfirme = vi.fn();
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => resultatAuthentification,
      },
      langue: 'fr',
      changerLangue: vi.fn(),
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionInactive',
      messageRetourConfirmable: true,
      onMessageRetourConfirme,
    };

    render(React.createElement(LoginPage, props));

    const overlay = document.querySelector('.session-return-overlay');
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay as Element);
    expect(onMessageRetourConfirme).toHaveBeenCalledTimes(1);
  });

  it('affiche un message simple inline quand la session expirée n’est pas confirmable', () => {
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => resultatAuthentification,
      },
      langue: 'fr',
      changerLangue: () => undefined,
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionExpired',
      messageRetourConfirmable: false,
    };

    render(React.createElement(LoginPage, props));

    const form = document.querySelector('form');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(form).not.toBeNull();
    expect(form?.contains(screen.getByRole('status'))).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('auth.sessionExpired');
  });

  it('valide le formulaire, déclenche la connexion et appelle la navigation par défaut', async () => {
    const gateway = {
      authentifier: vi.fn(async () => resultatAuthentification),
    };

    render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('auth.fieldLabel'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.passwordLabel'), {
      target: { value: 'motdepasse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.join' }));

    await waitFor(() => {
      expect(gateway.authentifier).toHaveBeenCalledWith({
        identifiant: 'alice',
        motDePasse: 'motdepasse',
      });
    });

    expect(window.electronAPI.allerAuTableauDeBord).toHaveBeenCalledTimes(1);
  });

  it('affiche une erreur de validation si les identifiants sont incomplets', () => {
    const gateway = {
      authentifier: vi.fn(),
    };

    render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('auth.fieldLabel'), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.join' }));

    expect(screen.getByRole('status').textContent).toContain('auth.invalidFormat');
    expect(gateway.authentifier).not.toHaveBeenCalled();
  });

  it('affiche une erreur backend et remet l’état de soumission à zéro', async () => {
    const gateway = {
      authentifier: vi.fn(async () => {
        throw new Error('ERR_IDENTIFIANTS_INVALIDES');
      }),
    };

    render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('auth.fieldLabel'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.passwordLabel'), {
      target: { value: 'motdepasse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.join' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Identifiants invalides');
    });
    expect((screen.getByRole('button', { name: 'auth.join' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('gère un Tab de sortie et un Escape dans le piège de focus', () => {
    const onMessageRetourConfirme = vi.fn();
    const dialog = document.createElement('div');
    const buttonA = document.createElement('button');
    const buttonB = document.createElement('button');
    dialog.append(buttonA, buttonB);
    document.body.appendChild(dialog);

    let activeElement: Element | null = buttonA;
    vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => activeElement);
    const focusButtonB = vi.spyOn(buttonB, 'focus').mockImplementation(() => {
      activeElement = buttonB;
    });
    const focusButtonA = vi.spyOn(buttonA, 'focus').mockImplementation(() => {
      activeElement = buttonA;
    });

    const eventTabShift = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
    });
    gererFocusTrapRetourSession(dialog, eventTabShift, onMessageRetourConfirme);
    expect(eventTabShift.defaultPrevented).toBe(true);
    expect(focusButtonB).toHaveBeenCalledTimes(1);
    expect(activeElement).toBe(buttonB);

    const eventEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    gererFocusTrapRetourSession(dialog, eventEscape, onMessageRetourConfirme);
    expect(onMessageRetourConfirme).toHaveBeenCalledTimes(1);
    expect(eventEscape.defaultPrevented).toBe(true);
    expect(focusButtonA).not.toHaveBeenCalled();

    document.body.removeChild(dialog);
  });

  it('ignore les touches autres que Tab et Escape dans le piège de focus', () => {
    const dialog = document.createElement('div');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.appendChild(dialog);

    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    const focusSpy = vi.spyOn(button, 'focus');

    gererFocusTrapRetourSession(dialog, event, vi.fn());

    expect(event.defaultPrevented).toBe(false);
    expect(focusSpy).not.toHaveBeenCalled();
    document.body.removeChild(dialog);
  });

  it('ignore le Tab quand le dialogue n’a aucun élément focusable', () => {
    const dialog = document.createElement('div');
    document.body.appendChild(dialog);

    const activeElement: Element | null = null;
    vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => activeElement);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      cancelable: true,
    });
    gererFocusTrapRetourSession(dialog, event, vi.fn());

    expect(event.defaultPrevented).toBe(false);
    expect(activeElement).toBeNull();
    document.body.removeChild(dialog);
  });

  it('ne branche pas le focus trap quand aucun message de retour n’est affiché', () => {
    render(
      <LoginPage
        gateway={{ authentifier: vi.fn(async () => resultatAuthentification) }}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
        messageRetour={null}
        messageRetourConfirmable={true}
        onMessageRetourConfirme={vi.fn()}
      />
    );

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('laisse passer le Tab normal quand le focus est au milieu du dialogue', () => {
    const dialog = document.createElement('div');
    const buttonA = document.createElement('button');
    const buttonB = document.createElement('button');
    const buttonC = document.createElement('button');
    dialog.append(buttonA, buttonB, buttonC);
    document.body.appendChild(dialog);

    const activeElement: Element | null = buttonB;
    vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => activeElement);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      cancelable: true,
    });
    gererFocusTrapRetourSession(dialog, event, vi.fn());

    expect(event.defaultPrevented).toBe(false);
    expect(activeElement).toBe(buttonB);
    document.body.removeChild(dialog);
  });

  it('restaure le focus précédent quand la modale est fermée', () => {
    const previous = document.createElement('button');
    const focusSpy = vi.spyOn(previous, 'focus');
    document.body.appendChild(previous);

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(previous);

    const onMessageRetourConfirme = vi.fn();
    const { unmount } = render(
      <LoginPage
        gateway={{ authentifier: vi.fn(async () => resultatAuthentification) }}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
        messageRetour="auth.sessionInactive"
        messageRetourConfirmable={true}
        onMessageRetourConfirme={onMessageRetourConfirme}
      />
    );

    unmount();

    expect(focusSpy).toHaveBeenCalledTimes(1);
    document.body.removeChild(previous);
  });

  it('bloque le focus quand le curseur est hors du dialogue sur la dernière cible du trap', () => {
    const dialog = document.createElement('div');
    const buttonA = document.createElement('button');
    const buttonB = document.createElement('button');
    dialog.append(buttonA, buttonB);
    document.body.appendChild(dialog);

    const outside = document.createElement('button');
    document.body.appendChild(outside);

    let activeElement: Element | null = outside;
    vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => activeElement);
    const focusButtonA = vi.spyOn(buttonA, 'focus').mockImplementation(() => {
      activeElement = buttonA;
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      cancelable: true,
    });
    gererFocusTrapRetourSession(dialog, event, vi.fn());

    expect(event.defaultPrevented).toBe(true);
    expect(focusButtonA).toHaveBeenCalledTimes(1);
    expect(activeElement).toBe(buttonA);
    document.body.removeChild(dialog);
    document.body.removeChild(outside);
  });

  it('traduit une erreur brute non-Error dans la modale de retour', async () => {
    const gateway = {
      authentifier: vi.fn(async () => {
        throw 'ERR_BACKEND_BRUT';
      }),
    };

    render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('auth.fieldLabel'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.passwordLabel'), {
      target: { value: 'motdepasse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.join' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('errors.generic');
    });
  });

  it('affiche un message générique pour une erreur inconnue non-Error', async () => {
    const gateway = {
      authentifier: vi.fn(async () => {
        throw { cause: 'boom' };
      }),
    };

    render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('auth.fieldLabel'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.passwordLabel'), {
      target: { value: 'motdepasse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.join' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('errors.generic');
    });
  });

  it('appelle le callback de session établie quand il est fourni', async () => {
    const onSessionEtablie = vi.fn();
    const gateway = {
      authentifier: vi.fn(async () => resultatAuthentification),
    };

    render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
        onSessionEtablie={onSessionEtablie}
      />
    );

    fireEvent.change(screen.getByLabelText('auth.fieldLabel'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('auth.passwordLabel'), {
      target: { value: 'motdepasse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'auth.join' }));

    await waitFor(() => {
      expect(onSessionEtablie).toHaveBeenCalledTimes(1);
    });
    expect(window.electronAPI.allerAuTableauDeBord).not.toHaveBeenCalled();
  });
});
