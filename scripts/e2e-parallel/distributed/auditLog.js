const fs = require("fs");
const path = require("path");

const ALLOWED_FIELDS = new Set([
    "action",
    "accepted",
    "authorizationMode",
    "authorizationPolicy",
    "backend",
    "cacheBudgets",
    "cacheBytes",
    "callerFingerprint",
    "connectionId",
    "environmentKey",
    "failureCode",
    "reason",
    "requestedProfile",
    "resolvedProfile",
    "resource",
    "sessionId",
    "targetFingerprint",
    "targetRole",
    "targetWorker",
    "unlistedTransportKey",
    "workerGeneration"
]);
const PROFILE_FIELDS = new Set([
    "schedulerTickMs",
    "workers",
    "slots",
    "cpu",
    "memoryBytes",
    "diskBytes",
    "pidsLimit",
    "targetLoad"
]);

function sanitizeProfile(profile) {
    return Object.fromEntries(
        Object.entries(profile).filter(
            ([key, value]) =>
                PROFILE_FIELDS.has(key) &&
                typeof value === "number" &&
                Number.isFinite(value)
        )
    );
}

function sanitizeNumericSummary(summary) {
    return Object.fromEntries(
        Object.entries(summary).filter(
            ([key, value]) =>
                /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) &&
                typeof value === "number" &&
                Number.isFinite(value)
        )
    );
}

function sanitizeRecord(record) {
    const safe = {};
    for (const [key, value] of Object.entries(record)) {
        if (!ALLOWED_FIELDS.has(key) || value === undefined) continue;
        if (key === "unlistedTransportKey") {
            if (/^[a-f0-9]{64}$/.test(value)) safe[key] = value;
        } else if (typeof value === "string") safe[key] = value.slice(0, 512);
        else if (typeof value === "boolean" || typeof value === "number") {
            safe[key] = value;
        } else if (
            value &&
            typeof value === "object" &&
            (key === "requestedProfile" || key === "resolvedProfile")
        ) {
            safe[key] = sanitizeProfile(value);
        } else if (
            value &&
            typeof value === "object" &&
            key === "cacheBudgets"
        ) {
            safe[key] = sanitizeNumericSummary(value);
        } else if (
            value &&
            typeof value === "object" &&
            key === "authorizationPolicy" &&
            typeof value.publicKeyAuthorizationRequired === "boolean"
        ) {
            safe[key] = {
                publicKeyAuthorizationRequired:
                    value.publicKeyAuthorizationRequired
            };
        }
    }
    return safe;
}

class WorkerAuditLog {
    constructor(workRoot, options = {}) {
        this.root = path.join(path.resolve(workRoot), "host-state", "audit");
        this.file = path.join(this.root, "worker-audit.jsonl");
        this.maxBytes = options.maxBytes || 8 * 1024 * 1024;
        this.generations = options.generations || 5;
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    }

    append(record) {
        this.rotateIfNeeded();
        const line = JSON.stringify({
            timestamp: new Date().toISOString(),
            ...sanitizeRecord(record)
        });
        fs.appendFileSync(this.file, `${line}\n`, { mode: 0o600 });
        fs.chmodSync(this.file, 0o600);
    }

    rotateIfNeeded() {
        let size = 0;
        try {
            size = fs.statSync(this.file).size;
        } catch {}
        if (size < this.maxBytes) return;
        for (let index = this.generations - 1; index >= 1; index--) {
            const source =
                index === 1 ? this.file : `${this.file}.${index - 1}`;
            const target = `${this.file}.${index}`;
            if (fs.existsSync(source)) fs.renameSync(source, target);
        }
    }

    read() {
        if (!fs.existsSync(this.file)) return "";
        return fs.readFileSync(this.file, "utf8");
    }

    exportTo(target) {
        const resolved = path.resolve(target);
        fs.copyFileSync(this.file, resolved);
        return resolved;
    }
}

module.exports = {
    ALLOWED_FIELDS,
    WorkerAuditLog,
    sanitizeProfile,
    sanitizeNumericSummary,
    sanitizeRecord
};
