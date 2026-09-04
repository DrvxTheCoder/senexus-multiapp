import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      /**
       * The UI copy is French, so apostrophes are everywhere in JSX text. The
       * rule exists to catch a stray quote breaking out of an attribute, which
       * TypeScript and the parser already catch here. Escaping every French
       * elision would make the copy unreadable in source.
       */
      "react/no-unescaped-entities": "off",

      /** `_`-prefixed parameters are deliberately unused. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    /** `src/server/**` is strict: no `any` may enter the data layer (§9). */
    files: ["src/server/**/*.ts", "src/server/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);

export default eslintConfig;
