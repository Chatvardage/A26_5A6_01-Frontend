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

    const popup = container.querySelector('[role="dialog"][aria-modal="true"]');

    expect(popup).not.toBeNull();
    expect(popup?.textContent).toContain('Confirme');

    root.unmount();
    container.remove();
  });
});
