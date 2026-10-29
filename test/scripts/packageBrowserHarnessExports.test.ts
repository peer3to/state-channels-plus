// @spec-test-coverage-ignore: package export packaging for downstream test tooling; not protocol behavior, no specification or implementation IDs apply
import { repoRoot as findRepoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// The package root, also when this suite runs compiled under dist/.
const repoRoot = findRepoRoot();
const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);

// Every string target of a package.json `exports` map, conditions included.
function exportTargets(entry: unknown): string[] {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object") {
        return Object.values(entry).flatMap(exportTargets);
    }
    return [];
}

describe("package browser-harness exports", function () {
    it("resolves the chromium-launch export through the package self-reference", function () {
        const resolved = require.resolve(
            "@peer3/state-channels-plus/browser-harness/chromium-launch"
        );
        expect(resolved).to.equal(
            path.join(repoRoot, "test", "browser", "chromiumLaunch.js")
        );
        const chromiumLaunch = require(resolved);
        expect(chromiumLaunch.launchChromium).to.be.a("function");
        expect(chromiumLaunch.chromiumLaunchOptions).to.be.a("function");
    });

    it("imports the local-discovery-relay-hub export through the package self-reference", function () {
        // A plain Node ESM consumer: this suite compiles `import()` to `require`.
        const exported = execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "--eval",
                'const hub = await import("@peer3/state-channels-plus/browser-harness/local-discovery-relay-hub"); console.log(typeof hub.startLocalDiscoveryRelayHub);'
            ],
            { cwd: repoRoot, encoding: "utf8" }
        ).trim();
        expect(exported).to.equal("function");
    });

    it("ships every package export target in the published files", function () {
        const files: string[] = packageJson.files;
        const targets = Object.values(packageJson.exports).flatMap(
            exportTargets
        );
        expect(targets).to.include("./test/browser/chromiumLaunch.js");
        expect(targets).to.include("./test/browser/localDiscoveryRelayHub.mjs");
        const uncovered = targets.filter((target) => {
            // A subpath pattern is shipped when the directory before `*` is.
            const shipped = path.posix.normalize(target.split("*")[0]);
            return !files.some(
                (file) =>
                    shipped === file ||
                    shipped.startsWith(`${file.replace(/\/$/, "")}/`)
            );
        });
        expect(uncovered).to.deep.equal([]);
    });
});
