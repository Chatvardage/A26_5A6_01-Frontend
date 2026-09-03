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

/**
 * Message affiché pour un format de pseudo invalide. Les règles exactes
 * (longueur, caractères permis) sont dans `validationPseudo` (domaine) —
 * ce message reste volontairement générique pour ne pas dupliquer la
 * règle ici et risquer de désynchroniser les deux.
 */
const MESSAGE_FORMAT_INVALIDE =
  'Le pseudo doit contenir entre 3 et 20 caractères (lettres, chiffres, _ ou -).';

export function LoginPage({ gateway, onSessionEtablie }: LoginPageProps) {
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
    message = MESSAGE_FORMAT_INVALIDE;
  } else if (disponibilite && disponibilite.pseudo === pseudoActuel) {
    etat = disponibilite.disponible ? 'ok' : 'error';
    message = disponibilite.disponible
      ? 'Pseudo disponible.'
      : 'Ce pseudo est déjà pris, choisissez-en un autre.';
  } else {
    etat = 'checking';
    message = 'Vérification de la disponibilité…';
  }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const valeur = pseudo.trim();
      if (!validationPseudo(valeur)) {
        setErreurSoumission({
          pseudo: valeur,
          message: MESSAGE_FORMAT_INVALIDE,
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
          err instanceof Error
            ? err.message
            : 'Impossible de créer la session.';
        setErreurSoumission({ pseudo: valeur, message: texte });
        setEnCours(false);
        inputRef.current?.focus();
      }
    },
    [pseudo, gateway, onSessionEtablie]
  );

  return (
    <div className="screen-login">
      <div className="login-brand">ChatVardage</div>
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <img
          className="login-mascot"
          src={mascotLogo}
          alt=""
          aria-hidden="true"
        />

        <label htmlFor="pseudo-input">Pseudo local</label>
        <div className="login-card-header">
          <span>Nom d&apos;utilisateur</span>
          <span>Local</span>
        </div>

        <input
          id="pseudo-input"
          name="pseudo"
          type="text"
          autoComplete="off"
          placeholder="Nom d'utilisateur"
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
          {enCours ? 'Connexion…' : 'Rejoindre le clavardage'}
        </button>

        <p className="login-hint">
          Unique sur cet appareil · aucun mot de passe
        </p>
      </form>
    </div>
  );
}
