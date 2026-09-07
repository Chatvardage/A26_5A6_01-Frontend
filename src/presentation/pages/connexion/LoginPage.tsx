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

/**
 * Délai maximal accordé à `gateway.pseudoDisponible` avant de considérer la
 * vérification comme en échec. Sans cette borne, un appel qui ne se résout
 * jamais (IPC bloqué, implémentation réseau future qui ne répond pas) laisse
 * le champ indéfiniment sur "Vérification…", puisque ni `disponibilite` ni
 * `erreurSoumission` ne sont alors mis à jour.
 */
const DELAI_VERIFICATION_MS = 5000;

type EtatChamp = 'idle' | 'checking' | 'error' | 'ok';

interface Disponibilite {
  pseudo: string;
  disponible: boolean;
}

interface ErreurSoumission {
  pseudo: string;
  /** Clé de traduction (ex. "auth.invalidFormat") ou code brut venant du
   * backend (ex. "ERR_PSEUDO_PRIS|alice") — jamais un texte déjà traduit,
   * pour que le message affiché se retraduise tout seul si la langue
   * change après coup (voir traduireErreurSoumission ci-dessous). */
  cle: string;
  params?: Record<string, string>;
}

/**
 * Traduit erreurSoumission.cle dans la langue COURANTE (recalculé à chaque
 * rendu, jamais mis en cache) : (1) une clé de validation locale connue
 * (ex. "auth.invalidFormat"), ou (2) un code d'erreur backend au format
 * "errors.CODE" avec un paramètre optionnel (voir nettoyerPrefixeIpc dans
 * main.tsx, qui ne traduit plus rien lui-même). Repli sur un message
 * générique traduit si le code est inconnu, plutôt qu'afficher une clé
 * technique brute à l'utilisateur.
 */
function traduireErreurSoumission(
  langue: string,
  erreur: ErreurSoumission
): string {
  if (erreur.cle.startsWith('auth.')) {
    return t(langue, erreur.cle);
  }
  const [code, ...params] = erreur.cle.split('|');
  const cleTraduction = `errors.${code}`;
  // Passe le paramètre à t() plutôt que de refaire la substitution ici :
  // un futur code d'erreur "CODE|param" dont le texte utilise un autre
  // nom de paramètre que {pseudo} (ex. {host}) fonctionnerait quand même.
  const traduit = t(
    langue,
    cleTraduction,
    params.length ? { pseudo: params[0] } : undefined
  );
  return traduit === cleTraduction ? t(langue, 'errors.generic') : traduit;
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
    let delaiDepasse: ReturnType<typeof setTimeout> | undefined;

    const debounce = setTimeout(() => {
      // Borne l'attente : sans ce minuteur, un appel qui ne se résout jamais
      // (voir DELAI_VERIFICATION_MS) laissait le champ bloqué indéfiniment
      // sur "Vérification…", car ni `disponibilite` ni `erreurSoumission`
      // n'étaient alors jamais mis à jour (voir le calcul de `etat` plus bas).
      delaiDepasse = setTimeout(() => {
        if (jeton !== jetonVerification.current) return; // réponse obsolète
        setErreurSoumission({
          pseudo: pseudoVerifie,
          cle: 'auth.checkTimeout',
        });
      }, DELAI_VERIFICATION_MS);

      gateway
        .pseudoDisponible(pseudoVerifie)
        .then((disponible) => {
          if (jeton !== jetonVerification.current) return; // réponse obsolète
          clearTimeout(delaiDepasse);
          setDisponibilite({ pseudo: pseudoVerifie, disponible });
          // Une vérification aboutie pour ce pseudo invalide toute erreur
          // précédente associée au MÊME pseudo (ex. un timeout ou un rejet
          // antérieur) : sans ça, `etat` restait bloqué sur 'error' même
          // après un succès, puisque `erreurSoumission` est prioritaire
          // dans son calcul plus bas.
          setErreurSoumission((actuelle) =>
            actuelle && actuelle.pseudo === pseudoVerifie ? null : actuelle
          );
        })
        .catch(() => {
          // Sans ce catch, un appel IPC qui rejette laissait le champ
          // bloqué sur "Vérification de la disponibilité…" indéfiniment.
          if (jeton !== jetonVerification.current) return; // réponse obsolète
          clearTimeout(delaiDepasse);
          setErreurSoumission({
            pseudo: pseudoVerifie,
            cle: 'auth.checkFailed',
          });
        });
    }, 300);

    return () => {
      clearTimeout(debounce);
      clearTimeout(delaiDepasse);
    };
  }, [pseudo, formatValide, gateway]);

  // --- État affiché, dérivé au rendu (pas de setState synchrone requis) ---
  let etat: EtatChamp = 'idle';
  let message = '';
  const pseudoActuel = pseudo.trim();

  if (erreurSoumission && erreurSoumission.pseudo === pseudoActuel) {
    etat = 'error';
    message = traduireErreurSoumission(langue, erreurSoumission);
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
          cle: 'auth.invalidFormat',
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
        const cle = err instanceof Error ? err.message : '';
        setErreurSoumission({ pseudo: valeur, cle });
        setEnCours(false);
        inputRef.current?.focus();
      }
    },
    [pseudo, gateway, onSessionEtablie]
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
