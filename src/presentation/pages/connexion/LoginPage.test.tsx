import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

afterEach(() => {
  cleanup();
});

vi.mock('../../../i18n/i18n-web', () => ({
  LANGUES_SUPPORTEES: ['fr', 'en'],
  t: (_langue: string, cle: string) => cle,
}));

describe('LoginPage', () => {
  it('affiche un pop-up de confirmation pour la session inactive', () => {
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => undefined,
      },
      langue: 'fr',
      changerLangue: () => undefined,
      allerAInscription: () => undefined,
      messageRetour: 'auth.sessionInactive',
      messageRetourConfirmable: true,
      onMessageRetourConfirme: () => undefined,
    };

    render(React.createElement(LoginPage, props));

    const popup = screen.getByRole('alertdialog');
    expect(popup).toBeTruthy();
    expect(popup.textContent).toContain('auth.sessionInactive');
    expect(screen.getByText('auth.sessionInactiveDismissHint')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'auth.sessionInactiveConfirm' })).toBeTruthy();
  });

  it('affiche un message simple inline quand la session expirée n’est pas confirmable', () => {
    const props: Parameters<typeof LoginPage>[0] = {
      gateway: {
        authentifier: async () => undefined,
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
});
