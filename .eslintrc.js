module.exports = {
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended", // Assuming React is used, which is mentioned in README.md (Line 17)
    "prettier/@typescript-eslint", // Disables conflicting ESLint rules with Prettier
    "prettier" // Includes prettier's basic formatting checks
  ],
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module",
    "jsx": "react-native" // Adjust if needed, but 'react-native' or 'react' is common for React projects. Using general modern setting.
  },
  "rules": {
    // Custom rules can be added here later
  }
};