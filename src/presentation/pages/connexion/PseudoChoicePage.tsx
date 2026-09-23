import { useCallback, useRef, useState, type FormEvent } from 'react';
import mascotLogo from '../../../../assets/icon.png';
import { validationPseudo } from '../../../domain/entities/Utilisateur';
import { t, LANGUES_SUPPORTEES } from '../../../i18n/i18n-web';

interface PseudoChoicePageProps {
  /** Pseudo généré automatiquement par le backend à l'inscription (voir
   * genererPseudoParDefaut côté domaine Utilisateur), pré-rempli ici pour que
   * l'utilisateur⋅rice puisse le garder tel quel sans rien retaper. */
  pseudoInitial: string;
  langue: string;
  changerLangue: (langue: string) => void;
  theme: string;
  changerTheme: (theme: string) => void;
  /** Appelé une fois cet écran terminé (pseudo changé OU "plus tard") — le
   * parent (voir main.tsx) navigue alors vers le tableau de bord, exactement
   * comme après une connexion normale. */
  onTermine: () => void;
}

interface ErreurSoumission {
  /** Même convention que LoginPage.tsx/InscriptionPage.tsx : une clé de
   * traduction locale ("auth.xxx") ou un code d'erreur backend brut
   * ("ERR_XXX"), jamais un texte déjà traduit — voir traduireErreurSoumission. */
  cle: string;
}

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

/**
 * Electron préfixe systématiquement toute erreur venant d'un handler IPC
 * (voir nettoyerPrefixeIpc dans main.tsx) — dupliqué ici car cet écran
 * appelle `window.electronAPI.profilModifierPseudo` directement plutôt que
 * via un contrat GatewaySession/GatewayInscription construit dans main.tsx
 * (qui, lui, nettoie déjà ce préfixe avant de relancer l'erreur).
 */
function nettoyerPrefixeIpc(err: unknown): string {
  if (!(err instanceof Error)) return '';
  return err.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  );
}

/** Même esprit que THEMES_SUPPORTEES dans LoginPage.tsx/InscriptionPage.tsx. */
const THEMES_SUPPORTEES = ['sombre', 'clair'] as const;

/**
 * Écran "Choisis ton pseudo", affiché juste après une inscription réussie
 * (voir main.tsx) — la page profil elle-même (accessible plus tard depuis le
 * tableau de bord) permet de rechanger le pseudo à tout moment, cet écran
 * n'est qu'une première occasion, jamais bloquante ("plus tard" mène
 * directement au tableau de bord sans rien changer).
 */
export function PseudoChoicePage({
  pseudoInitial,
  langue,
  changerLangue,
  theme,
  changerTheme,
  onTermine,
}: PseudoChoicePageProps) {
  const [pseudo, setPseudo] = useState(pseudoInitial);
  const [erreurSoumission, setErreurSoumission] =
    useState<ErreurSoumission | null>(null);
  const [enCours, setEnCours] = useState(false);
  const pseudoRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const pseudoSaisi = pseudo.trim();
      if (!validationPseudo(pseudoSaisi)) {
        setErreurSoumission({ cle: 'auth.invalidFormat' });
        pseudoRef.current?.focus();
        return;
      }

      if (pseudoSaisi === pseudoInitial) {
        // Rien à changer côté serveur : équivalent fonctionnel de "plus
        // tard", pas la peine d'un aller-retour réseau pour ne rien modifier.
        onTermine();
        return;
      }

      setEnCours(true);
      setErreurSoumission(null);
      try {
        await window.electronAPI.profilModifierPseudo(pseudoSaisi);
        onTermine();
      } catch (err) {
        const brut = nettoyerPrefixeIpc(err);
        // PATCH /auth/me répond 409 sur collision de pseudo (voir
        // RealGatewayRuntime.appelHttp, qui lève un code générique
        // "ERR_HTTP_<statut>" pour toute réponse HTTP en erreur — 409 est ici
        // sans ambiguïté un pseudo déjà pris, le seul conflit possible sur
        // cet endpoint pour ce champ) : on le traduit spécifiquement plutôt
        // que de tomber sur le message générique "Une erreur est survenue."
        // Réutilise auth.taken, déjà prévu pour ce message exact.
        const cle = brut === 'ERR_HTTP_409' ? 'auth.taken' : brut;
        setErreurSoumission({ cle });
        setEnCours(false);
        pseudoRef.current?.focus();
      }
    },
    [pseudo, pseudoInitial, onTermine]
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

      <div
        className="theme-switch"
        role="group"
        aria-label={t(langue, 'theme.label')}
      >
        {THEMES_SUPPORTEES.map((valeur) => (
          <button
            key={valeur}
            type="button"
            className={`theme-btn ${valeur === theme ? 'active' : ''}`}
            onClick={() => changerTheme(valeur)}
            aria-pressed={valeur === theme}
          >
            {t(langue, `theme.${valeur === 'sombre' ? 'dark' : 'light'}`)}
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

        <h1 className="login-card-title">{t(langue, 'pseudoChoice.title')}</h1>
        <p className="field-message" data-kind="idle">
          {t(langue, 'pseudoChoice.description')}
        </p>

        <label htmlFor="pseudo-choice-input">
          {t(langue, 'pseudoChoice.pseudoLabel')}
        </label>
        <input
          id="pseudo-choice-input"
          name="pseudo"
          type="text"
          autoComplete="off"
          maxLength={20}
          value={pseudo}
          onChange={(event) => setPseudo(event.target.value)}
          ref={pseudoRef}
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
          {enCours
            ? t(langue, 'pseudoChoice.submitting')
            : t(langue, 'pseudoChoice.submit')}
        </button>

        <button type="button" className="login-switch" onClick={onTermine}>
          {t(langue, 'pseudoChoice.skip')}
        </button>
      </form>
    </div>
  );
}
