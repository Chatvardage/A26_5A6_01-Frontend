import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type FormEvent,
} from 'react';
import {
  validationPseudo,
  creerUtilisateur,
} from '../../../domain/entities/Utilisateur';
import mascotLogo from '../../../../maquette/logo.png';
import type { ChatGateway } from '../../../infrastructure/gateways/ChatGateway';
import { t, LANGUES_SUPPORTEES } from '../../../i18n/i18n-web';

/**
 * Sous-ensemble de ChatGateway réellement nécessaire à cet écran (principe
 * de ségrégation d'interface). Permet de dépendre du contrat plutôt que
 * d'une implémentation concrète (voir la règle documentée dans
 * ChatGateway.ts), sans exiger que MockGateway implémente déjà l'intégralité
 * de ChatGateway — ce qui n'est pas encore le cas pour les salons/messages,
 * hors scope de cet écran.
 */
export type GatewaySession = Pick<
  ChatGateway,
  'pseudoDisponible' | 'connexion'
>;

interface LoginPageProps {
  gateway: GatewaySession;
  /** Langue actuelle ('fr' ou 'en'), pilotée par le composant parent (voir main.tsx). */
  langue: string;
  /** Demande un changement de langue ; le parent est responsable de le confirmer via l'IPC. */
  changerLangue: (langue: string) => void;
  /** Appelé une fois la session établie ; par défaut, redirige vers le tableau de bord via electronAPI. */
  onSessionEtablie?: () => void;
}

type EtatChamp = 'idle' | 'checking' | 'error' | 'ok';

interface Disponibilite {
  pseudo: string;
  disponible: boolean;
}

interface ErreurSoumission {
  pseudo: string;
  message: string;
}

export function LoginPage({
  gateway,
  langue,
  changerLangue,
  onSessionEtablie,
}: LoginPageProps) {
  const [pseudo, setPseudo] = useState('');
  const [disponibilite, setDisponibilite] = useState<Disponibilite | null>(
    null
  );
  const [erreurSoumission, setErreurSoumission] =
    useState<ErreurSoumission | null>(null);
  const [enCours, setEnCours] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const jetonVerification = useRef(0);

  const formatValide = useMemo(() => validationPseudo(pseudo.trim()), [pseudo]);

  // Vérification d'unicité "au fil de la frappe" (anti-rafale + jeton pour
  // ignorer une réponse obsolète). Le seul setState dans cet effet se
  // produit dans le callback async (synchronisation avec le gateway),
  // jamais de façon synchrone dans le corps de l'effet.
  useEffect(() => {
    if (!formatValide) return;

    const jeton = ++jetonVerification.current;
    const pseudoVerifie = pseudo.trim();

    const debounce = setTimeout(async () => {
      const disponible = await gateway.pseudoDisponible(pseudoVerifie);
      if (jeton !== jetonVerification.current) return; // réponse obsolète
      setDisponibilite({ pseudo: pseudoVerifie, disponible });
    }, 300);

    return () => clearTimeout(debounce);
  }, [pseudo, formatValide, gateway]);

  // --- État affiché, dérivé au rendu (pas de setState synchrone requis) ---
  let etat: EtatChamp = 'idle';
  let message = '';
  const pseudoActuel = pseudo.trim();

  if (erreurSoumission && erreurSoumission.pseudo === pseudoActuel) {
    etat = 'error';
    message = erreurSoumission.message;
  } else if (pseudoActuel.length === 0) {
    etat = 'idle';
  } else if (!formatValide) {
    etat = 'error';
    message = t(langue, 'auth.invalidFormat');
  } else if (disponibilite && disponibilite.pseudo === pseudoActuel) {
    etat = disponibilite.disponible ? 'ok' : 'error';
    message = disponibilite.disponible
      ? t(langue, 'auth.available')
      : t(langue, 'auth.taken');
  } else {
    etat = 'checking';
    message = t(langue, 'auth.checking');
  }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const valeur = pseudo.trim();
      if (!validationPseudo(valeur)) {
        setErreurSoumission({
          pseudo: valeur,
          message: t(langue, 'auth.invalidFormat'),
        });
        inputRef.current?.focus();
        return;
      }

      setEnCours(true);
      try {
        const utilisateur = creerUtilisateur(crypto.randomUUID(), valeur);
        await gateway.connexion(utilisateur);

        if (onSessionEtablie) {
          onSessionEtablie();
        } else {
          await window.electronAPI.allerAuTableauDeBord();
        }
      } catch (err) {
        const texte =
          err instanceof Error ? err.message : t(langue, 'errors.generic');
        setErreurSoumission({ pseudo: valeur, message: texte });
        setEnCours(false);
        inputRef.current?.focus();
      }
    },
    [pseudo, gateway, onSessionEtablie, langue]
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

        <label htmlFor="pseudo-input">{t(langue, 'auth.fieldLabel')}</label>
        <div className="login-card-header">
          <span>{t(langue, 'auth.headerUsername')}</span>
          <span>{t(langue, 'auth.headerLocal')}</span>
        </div>

        <input
          id="pseudo-input"
          name="pseudo"
          type="text"
          autoComplete="off"
          placeholder={t(langue, 'auth.usernamePlaceholder')}
          maxLength={20}
          value={pseudo}
          onChange={(event) => setPseudo(event.target.value)}
          ref={inputRef}
        />

        <p
          className="field-message"
          role="status"
          aria-live="polite"
          data-kind={etat}
        >
          {message}
        </p>

        <button type="submit" disabled={enCours}>
          {enCours ? t(langue, 'auth.connecting') : t(langue, 'auth.join')}
        </button>

        <p className="login-hint">{t(langue, 'auth.hint')}</p>
      </form>
    </div>
  );
}
