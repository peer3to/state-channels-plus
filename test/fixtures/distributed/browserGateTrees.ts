// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const LAUNCH_HELPER = path.join(
    REPO_ROOT,
    "test",
    "browser",
    "chromiumLaunch.js"
);

// Every throwaway tree this fixture created, for the owning suite to remove.
const scratchRoots: string[] = [];

/** A throwaway directory under temp/, tracked for cleanup. */
export function scratchRoot(prefix: string) {
    fs.mkdirSync(path.join(REPO_ROOT, "temp"), { recursive: true });
    const root = fs.mkdtempSync(path.join(REPO_ROOT, "temp", prefix));
    scratchRoots.push(root);
    return root;
}

/** Remove every tree this fixture created. */
export function removeScratchRoots(extra: string[] = []) {
    for (const root of [...scratchRoots.splice(0), ...extra]) {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

/** A gate tree: `<root>/<dir>/<name>` for each given relative file. */
export function writeGateTree(files: string[]) {
    const root = scratchRoot("browser-gates-");
    for (const file of files) {
        const target = path.join(root, "browser", file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "export default 1;\n");
    }
    return root;
}

/** A gate entry point that behaves the way a test asks for. */
export function writeGate(body: string) {
    const root = scratchRoot("browser-gate-");
    const gate = path.join(root, "run-gate.mjs");
    fs.writeFileSync(gate, `${body}\n`);
    return { root, gate };
}

/** An executable build command that runs `body` through /bin/sh. */
export function writeBuildCommand(name: string, body: string) {
    const root = scratchRoot("browser-build-");
    const command = path.join(root, name);
    fs.writeFileSync(command, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(command, 0o755);
    return { root, command };
}

/**
 * Launch Chromium through the gates' own policy in a child process, so the
 * browsers path — which Playwright resolves when it is imported — is the one
 * the case asks for. `mode` picks the real failure to provoke: "missing" points
 * Playwright at an empty browsers directory, "unrelated" gives its own launch a
 * path that is not a browser at all.
 */
export function runGateLaunchProbe(
    mode: "launch" | "missing" | "unrelated",
    browsersPath?: string
) {
    const script = `
        const { chromium } = require("playwright");
        const { launchChromium } = require(${JSON.stringify(LAUNCH_HELPER)});
        const target =
            ${JSON.stringify(mode)} === "unrelated"
                ? { launch: () => chromium.launch({ executablePath: "/nonexistent/browser" }) }
                : chromium;
        launchChromium(target)
            .then(async (browser) => {
                process.stdout.write("LAUNCHED " + browser.version());
                await browser.close();
            })
            .catch((error) => {
                process.stdout.write("FAILED " + error.message.replace(/\\s+/g, " "));
            });
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
            ...process.env,
            ...(browsersPath ? { PLAYWRIGHT_BROWSERS_PATH: browsersPath } : {}),
            SCP_BROWSER_CONTAINED: ""
        }
    });
    return `${result.stdout}${result.stderr}`;
}
