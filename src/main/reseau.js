// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Réseau du système d'exploitation.
const { net, powerMonitor } = require('electron');
const { chatGateway } = require('./gateway');

// --- Réseau du système d'exploitation ------------------------------------------
// Deux signaux combinés, relayés au gateway (voir signalerReseauSysteme) :
//  1. net.isOnline() : état des interfaces réseau de l'OS. Insuffisant seul :
//     sous WSL (mode NAT), l'interface virtuelle eth0 reste "UP" même quand
//     Windows perd le Wi-Fi, et une interface active ne garantit pas un
//     accès réel au réseau.
//  2. une sonde de connectivité (HEAD sur une URL "generate_204", même
//     principe que Windows/Chrome/Android) : indispensable quand le serveur
//     tourne en local (localhost:3000), puisque couper le réseau ne coupe
//     alors PAS la connexion au serveur — sans cette sonde, rien ne
//     changerait à l'écran. Désactivable avec CHATVARDAGE_CONNECTIVITY_URL=""
//     (seul net.isOnline() est alors utilisé), ou redirigeable vers une
//     autre URL avec cette même variable.
const URL_SONDE_CONNECTIVITE =
  process.env.CHATVARDAGE_CONNECTIVITY_URL ??
  'https://www.gstatic.com/generate_204';
const INTERVALLE_SONDE_RESEAU_MS = 3000;
const DELAI_SONDE_RESEAU_MS = 3000;
// Échecs consécutifs avant de déclarer "hors ligne" (évite qu'un seul
// paquet perdu fasse clignoter l'indicateur) ; un seul succès suffit pour
// repasser "en ligne".
const ECHECS_AVANT_HORS_LIGNE = 2;

async function reseauJoignable() {
  if (!net.isOnline()) return false;
  if (!URL_SONDE_CONNECTIVITE) return true;
  try {
    const reponse = await net.fetch(URL_SONDE_CONNECTIVITE, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(DELAI_SONDE_RESEAU_MS),
    });
    return reponse.status < 500;
  } catch {
    return false;
  }
}

function surveillerReseauSysteme() {
  let dernierEtat = true;
  let echecsConsecutifs = 0;

  const sonder = async () => {
    const joignable = await reseauJoignable();
    echecsConsecutifs = joignable ? 0 : echecsConsecutifs + 1;
    // Interfaces coupées : certain, pas besoin d'attendre un 2e échec.
    const enLigne =
      joignable ||
      (net.isOnline() && echecsConsecutifs < ECHECS_AVANT_HORS_LIGNE);
    if (enLigne !== dernierEtat) {
      dernierEtat = enLigne;
      console.log(`[reseau] système ${enLigne ? 'en ligne' : 'hors ligne'}`);
      chatGateway.signalerReseauSysteme(enLigne);
    }
    // setTimeout (et non setInterval) : jamais deux sondes en parallèle si
    // l'une met du temps à expirer.
    setTimeout(sonder, INTERVALLE_SONDE_RESEAU_MS);
  };
  void sonder();

  powerMonitor.on('resume', () => chatGateway.signalerReveil());
}

module.exports = { surveillerReseauSysteme };
