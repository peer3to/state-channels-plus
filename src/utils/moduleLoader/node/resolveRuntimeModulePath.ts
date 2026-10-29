import { existsSync } from "node:fs";

/**
 * Resolve a module path named with the extension of the tree it was written
 * in. Test fixtures and root workers name `.ts` files next to themselves; when
 * the same tree runs compiled the `.ts` is absent and its `.js` twin sits in
 * its place, and the reverse holds under ts-node. Returns the twin when the
 * named file is absent and the twin exists, otherwise the path unchanged.
 * Bare package specifiers never exist as files and pass through untouched.
 */
export function resolveRuntimeModulePath(modulePath: string): string {
    const match = /\.(ts|js)$/.exec(modulePath);
    if (!match || existsSync(modulePath)) return modulePath;
    const twin =
        modulePath.slice(0, -match[0].length) +
        (match[1] === "ts" ? ".js" : ".ts");
    return existsSync(twin) ? twin : modulePath;
}
