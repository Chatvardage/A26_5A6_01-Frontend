const fs = require('fs');
const path = require('path');

// Page des salons : scripts classiques qui partagent la même portée globale
// (voir l'en-tête de src/presentation/pages/javascript/salons/etat.js). Un
// fichier y utilise ce qu'un autre déclare : on déclare donc à ESLint, comme
// globales, les noms de haut niveau de ces fichiers — calculés ici plutôt
// que listés à la main, pour que no-undef reste actif (fautes de frappe).
const DOSSIER_SALONS = path.join(
  __dirname,
  'src/presentation/pages/javascript/salons'
);
const FICHIERS_SALONS = [
  ...fs
    .readdirSync(DOSSIER_SALONS)
    .filter((nom) => nom.endsWith('.js'))
    .map((nom) => path.join(DOSSIER_SALONS, nom)),
  path.join(__dirname, 'renderer.js'),
];
const DECLARATION_HAUT_NIVEAU =
  /^(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const globalesSalons = {};
for (const fichier of FICHIERS_SALONS) {
  const contenu = fs.readFileSync(fichier, 'utf8');
  for (const [, nom] of contenu.matchAll(DECLARATION_HAUT_NIVEAU)) {
    globalesSalons[nom] = 'writable';
  }
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
    {
      files: ['src/presentation/pages/javascript/salons/*.js', 'renderer.js'],
      // Scripts de navigateur : sans env node (qui active globalReturn et
      // ferait du niveau supérieur une portée de fonction, pas la portée
      // globale partagée entre les fichiers).
      env: { browser: true, node: false },
      parserOptions: { sourceType: 'script', ecmaFeatures: { globalReturn: false } },
      globals: globalesSalons,
      rules: {
        // Déclarés ici ET vus comme globales partagées : pas une
        // redéclaration.
        'no-redeclare': ['error', { builtinGlobals: false }],
        // Une déclaration de haut niveau peut ne servir qu'aux autres
        // fichiers de la page.
        'no-unused-vars': ['error', { vars: 'local' }],
      },
    },
  ],
};
