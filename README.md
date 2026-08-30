# multiplatforme-gr.1

- Calendrier de travail (section projet du repo github)

# Plan de communication:
- Communication par discord
- Rencontre à chaque début de cours avant de commencer à travailler
- Documenter problème dans les messages de push git.

# Definition of done:
- 90 % de couverture de tests (logique seulement, non sur l’interface)
- Deux personnes doivent approuver les pull requests
- Code qui compile
- Interface fonctionnelle

# Technologies
- Frontend: React
- Backend: Nodejs
- BD: SQLite

# Comment démarrer
  
  ```bash
  npm install
  npm start
  ```
# Comment exécuter les tests
  ```bash
  npm install -D vitest@^2 @vitest/coverage-v8@^2
  npm run test:coverage
  ```