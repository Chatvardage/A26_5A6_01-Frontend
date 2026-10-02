const fs = require('fs');
const path = require('path');

// Page des salons : scripts classiques qui partagent la même portée globale
// (voir l'en-tête de src/presentation/pages/javascript/salons/etat.js). Un
// fichier y utilise ce qu'un autre déclare : on déclare donc à ESLint, comme
// globales, les noms de haut niveau de ces fichiers — calculés ici plutôt
// que listés à la main, pour que no-undef reste actif (fautes de frappe).
// Même principe pour la page des messages privés (messages-prives/*.js +
// message-prive.js).
const PAGES_JS = 'src/presentation/pages/javascript';
const DECLARATION_HAUT_NIVEAU =
  /^(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

function fichiersDuDossier(dossier, pointDEntree) {
  const chemin = path.join(__dirname, PAGES_JS, dossier);
  return [
    ...fs
      .readdirSync(chemin)
      .filter((nom) => nom.endsWith('.js'))
      .map((nom) => path.join(chemin, nom)),
    path.join(__dirname, pointDEntree),
  ];
}

function globalesPartagees(fichiers) {
  const globales = {};
  for (const fichier of fichiers) {
    const contenu = fs.readFileSync(fichier, 'utf8');
    for (const [, nom] of contenu.matchAll(DECLARATION_HAUT_NIVEAU)) {
      globales[nom] = 'writable';
    }
  }
  return globales;
}

// Scripts de navigateur qui partagent une portée globale : sans env node
// (qui active globalReturn et ferait du niveau supérieur une portée de
// fonction, pas la portée globale partagée entre les fichiers).
function pagePartagee(motifs, fichiers) {
  return {
    files: motifs,
    env: { browser: true, node: false },
    parserOptions: {
      sourceType: 'script',
      ecmaFeatures: { globalReturn: false },
    },
    globals: globalesPartagees(fichiers),
    rules: {
      // Déclarés ici ET vus comme globales partagées : pas une
      // redéclaration.
      'no-redeclare': ['error', { builtinGlobals: false }],
      // Une déclaration de haut niveau peut ne servir qu'aux autres
      // fichiers de la page.
      'no-unused-vars': ['error', { vars: 'local' }],
    },
  };
}

module.exports = {
  env: { browser: true, es2021: true, node: true },
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/'],
  extends: ['eslint:recommended', 'prettier'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {},
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'prettier',
      ],
      rules: {},
    },
    pagePartagee(
      [`${PAGES_JS}/salons/*.js`, 'renderer.js'],
      fichiersDuDossier('salons', 'renderer.js')
    ),
    pagePartagee(
      [`${PAGES_JS}/messages-prives/*.js`, `${PAGES_JS}/message-prive.js`],
      fichiersDuDossier('messages-prives', `${PAGES_JS}/message-prive.js`)
    ),
  ],
};
