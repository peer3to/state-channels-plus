const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { assertContained } = require("../shared/paths");

const RESULT_OUTPUT_TAIL_BYTES = 4 * 1024 * 1024;

function appendTail(chunks, body) {
    chunks.push(body);
    let bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    while (bytes > RESULT_OUTPUT_TAIL_BYTES && chunks.length > 1) {
        bytes -= chunks.shift().length;
    }
    if (bytes > RESULT_OUTPUT_TAIL_BYTES) {
        chunks[0] = chunks[0].subarray(bytes - RESULT_OUTPUT_TAIL_BYTES);
    }
}

function sanitizeWorkerLabel(name, used = new Set()) {
    const base = String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    if (!base) throw new Error("Worker label is empty after normalization");
    let label = base;
    let suffix = 2;
    while (used.has(label)) label = `${base.slice(0, 43)}-${suffix++}`;
    used.add(label);
    return label;
}

function containedPath(root, ...segments) {
    return assertContained(
        path.resolve(root),
        path.resolve(root, ...segments),
        {
            allowRoot: true,
            message: "Resolved log path leaves run directory"
        }
    );
}

class OrchestratorLogStore {
    constructor(runDir) {
        this.runDir = path.resolve(runDir);
        this.attempts = new Map();
        this.labels = new Set();
        this.workerLabels = new Map();
    }

    workerLabel(workerId, suppliedName) {
        if (!this.workerLabels.has(workerId)) {
            this.workerLabels.set(
                workerId,
                sanitizeWorkerLabel(suppliedName, this.labels)
            );
        }
        return this.workerLabels.get(workerId);
    }

    infrastructurePath(workerId, suppliedName, fileName = "worker.ansi") {
        const label = this.workerLabel(workerId, suppliedName);
        const dir = containedPath(this.runDir, "infra", label);
        fs.mkdirSync(dir, { recursive: true });
        return containedPath(dir, path.basename(fileName));
    }

    begin(key, filePath) {
        if (this.attempts.has(key))
            throw new Error(`Attempt log already exists: ${key}`);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const fd = fs.openSync(filePath, "wx", 0o600);
        this.attempts.set(key, {
            fd,
            filePath,
            sequence: 0,
            byteCount: 0,
            hash: crypto.createHash("sha256"),
            stdout: [],
            stderr: []
        });
    }

    append(key, sequence, body, stream = "stdout") {
        const attempt = this.attempts.get(key);
        if (!attempt) throw new Error(`Unknown attempt log: ${key}`);
        if (sequence !== attempt.sequence)
            throw new Error("Out-of-order log chunk");
        if (stream !== "stdout" && stream !== "stderr") {
            throw new Error(`Unknown attempt stream: ${stream}`);
        }
        fs.writeSync(attempt.fd, body);
        attempt.hash.update(body);
        appendTail(attempt[stream], body);
        attempt.byteCount += body.length;
        attempt.sequence++;
    }

    commit(key, end) {
        const attempt = this.attempts.get(key);
        if (!attempt) throw new Error(`Unknown attempt log: ${key}`);
        try {
            const digest = attempt.hash.digest("hex");
            if (
                end.sequence !== attempt.sequence ||
                end.byteCount !== attempt.byteCount ||
                end.sha256 !== digest
            ) {
                throw new Error("Attempt log checksum mismatch");
            }
            fs.fsyncSync(attempt.fd);
            return {
                filePath: attempt.filePath,
                stdout: Buffer.concat(attempt.stdout).toString(),
                stderr: Buffer.concat(attempt.stderr).toString()
            };
        } finally {
            fs.closeSync(attempt.fd);
            this.attempts.delete(key);
        }
    }

    abort(key) {
        const attempt = this.attempts.get(key);
        if (!attempt) return;
        fs.closeSync(attempt.fd);
        this.attempts.delete(key);
    }
}

module.exports = { OrchestratorLogStore, sanitizeWorkerLabel, containedPath };
