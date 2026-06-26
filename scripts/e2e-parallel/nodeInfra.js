/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { HARDHAT_CLI } = require("./constants");

/** Probe the OS for an available TCP port by binding to :0 and reading back. */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close((err) => (err ? reject(err) : resolve(port)));
        });
        srv.on("error", reject);
    });
}

/**
 * Spawn the shared LocalDiscovery registry on `port` and wait for its ready
 * line. Rejects if the process exits non-zero before emitting the ready line,
 * or if the ready line doesn't arrive within 15 seconds.
 */
function startDiscoveryRegistry(port, logPath) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: "w" });
        const child = spawn(
            process.execPath,
            [
                path.join(
                    __dirname,
                    "..",
                    "infra",
                    "local-discovery-registry.js"
                )
            ],
            {
                cwd: path.join(__dirname, "..", ".."),
                env: {
                    ...process.env,
                    LOCAL_DISCOVERY_HOST: "127.0.0.1",
                    LOCAL_DISCOVERY_PORT: String(port)
                },
                // stdout piped so we can parse the ready line; stderr to log stream.
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        child.stderr.pipe(logStream, { end: false });

        const READY_RE = /LocalDiscovery registry listening on (ws:\/\/\S+)/;
        let settled = false;
        let buffer = "";

        const readyTimeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill("SIGTERM");
                reject(
                    new Error(
                        "LocalDiscovery registry did not become ready within 15s"
                    )
                );
            }
        }, 15000);

        child.stdout.on("data", (chunk) => {
            logStream.write(chunk);
            buffer += chunk.toString();
            const m = READY_RE.exec(buffer);
            if (m && !settled) {
                settled = true;
                clearTimeout(readyTimeout);
                resolve({ child, url: m[1] });
            }
        });

        child.on("exit", (code) => {
            clearTimeout(readyTimeout);
            logStream.end();
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `LocalDiscovery registry exited with code ${code} before becoming ready`
                    )
                );
            }
        });

        child.on("error", (err) => {
            clearTimeout(readyTimeout);
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
    });
}

/**
 * Poll a hardhat node's JSON-RPC endpoint until it responds or timeout expires.
 */
async function waitForHardhatNode(url, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ready = await new Promise((resolve) => {
            const req = http.request(
                url,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" }
                },
                (res) => {
                    res.resume();
                    resolve(true);
                }
            );
            req.on("error", () => resolve(false));
            req.write(
                '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
            );
            req.end();
        });
        if (ready) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Hardhat node not ready at ${url} within ${timeoutMs}ms`);
}

/**
 * Empty a slot's manager-cache dir. INVARIANT: every slot-node (re)boot MUST
 * call this before any test child reads the dir — a fresh node carries none of
 * the prior markers' bytecode, so a surviving marker would point at nothing.
 * This is the sole defense against stale markers; a future node-recycle path
 * must call it too.
 */
function resetSlotCacheDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Spawn an external hardhat node for `slotId` on `port` and wait until its
 * RPC endpoint is ready. Returns `{ proc, url, logStream }`.
 */
function startSlotNode(slotId, port, logPath) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: "w" });

        const proc = spawn(
            process.execPath,
            [
                HARDHAT_CLI,
                "node",
                "--hostname",
                "127.0.0.1",
                "--port",
                String(port)
            ],
            {
                cwd: path.join(__dirname, "..", ".."),
                env: { ...process.env },
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        proc.stdout.pipe(logStream, { end: false });
        proc.stderr.pipe(logStream, { end: false });

        const url = `http://127.0.0.1:${port}`;

        let settled = false;

        proc.on("exit", (code) => {
            logStream.end();
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `Slot ${slotId} hardhat node exited with code ${code} before becoming ready`
                    )
                );
            }
        });

        proc.on("error", (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        });

        // Wait for the node RPC to respond, then resolve.
        waitForHardhatNode(url).then(
            () => {
                if (!settled) {
                    settled = true;
                    resolve({ proc, url, logStream });
                }
            },
            (err) => {
                if (!settled) {
                    settled = true;
                    proc.kill("SIGTERM");
                    reject(err);
                }
            }
        );
    });
}

module.exports = {
    getFreePort,
    startDiscoveryRegistry,
    waitForHardhatNode,
    resetSlotCacheDir,
    startSlotNode
};
