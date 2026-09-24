import { useCallback, useRef, useState, type FormEvent } from 'react';
import mascotLogo from '../../../../assets/icon.png';
import type {
  AuthGateway,
  ResultatAuthentification,
} from '../../../infrastructure/gateways/AuthGateway';
import {
  validationCourriel,
  validationMotDePasse,
  genererPseudoParDefaut,
} from '../../../domain/entities/Utilisateur';
import { t, LANGUES_SUPPORTEES } from '../../../i18n/i18n-web';

/**
 * Sous-ensemble de AuthGateway réellement nécessaire à cet écran (voir la
 * même règle dans LoginPage.tsx).
 */
export type GatewayInscription = Pick<AuthGateway, 'inscrire'>;

interface InscriptionPageProps {
  gateway: GatewayInscription;
  langue: string;
  changerLangue: (langue: string) => void;
  /**
   * Appelé une fois le compte créé et la session ouverte, avec le résultat
   * complet de l'inscription (voir main.tsx) : le parent en tire le pseudo
   * généré par défaut pour préremplir l'écran "Choisis ton pseudo" qui suit
   * (voir PseudoChoicePage.tsx).
   */
  onSessionEtablie?: (resultat: ResultatAuthentification) => void;
  /** Retour à l'écran de connexion (voir main.tsx / LoginPage.tsx). */
  allerAConnexion: () => void;
}

interface ErreurSoumission {
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
 * Écran d'inscription : courriel + mot de passe SEULEMENT (pas de pseudo
 * choisi ici, voir genererPseudoParDefaut) — un pseudo par défaut est généré
 * côté backend, et l'écran "Choisis ton pseudo" (voir PseudoChoicePage.tsx et
 * main.tsx) est proposé juste après l'inscription pour le garder tel quel ou
 * en choisir un autre ; il reste aussi modifiable en tout temps depuis la
 * page profil.
 */
export function InscriptionPage({
  gateway,
  langue,
  changerLangue,
  onSessionEtablie,
  allerAConnexion,
}: InscriptionPageProps) {
  const [courriel, setCourriel] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreurSoumission, setErreurSoumission] =
    useState<ErreurSoumission | null>(null);
  const [enCours, setEnCours] = useState(false);
  const courrielRef = useRef<HTMLInputElement>(null);


  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const courrielSaisi = courriel.trim();
      if (!validationCourriel(courrielSaisi)) {
        setErreurSoumission({ cle: 'auth.invalidEmail' });
        courrielRef.current?.focus();
        return;
      }
      if (!validationMotDePasse(motDePasse)) {
        setErreurSoumission({ cle: 'auth.invalidPassword' });
        return;
      }

      setEnCours(true);
      setErreurSoumission(null);
      try {
        const resultat = await gateway.inscrire({
          courriel: courrielSaisi,
          motDePasse,
        });

        // Voir PseudoChoicePage.tsx / main.tsx : le parent navigue vers
        // l'écran "Choisis ton pseudo" avec ce résultat plutôt que directement
        // vers le tableau de bord.
        if (onSessionEtablie) {
          onSessionEtablie(resultat);
        } else {
          await window.electronAPI.allerAuTableauDeBord();
        }
      } catch (err) {
        const cle = err instanceof Error ? err.message : '';
        setErreurSoumission({ cle });
        setEnCours(false);
      }
    },
    [courriel, motDePasse, gateway, onSessionEtablie]
  );

  const apercuPseudo = validationCourriel(courriel.trim())
    ? genererPseudoParDefaut(courriel.trim())
    : null;

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

        <h1 className="login-card-title">{t(langue, 'auth.registerTitle')}</h1>

        <label htmlFor="courriel-input">{t(langue, 'auth.emailLabel')}</label>
        <input
          id="courriel-input"
          name="courriel"
          type="email"
          autoComplete="email"
          placeholder={t(langue, 'auth.emailPlaceholder')}
          value={courriel}
          onChange={(event) => setCourriel(event.target.value)}
          ref={courrielRef}
        />

        <label htmlFor="mot-de-passe-inscription-input">
          {t(langue, 'auth.passwordLabel')}
        </label>
        <input
          id="mot-de-passe-inscription-input"
          name="motDePasse"
          type="password"
          autoComplete="new-password"
          placeholder={t(langue, 'auth.passwordPlaceholder')}
          value={motDePasse}
          onChange={(event) => setMotDePasse(event.target.value)}
        />

        <p className="field-message" data-kind="idle">
          {t(langue, 'auth.defaultPseudoHint')}
          {apercuPseudo ? ` (« ${apercuPseudo} »)` : ''}
        </p>

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
          {enCours ? t(langue, 'auth.registering') : t(langue, 'auth.register')}
        </button>

        <button
          type="button"
          className="login-switch"
          onClick={allerAConnexion}
        >
          {t(langue, 'auth.alreadyAccount')} {t(langue, 'auth.backToLogin')}
        </button>
      </form>
    </div>
  );
}
