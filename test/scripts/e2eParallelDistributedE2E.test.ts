// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import WebSocket from "ws";
import { waitFor } from "../utils/waitFor";
import { LeasePoolHarness } from "../fixtures/distributed/leasePool";
import { TestIsolatedRuntimeBackend } from "../fixtures/distributed/isolatedRuntimeBackend";
import {
    createLocalDhtNetwork,
    createSocketPair,
    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
} from "../fixtures/distributed/testTransport";

const {
    DISTRIBUTED_PROTOCOL_VERSION,
    ProtocolPeer
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    derivePoolKeys,
    authenticateClient,
    authenticateServer
} = require("../../scripts/e2e-parallel/distributed/authentication.js");
const {
    receiveBundle,
    sendBundle
} = require("../../scripts/e2e-parallel/distributed/artifactTransfer.js");
const {
    extractRuntimeBundle
} = require("../../scripts/e2e-parallel/distributed/runtimeExtractor.js");
const {
    createPool
} = require("../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    closeStream,
    connectionHash
} = require("../../scripts/e2e-parallel/distributed/connectionLifecycle.js");
const {
    runDistributed
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const { runTask } = require("../../scripts/e2e-parallel/shared/runTask.js");
const { startDiscoveryRegistry } = require("../utils/nodeInfra.js");

describe("distributed parallel runner", function () {
    it("routes source preparation and worker startup through the assigned environment backend", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        const emptyDigest = crypto.createHash("sha256").digest("hex");
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
            workspaceId: "9".repeat(64),
            sourceDigest: "source",
            rootProjectPath: ".",
            repositories: [],
            files: [
                {
                    path: "identity.txt",
                    bytes: 8,
                    sha256: "8".repeat(64),
                    mode: 420
                }
            ],
            fileCount: 1,
            expandedBytes: 8
        };
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("run-one");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest },
                Buffer.from(JSON.stringify(manifest.files))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...manifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptyDigest
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptyDigest
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            await orchestrator.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1
            });
            await orchestrator.waitFor(worker.name, "WORKER_READY");

            const kinds = backend.frameKinds();
            expect(kinds).to.include.members([
                "WORKSPACE_OFFER",
                "SOURCE_COMPLETE",
                "RUN_CONFIG"
            ]);
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN");
        } finally {
            await pool.close();
        }
    });

    it("records the discovery server lifecycle before closing its log", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "discovery-lifecycle-")
        );
        const logPath = path.join(root, "discovery.ansi");
        const discovery = await startDiscoveryRegistry({ logPath });
        try {
            const client = new WebSocket(discovery.url);
            await new Promise<void>((resolve, reject) => {
                client.once("open", resolve);
                client.once("error", reject);
            });
            client.send(
                JSON.stringify({
                    port: 12345,
                    channelId: "test-channel",
                    peerAddress: "test-peer"
                })
            );
            await new Promise<void>((resolve, reject) => {
                client.once("message", () => resolve());
                client.once("error", reject);
            });
            client.close();
            await new Promise<void>((resolve) => client.once("close", resolve));
            await waitFor(
                () =>
                    fs.existsSync(logPath) &&
                    fs
                        .readFileSync(logPath, "utf8")
                        .includes("connection 1 closed with code"),
                TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
            );
            discovery.stop();
            const exit = await discovery.exited;
            await discovery.logClosed;

            expect(exit).to.deep.equal({ code: 0, signal: null });
            const log = fs.readFileSync(logPath, "utf8");
            expect(log).to.include("LocalDiscovery registry listening on");
            expect(log).to.include("connection 1 opened");
            expect(log).to.include(
                "connection 1 registered test-peer:12345 channel=test-channel"
            );
            expect(log).to.include("connection 1 closed with code");
            expect(log).to.include(
                "LocalDiscovery registry shutting down after SIGTERM"
            );
        } finally {
            discovery.stop();
            await discovery.exited;
            await discovery.logClosed;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("yields a failed outgoing dial so the peer can reverse the connection", async function () {
        const network = await createLocalDhtNetwork();
        const keys = derivePoolKeys(`dial-fallback-${process.pid}`);
        const pools: Array<{ close: () => Promise<void> }> = [];
        const observed: Array<{
            side: "orchestrator" | "worker";
            pool: {
                yieldFailedOutgoingDial: (
                    stream: unknown,
                    info: { client?: boolean },
                    error: Error
                ) => Promise<boolean>;
            };
            stream: { handshakeHash?: Uint8Array };
            info: { client?: boolean };
            hash: string;
        }> = [];
        try {
            const orchestrator = await createPool({
                announceTopics: [keys.orchestratorTopic],
                lookupTopics: [keys.workerTopic],
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(orchestrator);
            orchestrator.onConnection(
                (
                    stream: { handshakeHash?: Uint8Array },
                    info: { client?: boolean }
                ) =>
                    observed.push({
                        side: "orchestrator",
                        pool: orchestrator,
                        stream,
                        info,
                        hash: connectionHash(stream)
                    })
            );

            const worker = await createPool({
                announceTopics: [keys.workerTopic],
                lookupTopics: [keys.orchestratorTopic],
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(worker);
            worker.onConnection(
                (
                    stream: { handshakeHash?: Uint8Array },
                    info: { client?: boolean }
                ) =>
                    observed.push({
                        side: "worker",
                        pool: worker,
                        stream,
                        info,
                        hash: connectionHash(stream)
                    })
            );

            for (
                let attempt = 0;
                attempt < 80 && observed.length < 2;
                attempt++
            ) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            const outgoing = observed.find((entry) => entry.info.client);
            expect(outgoing, "missing initial outgoing connection").not.to.be
                .undefined;
            const firstHash = outgoing!.hash;
            await outgoing!.pool.yieldFailedOutgoingDial(
                outgoing!.stream,
                outgoing!.info,
                new Error("Timed out waiting for AUTH_CHALLENGE")
            );
            closeStream(outgoing!.stream, "simulated authentication timeout");

            let reverse;
            for (let attempt = 0; attempt < 120 && !reverse; attempt++) {
                reverse = observed.find(
                    (entry) =>
                        entry.hash !== firstHash &&
                        entry.info.client &&
                        entry.side !== outgoing!.side
                );
                if (!reverse) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
            }
            expect(reverse, "peer did not establish the reverse connection").not
                .to.be.undefined;
            expect(reverse!.side).not.to.equal(outgoing!.side);
        } finally {
            await Promise.allSettled(pools.map((pool) => pool.close()));
            await network.close();
        }
    });

    it("authenticates when the worker establishes the transport connection", async function () {
        const network = await createLocalDhtNetwork();
        const keys = derivePoolKeys(`reverse-dial-${process.pid}`);
        const pools: Array<{ close: () => Promise<void> }> = [];
        try {
            const orchestrator = await createPool({
                announceTopics: [keys.orchestratorTopic],
                lookupTopics: [],
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(orchestrator);
            let orchestratorWasTransportClient: boolean | undefined;
            const orchestratorAuthenticated = new Promise<void>(
                (resolve, reject) => {
                    orchestrator.onConnection(
                        (stream: unknown, info: { client?: boolean }) => {
                            orchestratorWasTransportClient = info.client;
                            authenticateClient(
                                new ProtocolPeer(stream),
                                keys.authKey,
                                { local: orchestrator.publicKey },
                                TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                            ).then(() => resolve(), reject);
                        }
                    );
                }
            );

            const worker = await createPool({
                announceTopics: [],
                lookupTopics: [keys.orchestratorTopic],
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(worker);
            let workerWasTransportClient: boolean | undefined;
            const workerAuthenticated = new Promise<void>((resolve, reject) => {
                worker.onConnection(
                    (stream: unknown, info: { client?: boolean }) => {
                        workerWasTransportClient = info.client;
                        authenticateServer(
                            new ProtocolPeer(stream),
                            keys.authKey,
                            { local: worker.publicKey },
                            TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                        ).then(() => resolve(), reject);
                    }
                );
            });

            await Promise.all([orchestratorAuthenticated, workerAuthenticated]);
            expect(orchestratorWasTransportClient).to.equal(false);
            expect(workerWasTransportClient).to.equal(true);
        } finally {
            await Promise.allSettled(pools.map((pool) => pool.close()));
            await network.close();
        }
    });

    it("keeps discovering and connects to worker servers that appear later", async function () {
        const network = await createLocalDhtNetwork();
        const topic = crypto.randomBytes(32);
        const pools: Array<{ close: () => Promise<void> }> = [];
        try {
            const firstServer = await createPool({
                topic,
                server: true,
                client: false,
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(firstServer);
            firstServer.onConnection(
                (stream: unknown) => new ProtocolPeer(stream)
            );

            let connectionCount = 0;
            let resolveFirst!: () => void;
            let resolveSecond!: () => void;
            const dialActivity: string[] = [];
            const connectedToFirst = new Promise<void>(
                (resolve) => (resolveFirst = resolve)
            );
            const connectedToBoth = new Promise<void>(
                (resolve) => (resolveSecond = resolve)
            );
            const client = await createPool({
                topic,
                server: false,
                client: true,
                dht: network.createNode(),
                refreshIntervalMs: 25,
                onDialActivity: (line: string) => dialActivity.push(line)
            });
            pools.unshift(client);
            client.onConnection((stream: unknown) => {
                new ProtocolPeer(stream);
                connectionCount++;
                if (connectionCount === 1) resolveFirst();
                if (connectionCount === 2) resolveSecond();
            });
            await connectedToFirst;

            const secondServer = await createPool({
                topic,
                server: true,
                client: false,
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(secondServer);
            secondServer.onConnection(
                (stream: unknown) => new ProtocolPeer(stream)
            );

            await connectedToBoth;
            expect(connectionCount).to.equal(2);
            expect(
                dialActivity.some((line) => line.startsWith("dialing peer"))
            ).to.equal(false);
        } finally {
            await Promise.allSettled(pools.map((pool) => pool.close()));
            await network.close();
        }
    });

    it("cancels while discovering before any worker connects", async function () {
        const network = await createLocalDhtNetwork();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-cancel-")
        );
        try {
            const cancellation = new AbortController();
            const startedAt = Date.now();
            const run = runDistributed({
                tasks: [{ label: "not-run", logName: "not-run" }],
                projectRoot: root,
                archivePath: path.join(root, "unused.tgz"),
                manifest: {},
                logDir: root,
                poolSecret: `cancel-${process.pid}`,
                discoveryTimeoutMs: 5000,
                discoveryRefreshMs: 25,
                signal: cancellation.signal,
                baseEnv: {},
                dht: network.createNode()
            });
            setTimeout(() => cancellation.abort(), 50);
            const result = await run;
            expect(result.completed).to.equal(0);
            expect(Date.now() - startedAt).to.be.lessThan(2000);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            await network.close();
        }
    });

    it("stops reconnecting to an incompatible worker for the rest of the run", async function () {
        const network = await createLocalDhtNetwork();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-incompatible-worker-")
        );
        const poolSecret = `incompatible-worker-${process.pid}`;
        const keys = derivePoolKeys(poolSecret);
        const warnings: string[] = [];
        const originalWarn = console.warn;
        let connections = 0;
        const worker = await createPool({
            announceTopics: [keys.workerTopic],
            lookupTopics: [keys.orchestratorTopic],
            dht: network.createNode(),
            refreshIntervalMs: 25
        });
        try {
            worker.onConnection(
                async (stream: unknown, info: { publicKey?: Buffer }) => {
                    connections++;
                    const peer = new ProtocolPeer(stream);
                    try {
                        await authenticateServer(
                            peer,
                            keys.authKey,
                            {
                                local: worker.publicKey,
                                remote: info.publicKey
                            },
                            TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                        );
                        await peer.send("SERVER_READY", {
                            name: "old-worker",
                            capabilities: {
                                distributedProtocol:
                                    DISTRIBUTED_PROTOCOL_VERSION - 1
                            }
                        });
                    } catch {}
                }
            );
            console.warn = (...data: unknown[]) => {
                warnings.push(data.map(String).join(" "));
            };
            const run = runDistributed({
                tasks: [{ label: "not-run", logName: "not-run" }],
                projectRoot: root,
                archivePath: path.join(root, "unused.tgz"),
                manifest: {},
                logDir: root,
                poolSecret,
                discoveryTimeoutMs: 1000,
                discoveryRefreshMs: 25,
                baseEnv: {},
                dht: network.createNode()
            });
            await waitFor(
                () =>
                    warnings.some((line) =>
                        line.includes("Ignoring worker old-worker")
                    ),
                TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
            );
            const connectionsAfterMismatch = connections;
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(connections).to.equal(connectionsAfterMismatch);

            let failure: Error | null = null;
            try {
                await run;
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.equal(
                "No distributed workers discovered"
            );
            expect(
                warnings.filter((line) =>
                    line.includes("Ignoring worker old-worker")
                )
            ).to.have.length(1);
        } finally {
            console.warn = originalWarn;
            await worker.close();
            fs.rmSync(root, { recursive: true, force: true });
            await network.close();
        }
    });

    it("reports every real worker failure cause after quarantine and protocol loss", async function () {
        const pool = await LeasePoolHarness.create();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-failure-summary-")
        );
        const preparationBackend = new TestIsolatedRuntimeBackend();
        const protocolBackend = new TestIsolatedRuntimeBackend();
        const terminal: string[] = [];
        const dialActivity: string[] = [];
        const originalStderrWrite = process.stderr.write;
        const originalConsoleLog = console.log;
        preparationBackend.preparationFailuresRemaining = 2;
        preparationBackend.preparationFailureDelayMs = 50;
        protocolBackend.preparationDelayMs = 2000;
        fs.writeFileSync(path.join(root, "source.txt"), "source");
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
            workspaceId: "a".repeat(64),
            sourceDigest: crypto
                .createHash("sha256")
                .update("source")
                .digest("hex"),
            rootProjectPath: ".",
            repositories: [],
            files: [
                {
                    path: "source.txt",
                    bytes: 6,
                    sha256: crypto
                        .createHash("sha256")
                        .update("source")
                        .digest("hex"),
                    mode:
                        fs.statSync(path.join(root, "source.txt")).mode & 0o777
                }
            ],
            fileCount: 1,
            expandedBytes: 6
        };
        Object.defineProperty(manifest, "localWorkspaceRoot", {
            value: root,
            enumerable: false
        });
        try {
            const preparationWorker = await pool.startServer(
                "quarantine-worker",
                { environmentBackend: preparationBackend }
            );
            const protocolWorker = await pool.startServer("protocol-worker", {
                environmentBackend: protocolBackend
            });
            process.stderr.write = ((chunk: string | Uint8Array) => {
                terminal.push(Buffer.from(chunk).toString("utf8"));
                return true;
            }) as typeof process.stderr.write;
            console.log = (...data: unknown[]) => {
                const line = data.map(String).join(" ");
                dialActivity.push(line);
                originalConsoleLog(...data);
            };

            const run = runDistributed({
                tasks: [{ label: "not-run", logName: "not-run" }],
                projectRoot: root,
                archivePath: path.join(root, "bundle.tgz"),
                manifest,
                logDir: path.join(root, "logs"),
                poolSecret: pool.poolSecret,
                discoveryTimeoutMs: 3000,
                discoveryRefreshMs: 25,
                baseEnv: {},
                dht: pool.createOrchestratorDht()
            });
            // The quarantine worker's connection lives only for its 50 ms
            // failing preparation, so both workers are active together only
            // in a short window; poll fast enough to observe it.
            await waitFor(
                () =>
                    preparationWorker.manager.active !== null &&
                    protocolWorker.manager.active !== null,
                TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS,
                5
            );
            const malformed = Buffer.alloc(5);
            malformed.writeUInt32BE(1, 0);
            protocolWorker.manager.active?.peer.stream.write(malformed);
            // The worker must go down before the orchestrator's next
            // discovery refresh (25 ms) re-dials it and a clean lease replaces
            // the protocol failure as its last disposition, so poll fast.
            await waitFor(
                () =>
                    dialActivity.some((line) =>
                        line.includes(
                            "protocol error from " +
                                protocolWorker.workerId.slice(0, 12) +
                                ": Malformed frame"
                        )
                    ),
                TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS,
                5
            );
            await pool.stopServer(protocolWorker);

            let failure: Error | null = null;
            try {
                await run;
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include("quarantine-worker");
            expect(failure?.message).to.include("test preparation failed");
            expect(failure?.message).to.include("protocol-worker");
            expect(failure?.message).to.include("Malformed frame");
            const terminalOutput = terminal.join("");
            expect(
                terminalOutput.match(/Quarantined after 2 failure\(s\)/g)
            ).to.have.lengthOf(1);
            expect(terminalOutput).to.include("Infrastructure log:");
            expect(
                dialActivity.some(
                    (line) =>
                        line.includes("worker is quarantined for this run") &&
                        line.includes("test preparation failed")
                )
            ).to.equal(true);
        } finally {
            process.stderr.write = originalStderrWrite;
            console.log = originalConsoleLog;
            await pool.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("kills infrastructure grandchildren after a test process exits", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-group-"));
        let grandchildPid: number | undefined;
        try {
            const result = await runTask(
                process.execPath,
                [
                    "-e",
                    [
                        'const { spawn } = require("child_process");',
                        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
                        "process.stdout.write(String(child.pid), () => process.exit(0));"
                    ].join(" ")
                ],
                {},
                "process-group-cleanup",
                path.join(root, "task.log")
            );
            grandchildPid = Number(result.stdout.trim());
            expect(grandchildPid).to.be.greaterThan(0);

            let alive = true;
            for (let attempt = 0; attempt < 20 && alive; attempt++) {
                try {
                    process.kill(grandchildPid, 0);
                    await new Promise((resolve) => setTimeout(resolve, 25));
                } catch {
                    alive = false;
                }
            }
            expect(alive).to.equal(false);
        } finally {
            if (grandchildPid) {
                try {
                    process.kill(grandchildPid, "SIGKILL");
                } catch {
                    // The process already exited.
                }
            }
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("disables the shared V8 compile cache in test children", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-env-"));
        try {
            const result = await runTask(
                process.execPath,
                [
                    "-e",
                    'process.stdout.write(process.env.DISABLE_V8_COMPILE_CACHE ?? "missing")'
                ],
                { DISABLE_V8_COMPILE_CACHE: "0" },
                "process-environment",
                path.join(root, "task.log")
            );
            expect(result.code).to.equal(0);
            expect(result.stdout).to.equal("1");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("retains the test process termination signal", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-signal-"));
        try {
            const result = await runTask(
                process.execPath,
                ["-e", 'process.kill(process.pid, "SIGTERM")'],
                {},
                "process-signal",
                path.join(root, "task.log")
            );
            expect(result.code).to.equal(1);
            expect(result.signal).to.equal("SIGTERM");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects a wrong-secret client before it can request a lease", async function () {
        const pair = await createSocketPair();
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            let leaseRequested = false;
            server.on("message", (message: { kind: string }) => {
                if (message.kind === "LEASE_REQUEST") leaseRequested = true;
            });
            const clientKeys = derivePoolKeys("wrong secret");
            const serverKeys = derivePoolKeys("right secret");
            const results = await Promise.allSettled([
                authenticateClient(
                    client,
                    clientKeys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                ),
                authenticateServer(
                    server,
                    serverKeys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                )
            ]);
            expect(results[0].status).to.equal("rejected");
            expect(leaseRequested).to.equal(false);
        } finally {
            await pair.close();
        }
    });

    it("rejects source paths not present in the offered manifest", async function () {
        const pair = await createSocketPair();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-request-"));
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const source = path.join(root, "source.ts");
            fs.writeFileSync(source, "source");
            const manifest = {
                version: 3,
                packageManager: "pnpm",
                distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
                workspaceId: "1".repeat(64),
                sourceDigest: "source",
                rootProjectPath: ".",
                runnerEntry: "runner.js",
                repositories: [],
                files: [
                    {
                        path: "source.ts",
                        bytes: 6,
                        sha256: crypto
                            .createHash("sha256")
                            .update("source")
                            .digest("hex"),
                        mode: 420
                    }
                ],
                fileCount: 1,
                expandedBytes: 6
            };
            Object.defineProperty(manifest, "localWorkspaceRoot", {
                value: root
            });
            server.on("message", (message: { kind: string }) => {
                if (message.kind === "WORKSPACE_OFFER") {
                    server.send(
                        "WORKSPACE_NEED",
                        {},
                        Buffer.from(
                            JSON.stringify({
                                changed: ["../outside"],
                                deleted: []
                            })
                        )
                    );
                }
            });

            let error: Error | undefined;
            try {
                await sendBundle(
                    client,
                    path.join(root, "delta.tgz"),
                    manifest
                );
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include("outside the offered manifest");
        } finally {
            await pair.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("isolates concurrent worker delta archives", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-race-"));
        const pairs = await Promise.all([
            createSocketPair(),
            createSocketPair()
        ]);
        const sourceArchive = path.join(root, "source.tgz");
        const sourceContents = "source";
        const sourcePath = path.join(root, "source.ts");
        const limits = {
            maxCompressedBytes: 1024 * 1024,
            maxExpandedBytes: 1024 * 1024
        };
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
            workspaceId: "1".repeat(64),
            sourceDigest: "source",
            rootProjectPath: ".",
            runnerEntry: "runner.js",
            repositories: [],
            files: [
                {
                    path: "source.ts",
                    bytes: Buffer.byteLength(sourceContents),
                    sha256: crypto
                        .createHash("sha256")
                        .update(sourceContents)
                        .digest("hex"),
                    mode: 420
                }
            ],
            fileCount: 1,
            expandedBytes: Buffer.byteLength(sourceContents)
        };
        Object.defineProperty(manifest, "localWorkspaceRoot", { value: root });
        fs.writeFileSync(sourcePath, sourceContents);
        fs.writeFileSync(sourceArchive, "original archive");

        try {
            const sends = pairs.map((pair, index) => {
                const orchestrator = new ProtocolPeer(pair.client);
                const worker = new ProtocolPeer(pair.server);
                const changed = index === 0 ? ["source.ts"] : [];
                worker.on("message", (message: { kind: string }) => {
                    if (message.kind !== "WORKSPACE_OFFER") return;
                    worker
                        .send(
                            "WORKSPACE_NEED",
                            {},
                            Buffer.from(
                                JSON.stringify({ changed, deleted: [] })
                            )
                        )
                        .catch(() => {});
                });
                const receivedArchive = path.join(root, `worker-${index}.tgz`);
                receiveBundle(
                    worker,
                    receivedArchive,
                    limits,
                    async (deltaManifest: { fileCount: number }) => {
                        await extractRuntimeBundle(
                            receivedArchive,
                            path.join(root, `worker-${index}`),
                            { ...manifest, ...deltaManifest },
                            limits,
                            changed.length ? manifest.files : []
                        );
                    }
                );
                return sendBundle(orchestrator, sourceArchive, manifest, 1);
            });

            await Promise.all(sends);
            expect(fs.readFileSync(sourceArchive, "utf8")).to.equal(
                "original archive"
            );
            expect(
                fs.existsSync(path.join(root, "worker-0", "source.ts"))
            ).to.equal(true);
            expect(
                fs.existsSync(path.join(root, "worker-1", "source.ts"))
            ).to.equal(false);
            expect(
                fs
                    .readdirSync(root)
                    .filter((entry) => entry.startsWith("source.tgz."))
            ).to.deep.equal([]);
        } finally {
            await Promise.allSettled(pairs.map((pair) => pair.close()));
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("contains a preparation failure after the orchestrator disconnects", async function () {
        const pair = await createSocketPair();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "closed-preparation-peer-")
        );
        try {
            const orchestrator = new ProtocolPeer(pair.client);
            const worker = new ProtocolPeer(pair.server);
            let resolveFailure!: (error: Error) => void;
            const failure = new Promise<Error>(
                (resolve) => (resolveFailure = resolve)
            );
            receiveBundle(
                worker,
                path.join(root, "runtime.tgz"),
                { maxCompressedBytes: 1024 },
                async () => {
                    const workerClosed = new Promise<void>((resolve) =>
                        worker.once("close", resolve)
                    );
                    orchestrator.close("simulated orchestrator disconnect");
                    await workerClosed;
                    throw new Error("pnpm install failed");
                },
                undefined,
                resolveFailure
            );

            await orchestrator.send("BUNDLE_META", {
                manifest: { archiveBytes: 0 }
            });
            await orchestrator.send("BUNDLE_END", {
                byteCount: 0,
                sha256: crypto.createHash("sha256").digest("hex")
            });

            expect((await failure).message).to.equal("pnpm install failed");
            await new Promise((resolve) => setTimeout(resolve, 25));
        } finally {
            await pair.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
