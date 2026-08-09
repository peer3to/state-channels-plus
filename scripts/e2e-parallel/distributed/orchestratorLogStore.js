const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { assertContained } = require("../shared/paths");

const RESULT_OUTPUT_TAIL_BYTES = 4 * 1024 * 1024;
const INFRA_PROCESS_FILES = {
    discovery: "discovery-server.ansi",
    hardhat: "hardhat-node.ansi"
};

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
        this.infrastructureProcessSnapshots = new Map();
        this.infrastructureProcessUploads = new Map();
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

    writeInfrastructureProcessSnapshot(
        workerId,
        suppliedName,
        processKind,
        slotId,
        trigger,
        processFailure,
        body
    ) {
        const fileName = INFRA_PROCESS_FILES[processKind];
        if (!fileName) {
            throw new Error(`Unknown infrastructure process: ${processKind}`);
        }
        const worker = this.workerLabel(workerId, suppliedName);
        const key = `${workerId}:${processKind}:${slotId}`;
        const previous = this.infrastructureProcessSnapshots.get(key);
        const reasons = previous?.reasons || [];
        reasons.push({ trigger, processFailure });
        this.infrastructureProcessSnapshots.set(key, {
            worker,
            processKind,
            slotId,
            reasons,
            body: Buffer.from(body)
        });
        const filePath = containedPath(this.runDir, "infra", fileName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const sections = [...this.infrastructureProcessSnapshots.values()]
            .filter((snapshot) => snapshot.processKind === processKind)
            .sort(
                (left, right) =>
                    left.worker.localeCompare(right.worker) ||
                    left.slotId - right.slotId
            )
            .map((snapshot) => {
                const reasonsText = snapshot.reasons
                    .map(
                        (reason) =>
                            `trigger: ${reason.trigger}${reason.processFailure ? `; process failure: ${reason.processFailure}` : ""}`
                    )
                    .join("\n");
                return Buffer.concat([
                    Buffer.from(
                        `=== ${snapshot.worker} slot ${snapshot.slotId} ===\n${reasonsText}\n--- ${snapshot.processKind} output ---\n`
                    ),
                    snapshot.body,
                    Buffer.from("\n")
                ]);
            });
        fs.writeFileSync(filePath, Buffer.concat(sections));
        return filePath;
    }

    writeInfrastructureProcessChunk(
        workerId,
        suppliedName,
        processKind,
        slotId,
        trigger,
        processFailure,
        uploadId,
        sequence,
        chunkCount,
        body
    ) {
        if (
            !Number.isInteger(sequence) ||
            !Number.isInteger(chunkCount) ||
            sequence < 0 ||
            chunkCount < 1 ||
            sequence >= chunkCount
        ) {
            throw new Error(
                "Invalid infrastructure process log chunk position"
            );
        }
        if (!INFRA_PROCESS_FILES[processKind]) {
            throw new Error(`Unknown infrastructure process: ${processKind}`);
        }
        const key = `${workerId}:${processKind}:${uploadId}`;
        let upload = this.infrastructureProcessUploads.get(key);
        if (!upload) {
            if (sequence !== 0) {
                throw new Error(
                    "Infrastructure process log upload did not start at zero"
                );
            }
            upload = {
                suppliedName,
                processKind,
                slotId,
                trigger,
                processFailure,
                nextSequence: 0,
                chunkCount,
                chunks: []
            };
            this.infrastructureProcessUploads.set(key, upload);
        }
        if (
            upload.nextSequence !== sequence ||
            upload.chunkCount !== chunkCount ||
            upload.suppliedName !== suppliedName ||
            upload.processKind !== processKind ||
            upload.slotId !== slotId ||
            upload.trigger !== trigger ||
            upload.processFailure !== processFailure
        ) {
            throw new Error("Out-of-order infrastructure process log chunk");
        }
        upload.chunks.push(Buffer.from(body));
        upload.nextSequence++;
        if (upload.nextSequence !== chunkCount) return undefined;
        this.infrastructureProcessUploads.delete(key);
        return this.writeInfrastructureProcessSnapshot(
            workerId,
            upload.suppliedName,
            upload.processKind,
            upload.slotId,
            upload.trigger,
            upload.processFailure,
            Buffer.concat(upload.chunks)
        );
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
