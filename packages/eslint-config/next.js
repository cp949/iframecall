import pluginNext from "@next/eslint-plugin-next";
import eslintReact from "@eslint-react/eslint-plugin";
import { globalIgnores } from "eslint/config";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { config as baseConfig } from "./base.js";

/** @type {import("eslint").Linter.Config[]} */
export const nextJsConfig = [
  ...baseConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  eslintReact.configs["recommended-typescript"],
  eslintReact.configs["disable-conflict-eslint-plugin-react-hooks"],
  { languageOptions: { globals: { ...globals.serviceworker } } },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // v7 recommended에는 React Compiler 규칙이 추가됐다. 기존 Hooks 정책만 유지한다.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
