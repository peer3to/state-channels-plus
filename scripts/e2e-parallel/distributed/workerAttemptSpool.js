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

    *readRecords(chunkBytes = 64 * 1024) {
        this.close();
        const fd = fs.openSync(this.filePath, "r");
        const header = Buffer.allocUnsafe(5);
        let position = 0;
        try {
            while (position < this.bytes) {
                if (fs.readSync(fd, header, 0, 5, position) !== 5) {
                    throw new Error("Corrupt attempt spool");
                }
                const stream = STREAM_NAMES[header.readUInt8(0)];
                const length = header.readUInt32BE(1);
                position += 5;
                if (!stream || position + length > this.bytes) {
                    throw new Error("Corrupt attempt spool");
                }
                let remaining = length;
                while (remaining > 0) {
                    const body = Buffer.allocUnsafe(
                        Math.min(remaining, chunkBytes)
                    );
                    const read = fs.readSync(
                        fd,
                        body,
                        0,
                        body.length,
                        position
                    );
                    if (read !== body.length) {
                        throw new Error("Corrupt attempt spool");
                    }
                    position += read;
                    remaining -= read;
                    yield { stream, body };
                }
            }
        } finally {
            fs.closeSync(fd);
        }
    }

    readOutput() {
        this.close();
        const output = { stdout: "", stderr: "" };
        for (const record of this.readRecords()) {
            output[record.stream] += record.body.toString();
        }
        return output;
    }

    remove() {
        this.close();
        fs.rmSync(this.filePath, { force: true });
    }
}

module.exports = { WorkerAttemptSpool };
