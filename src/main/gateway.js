// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Instance unique du gateway.
const {
  RealGatewayRuntime,
} = require('../infrastructure/gateways/RealGatewayRuntime.js');
const {
  obtenirConfiguration,
} = require('../infrastructure/config/ConfigurationApi.js');

// Instance UNIQUE du gateway réel (Serveur-API, voir A26_5A6_01-Infra),
// partagée par la page de connexion et le dashboard — voir le commentaire
// plus bas sur les canaux 'session:*' pour pourquoi une seule instance.
const configurationApi = obtenirConfiguration();
const chatGateway = new RealGatewayRuntime(configurationApi);
console.log(`[ChatVardage] Gateway actif : ${configurationApi.baseUrlHttp}`);

module.exports = { chatGateway, configurationApi };
