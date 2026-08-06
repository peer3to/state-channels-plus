const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STREAM_IDS = { stdout: 1, stderr: 2 };
const STREAM_NAMES = { 1: "stdout", 2: "stderr" };

class WorkerAttemptSpool {
    constructor(filePath, maxBytes) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        this.filePath = filePath;
        this.maxBytes = maxBytes;
        this.bytes = 0;
        this.fd = fs.openSync(filePath, "wx", 0o600);
        this.closed = false;
    }

    static openExisting(filePath) {
        const spool = Object.create(WorkerAttemptSpool.prototype);
        spool.filePath = filePath;
        spool.maxBytes = fs.statSync(filePath).size;
        spool.bytes = spool.maxBytes;
        spool.fd = null;
        spool.closed = true;
        return spool;
    }

    write(stream, chunk) {
        if (this.closed) throw new Error("Attempt spool is closed");
        if (!STREAM_IDS[stream])
            throw new Error(`Unknown output stream: ${stream}`);
        const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const record = Buffer.allocUnsafe(5 + body.length);
        record.writeUInt8(STREAM_IDS[stream], 0);
        record.writeUInt32BE(body.length, 1);
        body.copy(record, 5);
        if (this.bytes + record.length > this.maxBytes) {
            const error = new Error("Attempt spool limit exceeded");
            error.code = "ESPOOLLIMIT";
            throw error;
        }
        fs.writeSync(this.fd, record);
        this.bytes += record.length;
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        fs.fsyncSync(this.fd);
        fs.closeSync(this.fd);
    }

    async send(peer, header, chunkBytes = 64 * 1024) {
        this.close();
        let sequence = 0;
        let outputBytes = 0;
        const hash = crypto.createHash("sha256");
        let pending = Buffer.alloc(0);
        let streamName = null;
        let remaining = 0;
        for await (const input of fs.createReadStream(this.filePath, {
            highWaterMark: chunkBytes
        })) {
            pending = pending.length ? Buffer.concat([pending, input]) : input;
            while (pending.length) {
                if (remaining === 0) {
                    if (pending.length < 5) break;
                    streamName = STREAM_NAMES[pending.readUInt8(0)];
                    remaining = pending.readUInt32BE(1);
                    pending = pending.subarray(5);
                    if (!streamName) throw new Error("Corrupt attempt spool");
                }
                if (!pending.length) break;
                const length = Math.min(remaining, pending.length, chunkBytes);
                const chunk = pending.subarray(0, length);
                pending = pending.subarray(length);
                remaining -= length;
                hash.update(chunk);
                outputBytes += chunk.length;
                await peer.send(
                    "LOG_CHUNK",
                    {
                        ...header,
                        stream: streamName,
                        sequence: sequence++
                    },
                    chunk
                );
            }
        }
        if (pending.length || remaining !== 0)
            throw new Error("Corrupt attempt spool");
        await peer.send("LOG_END", {
            ...header,
            sequence,
            byteCount: outputBytes,
            sha256: hash.digest("hex")
        });
        return { byteCount: outputBytes, sequence };
    }

    remove() {
        this.close();
        fs.rmSync(this.filePath, { force: true });
    }
}

module.exports = { WorkerAttemptSpool };
