// @spec-test-coverage-ignore: shared runner and test infrastructure for node provisioning; executable evidence belongs to the calling runner and session tests
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

const PROJECT_ROOT = process.cwd();
const runtimeRoot = path.join(__dirname, "..", "..");
const discoveryScriptFrom = (root) =>
    path.join(root, "scripts", "infra", "local-discovery-registry.js");
const PACKAGE_ROOT = fs.existsSync(discoveryScriptFrom(runtimeRoot))
    ? runtimeRoot
    : path.join(runtimeRoot, "..");
const { resolveProjectHardhatCli } = require(
    path.join(
        PACKAGE_ROOT,
        "scripts",
        "e2e-parallel",
        "shared",
        "projectModules"
    )
);
const HARDHAT_CLI = resolveProjectHardhatCli(PROJECT_ROOT);
// Each peer3 node keeps its database in a directory of its own under here.
const PEER3_NODES_DIR = path.join(PROJECT_ROOT, "temp", "peer3-nodes");
// The file in a peer3 node's directory that names the node's process.
const PEER3_NODE_PID_FILE = "node.pid";
const DISCOVERY_SCRIPT = path.join(
    PACKAGE_ROOT,
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

/**
 * Start a local HyperDHT bootstrapper. Its DHT id derives from the port it
 * was created with, so it binds exactly that port: on a fallback port peers
 * reject its id and no announce is stored. The probed port is free for TCP
 * only; another process can hold it as UDP, so a taken port is retried on a
 * fresh one, up to `attempts` binds.
 */
async function startDhtBootstrapper(host, { port, attempts = 20 } = {}) {
    const DHT = require("hyperdht");
    let bindPort = port ?? (await getFreePort());
    for (let attempt = 1; ; attempt++) {
        const bootstrapper = DHT.bootstrapper(bindPort, host, {
            host,
            anyPort: false
        });
        try {
            await bootstrapper.ready();
            return bootstrapper;
        } catch (error) {
            // destroy() rethrows the bind error of the failed ready()
            await bootstrapper.destroy({ force: true }).catch(() => {});
            if (error.code !== "EADDRINUSE" || attempt >= attempts) throw error;
            bindPort = await getFreePort();
        }
    }
}

/**
 * Poll a node's RPC endpoint until it responds or the timeout expires. Polling
 * ends early, without an error, once `signal` aborts.
 */
async function waitForHardhatNode(
    url,
    timeoutMs = 30000,
    label = "Hardhat node",
    signal = undefined
) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (signal?.aborted) return;
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
    throw new Error(`${label} not ready at ${url} within ${timeoutMs}ms`);
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
// Extra node flags for the infra processes (hardhat node, discovery registry),
// e.g. TEST_INFRA_NODE_FLAGS="--cpu-prof --cpu-prof-dir=/tmp/prof" to profile
// the chain the tests hit. Empty by default.
function infraNodeFlags() {
    const flags = process.env.TEST_INFRA_NODE_FLAGS;
    return flags ? flags.split(" ").filter(Boolean) : [];
}

// --parachain (PARACHAIN=1) starts the parachain dev node (PEER3_NODE_BIN,
// default `zero-fee-node` on PATH) on the funded test chain instead of hardhat.
const isParachain = () => process.env.PARACHAIN === "1";

/** The peer3 node binary: the one `PEER3_NODE_BIN` names, else `zero-fee-node` on PATH. */
const peer3NodeBin = () => process.env.PEER3_NODE_BIN || "zero-fee-node";

/**
 * The peer3 dev node's arguments: `seal` is "interval" or "manual", `chain`
 * is "test" or "test-other" (the same chain under a second EVM chain id).
 * Archive state: Frontier's eth_getLogs skips blocks whose state is pruned
 * (by default all but the last 256), without an error. A pool ten times the
 * default: the future queue holds a tenth of it (2 MB by default), and the
 * opening wave of concurrent tests sends contract deploys out of nonce order,
 * so a smaller queue silently evicts deploys their senders then wait on.
 * `extraArgs` follow the common ones.
 */
function peer3NodeArgs(nodePort, seal, chain, basePath, extraArgs = []) {
    return [
        "--dev",
        "--base-path",
        basePath,
        "--chain",
        chain,
        "--dev-seal",
        seal,
        "--state-pruning",
        "archive",
        "--rpc-port",
        String(nodePort),
        "--rpc-max-connections",
        "10000",
        "--pool-limit",
        "81920",
        "--pool-kbytes",
        "204800",
        "--port",
        "0",
        "--no-mdns",
        "--no-prometheus",
        "--no-telemetry",
        "--no-hardware-benchmarks",
        ...extraArgs
    ];
}

/** Bytes of a node's latest output kept for its startup failure. */
const NODE_OUTPUT_TAIL = 4096;
/** How long a node may take to report its RPC port, as waitForHardhatNode. */
const NODE_READY_MS = 30000;

async function startHardhatNode({
    port,
    logPath,
    label = "hardhat node",
    env = {},
    seal = "interval",
    chain = "test"
} = {}) {
    if (isParachain())
        return startPeer3Node({ port, logPath, label, env, seal, chain });
    const nodePort = port ?? (await getFreePort());
    const proc = spawn(
        process.execPath,
        [
            ...infraNodeFlags(),
            HARDHAT_CLI,
            "node",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(nodePort)
        ],
        {
            cwd: PROJECT_ROOT,
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );
    return nodeHandleWhenReady(proc, nodePort, { logPath, label });
}

/**
 * Spawn the peer3 dev node (`peer3NodeBin`) on `port`, or without one on the
 * port it binds and reports, wait until its RPC is ready, and return
 * `{ proc, url, stop }`. The node seals blocks as `seal` says on `chain`, with
 * `extraArgs` after the common arguments, and keeps its database in a
 * directory of its own in `nodesDir`. The directory is removed when the node
 * exits, or by a later start when the process that would have removed it was
 * killed first.
 */
async function startPeer3Node({
    port,
    logPath,
    label = "peer3 node",
    env = {},
    seal = "interval",
    chain = "test",
    extraArgs = [],
    nodesDir = PEER3_NODES_DIR
} = {}) {
    // a node without a given port binds port 0 and prints the one it got: a
    // port reserved and released first can be taken before the node binds it
    const readsBoundPort = port === undefined;
    const nodePort = port ?? 0;
    // the node's database grows past a container's small /tmp, so it lives in
    // the project's temp dir; --dev alone keeps it in the system temp dir and
    // leaves it there
    fs.mkdirSync(nodesDir, { recursive: true });
    removeDeadPeer3NodeDirs(nodesDir);
    const basePath = fs.mkdtempSync(path.join(nodesDir, "node-"));
    const proc = spawn(
        peer3NodeBin(),
        peer3NodeArgs(nodePort, seal, chain, basePath, extraArgs),
        // the node logs every block, and an unread pipe would fill and stall it:
        // nodeHandleWhenReady reads both to the end
        {
            cwd: PROJECT_ROOT,
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );
    const removeBasePath = () =>
        fs.rmSync(basePath, { recursive: true, force: true });
    proc.once("exit", removeBasePath);
    // a binary that cannot be spawned emits no exit
    proc.once("error", removeBasePath);
    if (proc.pid !== undefined) {
        // written whole by a rename, so a sweep never reads half of it
        const pidFile = path.join(basePath, PEER3_NODE_PID_FILE);
        fs.writeFileSync(`${pidFile}.tmp`, String(proc.pid));
        fs.renameSync(`${pidFile}.tmp`, pidFile);
    }
    return nodeHandleWhenReady(proc, nodePort, {
        logPath,
        label,
        readsBoundPort
    });
}

/**
 * Removes the database directory of every peer3 node in `nodesDir` whose
 * process is gone. A directory without a valid process id is one whose node is
 * being started right now, and is kept.
 */
function removeDeadPeer3NodeDirs(nodesDir) {
    for (const entry of fs.readdirSync(nodesDir)) {
        const dir = path.join(nodesDir, entry);
        let pid;
        try {
            pid = Number(
                fs.readFileSync(path.join(dir, PEER3_NODE_PID_FILE), "utf8")
            );
        } catch {
            continue;
        }
        if (Number.isInteger(pid) && pid > 0 && !isProcessAlive(pid))
            fs.rmSync(dir, { recursive: true, force: true });
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: the process exists and belongs to another user
        return error.code === "EPERM";
    }
}

/**
 * The handle of a spawned node once its RPC answers: on `nodePort`, or with
 * `readsBoundPort` on the port the node prints.
 */
function nodeHandleWhenReady(
    proc,
    nodePort,
    { logPath, label, readsBoundPort = false }
) {
    let resolveExit;
    const exited = new Promise((resolve) => {
        resolveExit = resolve;
    });
    proc.once("exit", (code, signal) => resolveExit({ code, signal }));
    const logStream = pipeLogs(proc, logPath);
    // the output is always read, so a full pipe never blocks the node; its
    // tail goes into a startup failure
    let outputTail = "";
    let resolveBoundPort;
    const boundPort = new Promise((resolve) => {
        resolveBoundPort = resolve;
    });
    const readOutput = (chunk) => {
        outputTail = (outputTail + chunk.toString()).slice(-NODE_OUTPUT_TAIL);
        const bound = /Running JSON-RPC server: addr=127\.0\.0\.1:(\d+)/.exec(
            outputTail
        );
        if (bound) resolveBoundPort(Number(bound[1]));
    };
    proc.stdout.on("data", readOutput);
    proc.stderr.on("data", readOutput);
    const logClosed = logStream
        ? new Promise((resolve) => {
              if (logStream.closed) resolve();
              else logStream.once("close", resolve);
          })
        : Promise.resolve();
    proc.once("close", () => logStream?.end());
    const stop = () => {
        if (!proc.killed) proc.kill("SIGTERM");
    };

    // a node that exits or cannot start ends the readiness polling
    const polling = new AbortController();
    proc.once("exit", () => polling.abort());
    proc.once("error", () => polling.abort());

    return new Promise((resolve, reject) => {
        let settled = false;
        // close, not exit: the output read so far is complete
        proc.once("close", (code) => {
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `${label} exited with code ${code} before ready:\n${outputTail}`
                    )
                );
            }
        });
        proc.on("error", (err) => {
            logStream?.end();
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
        let url;
        (readsBoundPort
            ? Promise.race([
                  boundPort,
                  new Promise((_, rejectPort) =>
                      setTimeout(
                          () =>
                              rejectPort(
                                  new Error(
                                      `${label} reported no RPC port within ${NODE_READY_MS}ms:\n${outputTail}`
                                  )
                              ),
                          NODE_READY_MS
                      ).unref()
                  )
              ])
            : Promise.resolve(nodePort)
        )
            .then((boundTo) => {
                url = `http://127.0.0.1:${boundTo}`;
                return waitForHardhatNode(
                    url,
                    undefined,
                    label,
                    polling.signal
                );
            })
            .then(
                () => {
                    // polling also ends when the node exits; close then rejects
                    if (
                        settled ||
                        proc.exitCode !== null ||
                        proc.signalCode !== null
                    )
                        return;
                    settled = true;
                    resolve({ proc, url, stop, exited, logClosed });
                },
                (err) => {
                    if (!settled) {
                        settled = true;
                        stop();
                        reject(
                            new Error(
                                `${err.message}; its last output:\n${outputTail}`
                            )
                        );
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
    const child = spawn(
        process.execPath,
        [...infraNodeFlags(), DISCOVERY_SCRIPT],
        {
            cwd: PROJECT_ROOT,
            env: {
                ...process.env,
                LOCAL_DISCOVERY_HOST: "127.0.0.1",
                LOCAL_DISCOVERY_PORT: String(discPort)
            },
            stdio: ["ignore", "pipe", "pipe"]
        }
    );
    let resolveExit;
    const exited = new Promise((resolve) => {
        resolveExit = resolve;
    });
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    const logStream = pipeLogs(child, logPath);
    const logClosed = logStream
        ? new Promise((resolve) => {
              if (logStream.closed) resolve();
              else logStream.once("close", resolve);
          })
        : Promise.resolve();
    child.once("close", () => logStream?.end());
    const stop = () => {
        if (!child.killed) child.kill("SIGTERM");
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
                resolve({ child, url: m[1], stop, exited, logClosed });
            }
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                reject(
                    new Error(`${label} exited with code ${code} before ready`)
                );
            }
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            logStream?.end();
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
            label: `slot ${id} hardhat node`,
            env: { E2E_INTERVAL_MINING: "1" }
        });
        node.label = `slot ${id} hardhat node`;
        node.slotId = id;
        node.logPath = infraPath(`hardhat-node-slot${id}.log`);
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
        disc.slotId = id;
        disc.logPath = infraPath(`discovery-slot${id}.log`);
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
    startDhtBootstrapper,
    waitForHardhatNode,
    startHardhatNode,
    startPeer3Node,
    peer3NodeBin,
    PEER3_NODES_DIR,
    PEER3_NODE_PID_FILE,
    startDiscoveryRegistry,
    jsonRpc,
    resetSlotCacheDir,
    teardownInfra,
    provisionSlots,
    startGasMonitor
};
