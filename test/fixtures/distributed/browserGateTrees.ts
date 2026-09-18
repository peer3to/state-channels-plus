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
 * A gate that brings up what a real one owns — a Chromium and an HTTP server —
 * records how to find them, then idles until it is cancelled. The browser is
 * tagged through its user agent so the tree can be found from outside by
 * command line: Playwright's `launch` hands back no process handle, and it
 * rejects a `--user-data-dir` argument.
 */
export function writeIdlingGate() {
    const { root, gate } = writeGate("");
    const marker = path.join(root, "ready.json");
    const tag = `scp-cancelled-gate-${path.basename(root)}`;
    fs.writeFileSync(
        gate,
        `import { chromium } from "playwright";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { chromiumLaunchOptions } from ${JSON.stringify(LAUNCH_HELPER)};

const options = chromiumLaunchOptions();
const browser = await chromium.launch({
    ...options,
    args: [...(options.args ?? []), "--user-agent=${tag}"]
});
const page = await browser.newPage();
await page.setContent("<title>idling</title>");
const server = createServer((_request, response) => response.end("ok"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
writeFileSync(
    ${JSON.stringify(marker)},
    JSON.stringify({ gate: process.pid, port: server.address().port })
);
setInterval(() => {}, 1000);
`
    );
    return { root, gate, marker, tag };
}

/** PIDs whose command line carries `tag`, via pgrep. */
export function processesMatching(tag: string) {
    const result = spawnSync("pgrep", ["-f", tag], { encoding: "utf8" });
    return result.stdout.split("\n").filter(Boolean);
}

/** Wait for a gate to report readiness. The marker can be read mid-write. */
export async function waitForGateReady(marker: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            return JSON.parse(fs.readFileSync(marker, "utf8")) as {
                gate: number;
                port: number;
            };
        } catch {
            if (Date.now() > deadline) {
                throw new Error("gate never reported ready");
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

/**
 * Wait for a tagged tree to disappear. Cancellation resolves once the runner's
 * own child is gone; the signal it sent the rest of the group lands a moment
 * later, so this polls instead of sampling once.
 */
export async function waitForProcessesGone(tag: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const alive = processesMatching(tag);
        if (alive.length === 0) return alive;
        if (Date.now() > deadline) return alive;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/** Wait for a port to be free again, returning whether it still is not. */
export async function waitForPortFree(port: number, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (!(await portIsOccupied(port))) return false;
        if (Date.now() > deadline) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/** Whether a port on loopback still refuses to bind (something owns it). */
export async function portIsOccupied(port: number) {
    const { createServer } = await import("node:net");
    return new Promise<boolean>((resolve) => {
        const probe = createServer();
        probe.once("error", () => resolve(true));
        probe.once("listening", () => probe.close(() => resolve(false)));
        probe.listen(port, "127.0.0.1");
    });
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
