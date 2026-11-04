import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["node_modules/**", ".opencode/node_modules/**", ".dagger/**", "eslint.config.js"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Dependency-free Node scripts shipped with the installers.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" }
    }
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "@typescript-eslint/require-await": "off"
    }
  }
)
