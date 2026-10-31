// @spec-test-coverage-ignore: shared test-support probe of the modules a package entry loads; contains no test declarations
import { repoRoot } from "./repoRoot";
import { execFileSync } from "child_process";
import path from "path";

/**
 * The modules a fresh node process holds after requiring `specifier` and
 * then awaiting `afterLoad`, a script body that sees the module as `entry`.
 */
export function loadedModules(specifier: string, afterLoad = ""): string[] {
    const output = execFileSync(
        process.execPath,
        [
            "--eval",
            `(async () => { const entry = require(${JSON.stringify(specifier)}); ${afterLoad}; console.log(JSON.stringify(Object.keys(require.cache))); })().catch((error) => { console.error(error); process.exit(1); });`
        ],
        { cwd: repoRoot(), encoding: "utf8" }
    );
    return (JSON.parse(output.trim().split("\n").pop()!) as string[]).map(
        (file) => file.split(path.sep).join("/")
    );
}
