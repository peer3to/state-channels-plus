/* eslint-disable no-console */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");
const {
    EnvironmentFrameParser,
    HOST_KINDS,
    encodeEnvironmentFrame
} = require("./environmentProtocol");
const {
    assertCompatible,
    extractRuntimeBundle
} = require("./runtimeExtractor");
const {
    commitSourceManifest,
    inspectWorkspace,
    markPrepared,
    removeDeletedFiles,
    resolveWorkspaceFile,
    validateWorkspaceManifestPaths
} = require("./workspaceCache");
const {
    prepareWorkspace,
    selectPrepareScript
} = require("./workspacePreparation");
const { shouldTransferAttemptEvidence } = require("./artifactSelection");
const { IsolatedGuestCommandRunner } = require("./isolatedGuestCommandRunner");

const root = path.resolve(process.env.SCP_ISOLATED_ROOT || "/environment");
const parser = new EnvironmentFrameParser({
    allowedKinds: HOST_KINDS,
    direction: "host"
});
const artifacts = new Map();
let setup;
let offer;
let archive;
let worker;
let trustedRunnerAccepted = false;

function send(kind, payload = {}, body = Buffer.alloc(0)) {
    process.stdout.write(encodeEnvironmentFrame(kind, payload, body));
}

function resourceFailure(error, phase) {
    const mapping = {
        ENOSPC: "disk",
        EMFILE: "process",
        ENFILE: "process",
        EAGAIN: "process"
    };
    const resource = mapping[error.code];
    if (!resource) return false;
    send("RESOURCE_LIMIT_EXCEEDED", {
        resource,
        limit:
            resource === "disk"
                ? setup?.profile?.diskBytes
                : setup?.profile?.pidsLimit,
        phase,
        message: error.message
    });
    return true;
}

function dependencyFiles(repository) {
    const prefix = `${repository.path}/`;
    return new Set([
        `${prefix}package.json`,
        `${prefix}pnpm-lock.yaml`,
        `${prefix}yarn.lock`,
        `${prefix}package-lock.json`
    ]);
}

async function workspaceOffer(payload) {
    if (!setup) throw new Error("Environment setup is required first");
    if (offer) throw new Error("Workspace offer is already active");
    const manifest = payload.manifest;
    assertCompatible(manifest);
    validateWorkspaceManifestPaths(root, manifest);
    const cache = await inspectWorkspace(
        root,
        manifest,
        setup.orchestratorPublicKey
    );
    offer = { manifest, cache };
    send("WORKSPACE_NEED", { changed: cache.changed, deleted: cache.deleted });
}

function startSource(payload) {
    if (!offer) throw new Error("Workspace offer is required before source");
    if (archive) throw new Error("Source transfer already started");
    const archiveRoot = path.join(root, "transient");
    fs.mkdirSync(archiveRoot, { recursive: true });
    const archivePath = path.join(archiveRoot, "source.tgz");
    archive = {
        path: archivePath,
        fd: fs.openSync(archivePath, "w", 0o600),
        sequence: 0,
        bytes: 0,
        hash: crypto.createHash("sha256"),
        manifest: payload.manifest
    };
}

function sourceChunk(payload, body) {
    if (!archive) throw new Error("Source transfer has not started");
    if (payload.sequence !== archive.sequence++) {
        throw new Error("Out-of-order source chunk");
    }
    archive.bytes += body.length;
    if (archive.bytes > setup.limits.maxCompressedBytes) {
        throw new Error("Compressed bundle limit exceeded");
    }
    archive.hash.update(body);
    fs.writeSync(archive.fd, body);
}

async function completeSource(payload) {
    if (!archive) throw new Error("Source transfer has not started");
    fs.fsyncSync(archive.fd);
    fs.closeSync(archive.fd);
    archive.fd = null;
    const digest = archive.hash.digest("hex");
    if (payload.byteCount !== archive.bytes || payload.sha256 !== digest) {
        throw new Error("Transferred bundle checksum mismatch");
    }
    const { manifest, cache } = offer;
    const deltaManifest = archive.manifest;
    fs.mkdirSync(cache.workspace, { recursive: true });
    removeDeletedFiles(cache.workspace, cache.deleted);
    await extractRuntimeBundle(
        archive.path,
        cache.workspace,
        deltaManifest,
        setup.limits,
        manifest.files.filter((entry) => cache.changed.includes(entry.path))
    );
    commitSourceManifest(cache, manifest);
    if (!cache.prepared || cache.changed.length) {
        try {
            await prepareWorkspace(cache.workspace, manifest, {
                storeDir: path.join(root, "package-store"),
                commandRunner: new IsolatedGuestCommandRunner(),
                env: {},
                shouldInstall(repository) {
                    return (
                        cache.preparationChanged ||
                        !fs.existsSync(
                            path.join(
                                cache.workspace,
                                repository.path,
                                "node_modules"
                            )
                        ) ||
                        cache.changed.some((entry) =>
                            dependencyFiles(repository).has(entry)
                        )
                    );
                },
                selectPrepareScript: (repository) =>
                    selectPrepareScript(repository, cache),
                onStage(status) {
                    send("STATUS", { status });
                },
                onOutput(stream, data) {
                    send(
                        "WORKER_EVENT",
                        { message: { kind: "INFRA_LOG", stream } },
                        data
                    );
                }
            });
        } catch (error) {
            error.recoverablePreparationFailure = true;
            throw error;
        }
        markPrepared(cache, manifest);
    }
    fs.rmSync(archive.path, { force: true });
    archive = null;
    offer.projectRoot = resolveWorkspaceFile(
        cache.workspace,
        manifest.rootProjectPath
    );
    send("PREPARED", {
        reused: cache.prepared && !cache.changed.length,
        projectRoot: manifest.rootProjectPath
    });
}

function artifactManifest(spoolPath, requestId) {
    const { WorkerAttemptSpool } = require("./workerAttemptSpool");
    const spool = WorkerAttemptSpool.openExisting(spoolPath);
    const summaries = new Map(
        ["stdout", "stderr"].map((name) => [
            name,
            { bytes: 0, hash: crypto.createHash("sha256") }
        ])
    );
    for (const record of spool.readRecords()) {
        const summary = summaries.get(record.stream);
        summary.bytes += record.body.length;
        summary.hash.update(record.body);
    }
    const entries = [...summaries].map(([name, summary]) => ({
        name,
        bytes: summary.bytes,
        sha256: summary.hash.digest("hex")
    }));
    artifacts.set(requestId, {
        spoolPath,
        entries
    });
    return entries;
}

function startWorker(config) {
    if (!offer?.projectRoot) throw new Error("Workspace is not prepared");
    if (worker) throw new Error("Worker already started");
    const entry = path.join(__dirname, "worker.js");
    worker = fork(entry, [], {
        cwd: offer.projectRoot,
        env: {
            PATH: process.env.PATH,
            HOME: path.join(root, "home"),
            NODE_PATH: [
                path.join(offer.projectRoot, "node_modules"),
                process.env.NODE_PATH
            ]
                .filter(Boolean)
                .join(path.delimiter)
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        detached: false
    });
    worker.stdout.on("data", (data) =>
        send(
            "WORKER_EVENT",
            { message: { kind: "INFRA_LOG", stream: "stdout" } },
            data
        )
    );
    worker.stderr.on("data", (data) =>
        send(
            "WORKER_EVENT",
            { message: { kind: "INFRA_LOG", stream: "stderr" } },
            data
        )
    );
    worker.on("message", (message) => {
        if (message.kind === "ATTEMPT_READY") {
            const selected = shouldTransferAttemptEvidence(message.result);
            const manifest = selected
                ? artifactManifest(message.spoolPath, message.requestId)
                : [];
            const { spoolPath: _spoolPath, ...safeMessage } = message;
            send("WORKER_EVENT", {
                message: safeMessage,
                artifactManifest: manifest,
                artifactSelected: selected
            });
            return;
        }
        send("WORKER_EVENT", { message });
    });
    worker.once("exit", (code, signal) => {
        send("WORKER_EVENT", {
            message: { kind: "ISOLATED_WORKER_EXIT", code, signal }
        });
        worker = null;
    });
    worker.send({
        kind: "START",
        config: {
            ...config,
            projectRoot: offer.projectRoot,
            infraLogDir: path.join(root, "transient", "infra"),
            spoolRoot: path.join(root, "transient", "spool")
        }
    });
}

function sendArtifact(payload) {
    const artifact = artifacts.get(payload.requestId);
    if (!artifact) throw new Error("Unknown attempt artifact");
    const { WorkerAttemptSpool } = require("./workerAttemptSpool");
    const selected = new Set(payload.names);
    if (
        payload.names.some(
            (name) => !artifact.entries.some((entry) => entry.name === name)
        )
    ) {
        throw new Error("Unknown artifact name");
    }
    let sequence = 0;
    const spool = WorkerAttemptSpool.openExisting(artifact.spoolPath);
    for (const record of spool.readRecords(payload.chunkBytes)) {
        if (selected.has(record.stream)) {
            send(
                "ARTIFACT_CHUNK",
                {
                    requestId: payload.requestId,
                    name: record.stream,
                    sequence: sequence++
                },
                record.body
            );
        }
    }
    send("ARTIFACT_COMPLETE", { requestId: payload.requestId, sequence });
}

function commitArtifact(payload) {
    const artifact = artifacts.get(payload.requestId);
    if (artifact) artifacts.delete(payload.requestId);
    worker?.send({
        kind: "RESPONSE",
        requestId: payload.requestId,
        value: true
    });
}

async function stop() {
    if (worker) {
        worker.send({ kind: "CANCEL" });
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5000);
            worker.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
        if (worker) worker.kill("SIGKILL");
    }
    fs.rmSync(path.join(root, "transient"), { recursive: true, force: true });
    send("STOPPED");
    process.exit(0);
}

async function handle(frame) {
    if (frame.kind === "TRUSTED_RUNNER") trustedRunnerAccepted = true;
    else if (frame.kind === "ENVIRONMENT_SETUP") {
        if (!trustedRunnerAccepted) {
            throw new Error("Trusted runner must be accepted before setup");
        }
        setup = frame.payload;
    } else if (frame.kind === "WORKSPACE_OFFER")
        await workspaceOffer(frame.payload);
    else if (frame.kind === "SOURCE_BEGIN") startSource(frame.payload);
    else if (frame.kind === "SOURCE_CHUNK")
        sourceChunk(frame.payload, frame.body);
    else if (frame.kind === "SOURCE_COMPLETE")
        await completeSource(frame.payload);
    else if (frame.kind === "RUN_CONFIG") startWorker(frame.payload.config);
    else if (frame.kind === "WORKER_MESSAGE")
        worker?.send(frame.payload.message);
    else if (frame.kind === "ARTIFACT_REQUEST") sendArtifact(frame.payload);
    else if (frame.kind === "ARTIFACT_COMMITTED") commitArtifact(frame.payload);
    else if (frame.kind === "STOP") await stop();
}

parser.on("frame", (frame) => {
    handle(frame).catch((error) => {
        if (
            !resourceFailure(
                error,
                offer?.projectRoot ? "execution" : "preparation"
            )
        ) {
            send(
                error.recoverablePreparationFailure
                    ? "PREPARATION_FAILED"
                    : "ERROR",
                { message: error.message }
            );
        }
    });
});
parser.on("error", (error) => send("ERROR", { message: error.message }));
process.stdin.on("data", (chunk) => parser.consume(chunk));
process.stdin.on("end", () => stop().catch(() => process.exit(1)));

fs.mkdirSync(path.join(root, "home"), { recursive: true, mode: 0o700 });
send("READY", { version: 1 });
