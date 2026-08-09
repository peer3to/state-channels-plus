import { expect } from "chai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import WebSocket from "ws";
import {
    createLocalDhtNetwork,
    createSocketPair,
    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
} from "../fixtures/distributed/testTransport";

const {
    ProtocolPeer
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    derivePoolKeys,
    authenticateClient,
    authenticateServer
} = require("../../scripts/e2e-parallel/distributed/authentication.js");
const {
    WorkerLeaseManager
} = require("../../scripts/e2e-parallel/distributed/workerLeaseManager.js");
const {
    WorkerAttemptSpool
} = require("../../scripts/e2e-parallel/distributed/workerAttemptSpool.js");
const {
    OrchestratorLogStore
} = require("../../scripts/e2e-parallel/distributed/orchestratorLogStore.js");
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

    it("moves an authenticated attempt log over a real socket and releases the lease", async function () {
        const pair = await createSocketPair();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-wire-")
        );
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const keys = derivePoolKeys(`fixture-${process.pid}`);
            await Promise.all([
                authenticateClient(
                    client,
                    keys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                ),
                authenticateServer(
                    server,
                    keys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                )
            ]);

            const connection = { sessionId: "orchestrator" };
            const leases = new WorkerLeaseManager();
            expect(leases.request(connection).kind).to.equal("LEASE_GRANTED");
            leases.markRunning(connection);

            const received = path.join(root, "attempt.ansi");
            const store = new OrchestratorLogStore(root);
            store.begin("attempt", received);
            let resolveCommitted!: () => void;
            const committed = new Promise<void>(
                (resolve) => (resolveCommitted = resolve)
            );
            server.on(
                "message",
                (message: {
                    kind: string;
                    header: Record<string, unknown>;
                    body: Buffer;
                }) => {
                    if (message.kind === "LOG_CHUNK") {
                        store.append(
                            "attempt",
                            message.header.sequence as number,
                            message.body,
                            message.header.stream
                        );
                    } else if (message.kind === "LOG_END") {
                        store.commit("attempt", message.header);
                        resolveCommitted();
                    }
                }
            );

            const spool = new WorkerAttemptSpool(
                path.join(root, "attempt.spool"),
                1024
            );
            spool.write("stdout", Buffer.from("pass\n"));
            spool.write(
                "stderr",
                Buffer.from("\u001b[31mdiagnostic\u001b[0m\n")
            );
            await spool.send(client, { taskId: "1", attemptId: "1" }, 4);
            await committed;
            expect(fs.readFileSync(received, "utf8")).to.equal(
                "pass\n\u001b[31mdiagnostic\u001b[0m\n"
            );
            await leases.release(connection, async () => spool.remove());
            expect(leases.state).to.equal("idle");
            expect(fs.existsSync(path.join(root, "attempt.spool"))).to.equal(
                false
            );
        } finally {
            await pair.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
