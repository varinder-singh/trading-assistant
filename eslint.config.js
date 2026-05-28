import tseslint from "typescript-eslint"
import prettier from "eslint-plugin-prettier/recommended"

export default tseslint.config(
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "prettier/prettier": ["error", { semi: false }],
    },
  },
  {
    ignores: ["dist/", "coverage/", "data/", ".kite/", "node_modules/", "web/.nuxt/"],
  }
)
