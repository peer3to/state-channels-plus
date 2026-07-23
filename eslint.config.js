import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import unusedImportsPlugin from "eslint-plugin-unused-imports";

export default [
    {
        ignores: [
            "dist/**/*",
            "artifacts/**/*",
            "cache/**/*",
            "coverage/**/*",
            "node_modules/**/*",
            "typechain-types/**/*",
            "out/**/*",
            "lib/**/*"
        ]
    },
    js.configs.recommended,
    {
        files: ["**/*.{ts,tsx,js,jsx}"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            parser: tsParser,
            parserOptions: { project: "./tsconfig.json" },
            globals: {
                // Test globals
                describe: "readonly",
                it: "readonly",
                beforeEach: "readonly",
                afterEach: "readonly",
                before: "readonly",
                after: "readonly",
                expect: "readonly",
                require: "readonly",
                // Node.js globals
                console: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                process: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                global: "readonly",
                module: "readonly",
                exports: "readonly",
                NodeJS: "readonly"
            }
        },
        plugins: {
            "@typescript-eslint": tseslint,
            "unused-imports": unusedImportsPlugin
        },
        rules: {
            // TypeScript recommended rules
            ...tseslint.configs.recommended.rules,

            "prefer-const": "error",
            "@typescript-eslint/no-unused-vars": "off", // handled by unused-imports plugin
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": [
                "warn",
                {
                    vars: "all",
                    varsIgnorePattern: "^_",
                    args: "after-used",
                    argsIgnorePattern: "^_"
                }
            ],

            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-unused-expressions": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-var-requires": "off",
            "no-console": "warn"
        }
    }
];
