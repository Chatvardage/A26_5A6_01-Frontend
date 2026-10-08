import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('affiche un pop-up de confirmation pour la session inactive', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(LoginPage, {
          gateway: {
            authentifier: async () => undefined,
          },
          langue: 'fr',
          changerLangue: () => undefined,
          allerAInscription: () => undefined,
          messageRetour: 'auth.sessionInactive',
          messageRetourConfirmable: true,
          onMessageRetourConfirme: () => undefined,
        })
      );
    });

    const popup = container.querySelector('[role="alertdialog"][aria-modal="true"]');

    expect(popup).not.toBeNull();
    expect(popup?.getAttribute('aria-describedby')).toBeNull();

    const bouton = popup?.querySelector('button.session-return-button');
    expect(bouton).not.toBeNull();

    root.unmount();
    container.remove();
  });

  it('affiche un message simple inline quand la session expirée n’est pas confirmable', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(LoginPage, {
          gateway: {
            authentifier: async () => undefined,
          },
          langue: 'fr',
          changerLangue: () => undefined,
          allerAInscription: () => undefined,
          messageRetour: 'auth.sessionExpired',
          messageRetourConfirmable: false,
        })
      );
    });

    const popup = container.querySelector('[role="alertdialog"][aria-modal="true"]');
    const inline = container.querySelector('.field-message[data-kind="info"]');

    expect(popup).toBeNull();
    expect(inline).not.toBeNull();
    expect(inline?.textContent).toContain('session a expiré');

    root.unmount();
    container.remove();
  });
});
