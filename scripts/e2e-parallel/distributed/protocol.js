const { EventEmitter } = require("events");
const { closeStream } = require("./connectionLifecycle");

const PROTOCOL_VERSION = 2;
const DISTRIBUTED_PROTOCOL_VERSION = 9;
const DEFAULT_MAX_FRAME = 1024 * 1024;
const MESSAGE_KINDS = new Set([
    "AUTH_HELLO",
    "AUTH_CHALLENGE",
    "AUTH_PROOF",
    "AUTH_OK",
    "AUTH_ERROR",
    "SERVER_READY",
    "HEARTBEAT",
    "LEASE_REQUEST",
    "LEASE_GRANTED",
    "BUSY",
    "QUEUE_FULL",
    "FAULTED",
    "WORKSPACE_OFFER",
    "WORKSPACE_NEED",
    "BUNDLE_META",
    "BUNDLE_CHUNK",
    "BUNDLE_END",
    "PREPARED",
    "RUN_CONFIG",
    "RUN_PROGRESS",
    "WORKER_READY",
    "TASK_REQUEST",
    "TASK_ASSIGNMENT",
    "NO_TASK_AVAILABLE",
    "WORK_AVAILABLE",
    "LOG_CHUNK",
    "LOG_END",
    "LOG_COMMITTED",
    "ATTEMPT_RESULT",
    "INFRA_LOG",
    "WORKER_STATUS",
    "WORKER_STATS",
    "PREPARATION_ERROR",
    "WORKER_ERROR",
    "RUN_COMPLETE",
    "CANCEL",
    "RELEASE",
    "LEASE_CLEAN"
]);
const HEADER_FIELDS = {
    AUTH_HELLO: ["nonce", "publicKey"],
    AUTH_CHALLENGE: ["nonce", "publicKey", "proof"],
    AUTH_PROOF: ["proof"],
    SERVER_READY: ["name", "capabilities"],
    LEASE_REQUEST: ["sessionId"],
    LEASE_GRANTED: ["capabilities"],
    BUSY: [
        "state",
        "position",
        "status",
        "completedTasks",
        "totalTasks",
        "estimatedWaitMs"
    ],
    WORKSPACE_OFFER: ["manifest"],
    BUNDLE_META: ["manifest"],
    BUNDLE_CHUNK: ["sequence"],
    BUNDLE_END: ["byteCount", "sha256"],
    RUN_CONFIG: ["baseEnv", "taskCount"],
    RUN_PROGRESS: ["completedTasks", "totalTasks"],
    TASK_REQUEST: ["requestId"],
    TASK_ASSIGNMENT: ["requestId", "assignment"],
    NO_TASK_AVAILABLE: ["requestId"],
    LOG_CHUNK: [
        "worker",
        "taskId",
        "attemptId",
        "requestId",
        "stream",
        "sequence"
    ],
    LOG_END: [
        "worker",
        "taskId",
        "attemptId",
        "requestId",
        "sequence",
        "byteCount",
        "sha256"
    ],
    LOG_COMMITTED: ["requestId", "attemptId"],
    ATTEMPT_RESULT: ["requestId", "assignment", "result", "logTransferred"],
    INFRA_LOG: ["stream"],
    WORKER_STATUS: ["status"],
    WORKER_STATS: ["stats"],
    PREPARATION_ERROR: ["message"],
    WORKER_ERROR: ["message"]
};

function validateHeader(kind, header) {
    const allowed = new Set([
        "version",
        "kind",
        ...(HEADER_FIELDS[kind] || [])
    ]);
    for (const key of Object.keys(header)) {
        if (!allowed.has(key))
            throw new Error(`Unknown ${kind} header field: ${key}`);
    }
}

class ProtocolPeer extends EventEmitter {
    constructor(stream, options = {}) {
        super();
        this.stream = stream;
        this.buffer = Buffer.alloc(0);
        this.pendingMessages = [];
        this.maxFrame = options.maxFrame || DEFAULT_MAX_FRAME;
        this.writeChain = Promise.resolve();
        stream.on("data", (chunk) => this.consume(chunk));
        stream.on("end", () => {
            if (this.buffer.length) this.fail(new Error("EOF inside frame"));
            else this.emit("close");
        });
        stream.on("close", () => this.emit("close"));
        stream.on("error", (error) => this.emit("protocolError", error));
    }

    send(kind, header = {}, body = Buffer.alloc(0)) {
        if (!MESSAGE_KINDS.has(kind)) {
            return Promise.reject(new Error(`Invalid message kind: ${kind}`));
        }
        try {
            validateHeader(kind, header);
        } catch (error) {
            return Promise.reject(error);
        }
        const binary = Buffer.isBuffer(body) ? body : Buffer.from(body);
        const headerBytes = Buffer.from(
            JSON.stringify({ version: PROTOCOL_VERSION, kind, ...header })
        );
        if (headerBytes.length > 64 * 1024) {
            return Promise.reject(new Error("Protocol header is too large"));
        }
        const payload = Buffer.allocUnsafe(
            4 + headerBytes.length + binary.length
        );
        payload.writeUInt32BE(headerBytes.length, 0);
        headerBytes.copy(payload, 4);
        binary.copy(payload, 4 + headerBytes.length);
        if (payload.length > this.maxFrame) {
            return Promise.reject(new Error("Protocol frame is too large"));
        }
        const frame = Buffer.allocUnsafe(4 + payload.length);
        frame.writeUInt32BE(payload.length, 0);
        payload.copy(frame, 4);
        const write = this.writeChain.then(
            () =>
                new Promise((resolve, reject) => {
                    if (this.stream.destroyed) {
                        reject(new Error("Protocol stream is closed"));
                        return;
                    }
                    const onError = (error) => {
                        this.stream.off("drain", onDrain);
                        reject(error);
                    };
                    const onDrain = () => {
                        this.stream.off("error", onError);
                        resolve();
                    };
                    this.stream.once("error", onError);
                    if (this.stream.write(frame)) onDrain();
                    else this.stream.once("drain", onDrain);
                })
        );
        this.writeChain = write.catch(() => {});
        return write;
    }

    close(reason = "protocol peer closed by application") {
        closeStream(this.stream, reason);
    }

    consume(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            if (length > this.maxFrame) {
                this.fail(new Error("Protocol frame is too large"));
                return;
            }
            if (this.buffer.length < 4 + length) return;
            const payload = this.buffer.subarray(4, 4 + length);
            this.buffer = this.buffer.subarray(4 + length);
            this.decode(payload);
        }
    }

    decode(payload) {
        if (payload.length < 4) return this.fail(new Error("Malformed frame"));
        const headerLength = payload.readUInt32BE(0);
        if (headerLength > 64 * 1024 || headerLength > payload.length - 4) {
            return this.fail(new Error("Malformed protocol header"));
        }
        let header;
        try {
            header = JSON.parse(payload.subarray(4, 4 + headerLength));
        } catch {
            return this.fail(new Error("Malformed protocol JSON"));
        }
        if (
            header.version !== PROTOCOL_VERSION ||
            !MESSAGE_KINDS.has(header.kind)
        ) {
            return this.fail(new Error("Unsupported protocol message"));
        }
        try {
            validateHeader(header.kind, header);
        } catch (error) {
            return this.fail(error);
        }
        const message = {
            kind: header.kind,
            header,
            body: payload.subarray(4 + headerLength)
        };
        if (this.listenerCount("message")) this.emit("message", message);
        else this.pendingMessages.push(message);
    }

    takePending(kind) {
        const index = this.pendingMessages.findIndex(
            (message) => message.kind === kind
        );
        if (index === -1) return null;
        return this.pendingMessages.splice(index, 1)[0];
    }

    fail(error) {
        this.emit("protocolError", error);
        closeStream(this.stream, `protocol rejected stream: ${error.message}`);
    }
}

function waitForMessage(peer, kind, timeoutMs = 10000) {
    const pending = peer.takePending(kind);
    if (pending) return Promise.resolve(pending);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => done(new Error(`Timed out waiting for ${kind}`)),
            timeoutMs
        );
        const onMessage = (message) => {
            if (message.kind === kind) done(null, message);
        };
        const onClose = () =>
            done(new Error(`Connection closed waiting for ${kind}`));
        const done = (error, message) => {
            clearTimeout(timer);
            peer.off("message", onMessage);
            peer.off("close", onClose);
            if (error) reject(error);
            else resolve(message);
        };
        peer.on("message", onMessage);
        peer.once("close", onClose);
    });
}

module.exports = {
    DISTRIBUTED_PROTOCOL_VERSION,
    PROTOCOL_VERSION,
    MESSAGE_KINDS,
    ProtocolPeer,
    waitForMessage
};
