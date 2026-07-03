/* eslint-disable no-console */
// Common node infrastructure for e2e: start hardhat nodes / discovery
// registries, provision slot pools, JSON-RPC, gas monitoring. ONE file used the
// same way by both the parallel runner (scripts/test-e2e-parallel.js) and the
// test harness. TypeScript consumers import through the typed wrapper
// (nodeInfra.d.ts) so we don't mix `require`d .js into .ts.
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const HARDHAT_CLI = require.resolve("hardhat/internal/cli/cli.js");
const REPO_ROOT = path.join(__dirname, "..", "..");
const DISCOVERY_SCRIPT = path.join(
    REPO_ROOT,
    "scripts",
    "infra",
    "local-discovery-registry.js"
);

// ---------------------------------------------------------------------------
// Primitives (used by both the harness and the runner)
// ---------------------------------------------------------------------------

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

/** Poll a node's RPC endpoint until it responds or the timeout expires. */
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
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Hardhat node not ready at ${url} within ${timeoutMs}ms`);
}

function pipeLogs(child, logPath) {
    if (!logPath) return undefined;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.createWriteStream(logPath, { flags: "w" });
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
    return logStream;
}

/**
 * Spawn `hardhat node` (on `port` or a free one), wait until its RPC is ready,
 * and return `{ proc, url, stop }`. Inherits process.env so hardhat.config's
 * e2e mining / gas-limit / accounts apply.
 */
async function startHardhatNode({
    port,
    logPath,
    label = "hardhat node"
} = {}) {
    const nodePort = port ?? (await getFreePort());
    const proc = spawn(
        process.execPath,
        [
            HARDHAT_CLI,
            "node",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(nodePort)
        ],
        {
            cwd: REPO_ROOT,
            env: { ...process.env },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );
    const logStream = pipeLogs(proc, logPath);
    const url = `http://127.0.0.1:${nodePort}`;
    const stop = () => {
        if (!proc.killed) proc.kill("SIGTERM");
        logStream?.end();
    };

    return new Promise((resolve, reject) => {
        let settled = false;
        proc.on("exit", (code) => {
            logStream?.end();
            if (!settled) {
                settled = true;
                reject(
                    new Error(`${label} exited with code ${code} before ready`)
                );
            }
        });
        proc.on("error", (err) => settled || (reject(err), (settled = true)));
        waitForHardhatNode(url).then(
            () => settled || ((settled = true), resolve({ proc, url, stop })),
            (err) => {
                if (!settled) {
                    settled = true;
                    stop();
                    reject(err);
                }
            }
        );
    });
}

/**
 * Spawn the LocalDiscovery registry (on `port` or a free one), wait for its
 * ready line, and return `{ child, url, stop }`.
 */
async function startDiscoveryRegistry({
    port,
    logPath,
    label = "discovery"
} = {}) {
    const discPort = port ?? (await getFreePort());
    const child = spawn(process.execPath, [DISCOVERY_SCRIPT], {
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            LOCAL_DISCOVERY_HOST: "127.0.0.1",
            LOCAL_DISCOVERY_PORT: String(discPort)
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    const logStream = pipeLogs(child, logPath);
    const stop = () => {
        if (!child.killed) child.kill("SIGTERM");
        logStream?.end();
    };

    return new Promise((resolve, reject) => {
        const READY_RE = /LocalDiscovery registry listening on (ws:\/\/\S+)/;
        let settled = false;
        let buffer = "";
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                stop();
                reject(new Error(`${label} did not become ready within 15s`));
            }
        }, 15000);
        child.stdout.on("data", (chunk) => {
            buffer += chunk.toString();
            const m = READY_RE.exec(buffer);
            if (m && !settled) {
                settled = true;
                clearTimeout(timer);
                resolve({ child, url: m[1], stop });
            }
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            logStream?.end();
            if (!settled) {
                settled = true;
                reject(
                    new Error(`${label} exited with code ${code} before ready`)
                );
            }
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
    });
}

/** Single JSON-RPC call against a node url. Resolves the `result` field. */
function jsonRpc(url, method, params = []) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
        const req = http.request(
            url,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(body)
                }
            },
            (res) => {
                let data = "";
                res.on("data", (d) => (data += d));
                res.on("end", () => {
                    try {
                        const j = JSON.parse(data);
                        if (j.error) reject(new Error(j.error.message));
                        else resolve(j.result);
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

/**
 * Empty a slot's manager-cache dir. INVARIANT: every slot-node (re)boot MUST
 * call this before any test child reads the dir — a fresh node carries none of
 * the prior markers' bytecode, so a surviving marker would point at nothing.
 */
function resetSlotCacheDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Slot pool (used by the parallel runner)
// ---------------------------------------------------------------------------

/** Tear down all nodes + discoveries in `infra`. Idempotent (clears the lists). */
function teardownInfra(infra) {
    for (const n of infra.nodes) {
        if (!n.proc.killed) {
            console.log(`Tearing down ${n.label}`);
            n.proc.kill("SIGTERM");
        }
    }
    infra.nodes.length = 0;
    for (const d of infra.discoveries) {
        if (!d.child.killed) {
            console.log(`Tearing down ${d.label}`);
            d.child.kill("SIGTERM");
        }
    }
    infra.discoveries.length = 0;
}

/**
 * Provision `slotCount` uniform slots (own hardhat node + discovery + reset
 * deploy-cache dir), all in parallel. Returns `{ slots, infra }`. Each piece is
 * registered the moment it's ready, and `allSettled` lets every boot finish
 * before we act, so a partial failure tears down cleanly with no orphans.
 */
async function provisionSlots(slotCount, logDir) {
    const infra = { nodes: [], discoveries: [] };
    const infraPath = (name) => path.join(path.resolve(logDir), "infra", name);

    // Don't hand the same just-freed ephemeral port to two concurrent boots.
    const claimedPorts = new Set();
    const claimPort = async () => {
        for (let i = 0; i < 50; i++) {
            const p = await getFreePort();
            if (!claimedPorts.has(p)) {
                claimedPorts.add(p);
                return p;
            }
        }
        throw new Error("could not find a free unclaimed port");
    };

    const bootNode = async (id) => {
        const port = await claimPort();
        console.log(`Starting slot ${id} hardhat node on port ${port}...`);
        const node = await startHardhatNode({
            port,
            logPath: infraPath(`hardhat-node-slot${id}.log`),
            label: `slot ${id} hardhat node`
        });
        node.label = `slot ${id} hardhat node`;
        infra.nodes.push(node);
        return node;
    };
    const bootDiscovery = async (id) => {
        const port = await claimPort();
        console.log(`Starting slot ${id} discovery on port ${port}...`);
        const disc = await startDiscoveryRegistry({
            port,
            logPath: infraPath(`discovery-slot${id}.log`),
            label: `slot ${id} discovery`
        });
        disc.label = `slot ${id} discovery`;
        infra.discoveries.push(disc);
        return disc;
    };
    const provisionSlot = async (id) => {
        const [node, disc] = await Promise.all([
            bootNode(id),
            bootDiscovery(id)
        ]);
        const cacheDir = infraPath(`manager-cache-slot${id}`);
        resetSlotCacheDir(cacheDir);
        console.log(
            `Slot ${id} ready (node ${node.url}, discovery ${disc.url})`
        );
        return { id, nodeUrl: node.url, discoveryUrl: disc.url, cacheDir };
    };

    const settled = await Promise.allSettled(
        Array.from({ length: slotCount }, (_, id) => provisionSlot(id))
    );
    const rejected = settled.find((r) => r.status === "rejected");
    if (rejected) {
        teardownInfra(infra);
        throw rejected.reason;
    }
    return { slots: settled.map((r) => r.value), infra };
}

/**
 * Poll each slot node every `intervalMs`, scanning new blocks; whenever a block's
 * gasUsed/gasLimit beats that slot's prior peak, record it and call
 * `onNewPeak(slotId, peak)`. Returns `{ stop, gasPeak }`.
 */
function startGasMonitor(slots, onNewPeak, intervalMs = 1000) {
    const gasPeak = new Map(); // slotId → { pct, used, limit, block }
    const lastScanned = new Map(); // slotId → last block number scanned
    const pollSlotGas = async (slot) => {
        try {
            const latest = Number.parseInt(
                await jsonRpc(slot.nodeUrl, "eth_blockNumber"),
                16
            );
            let from = lastScanned.has(slot.id)
                ? lastScanned.get(slot.id) + 1
                : 0;
            if (latest - from > 500) from = latest - 500; // cap backscan
            for (let b = from; b <= latest; b++) {
                const blk = await jsonRpc(
                    slot.nodeUrl,
                    "eth_getBlockByNumber",
                    [`0x${b.toString(16)}`, false]
                );
                if (!blk) continue;
                const used = Number.parseInt(blk.gasUsed, 16);
                const limit = Number.parseInt(blk.gasLimit, 16);
                if (!limit) continue;
                const pct = (used / limit) * 100;
                const prev = gasPeak.get(slot.id);
                if (!prev || pct > prev.pct) {
                    const peak = { pct, used, limit, block: b };
                    gasPeak.set(slot.id, peak);
                    onNewPeak(slot.id, peak);
                }
            }
            lastScanned.set(slot.id, latest);
        } catch {
            // Node busy/unreachable this tick — retry next time.
        }
    };
    const timer = setInterval(() => {
        for (const s of slots) pollSlotGas(s);
    }, intervalMs);
    timer.unref?.();
    return { stop: () => clearInterval(timer), gasPeak };
}

module.exports = {
    getFreePort,
    startHardhatNode,
    startDiscoveryRegistry,
    jsonRpc,
    resetSlotCacheDir,
    teardownInfra,
    provisionSlots,
    startGasMonitor
};
