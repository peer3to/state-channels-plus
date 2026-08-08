/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");
const { DEFAULTS, parseServerArgs } = require("./serverArgParser");
const { acquireHostLock } = require("./hostLock");
const {
    DISCOVERY_AUTH_TIMEOUT_MS,
    derivePoolKeys,
    authenticateServer,
    isDiscoveryAuthenticationFailure
} = require("./authentication");
const { DISTRIBUTED_PROTOCOL_VERSION, ProtocolPeer } = require("./protocol");
const { DISCOVERY_REFRESH_MS, createPool } = require("./poolTransport");
const {
    closeStream,
    connectionHash,
    selectLowerHash,
    shortConnectionHash
} = require("./connectionLifecycle");
const { WorkerLeaseManager } = require("./workerLeaseManager");
const { LeaseRuntime } = require("./leaseRuntime");
const { receiveBundle } = require("./artifactTransfer");
const { extractRuntimeBundle } = require("./runtimeExtractor");
const { WorkerAttemptSpool } = require("./workerAttemptSpool");
const {
    prepareWorkspace,
    selectPrepareScript
} = require("./workspacePreparation");
const { buildWorkerEnvironment } = require("./remoteEnvironment");
const { loadWorkerKeyPair } = require("./workerIdentity");
const {
    inspectWorkspace,
    removeDeletedFiles,
    commitSourceManifest,
    markPrepared
} = require("./workspaceCache");

const BABY_BLUE = "\x1b[38;5;117m";
const RESET = "\x1b[0m";
const SHUTDOWN_TIMEOUT_MS = 5000;
const INFRA_PROCESS_LOG_CHUNK_BYTES = 512 * 1024;

function isRoutineDiscoveryFailure(error) {
    return isDiscoveryAuthenticationFailure(error);
}

function progressElapsedMs(connection, now = Date.now()) {
    const startedAt =
        connection.runStartedAt || connection.leaseStartedAt || now;
    return Math.max(0, now - startedAt);
}

function shouldTransferAttemptLog(result) {
    return result.code !== 0 || Boolean(result.infrastructureFailure);
}

function logOrchestratorRequest(message) {
    console.log(`${BABY_BLUE}${message}${RESET}`);
}

function sendStatusMessage(connection, status) {
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

function acknowledgeLoglessAttempt(connection, requestId, logTransferred) {
    if (logTransferred) return;
    sendToWorker(connection, {
        kind: "RESPONSE",
        requestId,
        value: true
    });
}

async function main(options = {}) {
    const config = Object.keys(options).length
        ? { ...DEFAULTS, ...options }
        : parseServerArgs(process.argv);
    const keys = derivePoolKeys(process.env.SCP_TEST_POOL_SECRET);
    const hostLock = acquireHostLock(config);
    const connections = new Set();
    const connectionsByPeerId = new Map();
    const manager = new WorkerLeaseManager({
        queueLength: config.queueLength,
        onGrant(connection) {
            connection.peer
                .send("LEASE_GRANTED", {
                    capabilities: capabilities(config)
                })
                .catch(() => {});
        },
        onQueueStatus(connection, status) {
            const { kind, ...header } = status;
            connection.peer.send(kind, header).catch(() => {});
        },
        onFault(error) {
            console.error(
                `Worker lease cleanup failed: ${error.stack || error}`
            );
            console.log(
                "Cleanup was incomplete; worker remains available with a fresh lease directory"
            );
        }
    });
    console.log(`Starting worker ${config.name}; announcing availability`);
    const pool = await createPool({
        announceTopics: [keys.workerTopic],
        lookupTopics: [keys.orchestratorTopic],
        dht: config.dht,
        keyPair: loadWorkerKeyPair(config.workRoot, config.name),
        refreshIntervalMs: DISCOVERY_REFRESH_MS,
        onDialActivity: (line) => console.log(`[dial] ${line}`)
    });
    let shuttingDown = false;
    let removeSignalHandlers = () => {};

    function reportStatus(connection, status) {
        if (manager.active === connection) {
            manager.updateStatus(connection, status);
        }
        return sendStatusMessage(connection, status);
    }

    const shutdown = async (code = 0) => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            await Promise.allSettled(
                [...connections].map((connection) =>
                    closeConnection(connection, "worker server shutting down")
                )
            );
            await pool.close();
        } finally {
            hostLock.release();
            removeSignalHandlers();
            process.exitCode = code;
        }
    };

    async function closeConnection(
        connection,
        reason = "connection cleanup after remote or transport close"
    ) {
        if (connection.closing) return;
        connection.closing = true;
        connections.delete(connection);
        if (connectionsByPeerId.get(connection.peerId) === connection) {
            connectionsByPeerId.delete(connection.peerId);
        }
        clearInterval(connection.heartbeat);
        if (manager.active === connection) {
            await manager.release(connection, async () =>
                connection.runtime?.cleanup()
            );
            console.log("Lease ended; worker is ready for another run");
        } else manager.remove(connection);
        connection.peer.close(reason);
    }

    pool.onConnection(async (stream, info) => {
        if (shuttingDown) {
            closeStream(stream, "worker server is shutting down");
            return;
        }
        const peerId = info?.publicKey?.toString("hex");
        const peer = new ProtocolPeer(stream);
        peer.on("protocolError", (error) =>
            console.log(
                `[dial] protocol error from ${peerId ? peerId.slice(0, 12) : "unknown"}: ${error.message}`
            )
        );
        const connection = {
            peer,
            peerId,
            sessionId: null,
            runtime: null,
            worker: null,
            lastHeartbeat: Date.now(),
            connectionHash: connectionHash(stream),
            authenticated: false,
            closing: false
        };
        connections.add(connection);
        try {
            await authenticateServer(
                peer,
                keys.authKey,
                { local: pool.publicKey },
                DISCOVERY_AUTH_TIMEOUT_MS
            );
            connection.authenticated = true;
            const existing = peerId ? connectionsByPeerId.get(peerId) : null;
            if (existing) {
                const winner = selectLowerHash(existing, connection);
                const loser = winner === existing ? connection : existing;
                console.log(
                    `[dedup] authenticated duplicate from ${peerId.slice(0, 12)}: ` +
                        `keeping lower stream ${shortConnectionHash(winner.connectionHash)}, ` +
                        `closing ${shortConnectionHash(loser.connectionHash)}`
                );
                if (winner === existing) {
                    await closeConnection(
                        connection,
                        `protocol deduplication kept lower authenticated stream ${shortConnectionHash(existing.connectionHash)}`
                    );
                    return;
                }
                connectionsByPeerId.set(peerId, connection);
                await closeConnection(
                    existing,
                    `protocol deduplication selected lower authenticated stream ${shortConnectionHash(connection.connectionHash)}`
                );
            } else if (peerId) {
                connectionsByPeerId.set(peerId, connection);
            }
            if (shuttingDown) {
                await closeConnection(
                    connection,
                    "worker server shut down after authentication"
                );
                return;
            }
            await peer.send("SERVER_READY", {
                name: config.name,
                capabilities: capabilities(config)
            });
            console.log("Orchestrator connected and authenticated");
            peer.on("message", (message) => {
                connection.lastHeartbeat = Date.now();
                handleMessage(connection, message).catch((error) =>
                    console.error(
                        `Lease message cleanup failed: ${error.stack || error}`
                    )
                );
            });
            connection.heartbeat = setInterval(
                () => {
                    if (
                        Date.now() - connection.lastHeartbeat >
                        config.heartbeatTimeoutMs
                    ) {
                        closeConnection(
                            connection,
                            `worker heartbeat timed out after ${config.heartbeatTimeoutMs}ms`
                        ).catch(() => {});
                    } else peer.send("HEARTBEAT").catch(() => {});
                },
                Math.max(250, config.heartbeatTimeoutMs / 3)
            );
            peer.once("close", () =>
                closeConnection(connection).catch(() => {})
            );
        } catch (error) {
            await pool.yieldFailedOutgoingDial(stream, info, error);
            if (!isRoutineDiscoveryFailure(error)) {
                console.error(
                    `Worker connection failed: ${error.stack || error}`
                );
            }
            await peer
                .send("AUTH_ERROR", { message: error.message })
                .catch(() => {});
            await closeConnection(
                connection,
                `authentication or connection setup failed: ${error.message}`
            );
        }
    });

    async function handleMessage(connection, message) {
        try {
            if (shuttingDown) {
                await closeConnection(connection);
                return;
            }
            if (message.kind === "HEARTBEAT") {
                connection.lastHeartbeat = Date.now();
                return;
            }
            if (message.kind === "LEASE_REQUEST") {
                connection.sessionId = message.header.sessionId;
                const response = manager.request(connection);
                if (response.kind === "LEASE_GRANTED") {
                    connection.leaseStartedAt = Date.now();
                }
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
                    cache: await inspectWorkspace(config.workRoot, manifest)
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
                await reportStatus(
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
                        await reportStatus(
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
                                selectPrepareScript: (repository) =>
                                    selectPrepareScript(repository, cache),
                                onStage(status) {
                                    reportStatus(connection, status).catch(
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
                        await reportStatus(
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
                if (shuttingDown) {
                    await closeConnection(connection);
                    return;
                }
                spawnWorker(
                    connection,
                    connection.prepared.workspaceRoot,
                    connection.prepared.projectRoot,
                    connection.prepared.manifest,
                    message.header
                );
                connection.runStartedAt = Date.now();
                manager.updateProgress(connection, {
                    completedTasks: 0,
                    totalTasks: message.header.taskCount,
                    elapsedMs: 0
                });
                console.log("Test worker started");
                await reportStatus(connection, "Starting test infrastructure");
            } else if (message.kind === "RUN_PROGRESS") {
                manager.updateProgress(connection, {
                    completedTasks: message.header.completedTasks,
                    totalTasks: message.header.totalTasks,
                    elapsedMs: progressElapsedMs(connection)
                });
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
                // A stop can reach a test worker that is still booting (the
                // run finished on other workers first); its clean exit must
                // not be reported as a startup failure.
                connection.stopRequested = true;
                await reportStatus(connection, "Cleaning completed lease");
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
                .send(
                    connection.worker ? "WORKER_ERROR" : "PREPARATION_ERROR",
                    {
                        message: error.message
                    }
                )
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
        connection.stopRequested = false;
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
            if (
                !connection.closing &&
                !connection.stopRequested &&
                !connection.workerReady
            ) {
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
        worker.on("message", (message) => {
            handleWorkerMessage(message).catch((error) => {
                if (connection.closing) return;
                console.error(
                    `Test worker message failed: ${error.stack || error}`
                );
                connection.peer
                    .send("WORKER_ERROR", { message: error.message })
                    .catch(() => {});
                closeConnection(connection).catch(() => {});
            });
        });

        async function handleWorkerMessage(message) {
            if (message.kind === "WORKER_READY") {
                connection.workerReady = true;
                await reportStatus(connection, "Ready");
                await connection.peer.send("WORKER_READY");
            } else if (message.kind === "TASK_REQUEST") {
                await connection.peer.send("TASK_REQUEST", {
                    requestId: message.requestId
                });
            } else if (message.kind === "ATTEMPT_READY") {
                const logTransferred = shouldTransferAttemptLog(message.result);
                if (logTransferred) {
                    const spool = WorkerAttemptSpool.openExisting(
                        message.spoolPath
                    );
                    await spool.send(connection.peer, {
                        taskId: message.assignment.taskId,
                        attemptId: message.assignment.attemptId,
                        requestId: message.requestId
                    });
                }
                await connection.peer.send("ATTEMPT_RESULT", {
                    requestId: message.requestId,
                    assignment: message.assignment,
                    result: message.result,
                    logTransferred
                });
                acknowledgeLoglessAttempt(
                    connection,
                    message.requestId,
                    logTransferred
                );
            } else if (message.kind === "INFRA_PROCESS_DIAGNOSTIC") {
                const log = Buffer.from(message.log);
                const chunkCount = Math.max(
                    1,
                    Math.ceil(log.length / INFRA_PROCESS_LOG_CHUNK_BYTES)
                );
                for (let sequence = 0; sequence < chunkCount; sequence++) {
                    const offset = sequence * INFRA_PROCESS_LOG_CHUNK_BYTES;
                    await connection.peer.send(
                        "INFRA_PROCESS_LOG",
                        {
                            processKind: message.processKind,
                            slotId: message.slotId,
                            trigger: message.trigger,
                            processFailure: message.processFailure,
                            uploadId: message.uploadId,
                            sequence,
                            chunkCount
                        },
                        log.subarray(
                            offset,
                            Math.min(
                                log.length,
                                offset + INFRA_PROCESS_LOG_CHUNK_BYTES
                            )
                        )
                    );
                }
                sendToWorker(connection, {
                    kind: "RESPONSE",
                    requestId: message.requestId,
                    value: true
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
        }
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
                heartbeatTimeoutMs: config.heartbeatTimeoutMs,
                taskCount: runConfig.taskCount,
                baseEnv: runConfig.baseEnv || {}
            }
        });
    }

    const handleSignal = (code) => {
        if (shuttingDown) process.exit(code);
        const forcedExit = setTimeout(
            () => process.exit(code),
            SHUTDOWN_TIMEOUT_MS
        );
        forcedExit.unref();
        shutdown(code).then(
            () => process.exit(code),
            (error) => {
                console.error(error.stack || error);
                process.exit(code);
            }
        );
    };
    const onSigint = () => handleSignal(130);
    const onSigterm = () => handleSignal(143);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    removeSignalHandlers = () => {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
    };
    console.log(
        `Worker ${config.name} ready on topic ${keys.workerTopic.toString("hex").slice(0, 12)} ` +
            `(peer ${pool.publicKey.toString("hex").slice(0, 12)})`
    );
    return { pool, manager, shutdown };
}

function capabilities(config) {
    return {
        distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
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

module.exports = {
    acknowledgeLoglessAttempt,
    main,
    capabilities,
    isRoutineDiscoveryFailure,
    progressElapsedMs,
    shouldTransferAttemptLog
};
