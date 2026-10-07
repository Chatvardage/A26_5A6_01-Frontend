import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import mascotLogo from '../../../../assets/icon.png';
import type { AuthGateway } from '../../../infrastructure/gateways/AuthGateway';
import { t, LANGUES_SUPPORTEES } from '../../../i18n/i18n-web';

/**
 * Sous-ensemble de AuthGateway réellement nécessaire à cet écran (principe
 * de ségrégation d'interface, voir AuthGateway.ts).
 */
export type GatewaySession = Pick<AuthGateway, 'authentifier'>;

interface LoginPageProps {
  gateway: GatewaySession;
  /** Langue actuelle ('fr' ou 'en'), pilotée par le composant parent (voir main.tsx). */
  langue: string;
  /** Demande un changement de langue ; le parent est responsable de le confirmer via l'IPC. */
  changerLangue: (langue: string) => void;
  /** Appelé une fois la session établie ; par défaut, redirige vers le tableau de bord via electronAPI. */
  onSessionEtablie?: () => void;
  /** Bascule vers l'écran d'inscription (voir main.tsx / InscriptionPage.tsx). */
  allerAInscription: () => void;
  /** Clé de traduction d'un message d'information à afficher en arrivant
   * (ex. 'auth.sessionExpired'), ou null. */
  messageRetour?: string | null;

  /** Si true, affiche un bouton de confirmation pour fermer le message. */
  messageRetourConfirmable?: boolean;
  /** Appelé quand l'utilisateur confirme le message de retour. */
  onMessageRetourConfirme?: () => void;
}


interface ErreurSoumission {
  /** Clé de traduction (ex. "auth.invalidFormat") ou code brut venant du
   * backend (ex. "ERR_IDENTIFIANTS_INVALIDES") — jamais un texte déjà
   * traduit, pour que le message affiché se retraduise tout seul si la
   * langue change après coup (voir traduireErreurSoumission ci-dessous). */
  cle: string;
}

/**
 * Traduit erreurSoumission.cle dans la langue COURANTE (recalculé à chaque
 * rendu, jamais mis en cache) : (1) une clé de validation locale connue
 * (ex. "auth.invalidFormat"), ou (2) un code d'erreur backend au format
 * "errors.CODE" (voir nettoyerPrefixeIpc dans main.tsx, qui ne traduit plus
 * rien lui-même). Repli sur un message générique traduit si le code est
 * inconnu, plutôt qu'afficher une clé technique brute à l'utilisateur.
 */
function traduireErreurSoumission(
  langue: string,
  erreur: ErreurSoumission
): string {
  if (erreur.cle.startsWith('auth.')) {
    return t(langue, erreur.cle);
  }
  const cleTraduction = `errors.${erreur.cle}`;
  const brutTraduit = t(langue, cleTraduction);
  return brutTraduit === cleTraduction ? t(langue, 'errors.generic') : brutTraduit;
}

export function LoginPage({
  gateway,
  langue,
  changerLangue,
  onSessionEtablie,
  allerAInscription,
  messageRetour = null,
  messageRetourConfirmable = false,
  onMessageRetourConfirme,
}: LoginPageProps) {
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreurSoumission, setErreurSoumission] =
    useState<ErreurSoumission | null>(null);
  const [enCours, setEnCours] = useState(false);

  const identifiantRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageRetourId = useRef(
    `session-return-${Math.random().toString(36).slice(2, 11)}`
  );

  const fermerMessageRetour = useCallback(() => {
    onMessageRetourConfirme?.();
  }, [onMessageRetourConfirme]);

  useEffect(() => {
    if (!messageRetour || !messageRetourConfirmable || !dialogRef.current) {
      return undefined;
    }

    const dialog = dialogRef.current;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const firstFocusable = focusables[0] ?? dialog;
    const lastFocusable = focusables[focusables.length - 1] ?? dialog;
    const previousActiveElement = document.activeElement as HTMLElement | null;

    firstFocusable.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        fermerMessageRetour();
        return;
      }

      if (event.key !== 'Tab' || focusables.length === 0) {
        return;
      }

      const currentTarget = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!dialog.contains(currentTarget) || currentTarget === firstFocusable) {
          event.preventDefault();
          lastFocusable.focus();
        }
        return;
      }

      if (!dialog.contains(currentTarget) || currentTarget === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previousActiveElement && previousActiveElement.focus) {
        previousActiveElement.focus();
      }
    };
  }, [fermerMessageRetour, messageRetour, messageRetourConfirmable]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const identifiantSaisi = identifiant.trim();
      if (!identifiantSaisi || !motDePasse) {
        setErreurSoumission({ cle: 'auth.invalidFormat' });
        identifiantRef.current?.focus();
        return;
      }

      setEnCours(true);
      setErreurSoumission(null);
      try {
        await gateway.authentifier({
          identifiant: identifiantSaisi,
          motDePasse,
        });

        if (onSessionEtablie) {
          onSessionEtablie();
        } else {
          await window.electronAPI.allerAuTableauDeBord();
        }
      } catch (err) {
        const cle = err instanceof Error ? err.message : '';
        setErreurSoumission({ cle });
        setEnCours(false);
        identifiantRef.current?.focus();
      }
    },
    [identifiant, motDePasse, gateway, onSessionEtablie]
  );

  return (
    <div className="screen-login">
      <div
        className="language-switch"
        role="group"
        aria-label={t(langue, 'auth.languageLabel')}
      >
        {LANGUES_SUPPORTEES.map((code) => (
          <button
            key={code}
            type="button"
            className={`lang-btn ${code === langue ? 'active' : ''}`}
            onClick={() => changerLangue(code)}
            aria-pressed={code === langue}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>


      <div className="login-brand">ChatVardage</div>
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <img
          className="login-mascot"
          src={mascotLogo}
          alt=""
          aria-hidden="true"
        />

        <label htmlFor="identifiant-input">{t(langue, 'auth.fieldLabel')}</label>
        <input
          id="identifiant-input"
          name="identifiant"
          type="text"
          autoComplete="username"
          placeholder={t(langue, 'auth.usernamePlaceholder')}
          maxLength={254}
          value={identifiant}
          onChange={(event) => setIdentifiant(event.target.value)}
          ref={identifiantRef}
        />

        <label htmlFor="mot-de-passe-input">
          {t(langue, 'auth.passwordLabel')}
        </label>
        <input
          id="mot-de-passe-input"
          name="motDePasse"
          type="password"
          autoComplete="current-password"
          placeholder={t(langue, 'auth.passwordPlaceholder')}
          value={motDePasse}
          onChange={(event) => setMotDePasse(event.target.value)}
        />

        {erreurSoumission && (
          <p
            className="field-message"
            role="status"
            aria-live="polite"
            data-kind="error"
          >
            {traduireErreurSoumission(langue, erreurSoumission)}
          </p>
        )}

        <button type="submit" disabled={enCours}>
          {enCours ? t(langue, 'auth.connecting') : t(langue, 'auth.join')}
        </button>

        <p className="login-hint">{t(langue, 'auth.hint')}</p>

        <button
          type="button"
          className="login-switch"
          onClick={allerAInscription}
        >
          {t(langue, 'auth.noAccount')} {t(langue, 'auth.createAccount')}
        </button>
      </form>

      {messageRetour && !erreurSoumission && (
        messageRetourConfirmable ? (
          <div
            className="session-return-overlay"
            onClick={fermerMessageRetour}
          >
            <div
              ref={dialogRef}
              className="session-return-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={messageRetourId.current}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              <p id={messageRetourId.current} className="session-return-message">
                {t(langue, messageRetour)}
              </p>
              {onMessageRetourConfirme && (
                <button
                  type="button"
                  className="session-return-button"
                  onClick={fermerMessageRetour}
                >
                  {t(langue, 'auth.confirm')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="field-message" role="status" data-kind="info">
            <p>{t(langue, messageRetour)}</p>
          </div>
        )
      )}
    </div>
  );
}
