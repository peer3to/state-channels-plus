/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");
const { DEFAULTS, parseServerArgs } = require("./serverArgParser");
const { acquireHostLock } = require("./hostLock");
const { derivePoolKeys, authenticateServer } = require("./authentication");
const { ProtocolPeer } = require("./protocol");
const { createPool, matchesConnectionRole } = require("./poolTransport");
const { WorkerLeaseManager } = require("./workerLeaseManager");
const { LeaseRuntime } = require("./leaseRuntime");
const { receiveBundle } = require("./artifactTransfer");
const { extractRuntimeBundle } = require("./runtimeExtractor");
const { WorkerAttemptSpool } = require("./workerAttemptSpool");
const { prepareWorkspace } = require("./workspacePreparation");
const { buildWorkerEnvironment } = require("./remoteEnvironment");
const {
    inspectWorkspace,
    removeDeletedFiles,
    commitSourceManifest,
    markPrepared
} = require("./workspaceCache");

const BABY_BLUE = "\x1b[38;5;117m";
const RESET = "\x1b[0m";

function isRoutineDiscoveryFailure(error) {
    return /^(Connection closed|Timed out) waiting for AUTH_(HELLO|CHALLENGE|PROOF|OK)$/.test(
        error?.message || ""
    );
}

function logOrchestratorRequest(message) {
    console.log(`${BABY_BLUE}${message}${RESET}`);
}

function sendStatus(connection, status) {
    return connection.peer.send("WORKER_STATUS", { status });
}

function sendToWorker(connection, message) {
    const worker = connection.worker;
    if (!worker?.connected) return;
    worker.send(message, (error) => {
        if (error && error.code !== "ERR_IPC_CHANNEL_CLOSED") {
            console.error(`Worker IPC failed: ${error.message}`);
        }
    });
}

async function main(options = {}) {
    const config = Object.keys(options).length
        ? { ...DEFAULTS, ...options }
        : parseServerArgs(process.argv);
    const keys = derivePoolKeys(process.env.SCP_TEST_POOL_SECRET);
    const hostLock = acquireHostLock(config);
    const connections = new Set();
    const manager = new WorkerLeaseManager({
        queueLength: config.queueLength,
        onGrant(connection) {
            connection.peer.send("LEASE_GRANTED", {
                capabilities: capabilities(config)
            });
        }
    });
    const pool = await createPool({
        topic: keys.topic,
        server: true,
        client: false,
        dht: config.dht
    });
    let shuttingDown = false;

    const shutdown = async (code = 0) => {
        if (shuttingDown) return;
        shuttingDown = true;
        for (const connection of connections) await closeConnection(connection);
        await pool.close();
        hostLock.release();
        process.exitCode = code;
    };

    async function closeConnection(connection) {
        if (connection.closing) return;
        connection.closing = true;
        connections.delete(connection);
        clearInterval(connection.heartbeat);
        if (manager.active === connection) {
            await manager.release(connection, async () =>
                connection.runtime?.cleanup()
            );
        } else manager.remove(connection);
        connection.peer.close();
    }

    pool.onConnection(async (stream, info) => {
        if (!matchesConnectionRole(info, false)) {
            stream.destroy();
            return;
        }
        const peer = new ProtocolPeer(stream);
        const connection = {
            peer,
            sessionId: null,
            runtime: null,
            worker: null,
            lastHeartbeat: Date.now(),
            closing: false
        };
        connections.add(connection);
        try {
            await authenticateServer(
                peer,
                keys.authKey,
                { local: pool.publicKey },
                10000
            );
            await peer.send("SERVER_READY", {
                name: config.name,
                capabilities: capabilities(config)
            });
            console.log("Orchestrator connected and authenticated");
            peer.on("message", (message) => {
                connection.lastHeartbeat = Date.now();
                handleMessage(connection, message);
            });
            connection.heartbeat = setInterval(
                () => {
                    if (
                        Date.now() - connection.lastHeartbeat >
                        config.heartbeatTimeoutMs
                    ) {
                        closeConnection(connection).catch(() => {});
                    } else peer.send("HEARTBEAT").catch(() => {});
                },
                Math.max(250, config.heartbeatTimeoutMs / 3)
            );
            peer.once("close", () =>
                closeConnection(connection).catch(() => {})
            );
        } catch (error) {
            if (!isRoutineDiscoveryFailure(error)) {
                console.error(
                    `Worker connection failed: ${error.stack || error}`
                );
            }
            await peer
                .send("AUTH_ERROR", { message: error.message })
                .catch(() => {});
            peer.close();
        }
    });

    async function handleMessage(connection, message) {
        try {
            if (message.kind === "HEARTBEAT") {
                connection.lastHeartbeat = Date.now();
                return;
            }
            if (message.kind === "LEASE_REQUEST") {
                connection.sessionId = message.header.sessionId;
                const response = manager.request(connection);
                console.log(
                    response.kind === "LEASE_GRANTED"
                        ? `Lease granted to ${connection.sessionId}`
                        : `Lease ${connection.sessionId}: ${response.kind}`
                );
                if (response.kind !== "LEASE_GRANTED") {
                    await connection.peer.send(response.kind, response);
                }
                return;
            }
            manager.assertActive(connection);
            if (message.kind === "WORKSPACE_OFFER") {
                const manifest = {
                    ...message.header.manifest,
                    files: JSON.parse(message.body.toString("utf8"))
                };
                if (
                    manifest.files.length !== manifest.fileCount ||
                    manifest.files.some(
                        (entry) =>
                            typeof entry.path !== "string" ||
                            !/^[a-f0-9]{64}$/.test(entry.sha256)
                    )
                ) {
                    throw new Error("Invalid source file manifest");
                }
                connection.runtime = new LeaseRuntime(config.workRoot);
                connection.workspaceOffer = {
                    manifest,
                    cache: inspectWorkspace(config.workRoot, manifest)
                };
                const { changed, deleted } = connection.workspaceOffer.cache;
                await connection.peer.send(
                    "WORKSPACE_NEED",
                    {},
                    Buffer.from(JSON.stringify({ changed, deleted }))
                );
                console.log(
                    `Workspace diff: ${changed.length} changed, ${deleted.length} deleted`
                );
                await sendStatus(
                    connection,
                    changed.length || deleted.length
                        ? `Syncing ${changed.length} changed and ${deleted.length} deleted source files`
                        : "Source workspace unchanged; reusing cached files"
                );
            } else if (message.kind === "BUNDLE_META") {
                console.log("Receiving source workspace");
                if (!connection.workspaceOffer || !connection.runtime) {
                    throw new Error(
                        "Workspace offer is required before transfer"
                    );
                }
                const archivePath = path.join(
                    connection.runtime.root,
                    "runtime.tgz"
                );
                receiveBundle(
                    connection.peer,
                    archivePath,
                    config,
                    async (deltaManifest) => {
                        const { manifest, cache } = connection.workspaceOffer;
                        console.log(
                            `Source received: ${deltaManifest.fileCount} changed file(s), applying`
                        );
                        await sendStatus(
                            connection,
                            deltaManifest.fileCount
                                ? `Applying ${deltaManifest.fileCount} changed source files`
                                : "Using cached source workspace"
                        );
                        const workspaceRoot = cache.workspace;
                        fs.mkdirSync(workspaceRoot, { recursive: true });
                        removeDeletedFiles(workspaceRoot, cache.deleted);
                        await extractRuntimeBundle(
                            archivePath,
                            workspaceRoot,
                            deltaManifest,
                            config,
                            manifest.files.filter((entry) =>
                                cache.changed.includes(entry.path)
                            )
                        );
                        commitSourceManifest(cache, manifest);
                        console.log(
                            "Source verified; installing and preparing workspace"
                        );
                        const projectRoot = path.join(
                            workspaceRoot,
                            manifest.rootProjectPath
                        );
                        if (!cache.prepared || cache.changed.length) {
                            await prepareWorkspace(workspaceRoot, manifest, {
                                workRoot: config.workRoot,
                                runtime: connection.runtime,
                                env: {},
                                shouldInstall(repository) {
                                    const prefix = `${repository.path}/`;
                                    const dependencyFiles = new Set([
                                        `${prefix}package.json`,
                                        `${prefix}pnpm-lock.yaml`,
                                        `${prefix}yarn.lock`,
                                        `${prefix}package-lock.json`
                                    ]);
                                    return (
                                        cache.preparationChanged ||
                                        !fs.existsSync(
                                            path.join(
                                                workspaceRoot,
                                                repository.path,
                                                "node_modules"
                                            )
                                        ) ||
                                        cache.changed.some((entry) =>
                                            dependencyFiles.has(entry)
                                        )
                                    );
                                },
                                onStage(status) {
                                    sendStatus(connection, status).catch(
                                        () => {}
                                    );
                                },
                                onOutput(stream, data) {
                                    const target =
                                        stream === "stderr"
                                            ? process.stderr
                                            : process.stdout;
                                    target.write(data);
                                    connection.peer
                                        .send("INFRA_LOG", { stream }, data)
                                        .catch(() => {});
                                }
                            });
                            markPrepared(cache, manifest);
                        } else {
                            console.log(
                                "Source and prepared workspace unchanged; skipping install and build"
                            );
                        }
                        manager.markRunning(connection);
                        connection.prepared = {
                            workspaceRoot,
                            projectRoot,
                            manifest
                        };
                        console.log(
                            "Workspace prepared; waiting for run configuration"
                        );
                        await sendStatus(
                            connection,
                            "Workspace prepared; waiting to start tests"
                        );
                    },
                    message,
                    (error) =>
                        console.error(
                            `Workspace preparation failed: ${error.stack || error}`
                        )
                );
            } else if (message.kind === "RUN_CONFIG") {
                if (!connection.prepared || connection.worker) {
                    throw new Error(
                        "RUN_CONFIG is invalid in the current lease state"
                    );
                }
                spawnWorker(
                    connection,
                    connection.prepared.workspaceRoot,
                    connection.prepared.projectRoot,
                    connection.prepared.manifest,
                    message.header
                );
                console.log("Test worker started");
                await sendStatus(connection, "Starting test infrastructure");
            } else if (message.kind === "TASK_ASSIGNMENT") {
                sendToWorker(connection, {
                    kind: "RESPONSE",
                    requestId: message.header.requestId,
                    value: message.header.assignment
                });
            } else if (message.kind === "NO_TASK_AVAILABLE") {
                sendToWorker(connection, {
                    kind: "RESPONSE",
                    requestId: message.header.requestId,
                    value: null
                });
            } else if (message.kind === "WORK_AVAILABLE") {
                sendToWorker(connection, { kind: "WORK_AVAILABLE" });
            } else if (message.kind === "LOG_COMMITTED") {
                sendToWorker(connection, {
                    kind: "RESPONSE",
                    requestId: message.header.requestId,
                    value: true
                });
            } else if (
                message.kind === "RUN_COMPLETE" ||
                message.kind === "CANCEL" ||
                message.kind === "RELEASE"
            ) {
                await sendStatus(connection, "Cleaning completed lease");
                sendToWorker(connection, { kind: message.kind });
                if (message.kind === "RUN_COMPLETE") {
                    const stats = await connection.workerComplete;
                    if (stats) {
                        await connection.peer.send("WORKER_STATS", { stats });
                    }
                }
                await manager.release(connection, async () =>
                    connection.runtime?.cleanup()
                );
                await connection.peer.send("LEASE_CLEAN");
                console.log("Lease cleaned; worker is ready for another run");
            }
        } catch (error) {
            console.error(`Lease failed: ${error.stack || error}`);
            await connection.peer
                .send("WORKER_ERROR", { message: error.message })
                .catch(() => {});
            await closeConnection(connection);
        }
    }

    function spawnWorker(
        connection,
        workspaceRoot,
        projectRoot,
        manifest,
        runConfig
    ) {
        if (
            path.isAbsolute(manifest.runnerEntry) ||
            manifest.runnerEntry.split(/[\\/]+/).includes("..")
        ) {
            throw new Error(
                "Distributed worker entry must be a safe relative path"
            );
        }
        const entry = path.join(workspaceRoot, manifest.runnerEntry);
        if (!fs.existsSync(entry)) {
            throw new Error(`Distributed worker entry is missing: ${entry}`);
        }
        const worker = fork(entry, [], {
            cwd: projectRoot,
            env: buildWorkerEnvironment(process.env),
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            detached: process.platform !== "win32"
        });
        connection.worker = worker;
        connection.workerReady = false;
        connection.workerComplete = new Promise((resolve) => {
            connection.resolveWorkerComplete = resolve;
        });
        connection.runtime.addChild(worker);
        worker.on("error", (error) => {
            if (error.code !== "ERR_IPC_CHANNEL_CLOSED") {
                console.error(`Test worker process failed: ${error.message}`);
            }
        });
        worker.on("exit", (code, signal) => {
            connection.resolveWorkerComplete?.(null);
            connection.worker = null;
            console.log(
                `Test worker exited (${code === null ? signal : `code ${code}`})`
            );
            if (!connection.closing && !connection.workerReady) {
                connection.peer
                    .send("WORKER_ERROR", {
                        message: `Test worker exited before becoming ready (${code === null ? signal : `code ${code}`})`
                    })
                    .catch(() => {});
            }
        });
        worker.stdout.on("data", (data) => {
            process.stdout.write(data);
            connection.peer
                .send("INFRA_LOG", { stream: "stdout" }, data)
                .catch(() => {});
        });
        worker.stderr.on("data", (data) => {
            process.stderr.write(data);
            connection.peer
                .send("INFRA_LOG", { stream: "stderr" }, data)
                .catch(() => {});
        });
        worker.on("message", async (message) => {
            if (message.kind === "WORKER_READY") {
                connection.workerReady = true;
                await sendStatus(connection, "Ready");
                await connection.peer.send("WORKER_READY");
            } else if (message.kind === "TASK_REQUEST") {
                await connection.peer.send("TASK_REQUEST", {
                    requestId: message.requestId
                });
            } else if (message.kind === "ATTEMPT_READY") {
                const spool = WorkerAttemptSpool.openExisting(
                    message.spoolPath
                );
                await spool.send(connection.peer, {
                    taskId: message.assignment.taskId,
                    attemptId: message.assignment.attemptId,
                    requestId: message.requestId
                });
                await connection.peer.send("ATTEMPT_RESULT", {
                    requestId: message.requestId,
                    assignment: message.assignment,
                    result: message.result
                });
            } else if (message.kind === "WORKER_ERROR") {
                logOrchestratorRequest(
                    "Reporting worker failure to orchestrator"
                );
                await connection.peer.send("WORKER_ERROR", {
                    message: message.message
                });
            } else if (message.kind === "WORKER_COMPLETE") {
                connection.resolveWorkerComplete?.(message.stats);
                worker.send({ kind: "WORKER_COMPLETE_ACK" });
            }
        });
        worker.send({
            kind: "START",
            config: {
                projectRoot,
                infraLogDir: path.join(connection.runtime.root, "infra"),
                spoolRoot: path.join(connection.runtime.root, "spool"),
                slotCount: config.slots,
                concurrencyCap: config.workers,
                schedulerTickMs: config.schedulerTickMs,
                targetLoad: config.targetLoad,
                memBoundGb: config.memLimitGb,
                maxAttemptSpoolBytes: config.maxAttemptSpoolBytes,
                taskCount: runConfig.taskCount,
                baseEnv: runConfig.baseEnv || {}
            }
        });
    }

    process.on("SIGINT", () => shutdown(130));
    process.on("SIGTERM", () => shutdown(143));
    console.log(
        `Worker ${config.name} ready on topic ${keys.topic.toString("hex").slice(0, 12)} ` +
            `(peer ${pool.publicKey.toString("hex").slice(0, 12)})`
    );
    return { pool, manager, shutdown };
}

function capabilities(config) {
    return {
        distributedProtocol: 7,
        slots: config.slots,
        workers: config.workers,
        memoryGb: config.memLimitGb,
        heartbeatTimeoutMs: config.heartbeatTimeoutMs
    };
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { main, capabilities, isRoutineDiscoveryFailure };
