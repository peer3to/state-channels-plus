/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const path = require("path");
const os = require("os");
const { DEFAULTS, parseServerArgs } = require("./serverArgParser");
const { acquireHostLock } = require("./hostLock");
const { acquireWorkspaceLock } = require("./workspaceLock");
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
const { loadWorkerKeyPair } = require("./workerIdentity");
const { EnvironmentCache, deriveEnvironmentKey } = require("./workspaceCache");
const { IsolatedEnvironmentManager } = require("./isolatedEnvironment");
const {
    profileSummary,
    resolveExecutionProfile
} = require("./executionProfile");
const { AuthorizationStore, fingerprint } = require("./authorizationStore");
const { WorkerAuditLog } = require("./auditLog");
const { shouldTransferAttemptEvidence } = require("./artifactSelection");
const { BoundedArtifactAssembler } = require("./failureArtifacts");

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

function requireTransportPublicKey(info) {
    const peerId = info?.publicKey?.toString("hex");
    if (!/^[a-f0-9]{64}$/.test(peerId || "")) {
        throw new Error("Authenticated transport key is required");
    }
    return peerId;
}

function sendStatusMessage(connection, status) {
    return connection.peer.send("WORKER_STATUS", { status });
}

function sendToWorker(connection, message) {
    if (!connection.environment || connection.environment.state !== "ready") {
        return;
    }
    connection.environment
        .send("WORKER_MESSAGE", { message })
        .catch((error) =>
            console.error(`Environment control failed: ${error.message}`)
        );
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
    const programmaticOptions = Object.keys(options).length > 0;
    const config = programmaticOptions
        ? { ...DEFAULTS, ...options }
        : parseServerArgs(process.argv);
    const authorizationPolicyProvided = programmaticOptions
        ? Object.prototype.hasOwnProperty.call(
              options,
              "allowUnlistedOrchestrators"
          )
        : config.authorizationPolicyProvided;
    if (
        config.allowSharedHost &&
        !config.workRootProvided &&
        path.resolve(config.workRoot) === path.resolve(DEFAULTS.workRoot)
    ) {
        throw new Error("allowSharedHost requires an explicit unique workRoot");
    }
    const allocatableCpu = Math.max(
        0.01,
        os.cpus().length - config.supervisorCpuReserve
    );
    const allocatableMemoryBytes = Math.max(
        1,
        os.totalmem() - config.supervisorMemoryReserveBytes
    );
    if (config.cpuLimit > allocatableCpu) {
        throw new Error(
            `Worker CPU limit ${config.cpuLimit} leaves less than the configured supervisor reserve`
        );
    }
    if (config.memLimitGb * 1024 ** 3 > allocatableMemoryBytes) {
        throw new Error(
            `Worker memory limit ${config.memLimitGb}GB leaves less than the configured supervisor reserve`
        );
    }
    const keys = derivePoolKeys(process.env.SCP_TEST_POOL_SECRET);
    const hostLock = acquireHostLock(config);
    const authorization = new AuthorizationStore(config.workRoot, {
        authorizedPublicKeys: config.authorizedPublicKeys,
        adminPublicKeys: config.adminPublicKeys,
        allowUnlistedOrchestrators: config.allowUnlistedOrchestrators
    });
    if (authorizationPolicyProvided) {
        authorization.setPublicKeyAuthorizationRequired(
            !config.allowUnlistedOrchestrators
        );
    }
    const audit = new WorkerAuditLog(config.workRoot);
    const environmentCache = new EnvironmentCache(config.workRoot, config);
    const environmentManager = await IsolatedEnvironmentManager.create({
        workRoot: config.workRoot,
        runnerImage: config.runnerImage,
        executionBackend: config.executionBackend,
        backend: config.environmentBackend,
        backendName: config.environmentBackendName,
        deniedPrivateCidrs: config.deniedPrivateCidrs,
        volumeDriver: config.volumeDriver,
        trustedRoot: path.resolve(__dirname, "../../..")
    });
    audit.append({
        action: "cache-configuration",
        accepted: true,
        backend: environmentManager.capabilities().backend,
        cacheBudgets: {
            maxCachedEnvironments: environmentCache.maxCachedEnvironments,
            maxCacheDiskBytes: environmentCache.maxCacheDiskBytes,
            maxEnvironmentDiskBytes: environmentCache.maxEnvironmentDiskBytes
        },
        workerGeneration: environmentManager.generation
    });
    environmentCache.onEvict = async (entry) => {
        await environmentManager.evict(entry.environmentKey);
        audit.append({
            action: "cache-eviction",
            accepted: true,
            environmentKey: entry.environmentKey,
            resource: "diskBytes",
            reason: `measured-or-reserved-bytes:${entry.bytes}`
        });
    };
    await environmentManager.recoverOrphans();
    const connections = new Set();
    const connectionsByPeerId = new Map();
    const manager = new WorkerLeaseManager({
        queueLength: config.queueLength,
        onGrant(connection) {
            connection.peer
                .send("LEASE_GRANTED", {
                    capabilities: capabilities(
                        config,
                        environmentManager,
                        authorization
                    )
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
            console.error(
                "Worker is disabled until its administrator restarts this server"
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

    function executionProfiles() {
        const memoryBytes = Math.max(
            1,
            Math.floor(config.memLimitGb * 1024 ** 3)
        );
        const defaults = {
            schedulerTickMs: config.schedulerTickMs,
            workers: config.workers,
            slots: config.slots,
            cpu: config.cpuLimit,
            memoryBytes,
            diskBytes: config.diskLimitBytes,
            pidsLimit: config.pidsLimit,
            targetLoad: config.targetLoad
        };
        return { defaults, ceilings: { ...defaults } };
    }

    function createWorkspaceRuntime(connection, environmentKey, manifest) {
        let reserved = false;
        let lock = null;
        let environment = null;
        let listeners = null;
        let setupFailure = null;
        let cleanupRequested = false;
        let cleaned = false;
        const runtime = {
            listeners: null,
            setup: null,
            async cleanup() {
                if (cleaned) return;
                cleaned = true;
                cleanupRequested = true;
                await runtime.setup.catch(() => {});
                if (listeners && environment) {
                    environment.off("frame", listeners.frame);
                    environment.off("failure", listeners.failure);
                    environment.off("resourceLimit", listeners.resourceLimit);
                }
                if (reserved) environmentCache.beginStop(environmentKey);
                let detached = false;
                let destroyed = false;
                try {
                    if (environment) {
                        if (
                            setupFailure ||
                            connection.environmentFailed ||
                            environment.state === "created" ||
                            environment.state === "failed"
                        ) {
                            await environment.destroy();
                            destroyed = true;
                        } else {
                            await environment.stop();
                            environmentManager.markClean(environment);
                        }
                    }
                    detached = true;
                } catch (error) {
                    environmentManager.block(environmentKey, error);
                    audit.append({
                        action: "environment-failure",
                        accepted: false,
                        callerFingerprint: fingerprint(connection.peerId),
                        environmentKey,
                        failureCode: "DETACH_UNCONFIRMED"
                    });
                } finally {
                    lock?.release();
                    if (reserved) environmentCache.release(environmentKey);
                }
                if (destroyed && detached && reserved) {
                    environmentCache.invalidate(environmentKey);
                }
            }
        };
        runtime.setup = (async () => {
            const reservation = await environmentCache.reserve(
                environmentKey,
                connection.executionProfile.diskBytes
            );
            reserved = true;
            audit.append({
                action: "environment-allocation",
                accepted: true,
                callerFingerprint: fingerprint(connection.peerId),
                environmentKey,
                backend: environmentManager.capabilities().backend,
                cacheBytes: reservation.measuredBytes,
                resolvedProfile: profileSummary(connection.executionProfile),
                reason: reservation.evicted.length
                    ? `evicted:${reservation.evicted.join(",")}`
                    : "within-cache-budget"
            });
            if (cleanupRequested) return null;
            lock = acquireWorkspaceLock(config.workRoot, environmentKey);
            if (cleanupRequested) return null;
            environment = await environmentManager.allocate({
                environmentKey,
                orchestratorPublicKey: connection.peerId,
                profile: connection.executionProfile
            });
            connection.environment = environment;
            connection.environmentKey = environmentKey;
            const onEnvironmentFrame = (frame) =>
                handleEnvironmentFrame(connection, frame).catch((error) =>
                    handleEnvironmentFailure(connection, error)
                );
            const onEnvironmentFailure = (error) =>
                handleEnvironmentFailure(connection, error);
            const onResourceLimit = (failure) =>
                handleEnvironmentFrame(connection, {
                    kind: "RESOURCE_LIMIT_EXCEEDED",
                    payload: failure,
                    body: Buffer.alloc(0)
                }).catch((error) =>
                    handleEnvironmentFailure(connection, error)
                );
            listeners = {
                frame: onEnvironmentFrame,
                failure: onEnvironmentFailure,
                resourceLimit: onResourceLimit
            };
            runtime.listeners = listeners;
            environment.on("frame", onEnvironmentFrame);
            environment.on("failure", onEnvironmentFailure);
            environment.on("resourceLimit", onResourceLimit);
            if (cleanupRequested) return null;
            await environment.start();
            if (cleanupRequested) return null;
            environmentManager.writeMetadata(environment, true);
            await environment.send("ENVIRONMENT_SETUP", {
                environmentKey,
                orchestratorPublicKey: connection.peerId,
                profile: profileSummary(connection.executionProfile),
                limits: {
                    maxCompressedBytes: config.maxCompressedBytes,
                    maxExpandedBytes: config.maxExpandedBytes,
                    maxAttemptSpoolBytes: config.maxAttemptSpoolBytes
                }
            });
            if (cleanupRequested) return null;
            const needed = environment.waitFor("WORKSPACE_NEED", 30000);
            await environment.send("WORKSPACE_OFFER", { manifest });
            const need = (await needed).payload;
            if (cleanupRequested) return null;
            return need;
        })().catch((error) => {
            setupFailure = error;
            throw error;
        });
        return runtime;
    }

    async function handleAuthorizationAdmin(connection, message) {
        const requestId = message.header.requestId;
        const targetWorker = message.header.targetWorker;
        let accepted = false;
        let decisionReason = "accepted";
        let response;
        try {
            if (targetWorker !== pool.publicKey.toString("hex")) {
                throw new Error("Authorization request targets another worker");
            }
            if (connection.authorizationRole !== "admin") {
                throw new Error("Admin authorization is required");
            }
            if (message.kind === "AUTHORIZATION_LIST") {
                response = { entries: authorization.list() };
            } else if (message.kind === "AUTHORIZATION_ADD") {
                response = authorization.add(
                    message.header.publicKey,
                    message.header.note || "",
                    message.header.role || "orchestrator"
                );
            } else if (message.kind === "AUTHORIZATION_REMOVE") {
                response = authorization.remove(message.header.publicKey);
            } else {
                response = {
                    authorizationPolicy:
                        authorization.setPublicKeyAuthorizationRequired(
                            message.header.publicKeyAuthorizationRequired
                        )
                };
            }
            accepted = true;
            await connection.peer.send("AUTHORIZATION_RESULT", {
                requestId,
                accepted,
                message: "ok",
                entries:
                    response.entries ||
                    (response.authorizationPolicy ? [] : [response]),
                authorizationPolicy: response.authorizationPolicy
            });
        } catch (error) {
            decisionReason = error.message;
            await connection.peer.send("AUTHORIZATION_RESULT", {
                requestId,
                accepted,
                message: error.message,
                entries: []
            });
        }
        audit.append({
            action: message.kind,
            accepted,
            callerFingerprint: fingerprint(connection.peerId),
            targetWorker,
            targetFingerprint: /^[a-f0-9]{64}$/.test(
                message.header.publicKey || ""
            )
                ? fingerprint(message.header.publicKey)
                : undefined,
            targetRole:
                message.kind === "AUTHORIZATION_ADD"
                    ? message.header.role || "orchestrator"
                    : undefined,
            authorizationPolicy:
                message.kind === "AUTHORIZATION_POLICY_SET"
                    ? authorization.policy()
                    : undefined,
            reason: decisionReason
        });
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

    async function releaseLease(connection) {
        if (connection.releasePromise) return connection.releasePromise;
        if (manager.active !== connection && !connection.runtime) return true;
        connection.releasePromise = (async () => {
            const result = await manager.release(connection, async () =>
                connection.runtime?.cleanup()
            );
            connection.runtime = null;
            connection.environment = null;
            connection.environmentKey = null;
            connection.workspaceOffer = null;
            connection.sourceTransfer = null;
            connection.artifactTransfers = null;
            connection.prepared = false;
            connection.workerStarted = false;
            connection.workerReady = false;
            connection.workerComplete = null;
            connection.resolveWorkerComplete = null;
            connection.environmentFailed = false;
            connection.environmentFailureReported = false;
            if (!result.faulted) return true;
            await connection.peer
                .send("FAULTED", { message: result.message })
                .catch(() => {});
            return false;
        })();
        try {
            return await connection.releasePromise;
        } finally {
            connection.releasePromise = null;
        }
    }

    async function closeConnection(
        connection,
        reason = "connection cleanup after remote or transport close"
    ) {
        if (connection.closing) return;
        connection.closing = true;
        connection.stopRequested = true;
        connections.delete(connection);
        if (connection.authenticated) {
            audit.append({
                action: "disconnect",
                accepted: true,
                callerFingerprint: fingerprint(connection.peerId),
                sessionId: connection.sessionId
            });
        }
        if (connectionsByPeerId.get(connection.peerId) === connection) {
            connectionsByPeerId.delete(connection.peerId);
        }
        clearInterval(connection.heartbeat);
        if (manager.active === connection) {
            manager.updateStatus(connection, "Cleaning disconnected lease");
            const reusable = await releaseLease(connection);
            console.log(
                reusable
                    ? "Lease ended; worker is ready for another run"
                    : "Lease ended; worker is faulted and requires administrator restart"
            );
        } else manager.remove(connection);
        connection.peer.close(reason);
    }

    pool.onConnection(async (stream, info) => {
        if (shuttingDown) {
            closeStream(stream, "worker server is shutting down");
            return;
        }
        let peerId;
        try {
            peerId = requireTransportPublicKey(info);
        } catch (error) {
            closeStream(stream, error.message);
            return;
        }
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
            const authentication = await authenticateServer(
                peer,
                keys.authKey,
                { local: pool.publicKey, remote: info?.publicKey },
                DISCOVERY_AUTH_TIMEOUT_MS
            );
            const authenticatedKey =
                authentication.remotePublicKey.toString("hex");
            const admission = authorization.authorize(authenticatedKey);
            audit.append({
                action: "connection",
                accepted: admission.accepted,
                authorizationMode: admission.mode,
                callerFingerprint: fingerprint(authenticatedKey),
                unlistedTransportKey:
                    admission.mode === "shared-secret-migration"
                        ? authenticatedKey
                        : undefined,
                connectionId: shortConnectionHash(connection.connectionHash)
            });
            if (!admission.accepted) {
                throw new Error("Orchestrator transport key is not authorized");
            }
            connection.peerId = authenticatedKey;
            connection.authorizationRole = admission.role;
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
                capabilities: capabilities(
                    config,
                    environmentManager,
                    authorization
                )
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
            if (connection.closing) return;
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
                connection.allocationDetailsNegotiated = Boolean(
                    message.header.executionProfile ||
                        message.header.extensions?.resourceAllocationDetails
                );
                const { defaults, ceilings } = executionProfiles();
                try {
                    connection.requestedProfile =
                        message.header.executionProfile || {};
                    connection.executionProfile = resolveExecutionProfile(
                        defaults,
                        ceilings,
                        connection.requestedProfile
                    );
                } catch (error) {
                    if (error.code !== "RESOURCE_ALLOCATION_REJECTED") {
                        throw error;
                    }
                    audit.append({
                        action: "lease-request",
                        accepted: false,
                        callerFingerprint: fingerprint(connection.peerId),
                        sessionId: connection.sessionId,
                        failureCode: error.code,
                        resource: error.resource,
                        requestedProfile: connection.requestedProfile
                    });
                    await connection.peer.send(
                        connection.allocationDetailsNegotiated
                            ? "RESOURCE_ALLOCATION_REJECTED"
                            : "PREPARATION_ERROR",
                        connection.allocationDetailsNegotiated
                            ? {
                                  resource: error.resource,
                                  requested: error.requested,
                                  permitted: error.permitted,
                                  message: error.message
                              }
                            : { message: "Worker resource allocation refused" }
                    );
                    return;
                }
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
                audit.append({
                    action: "lease-request",
                    accepted: response.kind === "LEASE_GRANTED",
                    callerFingerprint: fingerprint(connection.peerId),
                    sessionId: connection.sessionId,
                    requestedProfile: connection.requestedProfile,
                    resolvedProfile: profileSummary(
                        connection.executionProfile
                    ),
                    reason: response.kind
                });
                return;
            }
            if (
                message.kind === "AUTHORIZATION_LIST" ||
                message.kind === "AUTHORIZATION_ADD" ||
                message.kind === "AUTHORIZATION_REMOVE" ||
                message.kind === "AUTHORIZATION_POLICY_SET"
            ) {
                await handleAuthorizationAdmin(connection, message);
                return;
            }
            if (
                (message.kind === "RUN_COMPLETE" ||
                    message.kind === "CANCEL" ||
                    message.kind === "RELEASE") &&
                manager.active !== connection
            ) {
                return;
            }
            manager.assertActive(connection);
            if (message.kind === "WORKSPACE_OFFER") {
                if (connection.runtime) {
                    throw new Error(
                        "Workspace offer is invalid after preparation has started"
                    );
                }
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
                const environmentKey = deriveEnvironmentKey(
                    connection.peerId,
                    manifest.workspaceId
                );
                connection.environmentKey = environmentKey;
                const runtime = createWorkspaceRuntime(
                    connection,
                    environmentKey,
                    manifest
                );
                connection.runtime = runtime;
                const need = await runtime.setup;
                if (connection.closing || !need) return;
                connection.workspaceOffer = { manifest, need };
                const { changed, deleted } = need;
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
                if (!connection.workspaceOffer || !connection.environment) {
                    throw new Error(
                        "Workspace offer is required before transfer"
                    );
                }
                connection.sourceTransfer = {
                    manifest: message.header.manifest,
                    sequence: 0,
                    bytes: 0
                };
                await connection.environment.send("SOURCE_BEGIN", {
                    manifest: message.header.manifest
                });
            } else if (message.kind === "BUNDLE_CHUNK") {
                const transfer = connection.sourceTransfer;
                if (
                    !transfer ||
                    message.header.sequence !== transfer.sequence++
                ) {
                    throw new Error("Out-of-order source chunk");
                }
                transfer.bytes += message.body.length;
                if (transfer.bytes > config.maxCompressedBytes) {
                    throw new Error("Compressed bundle limit exceeded");
                }
                await connection.environment.send(
                    "SOURCE_CHUNK",
                    {
                        sequence: message.header.sequence
                    },
                    message.body
                );
            } else if (message.kind === "BUNDLE_END") {
                const transfer = connection.sourceTransfer;
                if (!transfer || transfer.bytes !== message.header.byteCount) {
                    throw new Error("Invalid source transfer completion");
                }
                const prepared = connection.environment.waitForActivity(
                    "PREPARED",
                    config.preparationInactivityTimeoutMs
                );
                await connection.environment.send("SOURCE_COMPLETE", {
                    byteCount: message.header.byteCount,
                    sha256: message.header.sha256
                });
                await prepared;
                if (connection.closing) return;
                connection.sourceTransfer = null;
                connection.prepared = true;
                manager.markRunning(connection);
                await connection.peer.send("PREPARED");
                await reportStatus(
                    connection,
                    "Workspace prepared; waiting to start tests"
                );
            } else if (message.kind === "RUN_CONFIG") {
                if (!connection.prepared || connection.workerStarted) {
                    throw new Error(
                        "RUN_CONFIG is invalid in the current lease state"
                    );
                }
                if (shuttingDown) {
                    await closeConnection(connection);
                    return;
                }
                connection.resourceDetailsNegotiated = Boolean(
                    message.header.extensions?.resourceLimitDetails
                );
                connection.runtimeMetadataNegotiated = Boolean(
                    message.header.extensions?.isolatedRuntimeMetadata
                );
                audit.append({
                    action: "task-execution-request",
                    accepted: true,
                    callerFingerprint: fingerprint(connection.peerId),
                    sessionId: connection.sessionId,
                    environmentKey: connection.environmentKey,
                    resolvedProfile: profileSummary(connection.executionProfile)
                });
                connection.workerStarted = true;
                connection.workerComplete = new Promise((resolve) => {
                    connection.resolveWorkerComplete = resolve;
                });
                const profile = connection.executionProfile;
                await connection.environment.send("RUN_CONFIG", {
                    config: {
                        slotCount: profile.slots,
                        concurrencyCap: profile.workers,
                        schedulerTickMs: profile.schedulerTickMs,
                        targetLoad: profile.targetLoad,
                        memBoundGb: profile.memoryBytes / 1024 ** 3,
                        maxAttemptSpoolBytes: config.maxAttemptSpoolBytes,
                        heartbeatTimeoutMs: config.heartbeatTimeoutMs,
                        keepInfraLogs: message.header.keepInfraLogs === true,
                        taskCount: message.header.taskCount,
                        baseEnv: message.header.baseEnv || {}
                    }
                });
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
                if (connection.workerStarted) {
                    sendToWorker(connection, { kind: message.kind });
                }
                if (
                    message.kind === "RUN_COMPLETE" &&
                    connection.workerStarted
                ) {
                    const stats = await connection.workerComplete;
                    if (stats) {
                        await connection.peer.send("WORKER_STATS", { stats });
                    }
                }
                const reusable = await releaseLease(connection);
                audit.append({
                    action: "lease-outcome",
                    accepted: reusable,
                    callerFingerprint: fingerprint(connection.peerId),
                    sessionId: connection.sessionId,
                    reason: reusable ? "clean" : "faulted"
                });
                if (reusable) {
                    await connection.peer.send("LEASE_CLEAN");
                    console.log(
                        "Lease cleaned; worker is ready for another run"
                    );
                }
            }
        } catch (error) {
            console.error(`Lease failed: ${error.stack || error}`);
            if (error.code === "RESOURCE_ALLOCATION_REJECTED") {
                audit.append({
                    action: "environment-allocation",
                    accepted: false,
                    callerFingerprint: fingerprint(connection.peerId),
                    environmentKey: connection.environmentKey,
                    failureCode: error.code,
                    resource: error.resource,
                    requestedProfile: connection.executionProfile
                        ? profileSummary(connection.executionProfile)
                        : undefined,
                    reason: error.message
                });
                await connection.peer
                    .send(
                        connection.allocationDetailsNegotiated
                            ? "RESOURCE_ALLOCATION_REJECTED"
                            : "PREPARATION_ERROR",
                        connection.allocationDetailsNegotiated
                            ? {
                                  resource: error.resource,
                                  requested: error.requested,
                                  permitted: error.permitted,
                                  message: error.message
                              }
                            : { message: "Worker resource allocation refused" }
                    )
                    .catch(() => {});
                await releaseLease(connection);
                return;
            }
            if (error.code === "RECOVERABLE_PREPARATION_FAILURE") {
                audit.append({
                    action: "environment-failure",
                    accepted: false,
                    callerFingerprint: fingerprint(connection.peerId),
                    environmentKey: connection.environmentKey,
                    failureCode: "PREPARATION_ERROR",
                    reason: "recoverable-preparation-command-failure"
                });
                await connection.peer
                    .send("PREPARATION_ERROR", { message: error.message })
                    .catch(() => {});
                await releaseLease(connection);
                return;
            }
            if (error.code === "ISOLATED_INACTIVITY_TIMEOUT") {
                connection.environmentFailed = true;
                await connection.peer
                    .send("PREPARATION_ERROR", { message: error.message })
                    .catch(() => {});
                await releaseLease(connection);
                return;
            }
            if (connection.environment) connection.environmentFailed = true;
            const failureKind = connection.workerStarted
                ? "WORKER_ERROR"
                : "PREPARATION_ERROR";
            audit.append({
                action: "environment-failure",
                accepted: false,
                callerFingerprint: fingerprint(connection.peerId),
                environmentKey: connection.environmentKey,
                failureCode: failureKind,
                reason: error.message
            });
            let failureReported = true;
            await connection.peer
                .send(failureKind, { message: error.message })
                .catch(() => {
                    failureReported = false;
                });
            await releaseLease(connection);
            if (!failureReported) {
                await closeConnection(
                    connection,
                    "failed to report lease failure"
                );
            }
        }
    }

    async function transferAttemptArtifacts(connection, message, manifest) {
        const assembler = new BoundedArtifactAssembler(
            manifest,
            config.maxAttemptSpoolBytes,
            config.maxAttemptSpoolBytes
        );
        const transfer = {
            requestId: message.requestId,
            assignment: message.assignment,
            assembler
        };
        connection.artifactTransfers ??= new Map();
        if (connection.artifactTransfers.has(message.requestId)) {
            throw new Error("Attempt artifact transfer is already active");
        }
        connection.artifactTransfers.set(message.requestId, transfer);
        transfer.complete = new Promise((resolve) => {
            transfer.resolve = resolve;
        });
        const artifactBytes = manifest.reduce(
            (total, entry) => total + entry.bytes,
            0
        );
        const timeoutMs = Math.max(
            config.artifactTransferTimeoutMs,
            Math.ceil(artifactBytes / (64 * 1024)) * 1000
        );
        let timeout;
        let onFailure;
        const failed = new Promise((_, reject) => {
            onFailure = reject;
            connection.environment.once("failure", onFailure);
        });
        const timedOut = new Promise((_, reject) => {
            timeout = setTimeout(
                () =>
                    reject(
                        new Error(
                            `Attempt artifact transfer timed out after ${timeoutMs}ms`
                        )
                    ),
                timeoutMs
            );
        });
        try {
            await connection.environment.send("ARTIFACT_REQUEST", {
                requestId: message.requestId,
                names: manifest.map((entry) => entry.name),
                chunkBytes: 64 * 1024
            });
            await Promise.race([transfer.complete, failed, timedOut]);
            const completed = assembler.complete();
            await connection.peer.send("LOG_END", {
                taskId: message.assignment.taskId,
                attemptId: message.assignment.attemptId,
                requestId: message.requestId,
                sequence: completed.sequence,
                byteCount: completed.byteCount,
                sha256: completed.sha256
            });
        } finally {
            clearTimeout(timeout);
            connection.environment.off("failure", onFailure);
            connection.artifactTransfers.delete(message.requestId);
        }
    }

    async function handleWorkerMessage(
        connection,
        message,
        artifactManifest = []
    ) {
        if (message.kind === "WORKER_READY") {
            connection.workerReady = true;
            await reportStatus(connection, "Ready");
            await connection.peer.send("WORKER_READY");
        } else if (message.kind === "TASK_REQUEST") {
            await connection.peer.send("TASK_REQUEST", {
                requestId: message.requestId
            });
        } else if (message.kind === "ATTEMPT_READY") {
            const logTransferred = shouldTransferAttemptEvidence(
                message.result
            );
            if (logTransferred) {
                await transferAttemptArtifacts(
                    connection,
                    message,
                    artifactManifest
                );
            }
            await connection.peer.send("ATTEMPT_RESULT", {
                requestId: message.requestId,
                assignment: message.assignment,
                result: message.result,
                logTransferred,
                isolatedRuntime: connection.runtimeMetadataNegotiated
                    ? environmentManager.capabilities()
                    : undefined
            });
            await connection.environment.send("ARTIFACT_COMMITTED", {
                requestId: message.requestId
            });
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
        } else if (message.kind === "INFRA_LOG") {
            await connection.peer.send(
                "INFRA_LOG",
                { stream: message.stream },
                message.body || Buffer.alloc(0)
            );
        } else if (message.kind === "WORKER_ERROR") {
            if (message.stats) {
                await connection.peer.send("WORKER_STATS", {
                    stats: message.stats
                });
            }
            await connection.peer.send("WORKER_ERROR", {
                message: message.message
            });
        } else if (message.kind === "WORKER_COMPLETE") {
            connection.resolveWorkerComplete?.(message.stats);
            sendToWorker(connection, { kind: "WORKER_COMPLETE_ACK" });
        } else if (message.kind === "ISOLATED_WORKER_EXIT") {
            connection.resolveWorkerComplete?.(null);
            if (connection.closing || connection.stopRequested) return;
            if (!connection.workerReady) {
                const error = new Error(
                    `Test worker exited before becoming ready (${message.code ?? message.signal})`
                );
                error.code = "ISOLATED_WORKER_EXIT";
                await handleEnvironmentFailure(connection, error);
                return;
            }
            const classification = await connection.environment?.classifyExit();
            if (classification) {
                if (!connection.environment.claimResourceFailureReport()) {
                    return;
                }
                await handleResourceLimit(connection, classification);
                return;
            }
            const error = new Error(
                `Test worker exited unexpectedly (${message.code ?? message.signal})`
            );
            error.code = "ISOLATED_WORKER_EXIT";
            await handleEnvironmentFailure(connection, error);
        }
    }

    async function handleResourceLimit(connection, failure) {
        audit.append({
            action: "environment-failure",
            accepted: false,
            callerFingerprint: fingerprint(connection.peerId),
            environmentKey: connection.environmentKey,
            failureCode: "RESOURCE_LIMIT_EXCEEDED",
            resource: failure.resource
        });
        if (connection.resourceDetailsNegotiated) {
            await connection.peer.send("RESOURCE_LIMIT_EXCEEDED", failure);
        } else {
            await connection.peer.send("WORKER_ERROR", {
                message: `Isolated worker exceeded its ${failure.resource} limit`
            });
        }
        connection.environmentFailed = true;
        await releaseLease(connection);
    }

    async function handleEnvironmentFrame(connection, frame) {
        if (connection.closing) return;
        if (frame.kind === "STATUS") {
            await reportStatus(connection, frame.payload.status);
        } else if (frame.kind === "WORKER_EVENT") {
            await handleWorkerMessage(
                connection,
                {
                    ...frame.payload.message,
                    body: frame.body
                },
                frame.payload.artifactManifest || []
            );
        } else if (frame.kind === "ARTIFACT_CHUNK") {
            const transfer = connection.artifactTransfers?.get(
                frame.payload.requestId
            );
            if (
                !transfer ||
                transfer.requestId !== frame.payload.requestId ||
                frame.payload.sequence !== transfer.assembler.sequence
            ) {
                throw new Error(
                    `Out-of-order guest artifact chunk for request ${frame.payload.requestId}: ` +
                        `received ${frame.payload.sequence}, expected ${transfer?.assembler.sequence ?? "no active transfer"}`
                );
            }
            transfer.assembler.accept(
                frame.payload.name,
                frame.payload.sequence,
                frame.body
            );
            await connection.peer.send(
                "LOG_CHUNK",
                {
                    taskId: transfer.assignment.taskId,
                    attemptId: transfer.assignment.attemptId,
                    requestId: transfer.requestId,
                    stream: frame.payload.name,
                    sequence: frame.payload.sequence
                },
                frame.body
            );
        } else if (frame.kind === "ARTIFACT_COMPLETE") {
            connection.artifactTransfers
                ?.get(frame.payload.requestId)
                ?.resolve();
        } else if (frame.kind === "RESOURCE_LIMIT_EXCEEDED") {
            await handleResourceLimit(connection, frame.payload);
        } else if (frame.kind === "PREPARATION_FAILED") {
            // The active preparation waiter turns this into a recoverable lease
            // failure while preserving the stopped identity cache.
        } else if (frame.kind === "ERROR") {
            throw new Error(frame.payload.message);
        }
    }

    async function handleEnvironmentFailure(connection, error) {
        if (connection.closing || connection.environmentFailureReported) return;
        connection.environmentFailureReported = true;
        audit.append({
            action: "environment-failure",
            accepted: false,
            callerFingerprint: fingerprint(connection.peerId),
            environmentKey: connection.environmentKey,
            failureCode: "WORKER_ERROR",
            reason: "isolated-environment-failure"
        });
        const diagnostics = await connection.environment
            ?.diagnostics()
            .catch(() => "Isolated environment diagnostics are unavailable");
        if (diagnostics) {
            await connection.peer
                .send(
                    "INFRA_PROCESS_LOG",
                    {
                        processKind: "isolated-runtime",
                        trigger: "isolated environment failed",
                        processFailure: error.message,
                        uploadId: `isolated-${Date.now()}`,
                        sequence: 0,
                        chunkCount: 1
                    },
                    Buffer.from(diagnostics).subarray(0, 64 * 1024)
                )
                .catch(() => {});
        }
        const unexpectedRuntimeFailure = new Set([
            "ISOLATED_CONTROL_PROTOCOL",
            "ISOLATED_ENVIRONMENT_EXIT"
        ]).has(error.code);
        await connection.peer
            .send(
                connection.workerStarted || unexpectedRuntimeFailure
                    ? "WORKER_ERROR"
                    : "PREPARATION_ERROR",
                {
                    message:
                        "Isolated environment failed; see infrastructure log"
                }
            )
            .catch(() => {});
        connection.environmentFailed = true;
        await releaseLease(connection);
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
    return { pool, manager, environmentManager, shutdown };
}

function capabilities(config, environmentManager, authorization) {
    const runtime = environmentManager?.capabilities() || {
        backend: "unresolved",
        isolation: null
    };
    return {
        distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
        slots: config.slots,
        workers: config.workers,
        memoryGb: config.memLimitGb,
        heartbeatTimeoutMs: config.heartbeatTimeoutMs,
        isolatedRuntime: runtime,
        authorizationPolicy: authorization?.policy() || {
            publicKeyAuthorizationRequired: !config.allowUnlistedOrchestrators
        },
        extensions: {
            executionProfile: true,
            resourceAllocationDetails: true,
            resourceLimitDetails: true,
            isolatedRuntimeMetadata: true,
            authorizationAdministration: true,
            authorizationRoleManagement: true,
            authorizationPolicyManagement: true
        }
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
    requireTransportPublicKey,
    shouldTransferAttemptEvidence
};
