import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Extension .mts (plutôt que .ts) : le package.json racine n'a pas
// "type": "module" (main.js/preload.js/renderer.js d'Electron sont
// volontairement en CommonJS), donc sous moduleResolution NodeNext, un
// simple .ts serait résolu comme CommonJS et pointerait vers les types CJS
// (incomplets) du package "vite". Le suffixe .mts force une résolution ESM
// pour ce fichier uniquement, sans toucher au reste du projet.

// server.fs.allow est ancré sur le dossier de CE fichier (racine du projet)
// par défaut, ce qui permet à la page de connexion d'importer les assets de
// maquette/ (ex. le logo) même si "root" pointe plus bas.
export default defineConfig({
  plugins: [react()],
  // "root" = racine standard d'un projet Vite pour cette page : un unique
  // index.html à sa racine (voir src/presentation/pages/connexion/index.html).
  // Le dashboard existant (src/presentation/pages/index.html, renderer.js)
  // n'est PAS géré par Vite et reste chargé tel quel par Electron.
  root: resolve(import.meta.dirname, 'src/presentation/pages/connexion'),
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Dossier de sortie fixé à dist/login (et non dist/connexion) car
    // main.js s'attend à trouver le build de production à cet endroit
    // précis (APP_LOGIN_PATH). Si vous renommez encore ce dossier source,
    // seul "root" ci-dessus a besoin de changer — pas outDir.
    outDir: resolve(import.meta.dirname, 'dist/login'),
    emptyOutDir: true,
  },
});
