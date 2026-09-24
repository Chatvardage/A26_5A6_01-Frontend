// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Menu applicatif.
const { app, Menu } = require('electron');
const { t } = require('../i18n/i18n.js');
const { etat, isDev } = require('./contexte');

// --- Menu applicatif minimal et maîtrisé -----------------------------------
// L'énoncé interdit les menus par défaut non contrôlés en production.
// On construit ici un menu volontairement réduit (pas d'onglets Node/Debug
// exposés en production), avec un `label` explicite sur CHAQUE entrée
// (y compris celles avec un `role`) : les libellés par défaut d'Electron
// pour un `role` suivent la langue du système d'exploitation, pas la
// langue choisie dans l'app — on ne peut pas s'y fier pour l'i18n.
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'quit', label: t(etat.langueActuelle, 'menu.quit') },
            ],
          },
        ]
      : []),
    {
      label: t(etat.langueActuelle, 'menu.file'),
      submenu: [
        process.platform === 'darwin'
          ? { role: 'close', label: t(etat.langueActuelle, 'menu.close') }
          : { role: 'quit', label: t(etat.langueActuelle, 'menu.quit') },
      ],
    },
    {
      label: t(etat.langueActuelle, 'menu.edit'),
      submenu: [
        { role: 'copy', label: t(etat.langueActuelle, 'menu.copy') },
        { role: 'paste', label: t(etat.langueActuelle, 'menu.paste') },
        { role: 'selectAll', label: t(etat.langueActuelle, 'menu.selectAll') },
      ],
    },
    // DevTools uniquement en développement : jamais exposé en production.
    ...(isDev
      ? [
          {
            label: t(etat.langueActuelle, 'menu.development'),
            submenu: [
              {
                role: 'toggleDevTools',
                label: t(etat.langueActuelle, 'menu.toggleDevTools'),
              },
              { role: 'reload', label: t(etat.langueActuelle, 'menu.reload') },
            ],
          },
        ]
      : []),
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
