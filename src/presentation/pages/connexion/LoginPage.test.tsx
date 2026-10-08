import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

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

  it('affiche un pop-up de confirmation pour la session inactive et le confirme via bouton', async () => {
    const onMessageRetourConfirme = vi.fn();
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
      onMessageRetourConfirme,
    };

    render(React.createElement(LoginPage, props));

    const popup = screen.getByRole('alertdialog');
    expect(popup).toBeTruthy();
    expect(popup.textContent).toContain('auth.sessionInactive');
    expect(screen.getByText('auth.sessionInactiveDismissHint')).toBeTruthy();
    const boutonConfirmation = screen.getByRole('button', {
      name: 'auth.sessionInactiveConfirm',
    });
    expect(boutonConfirmation).toBeTruthy();

    fireEvent.click(boutonConfirmation);
    expect(onMessageRetourConfirme).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onMessageRetourConfirme.mock.calls.length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(changerLangue).toHaveBeenCalledWith('en');

    const overlay = document.querySelector('.session-return-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(onMessageRetourConfirme).toHaveBeenCalled();

    const button = screen.getByRole('button', { name: 'auth.sessionInactiveConfirm' });
    button.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
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

  it('gère les cas de focus trap et d’erreur non-Error dans la modale de retour', async () => {
    const gateway = {
      authentifier: vi.fn(async () => {
        throw 'ERR_BACKEND_BRUT';
      }),
    };
    const previous = document.createElement('button');
    previous.textContent = 'focus-prev';
    document.body.appendChild(previous);

    const originalQuerySelectorAll = HTMLElement.prototype.querySelectorAll;
    const querySelectorAllSpy = vi
      .spyOn(HTMLElement.prototype, 'querySelectorAll')
      .mockImplementation(function (this: HTMLElement, selector: string) {
        if (selector.includes('button:not([disabled])')) {
          return [] as unknown as NodeListOf<Element>;
        }
        return originalQuerySelectorAll.call(this, selector);
      });

    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => previous,
    });

    const onMessageRetourConfirme = vi.fn();
    const { unmount } = render(
      <LoginPage
        gateway={gateway}
        langue="fr"
        changerLangue={() => undefined}
        allerAInscription={() => undefined}
        messageRetour="auth.sessionInactive"
        messageRetourConfirmable={true}
        onMessageRetourConfirme={onMessageRetourConfirme}
      />
    );

    const dialog = screen.getByRole('alertdialog');
    dialog.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(dialog.parentElement as Element);

    expect(onMessageRetourConfirme).toHaveBeenCalled();

    unmount();
    expect(document.activeElement).toBe(previous);

    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => document.body,
    });
    querySelectorAllSpy.mockRestore();
    document.body.removeChild(previous);

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
