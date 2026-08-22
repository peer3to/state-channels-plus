/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const path = require("path");
const {
    DISCOVERY_AUTH_TIMEOUT_MS,
    authenticateClient,
    derivePoolKeys
} = require("./authentication");
const { createPool, DISCOVERY_REFRESH_MS } = require("./poolTransport");
const { ProtocolPeer, waitForMessage } = require("./protocol");
const { loadOrchestratorKeyPair } = require("./orchestratorIdentity");
const { assertPublicKey, validateNote } = require("./authorizationStore");

const COMMANDS = new Set([
    "workers",
    "authorization-list",
    "authorization-add",
    "authorization-remove",
    "authorization-policy-set"
]);

function usage() {
    return `Usage: yarn distributed:admin <command> [options]

Commands:
  workers                          Discover authorized workers and print their identities
  authorization-list              List authorization entries on one worker
  authorization-add               Add an orchestrator or admin key
  authorization-remove            Remove an orchestrator or admin key
  authorization-policy-set        Require or relax public-key authorization

Options:
  --worker PUBLIC_KEY              Target one worker (default: all discovered workers)
  --public-key PUBLIC_KEY          Key to add or remove
  --role orchestrator|admin        Role to add (default: orchestrator)
  --note TEXT                      Bounded operator note for an added key
  --require-public-key on|off      Policy value for authorization-policy-set
  --state-dir PATH                 Persistent orchestrator identity directory
  --discovery-timeout MS           Discovery deadline (default: 30000)
  -h, --help                       Show this help`;
}

function parseAdminArgs(argv) {
    const command = argv[2];
    if (!command || command === "--help" || command === "-h") {
        return { help: true };
    }
    if (!COMMANDS.has(command)) {
        throw new Error(`Unknown distributed admin command: ${command}`);
    }
    const options = {
        command,
        stateDir: path.resolve("temp", "distributed-orchestrator"),
        discoveryTimeoutMs: 30000,
        role: "orchestrator",
        note: ""
    };
    const valueFlags = new Map([
        ["--worker", "worker"],
        ["--public-key", "publicKey"],
        ["--role", "role"],
        ["--note", "note"],
        ["--require-public-key", "publicKeyAuthorizationRequired"],
        ["--state-dir", "stateDir"],
        ["--discovery-timeout", "discoveryTimeoutMs"]
    ]);
    for (let index = 3; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") {
            return { help: true };
        }
        const [flag, inline] = argument.split(/=(.*)/s);
        const key = valueFlags.get(flag);
        if (!key) throw new Error(`Unknown distributed admin option: ${flag}`);
        const value = inline === undefined ? argv[++index] : inline;
        if (!value || value.startsWith("--")) {
            throw new Error(`${flag} requires a value`);
        }
        options[key] = value;
    }
    options.stateDir = path.resolve(options.stateDir);
    options.discoveryTimeoutMs = Number(options.discoveryTimeoutMs);
    if (
        !Number.isInteger(options.discoveryTimeoutMs) ||
        options.discoveryTimeoutMs <= 0
    ) {
        throw new Error("--discovery-timeout requires a positive integer");
    }
    if (options.command.startsWith("authorization-") && options.worker) {
        options.worker = assertPublicKey(options.worker);
    }
    if (
        options.command === "authorization-add" ||
        options.command === "authorization-remove"
    ) {
        options.publicKey = assertPublicKey(options.publicKey);
    }
    if (options.command === "authorization-add") {
        if (!new Set(["orchestrator", "admin"]).has(options.role)) {
            throw new Error("--role must be orchestrator or admin");
        }
        options.note = validateNote(options.note);
    } else if (options.role !== "orchestrator" || options.note) {
        throw new Error(
            "--role and --note are valid only for authorization-add"
        );
    }
    if (options.command === "authorization-policy-set") {
        const values = new Map([
            ["on", true],
            ["true", true],
            ["off", false],
            ["false", false]
        ]);
        if (!values.has(options.publicKeyAuthorizationRequired)) {
            throw new Error("--require-public-key must be on or off");
        }
        options.publicKeyAuthorizationRequired = values.get(
            options.publicKeyAuthorizationRequired
        );
    } else if (options.publicKeyAuthorizationRequired !== undefined) {
        throw new Error(
            "--require-public-key is valid only for authorization-policy-set"
        );
    }
    return options;
}

function authorizationRequest(options, workerId) {
    const requestId = crypto.randomUUID();
    if (options.command === "authorization-list") {
        return {
            kind: "AUTHORIZATION_LIST",
            header: { targetWorker: workerId, requestId }
        };
    }
    if (options.command === "authorization-add") {
        const header = {
            targetWorker: workerId,
            requestId,
            publicKey: options.publicKey,
            note: options.note
        };
        if (options.role === "admin") header.role = "admin";
        return {
            kind: "AUTHORIZATION_ADD",
            header
        };
    }
    if (options.command === "authorization-policy-set") {
        return {
            kind: "AUTHORIZATION_POLICY_SET",
            header: {
                targetWorker: workerId,
                requestId,
                publicKeyAuthorizationRequired:
                    options.publicKeyAuthorizationRequired
            }
        };
    }
    return {
        kind: "AUTHORIZATION_REMOVE",
        header: {
            targetWorker: workerId,
            requestId,
            publicKey: options.publicKey
        }
    };
}

async function runAdmin(options, dependencies = {}) {
    const keyPair =
        options.keyPair || loadOrchestratorKeyPair(options.stateDir);
    const poolSecret = options.poolSecret || process.env.SCP_TEST_POOL_SECRET;
    const keys = derivePoolKeys(poolSecret);
    const pool = await createPool({
        announceTopics: [keys.orchestratorTopic],
        lookupTopics: [keys.workerTopic],
        dht: dependencies.dht,
        keyPair,
        refreshIntervalMs: DISCOVERY_REFRESH_MS
    });
    const workers = new Map();
    const outcomes = new Map();
    let discoveryEnded = false;
    let activeBulkConnections = 0;
    let settled = false;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
    const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) rejectResult(error);
        else resolveResult(value);
    };
    const finishBulkAuthorization = () => {
        if (
            !discoveryEnded ||
            activeBulkConnections ||
            !options.command.startsWith("authorization-") ||
            options.worker
        ) {
            return;
        }
        if (outcomes.size) {
            finish(null, { results: [...outcomes.values()] });
        } else {
            finish(
                new Error(
                    "No authorized workers were discovered before the timeout"
                )
            );
        }
    };
    const timer = setTimeout(() => {
        discoveryEnded = true;
        if (options.command === "workers" && workers.size) {
            finish(null, { workers: [...workers.values()] });
            return;
        }
        if (options.command.startsWith("authorization-") && !options.worker) {
            finishBulkAuthorization();
            return;
        }
        finish(
            new Error(
                options.worker
                    ? `Worker ${options.worker} was not reachable before the discovery timeout`
                    : "No authorized workers were discovered before the timeout"
            )
        );
    }, options.discoveryTimeoutMs);

    pool.onConnection(async (stream, info) => {
        const workerId = info?.publicKey?.toString("hex");
        const peer = new ProtocolPeer(stream);
        if (discoveryEnded) {
            peer.close("distributed admin discovery window ended");
            return;
        }
        if (!workerId || (options.worker && workerId !== options.worker)) {
            peer.close("distributed admin is targeting another worker");
            return;
        }
        if (workers.has(workerId)) {
            peer.close("distributed admin already connected to this worker");
            return;
        }
        const bulkAuthorization =
            options.command.startsWith("authorization-") && !options.worker;
        if (bulkAuthorization) activeBulkConnections++;
        try {
            await authenticateClient(
                peer,
                keys.authKey,
                { local: pool.publicKey, remote: info.publicKey },
                DISCOVERY_AUTH_TIMEOUT_MS
            );
            const ready = await waitForMessage(
                peer,
                "SERVER_READY",
                DISCOVERY_AUTH_TIMEOUT_MS
            );
            const worker = {
                name: ready.header.name,
                publicKey: workerId,
                authorizationPolicy:
                    ready.header.capabilities.authorizationPolicy,
                capabilities: ready.header.capabilities
            };
            workers.set(workerId, worker);
            peer.on("message", (message) => {
                if (message.kind === "HEARTBEAT") {
                    peer.send("HEARTBEAT").catch(() => {});
                }
            });
            if (options.command === "workers") return;
            if (
                !ready.header.capabilities.extensions
                    ?.authorizationAdministration
            ) {
                throw new Error(
                    `Worker ${ready.header.name} does not support authorization administration`
                );
            }
            if (
                options.command === "authorization-add" &&
                options.role === "admin" &&
                !ready.header.capabilities.extensions
                    ?.authorizationRoleManagement
            ) {
                throw new Error(
                    `Worker ${ready.header.name} does not support admin-role changes`
                );
            }
            if (
                options.command === "authorization-policy-set" &&
                !ready.header.capabilities.extensions
                    ?.authorizationPolicyManagement
            ) {
                throw new Error(
                    `Worker ${ready.header.name} does not support authorization policy management`
                );
            }
            const request = authorizationRequest(options, workerId);
            const responsePromise = waitForMessage(
                peer,
                "AUTHORIZATION_RESULT",
                options.discoveryTimeoutMs
            );
            await peer.send(request.kind, request.header);
            const response = await responsePromise;
            if (response.header.requestId !== request.header.requestId) {
                throw new Error("Worker returned an unrelated admin response");
            }
            if (!response.header.accepted) {
                throw new Error(response.header.message);
            }
            const outcome = {
                worker: { name: worker.name, publicKey: worker.publicKey },
                accepted: true,
                entries: response.header.entries
            };
            if (response.header.authorizationPolicy) {
                outcome.authorizationPolicy =
                    response.header.authorizationPolicy;
            }
            outcomes.set(workerId, outcome);
            if (options.worker) finish(null, outcome);
            else peer.close("distributed admin operation completed");
        } catch (error) {
            await pool.yieldFailedOutgoingDial(stream, info, error);
            if (options.worker === workerId) finish(error);
            else if (!options.worker && workerId) {
                outcomes.set(workerId, {
                    worker: {
                        name: workers.get(workerId)?.name,
                        publicKey: workerId
                    },
                    accepted: false,
                    message: error.message,
                    entries: []
                });
            }
            peer.close(`distributed admin failed: ${error.message}`);
        } finally {
            if (bulkAuthorization) {
                activeBulkConnections--;
                finishBulkAuthorization();
            }
        }
    });

    try {
        return await result;
    } finally {
        clearTimeout(timer);
        await pool.close();
    }
}

async function main(argv = process.argv) {
    const options = parseAdminArgs(argv);
    if (options.help) {
        console.log(usage());
        return;
    }
    const result = await runAdmin(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.results?.some((entry) => !entry.accepted)) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    authorizationRequest,
    main,
    parseAdminArgs,
    runAdmin,
    usage
};
