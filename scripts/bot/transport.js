const { EventEmitter } = require("node:events");
const {
    ProtocolPeer,
    waitForMessage
} = require("../e2e-parallel/distributed/protocol");
const {
    authenticateClient,
    authenticateServer
} = require("../e2e-parallel/distributed/authentication");
const { check, digest } = require("./data");
const { ReviewError } = require("./errors");
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const OPERATIONS = new Set([
    "request",
    "result",
    "failure",
    "correction",
    "receipt",
    "publication",
    "acknowledgement"
]);
class ReviewConnection extends EventEmitter {
    peer;
    limits;
    incoming = null;
    outgoing = Promise.resolve();
    authenticatedKey = null;
    ready = false;
    timer = null;
    closed = false;
    constructor(stream, limits, peer = null) {
        super();
        this.limits = limits;
        this.peer = peer || new ProtocolPeer(stream, { review: true });
        this.peer.on("protocolError", () =>
            this.emit(
                "failure",
                new ReviewError(
                    this.incoming ? "INVALID_RESULT" : "SERVICE_UNAVAILABLE"
                )
            )
        );
        this.peer.on("close", () => {
            if (this.closed) return;
            this.closed = true;
            clearTimeout(this.timer);
            const truncated = this.incoming !== null;
            this.incoming = null;
            if (truncated)
                this.emit("failure", new ReviewError("INVALID_RESULT"));
            this.emit("close");
        });
    }
    async authenticate({
        server,
        authKey,
        localKey,
        remoteKey,
        authorization
    }) {
        try {
            if (server) {
                const identity = await authenticateServer(
                    this.peer,
                    authKey,
                    { local: localKey, remote: remoteKey },
                    this.limits.transferMs
                );
                this.authenticatedKey =
                    identity.remotePublicKey.toString("hex");
                const allowed = authorization.authorize(this.authenticatedKey);
                check(allowed.accepted, "UNAUTHORIZED");
                await this.peer.send("SERVER_READY", {
                    capabilities: { review: true }
                });
                const hello = await waitForMessage(
                    this.peer,
                    "REVIEW_HELLO",
                    this.limits.transferMs
                );
                check(
                    hello.header.reviewVersion === 1 && hello.body.length === 0
                );
                // Install payload handling before acknowledging negotiation.
                this.activate();
                await this.peer.send("REVIEW_READY", { reviewVersion: 1 });
            } else {
                check(
                    remoteKey &&
                        Buffer.from(remoteKey).equals(
                            this.peer.stream.remotePublicKey
                        ),
                    "UNAUTHORIZED"
                );
                const identity = await authenticateClient(
                    this.peer,
                    authKey,
                    { local: localKey, remote: remoteKey },
                    this.limits.transferMs
                );
                this.authenticatedKey =
                    identity.remotePublicKey.toString("hex");
                const serverReady = await waitForMessage(
                    this.peer,
                    "SERVER_READY",
                    this.limits.transferMs
                );
                check(
                    serverReady.header.capabilities?.review === true,
                    "SERVICE_UNAVAILABLE"
                );
                await this.peer.send("REVIEW_HELLO", { reviewVersion: 1 });
                const ready = await waitForMessage(
                    this.peer,
                    "REVIEW_READY",
                    this.limits.transferMs
                );
                check(
                    ready.header.reviewVersion === 1 && ready.body.length === 0
                );
                this.activate();
            }
        } catch (error) {
            this.close();
            throw error;
        }
    }
    activate(listen = true) {
        check(!this.ready);
        this.ready = true;
        if (!listen) return;
        this.peer.on("message", (message) => {
            try {
                this.consume(message);
            } catch (error) {
                this.emit("failure", error);
                this.close();
            }
        });
        const pending = this.peer.pendingMessages.splice(0);
        for (const message of pending) {
            if (
                message.kind.startsWith("REVIEW_") ||
                message.kind === "HEARTBEAT"
            )
                this.consume(message);
            else this.peer.pendingMessages.push(message);
        }
    }
    consume(message) {
        const { header, body, kind } = message;
        if (kind === "HEARTBEAT") {
            this.peer.send("HEARTBEAT").catch(() => this.close());
            return;
        }
        if (!kind.startsWith("REVIEW_")) return;
        check(
            this.ready &&
                header.reviewVersion === 1 &&
                ID.test(header.requestId || "") &&
                ID.test(header.attemptId || "")
        );
        if (kind === "REVIEW_PROGRESS") {
            check(body.length === 0 && ID.test(header.executionId || ""));
            if (header.activity !== undefined) {
                const activity = header.activity;
                check(
                    activity &&
                        [
                            "starting",
                            "waiting-for-model",
                            "reading-source",
                            "model-event",
                            "completed"
                        ].includes(activity.phase)
                );
                check(
                    activity.lastEventAt === null ||
                        (Number.isSafeInteger(activity.lastEventAt) &&
                            activity.lastEventAt > 0)
                );
                check(
                    [activity.completedItems, activity.toolCalls].every(
                        (value) => Number.isSafeInteger(value) && value >= 0
                    )
                );
            }
            this.emit("progress", {
                requestId: header.requestId,
                attemptId: header.attemptId,
                executionId: header.executionId,
                ...(header.activity ? { activity: header.activity } : {})
            });
            return;
        }
        if (kind === "REVIEW_START") {
            check(
                !this.incoming &&
                    body.length === 0 &&
                    OPERATIONS.has(header.operation)
            );
            check(
                Number.isSafeInteger(header.byteCount) &&
                    header.byteCount > 0 &&
                    header.byteCount <= this.limits.maxBytes &&
                    /^[a-f0-9]{64}$/.test(header.sha256)
            );
            this.incoming = { ...header, chunks: [], size: 0, next: 0 };
            this.timer = setTimeout(() => {
                this.emit("failure", new ReviewError("TRANSFER_TIMEOUT"));
                this.close();
            }, this.limits.transferMs);
            return;
        }
        const incoming = this.incoming;
        check(
            incoming &&
                incoming.requestId === header.requestId &&
                incoming.attemptId === header.attemptId &&
                header.sequence === incoming.next
        );
        if (kind === "REVIEW_CHUNK") {
            check(
                body.length > 0 &&
                    incoming.size + body.length <= incoming.byteCount
            );
            incoming.chunks.push(body);
            incoming.size += body.length;
            incoming.next++;
        } else {
            check(
                kind === "REVIEW_END" &&
                    body.length === 0 &&
                    header.byteCount === incoming.byteCount &&
                    header.sha256 === incoming.sha256 &&
                    incoming.size === incoming.byteCount
            );
            const bytes = Buffer.concat(incoming.chunks);
            check(digest(bytes) === incoming.sha256);
            const value = JSON.parse(bytes.toString("utf8"));
            clearTimeout(this.timer);
            this.timer = null;
            this.incoming = null;
            this.emit("payload", {
                requestId: incoming.requestId,
                attemptId: incoming.attemptId,
                operation: incoming.operation,
                value
            });
        }
    }
    send(operation, requestId, attemptId, value) {
        check(
            this.ready &&
                OPERATIONS.has(operation) &&
                ID.test(requestId) &&
                ID.test(attemptId)
        );
        const bytes = Buffer.from(JSON.stringify(value));
        check(bytes.length > 0 && bytes.length <= this.limits.maxBytes);
        const send = this.outgoing.then(async () => {
            const common = { reviewVersion: 1, requestId, attemptId },
                hash = digest(bytes);
            await this.peer.send("REVIEW_START", {
                ...common,
                operation,
                byteCount: bytes.length,
                sha256: hash
            });
            let sequence = 0;
            for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
                await this.peer.send(
                    "REVIEW_CHUNK",
                    { ...common, sequence: sequence++ },
                    bytes.subarray(offset, offset + 256 * 1024)
                );
            }
            await this.peer.send("REVIEW_END", {
                ...common,
                sequence,
                byteCount: bytes.length,
                sha256: hash
            });
        });
        this.outgoing = send.catch(() => {});
        return send;
    }
    progress(requestId, attemptId, executionId, activity) {
        return this.peer.send("REVIEW_PROGRESS", {
            reviewVersion: 1,
            requestId,
            attemptId,
            executionId,
            ...(activity ? { activity } : {})
        });
    }
    close() {
        clearTimeout(this.timer);
        this.peer.close("review connection closed");
    }
}
module.exports = { ReviewConnection };
