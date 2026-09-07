import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

// Keep one ordering rule for the main lint config and the standalone import check.
export const importOrderConfig = {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/utils/GeneratedArtifacts.ts", "src/types/sol-enums.ts"],
    languageOptions: { parser: tsParser },
    plugins: { import: importPlugin, "@typescript-eslint": tsPlugin },
    rules: {
        "import/order": [
            "error",
            {
                groups: [
                    [
                        "builtin",
                        "external",
                        "internal",
                        "unknown",
                        "parent",
                        "sibling",
                        "index",
                        "object",
                        "type"
                    ]
                ],
                alphabetize: { order: "asc", caseInsensitive: true },
                "newlines-between": "ignore",
                warnOnUnassignedImports: false
            }
        ]
    }
};

export default [
    // This focused fixer must preserve suppressions for rules it does not run.
    { linterOptions: { reportUnusedDisableDirectives: "off" } },
    importOrderConfig
];
