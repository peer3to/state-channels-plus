import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The repository root, found by walking up from this module until the
 * package manifest appears. Correct both when the test tree runs from source
 * and when it runs compiled under `dist/`, where `__dirname` sits one level
 * deeper.
 */
export function repoRoot(): string {
    let dir = __dirname;
    for (;;) {
        if (existsSync(path.join(dir, "package.json"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error("Repository root not found");
        dir = parent;
    }
}
