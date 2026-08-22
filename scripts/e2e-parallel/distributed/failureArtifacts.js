const crypto = require("crypto");

class BoundedArtifactAssembler {
    constructor(manifest, maxArtifactBytes, maxAttemptBytes) {
        if (!Array.isArray(manifest) || !manifest.length) {
            throw new Error("Selected attempt evidence requires a manifest");
        }
        const names = new Set();
        let total = 0;
        this.entries = manifest.map((entry) => {
            if (
                !new Set(["stdout", "stderr"]).has(entry.name) ||
                names.has(entry.name) ||
                !Number.isInteger(entry.bytes) ||
                entry.bytes < 0 ||
                entry.bytes > maxArtifactBytes ||
                typeof entry.sha256 !== "string" ||
                !/^[a-f0-9]{64}$/.test(entry.sha256)
            ) {
                throw new Error("Invalid guest artifact manifest");
            }
            names.add(entry.name);
            total += entry.bytes;
            return {
                ...entry,
                received: 0,
                hash: crypto.createHash("sha256")
            };
        });
        if (total > maxAttemptBytes) {
            throw new Error("Guest artifact manifest exceeds attempt limit");
        }
        this.byName = new Map(this.entries.map((entry) => [entry.name, entry]));
        this.sequence = 0;
        this.bytes = 0;
        this.aggregateHash = crypto.createHash("sha256");
    }

    accept(name, sequence, body) {
        if (sequence !== this.sequence) {
            throw new Error("Out-of-order guest artifact chunk");
        }
        const entry = this.byName.get(name);
        if (!entry || entry.received + body.length > entry.bytes) {
            throw new Error("Guest artifact chunk exceeds its manifest");
        }
        entry.received += body.length;
        entry.hash.update(body);
        this.aggregateHash.update(body);
        this.bytes += body.length;
        this.sequence += 1;
    }

    complete() {
        for (const entry of this.entries) {
            if (
                entry.received !== entry.bytes ||
                entry.hash.digest("hex") !== entry.sha256
            ) {
                throw new Error(
                    `Guest artifact verification failed: ${entry.name}`
                );
            }
        }
        return {
            sequence: this.sequence,
            byteCount: this.bytes,
            sha256: this.aggregateHash.digest("hex")
        };
    }
}

module.exports = { BoundedArtifactAssembler };
