'use strict';

// runtime/jeton.js — Persistance du jeton de session (chiffré avec safeStorage).
const { NOM_FICHIER_SESSION } = require('./constantes');
const path = require('path');
const fs = require('fs');

/**
 * Chemin du petit fichier JSON persistant le jeton de session (voir
 * `chargerJetonPersiste`/`sauvegarderJetonPersiste`), dans le dossier de
 * données utilisateur d'Electron (`app.getPath('userData')`). Le require()
 * d'`electron` est fait ici, au moment de l'appel, plutôt qu'en haut de
 * fichier : `app.getPath` n'est fiable qu'une fois Electron initialisé, et ce
 * module peut être chargé tôt (voir main.js).
 */
function cheminFichierSession() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), NOM_FICHIER_SESSION);
}

/**
 * Chiffrement du jeton par le système (`safeStorage` d'Electron : trousseau
 * Windows/macOS, libsecret/KWallet sous Linux), ou `null` s'il n'est pas
 * disponible. Sous Linux sans trousseau, Electron se rabat sur une clé fixe
 * ('basic_text') : c'est alors de l'obscurcissement, pas une vraie protection.
 */
function coffreJeton() {
  const { safeStorage } = require('electron');
  if (!safeStorage?.isEncryptionAvailable?.()) return null;
  // basic_text utilise une clé publique fixe : ne jamais persister un jeton avec ce repli.
  if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') return null;
  return safeStorage;
}

/**
 * Relit le jeton persisté. Format courant : `{ jetonChiffre }` (base64 du
 * jeton chiffré par coffreJeton). Ancien format `{ jeton }` en clair : relu,
 * puis réécrit chiffré si possible (migration sans reconnexion). Tout échec
 * (fichier absent ou illisible, déchiffrement impossible — trousseau changé,
 * autre machine…) renvoie `null` : l'utilisateur se reconnecte simplement.
 */
function chargerJetonPersiste() {
  try {
    const contenu = fs.readFileSync(cheminFichierSession(), 'utf8');
    const donnees = JSON.parse(contenu);
    if (typeof donnees.jetonChiffre === 'string' && donnees.jetonChiffre) {
      const coffre = coffreJeton();
      if (!coffre) return null;
      const jeton = coffre.decryptString(
        Buffer.from(donnees.jetonChiffre, 'base64')
      );
      return jeton || null;
    }
    if (typeof donnees.jeton === 'string' && donnees.jeton) {
      if (!coffreJeton()) {
        sauvegarderJetonPersiste(null);
        return null;
      }
      sauvegarderJetonPersiste(donnees.jeton);
      return donnees.jeton;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persiste le jeton de session (ou l'efface si `jeton` est vide). Chiffré par
 * le système quand c'est possible ; sinon, aucune persistance. Le fichier
 * chiffré n'est lisible que par son propriétaire (0600).
 */
function sauvegarderJetonPersiste(jeton) {
  try {
    if (jeton) {
      const coffre = coffreJeton();
      if (!coffre) {
        fs.rmSync(cheminFichierSession(), { force: true });
        return;
      }
      const donnees = { jetonChiffre: coffre.encryptString(jeton).toString('base64') };
      const chemin = cheminFichierSession();
      fs.writeFileSync(chemin, JSON.stringify(donnees), {
        encoding: 'utf8',
        mode: 0o600,
      });
      // `mode` ne s'applique qu'à la création : un ancien fichier garderait
      // ses droits d'origine.
      fs.chmodSync(chemin, 0o600);
    } else {
      fs.rmSync(cheminFichierSession(), { force: true });
    }
  } catch (erreur) {
    console.error(
      '[RealGatewayRuntime] persistance de session impossible :',
      erreur
    );
  }
}

module.exports = {
  chargerJetonPersiste,
  cheminFichierSession,
  coffreJeton,
  sauvegarderJetonPersiste,
};
