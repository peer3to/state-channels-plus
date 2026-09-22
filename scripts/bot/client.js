const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
    createPool,
    DISCOVERY_REFRESH_MS
} = require("../e2e-parallel/distributed/poolTransport");
const {
    loadOrchestratorKeyPair
} = require("../e2e-parallel/distributed/orchestratorIdentity");
const {
    derivePoolKeys
} = require("../e2e-parallel/distributed/authentication");
const { ReviewConnection } = require("./transport");
const { DEFAULTS } = require("./config");
const { check, writeJson } = require("./data");
const { ReviewError, sanitized, MESSAGES } = require("./errors");
const protocol = require("./protocol");
const { clientSeed } = require("./identity");
async function callService({
    request,
    operation = "request",
    payload,
    stateRoot = path.resolve("temp", "distributed-orchestrator"),
    serverKey,
    secret,
    seed,
    limits = DEFAULTS,
    dht,
    interact,
    onProgress = () => {}
}) {
    protocol.request(request);
    check(serverKey === undefined || /^[a-f0-9]{64}$/.test(serverKey));
    const keys = derivePoolKeys(secret),
        keyPair = loadOrchestratorKeyPair(stateRoot, seed);
    check(keyPair.publicKey.toString("hex") === request.caller, "UNAUTHORIZED");
    const pool = await createPool({
        dht,
        keyPair,
        refreshIntervalMs: DISCOVERY_REFRESH_MS,
        lookupTopics: [keys.reviewTopic],
        announceTopics: [keys.reviewOrchestratorTopic]
    });
    const connections = new Set();
    const requestId = crypto.randomUUID();
    let timer,
        progressTimer,
        activeConnection,
        waiting,
        interacting = false,
        terminal = false,
        lastProgress = 0;
    try {
        return await new Promise((resolve, reject) => {
            const total =
                limits.queueMs +
                limits.setupMs +
                limits.modelMs +
                limits.validationMs +
                limits.transferMs * 2 +
                limits.terminationMs +
                limits.cleanupMs;
            // Publication does no model work. Bound discovery and each journal
            // RPC, not the GitHub work performed between journal calls.
            const armPublicationTimer = () => {
                clearTimeout(timer);
                timer = setTimeout(
                    () => reject(new ReviewError("SERVICE_UNAVAILABLE")),
                    limits.queueMs + limits.setupMs + limits.transferMs * 2
                );
            };
            if (operation === "publication") armPublicationTimer();
            else
                timer = setTimeout(
                    () => reject(new ReviewError("REVIEW_TIMEOUT")),
                    total
                );
            pool.onConnection((stream, info) => {
                // Discovery may queue a connection that closes before this listener is installed.
                if (stream.destroyed) return;
                if (
                    (serverKey &&
                        stream.remotePublicKey.toString("hex") !== serverKey) ||
                    activeConnection
                ) {
                    stream.destroy();
                    return;
                }
                const connection = new ReviewConnection(stream, limits);
                connections.add(connection);
                activeConnection = connection;
                connection.on("close", () => {
                    if (activeConnection === connection) {
                        activeConnection = null;
                        if (!terminal)
                            onProgress(
                                "Review service contact lost; waiting for reconnection."
                            );
                    }
                });
                connection.on("failure", () => {
                    if (activeConnection === connection)
                        activeConnection = null;
                    connection.close();
                });
                connection.on("progress", (progress) => {
                    if (
                        progress.requestId === requestId &&
                        progress.attemptId === request.attempt
                    ) {
                        lastProgress = Date.now();
                        const activity = progress.activity;
                        onProgress(
                            activity
                                ? `Worker connected; ${activity.phase}; ${activity.completedItems} completed items, ${activity.toolCalls} tool calls; last model event ${activity.lastEventAt ? `${Math.max(0, Math.floor((Date.now() - activity.lastEventAt) / 1000))}s ago` : "not observed"}.`
                                : "Worker connected; model progress unavailable."
                        );
                    }
                });
                connection.on("payload", (message) => {
                    const accept = (value) => {
                        if (operation === "publication") clearTimeout(timer);
                        if (!interact) return resolve(value);
                        check(waiting, "INVALID_RESULT");
                        const pending = waiting;
                        waiting = null;
                        pending.resolve(value);
                    };
                    try {
                        check(
                            message.requestId === requestId &&
                                message.attemptId === request.attempt
                        );
                        if (message.operation === "failure") {
                            const failure = protocol.failureResult(
                                message.value,
                                request
                            );
                            const error = new ReviewError(failure.code);
                            error.diagnostics = failure.diagnostics;
                            if (waiting) {
                                waiting.reject(error);
                                waiting = null;
                            } else reject(error);
                        } else if (message.operation === "result")
                            accept(protocol.result(message.value, request));
                        else if (message.operation === "acknowledgement") {
                            check(message.value.accepted === true);
                            accept(message.value);
                        } else check(false);
                    } catch (error) {
                        reject(error);
                    }
                });
                connection
                    .authenticate({
                        server: false,
                        localKey: keyPair.publicKey,
                        remoteKey: stream.remotePublicKey,
                        authKey: keys.authKey
                    })
                    .then(() => {
                        if (interact) {
                            if (operation === "publication" && !waiting)
                                clearTimeout(timer);
                            const send = (value) =>
                                connection.send(
                                    operation,
                                    requestId,
                                    request.attempt,
                                    { request, ...value }
                                );
                            if (interacting)
                                return waiting
                                    ? send(waiting.payload)
                                    : undefined;
                            interacting = true;
                            Promise.resolve()
                                .then(() =>
                                    interact(
                                        (value) =>
                                            new Promise((yes, no) => {
                                                check(
                                                    !waiting,
                                                    "INVALID_REQUEST"
                                                );
                                                waiting = {
                                                    resolve: yes,
                                                    reject: no,
                                                    payload: value
                                                };
                                                if (operation === "publication")
                                                    armPublicationTimer();
                                                if (activeConnection?.ready)
                                                    activeConnection
                                                        .send(
                                                            operation,
                                                            requestId,
                                                            request.attempt,
                                                            {
                                                                request,
                                                                ...value
                                                            }
                                                        )
                                                        .catch(() =>
                                                            activeConnection?.close()
                                                        );
                                            })
                                    )
                                )
                                .then(resolve, reject);
                            return;
                        }
                        return connection.send(
                            operation,
                            requestId,
                            request.attempt,
                            operation === "request"
                                ? request
                                : { request, ...payload }
                        );
                    })
                    .catch((error) => {
                        if (activeConnection === connection)
                            activeConnection = null;
                        connection.close();
                        pool.yieldFailedOutgoingDial(stream, info, error).catch(
                            reject
                        );
                    });
            });
            progressTimer = setInterval(() => {
                if (
                    lastProgress &&
                    Date.now() - lastProgress > limits.progressMs * 2
                ) {
                    lastProgress = 0;
                    onProgress(
                        "Worker contact is no longer verified; model progress is unknown."
                    );
                }
            }, limits.progressMs);
        });
    } finally {
        terminal = true;
        waiting?.reject(new ReviewError("SERVICE_UNAVAILABLE"));
        clearTimeout(timer);
        clearInterval(progressTimer);
        for (const connection of connections) connection.close();
        await pool.close();
    }
}
async function main() {
    const [inputFile, outputFile, operation = "request", extraFile] =
        process.argv.slice(2);
    check(
        inputFile &&
            outputFile &&
            ["request", "correction", "receipt", "acknowledgement"].includes(
                operation
            )
    );
    const request = JSON.parse(await fs.readFile(inputFile, "utf8"));
    protocol.request(request);
    const root = path.dirname(path.resolve(outputFile));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    try {
        const result = await callService({
            request,
            operation,
            payload: extraFile
                ? JSON.parse(await fs.readFile(extraFile, "utf8"))
                : undefined,
            stateRoot: process.env.SCP_REVIEW_CLIENT_STATE,
            secret: process.env.SCP_TEST_POOL_SECRET,
            seed: clientSeed(),
            onProgress: (message) => console.log(message)
        });
        await writeJson(root, path.basename(outputFile), result);
    } catch (error) {
        await writeJson(
            root,
            path.basename(outputFile),
            protocol.failure(sanitized(error), request)
        );
        throw error;
    }
}
if (require.main === module)
    main().catch((error) => {
        console.error(sanitized(error).message);
        process.exitCode = 1;
    });
module.exports = { callService };
