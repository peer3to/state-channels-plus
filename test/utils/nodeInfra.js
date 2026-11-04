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
const readline = require("readline");

const PROJECT_ROOT = process.cwd();
const runtimeRoot = path.join(__dirname, "..", "..");
const discoveryScriptFrom = (root) =>
    path.join(root, "scripts", "infra", "local-discovery-registry.js");
const PACKAGE_ROOT = fs.existsSync(discoveryScriptFrom(runtimeRoot))
    ? runtimeRoot
    : path.join(runtimeRoot, "..");
const DISCOVERY_SCRIPT = path.join(
    PACKAGE_ROOT,
    "scripts",
    "infra",
    "local-discovery-registry.js"
);
// The storage diff service is the SDK's own TypeScript (src/utils/node), so
// in the SDK it runs from the project beside the tests; a project with no copy
// of its own runs the runner's.
const storageDiffScriptFrom = (root) =>
    path.join(root, "scripts", "infra", "storage-diff-service.js");
const STORAGE_DIFF_SCRIPT = fs.existsSync(storageDiffScriptFrom(PROJECT_ROOT))
    ? storageDiffScriptFrom(PROJECT_ROOT)
    : storageDiffScriptFrom(PACKAGE_ROOT);
// The trace the service asks for every block (BlockStager's TRACE_OPTIONS),
// here of the genesis block.
const STORAGE_DIFF_TRACE_PROBE = [
    "0x0",
    { tracer: "prestateTracer", tracerConfig: { diffMode: true } }
];
// The trusted copy, never PROJECT_ROOT's: the project is untrusted.
const { ANVIL_BIN, ANVIL_WATCHDOG, anvilArgs, pinnedAnvilMismatch } = require(
    path.join(PACKAGE_ROOT, "scripts", "infra", "anvilNode.js")
);
const { resolveProjectHardhatCli } = require(
    path.join(
        PACKAGE_ROOT,
        "scripts",
        "e2e-parallel",
        "shared",
        "projectModules"
    )
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

/** One eth_blockNumber probe: true only when the node answers with a result. */
function probeRpc(url) {
    return new Promise((resolve) => {
        const req = http.request(
            url,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                timeout: 3000
            },
            (res) => {
                let data = "";
                res.on("data", (d) => (data += d));
                res.on("end", () => {
                    try {
                        resolve(/^0x[0-9a-f]+$/i.test(JSON.parse(data).result));
                    } catch {
                        resolve(false);
                    }
                });
                res.on("error", () => resolve(false));
            }
        );
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(false));
        req.write(
            '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
        );
        req.end();
    });
}

/** Poll a node's RPC endpoint until it answers JSON-RPC or the timeout expires. */
async function waitForHardhatNode(
    url,
    timeoutMs = 30000,
    cancelled = () => false
) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (cancelled()) return;
        if (await probeRpc(url)) return;
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

// Extra node flags for the infra processes (the project's hardhat node, the
// discovery registry), e.g.
// TEST_INFRA_NODE_FLAGS="--cpu-prof --cpu-prof-dir=/tmp/prof". Empty by default.
function infraNodeFlags() {
    const flags = process.env.TEST_INFRA_NODE_FLAGS;
    return flags ? flags.split(" ").filter(Boolean) : [];
}

const NODE_STARTUP_BUDGET_MS = 30000;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
const BOUND_PORT_RE = /Listening on 127\.0\.0\.1:(\d+)\r?\n/;
const HARDHAT_BOUND_PORT_RE =
    /JSON-RPC server at http:\/\/127\.0\.0\.1:(\d+)\//;
// anvil's own log lines: each RPC request's method name, the indented summary
// of each mined transaction and block, a failed request's header and indented
// details, and the blank lines between them. Contract console.log lines are
// printed unindented.
const ANVIL_LOG_LINE_RE =
    /^(?:(?:eth|net|web3|anvil|hardhat|evm|debug|trace|txpool|ots|erigon|personal)_\w+|RPC request failed:|\s.*|)$/;

/**
 * The test chain E2E_TEST_CHAIN selects: "anvil", the pinned anvil (the
 * default), or "project", the project's own `hardhat node`, for a project
 * whose tests rely on its own Hardhat build.
 */
function testChain(env = process.env) {
    const chain = env.E2E_TEST_CHAIN || "anvil";
    if (chain !== "anvil" && chain !== "project")
        throw new Error(
            `E2E_TEST_CHAIN must be anvil or project, not ${chain}`
        );
    return chain;
}

/** Copy the chain's output after ready to this process's, without anvil's own log lines. */
function forwardChainOutput(proc) {
    for (const [source, target] of [
        [proc.stdout, process.stdout],
        [proc.stderr, process.stderr]
    ]) {
        readline.createInterface({ input: source }).on("line", (line) => {
            if (!ANVIL_LOG_LINE_RE.test(line)) target.write(`${line}\n`);
        });
    }
}

// The pinned-anvil check, once per PATH: it runs `anvil --version`.
const anvilChecks = new Map();
function anvilRefusal(env) {
    if (!anvilChecks.has(env.PATH)) {
        anvilChecks.set(env.PATH, pinnedAnvilMismatch(PROJECT_ROOT, env));
    }
    return anvilChecks.get(env.PATH);
}

/**
 * Spawn the test chain (testChain), the pinned anvil
 * (scripts/infra/anvilNode.js) or the project's `hardhat node`, on `port` or
 * one it binds itself on 0; wait for its bound-port line and for its RPC to
 * answer, and return `{ proc, url, stop, exited, logClosed }`. The chain binds
 * port 0 itself: a port reserved and released first can be taken by another
 * process before the chain binds it. Inherits process.env so the e2e mining /
 * chain id apply. The chain runs under ANVIL_WATCHDOG, so it dies with this
 * process however this process dies. `forwardOutput` copies the chain's output
 * after ready to this process's own (forwardChainOutput).
 */
async function startHardhatNode({
    port,
    logPath,
    label = "hardhat node",
    env = {},
    forwardOutput = false
} = {}) {
    const nodeEnv = {
        ...process.env,
        ...env,
        HARDHAT_NODE_HOST: "127.0.0.1",
        HARDHAT_NODE_PORT: String(port ?? 0)
    };
    const projectChain = testChain(nodeEnv) === "project";
    const refusal = projectChain ? null : anvilRefusal(nodeEnv);
    if (refusal) throw new Error(`${label} cannot start: ${refusal}`);
    const command = projectChain
        ? [
              process.execPath,
              ...infraNodeFlags(),
              resolveProjectHardhatCli(PROJECT_ROOT),
              "node",
              "--hostname",
              "127.0.0.1",
              "--port",
              String(port ?? 0)
          ]
        : [ANVIL_BIN, ...anvilArgs(nodeEnv)];
    const boundPortRe = projectChain ? HARDHAT_BOUND_PORT_RE : BOUND_PORT_RE;
    const proc = spawn("/bin/sh", ["-c", ANVIL_WATCHDOG, "sh", ...command], {
        cwd: PROJECT_ROOT,
        env: nodeEnv,
        stdio: ["pipe", "pipe", "pipe"]
    });
    let resolveExit;
    const exited = new Promise((resolve) => {
        resolveExit = resolve;
    });
    proc.once("exit", (code, signal) => resolveExit({ code, signal }));
    const logStream = pipeLogs(proc, logPath);
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

    return new Promise((resolve, reject) => {
        let settled = false;
        let output = "";
        const settle = (finish) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            proc.off("exit", onExit);
            proc.stdout.off("data", onData);
            proc.stderr.off("data", onData);
            if (forwardOutput) forwardChainOutput(proc);
            // keep draining the chain's log so its pipes never fill
            proc.stdout.resume();
            proc.stderr.resume();
            finish();
        };
        const fail = (error) =>
            settle(() => {
                stop();
                reject(error);
            });
        const timer = setTimeout(
            () =>
                fail(
                    new Error(
                        `${label} did not become ready within ${NODE_STARTUP_BUDGET_MS}ms:\n${output}`
                    )
                ),
            NODE_STARTUP_BUDGET_MS
        );
        const onExit = (code) =>
            settle(() =>
                reject(
                    new Error(
                        `${label} exited with code ${code} before ready:\n${output}`
                    )
                )
            );
        // stays attached: a late child error must not become an uncaught one
        const onError = (err) => {
            logStream?.end();
            settle(() => reject(err));
        };
        const onData = (chunk) => {
            if (settled || bound) return;
            output += chunk.toString().replace(ANSI_RE, "");
            const match = boundPortRe.exec(output);
            if (!match) return;
            const boundPort = Number(match[1]);
            if (!(boundPort >= 1 && boundPort <= 65535)) return;
            bound = true;
            const url = `http://127.0.0.1:${boundPort}`;
            waitForHardhatNode(url, NODE_STARTUP_BUDGET_MS, () => settled).then(
                () =>
                    settle(() =>
                        resolve({ proc, url, stop, exited, logClosed })
                    ),
                fail
            );
        };
        let bound = false;
        proc.on("exit", onExit);
        proc.on("error", onError);
        proc.stdout.on("data", onData);
        proc.stderr.on("data", onData);
    });
}

/**
 * Resolves with the first match of `pattern` in `child`'s stdout, and rejects
 * when the child exits, errors or stays silent for `timeoutMs`. Once settled the
 * stdout handler is removed and the stream keeps draining: later output goes only
 * to the log pipe, if any, and is never held here.
 */
function waitForStdoutMatch({
    child,
    pattern,
    label,
    timeoutMs,
    stop,
    logStream
}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let buffer = "";
        const settle = (finish) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.stdout.off("data", onData);
            child.off("exit", onExit);
            // keep draining so the child's pipe never fills
            child.stdout.resume();
            finish();
        };
        const timer = setTimeout(
            () =>
                settle(() => {
                    stop();
                    reject(
                        new Error(
                            `${label} did not become ready within ${timeoutMs / 1000}s`
                        )
                    );
                }),
            timeoutMs
        );
        const onData = (chunk) => {
            buffer += chunk.toString();
            const match = pattern.exec(buffer);
            if (match) settle(() => resolve(match));
        };
        const onExit = (code) =>
            settle(() =>
                reject(
                    new Error(`${label} exited with code ${code} before ready`)
                )
            );
        child.stdout.on("data", onData);
        child.on("exit", onExit);
        child.on("error", (err) => {
            logStream?.end();
            settle(() => reject(err));
        });
    });
}

/**
 * Spawns a node script of the test infra with its output piped to `logPath`
 * and waits for the first match of `pattern` in its stdout. Returns `{ child,
 * ready, stop, exited, logClosed }`; `ready` is the regexp match.
 */
async function startInfraProcess({
    args,
    env,
    pattern,
    label,
    timeoutMs,
    logPath
}) {
    const child = spawn(process.execPath, args, {
        cwd: PROJECT_ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"]
    });
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
    // with no log to pipe to, stderr is drained so its pipe never fills
    if (!logStream) child.stderr.resume();
    const stop = () => {
        if (!child.killed) child.kill("SIGTERM");
    };
    const ready = await waitForStdoutMatch({
        child,
        pattern,
        label,
        timeoutMs,
        stop,
        logStream
    });
    return { child, ready, stop, exited, logClosed };
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
    const { ready, ...spawned } = await startInfraProcess({
        args: [...infraNodeFlags(), DISCOVERY_SCRIPT],
        env: {
            ...process.env,
            LOCAL_DISCOVERY_HOST: "127.0.0.1",
            LOCAL_DISCOVERY_PORT: String(discPort)
        },
        pattern: /LocalDiscovery registry listening on (ws:\/\/\S+)/,
        label,
        timeoutMs: 15000,
        logPath
    });
    return { ...spawned, url: ready[1] };
}

/**
 * Spawn the storage diff service following the chain node at `upstreamUrl`
 * (`ws://`), wait for its listening line, and return `{ child, url, stop,
 * exited, logClosed }`. A chain that cannot trace blocks as the service does
 * is refused first.
 */
async function startStorageDiffService({
    upstreamUrl,
    logPath,
    label = "storage diff service",
    retention = 64
} = {}) {
    try {
        await jsonRpc(
            upstreamUrl.replace(/^ws/, "http"),
            "debug_traceBlockByNumber",
            STORAGE_DIFF_TRACE_PROBE
        );
    } catch (error) {
        throw new Error(
            `${label} cannot start: its test chain does not trace blocks with prestateTracer (debug_traceBlockByNumber: ${error.message})`
        );
    }
    const { ready, ...spawned } = await startInfraProcess({
        args: [
            ...infraNodeFlags(),
            STORAGE_DIFF_SCRIPT,
            "--upstream",
            upstreamUrl,
            "--port",
            "0",
            "--retention",
            String(retention)
        ],
        env: process.env,
        pattern: /"event":"listening","url":"(ws:\/\/[^"]+)"/,
        label,
        timeoutMs: 60000,
        logPath
    });
    return { ...spawned, url: ready[1] };
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

/** An infra with nothing started yet: the shape {@link teardownInfra} takes. */
function emptyInfra() {
    return { nodes: [], discoveries: [], services: [] };
}

/** Tear down all nodes + discoveries in `infra`. Idempotent (clears the lists). */
function teardownInfra(infra) {
    // the services follow the nodes: stop them first
    for (const service of infra.services) {
        if (!service.child.killed) {
            console.log(`Tearing down ${service.label}`);
            service.child.kill("SIGTERM");
        }
    }
    infra.services.length = 0;
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
 * deploy-cache dir), all in parallel; `env` reaches each slot's chain. Returns `{ slots, infra }`. Each piece is
 * registered the moment it's ready, and `allSettled` lets every boot finish
 * before we act, so a partial failure tears down cleanly with no orphans.
 */
async function provisionSlots(slotCount, logDir, env = {}) {
    const infra = emptyInfra();
    const infraPath = (name) => path.join(path.resolve(logDir), "infra", name);

    // Don't hand the same just-freed ephemeral port to two concurrent
    // discovery boots.
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

    // The chain binds port 0 itself and reports the port it bound.
    const bootNode = async (id) => {
        console.log(`Starting slot ${id} hardhat node...`);
        const node = await startHardhatNode({
            port: 0,
            logPath: infraPath(`hardhat-node-slot${id}.log`),
            label: `slot ${id} hardhat node`,
            env: { ...env, E2E_INTERVAL_MINING: "1" }
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
    // one service per slot chain, shared by every test process of the slot
    const bootStorageDiff = async (id, node) => {
        console.log(`Starting slot ${id} storage diff service...`);
        const service = await startStorageDiffService({
            upstreamUrl: node.url.replace(/^http/, "ws"),
            logPath: infraPath(`storage-diff-slot${id}.log`),
            label: `slot ${id} storage diff service`
        });
        service.label = `slot ${id} storage diff service`;
        service.slotId = id;
        service.logPath = infraPath(`storage-diff-slot${id}.log`);
        infra.services.push(service);
        return service;
    };
    const provisionSlot = async (id) => {
        const [node, disc] = await Promise.all([
            bootNode(id),
            bootDiscovery(id)
        ]);
        const service = await bootStorageDiff(id, node);
        const cacheDir = infraPath(`manager-cache-slot${id}`);
        resetSlotCacheDir(cacheDir);
        console.log(
            `Slot ${id} ready (node ${node.url}, discovery ${disc.url}, storage diff ${service.url})`
        );
        return {
            id,
            nodeUrl: node.url,
            discoveryUrl: disc.url,
            storageDiffUrl: service.url,
            cacheDir
        };
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
    testChain,
    startDiscoveryRegistry,
    startStorageDiffService,
    jsonRpc,
    resetSlotCacheDir,
    emptyInfra,
    teardownInfra,
    provisionSlots,
    startGasMonitor
};
