const { EventEmitter } = require("events");

const ENVIRONMENT_PROTOCOL_VERSION = 1;
const DEFAULT_MAX_ENVIRONMENT_FRAME_BYTES = 1024 * 1024;
const HOST_KINDS = new Set([
    "TRUSTED_RUNNER",
    "ENVIRONMENT_SETUP",
    "WORKSPACE_OFFER",
    "SOURCE_BEGIN",
    "SOURCE_CHUNK",
    "SOURCE_COMPLETE",
    "RUN_CONFIG",
    "WORKER_MESSAGE",
    "ARTIFACT_REQUEST",
    "ARTIFACT_COMMITTED",
    "STOP"
]);
const GUEST_KINDS = new Set([
    "READY",
    "WORKSPACE_NEED",
    "PREPARED",
    "WORKER_EVENT",
    "STATUS",
    "ARTIFACT_MANIFEST",
    "ARTIFACT_CHUNK",
    "ARTIFACT_COMPLETE",
    "RESOURCE_LIMIT_EXCEEDED",
    "PREPARATION_FAILED",
    "ERROR",
    "STOPPED"
]);

const PAYLOAD_SCHEMAS = {
    TRUSTED_RUNNER: { required: ["version"], optional: [] },
    ENVIRONMENT_SETUP: {
        required: [
            "environmentKey",
            "orchestratorPublicKey",
            "profile",
            "limits"
        ],
        optional: []
    },
    WORKSPACE_OFFER: { required: ["manifest"], optional: [] },
    SOURCE_BEGIN: { required: ["manifest"], optional: [] },
    SOURCE_CHUNK: { required: ["sequence"], optional: [] },
    SOURCE_COMPLETE: {
        required: ["byteCount", "sha256"],
        optional: []
    },
    RUN_CONFIG: { required: ["config"], optional: [] },
    WORKER_MESSAGE: { required: ["message"], optional: [] },
    ARTIFACT_REQUEST: {
        required: ["requestId", "names", "chunkBytes"],
        optional: []
    },
    ARTIFACT_COMMITTED: { required: ["requestId"], optional: [] },
    STOP: { required: [], optional: [] },
    READY: {
        required: [],
        optional: ["version", "distributedProtocol"]
    },
    WORKSPACE_NEED: { required: ["changed", "deleted"], optional: [] },
    PREPARED: { required: [], optional: ["reused", "projectRoot"] },
    WORKER_EVENT: {
        required: ["message"],
        optional: ["artifactManifest", "artifactSelected"]
    },
    STATUS: { required: ["status"], optional: [] },
    ARTIFACT_MANIFEST: { required: ["requestId", "entries"], optional: [] },
    ARTIFACT_CHUNK: {
        required: ["requestId", "name", "sequence"],
        optional: []
    },
    ARTIFACT_COMPLETE: {
        required: ["requestId", "sequence"],
        optional: []
    },
    RESOURCE_LIMIT_EXCEEDED: {
        required: ["resource", "limit", "phase", "message"],
        optional: []
    },
    PREPARATION_FAILED: { required: ["message"], optional: [] },
    ERROR: { required: ["message"], optional: [] },
    STOPPED: { required: [], optional: [] }
};

const BODY_KINDS = new Set(["SOURCE_CHUNK", "WORKER_EVENT", "ARTIFACT_CHUNK"]);

function encodeEnvironmentFrame(kind, payload = {}, body = Buffer.alloc(0)) {
    const encodedBody = Buffer.isBuffer(body) ? body.toString("base64") : "";
    return Buffer.from(
        `${JSON.stringify({ version: ENVIRONMENT_PROTOCOL_VERSION, kind, payload, body: encodedBody })}\n`
    );
}

function validateEnvironmentFrame(frame, allowedKinds) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
        throw new Error("Invalid environment frame");
    }
    const allowed = new Set(["version", "kind", "payload", "body"]);
    for (const key of Object.keys(frame)) {
        if (!allowed.has(key))
            throw new Error(`Unknown environment frame field: ${key}`);
    }
    if (frame.version !== ENVIRONMENT_PROTOCOL_VERSION) {
        throw new Error("Environment protocol version mismatch");
    }
    if (!allowedKinds.has(frame.kind)) {
        throw new Error(`Unknown environment message kind: ${frame.kind}`);
    }
    if (
        !frame.payload ||
        typeof frame.payload !== "object" ||
        Array.isArray(frame.payload)
    ) {
        throw new Error("Invalid environment frame payload");
    }
    const schema = PAYLOAD_SCHEMAS[frame.kind];
    const payloadFields = new Set([...schema.required, ...schema.optional]);
    for (const field of Object.keys(frame.payload)) {
        if (!payloadFields.has(field)) {
            throw new Error(`Unknown ${frame.kind} payload field: ${field}`);
        }
    }
    for (const field of schema.required) {
        if (!(field in frame.payload)) {
            throw new Error(`Missing ${frame.kind} payload field: ${field}`);
        }
    }
    if (
        typeof frame.body !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            frame.body
        )
    ) {
        throw new Error("Invalid environment frame encoding");
    }
    if (frame.body && !BODY_KINDS.has(frame.kind)) {
        throw new Error(
            `Unexpected body for environment message: ${frame.kind}`
        );
    }
    return {
        kind: frame.kind,
        payload: frame.payload,
        body: Buffer.from(frame.body, "base64")
    };
}

class EnvironmentFrameSequence {
    constructor(direction) {
        this.direction = direction;
        this.state = "initial";
    }

    accept(kind) {
        if (this.direction === "host") this.acceptHost(kind);
        else this.acceptGuest(kind);
    }

    acceptHost(kind) {
        if (kind === "STOP") {
            if (this.state === "initial") {
                throw new Error("Out-of-order environment message: STOP");
            }
            this.state = "stopping";
            return;
        }
        if (this.state === "initial" && kind === "TRUSTED_RUNNER") {
            this.state = "trusted";
            return;
        }
        if (this.state === "trusted" && kind === "ENVIRONMENT_SETUP") {
            this.state = "setup";
            return;
        }
        if (this.state === "setup" && kind === "WORKSPACE_OFFER") {
            this.state = "source";
            return;
        }
        if (this.state === "source" && kind === "SOURCE_BEGIN") {
            this.state = "source-transfer";
            return;
        }
        if (this.state === "source-transfer" && kind === "SOURCE_CHUNK") return;
        if (this.state === "source-transfer" && kind === "SOURCE_COMPLETE") {
            this.state = "prepared";
            return;
        }
        if (this.state === "prepared" && kind === "RUN_CONFIG") {
            this.state = "running";
            return;
        }
        if (
            this.state === "running" &&
            new Set([
                "WORKER_MESSAGE",
                "ARTIFACT_REQUEST",
                "ARTIFACT_COMMITTED"
            ]).has(kind)
        ) {
            return;
        }
        throw new Error(`Out-of-order environment message: ${kind}`);
    }

    acceptGuest(kind) {
        if (this.state === "initial" && kind === "READY") {
            this.state = "ready";
            return;
        }
        if (
            this.state !== "initial" &&
            new Set([
                "WORKSPACE_NEED",
                "PREPARED",
                "WORKER_EVENT",
                "STATUS",
                "ARTIFACT_MANIFEST",
                "ARTIFACT_CHUNK",
                "ARTIFACT_COMPLETE",
                "RESOURCE_LIMIT_EXCEEDED",
                "PREPARATION_FAILED",
                "ERROR",
                "STOPPED"
            ]).has(kind)
        ) {
            return;
        }
        throw new Error(`Out-of-order environment message: ${kind}`);
    }
}

class EnvironmentFrameParser extends EventEmitter {
    constructor(options = {}) {
        super();
        this.buffer = Buffer.alloc(0);
        this.maxFrameBytes =
            options.maxFrameBytes || DEFAULT_MAX_ENVIRONMENT_FRAME_BYTES;
        this.allowedKinds = options.allowedKinds || GUEST_KINDS;
        this.sequence = options.direction
            ? new EnvironmentFrameSequence(options.direction)
            : null;
    }

    consume(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            const newline = this.buffer.indexOf(10);
            if (newline < 0) {
                if (this.buffer.length > this.maxFrameBytes) {
                    this.buffer = Buffer.alloc(0);
                    this.emit(
                        "error",
                        new Error("Environment frame is too large")
                    );
                }
                return;
            }
            const line = this.buffer.subarray(0, newline);
            this.buffer = this.buffer.subarray(newline + 1);
            if (!line.length) continue;
            try {
                if (line.length > this.maxFrameBytes) {
                    throw new Error("Environment frame is too large");
                }
                const parsed = JSON.parse(line.toString("utf8"));
                const frame = validateEnvironmentFrame(
                    parsed,
                    this.allowedKinds
                );
                this.sequence?.accept(frame.kind);
                this.emit("frame", frame);
            } catch (error) {
                this.emit("error", error);
            }
        }
    }
}

module.exports = {
    DEFAULT_MAX_ENVIRONMENT_FRAME_BYTES,
    ENVIRONMENT_PROTOCOL_VERSION,
    EnvironmentFrameParser,
    EnvironmentFrameSequence,
    GUEST_KINDS,
    HOST_KINDS,
    PAYLOAD_SCHEMAS,
    encodeEnvironmentFrame,
    validateEnvironmentFrame
};
