const fs = require("fs");
const path = require("path");

const MAX_NOTE_BYTES = 256;

function assertPublicKey(publicKey) {
    if (typeof publicKey !== "string" || !/^[a-f0-9]{64}$/.test(publicKey)) {
        throw new Error("Public key must be 32 lowercase hex bytes");
    }
    return publicKey;
}

function validateNote(note = "") {
    if (typeof note !== "string" || Buffer.byteLength(note) > MAX_NOTE_BYTES) {
        throw new Error(`Authorization note exceeds ${MAX_NOTE_BYTES} bytes`);
    }
    if (/[^\t\x20-\x7e]/.test(note)) {
        throw new Error("Authorization note must be bounded plain text");
    }
    return note;
}

function fingerprint(publicKey) {
    return assertPublicKey(publicKey).slice(0, 12);
}

class AuthorizationStore {
    constructor(workRoot, bootstrap = {}) {
        this.root = path.join(path.resolve(workRoot), "host-state");
        this.file = path.join(this.root, "authorization.json");
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
        this.entries = new Map();
        this.allowUnlistedOrchestrators =
            bootstrap.allowUnlistedOrchestrators ?? true;
        const loadedVersion = this.load();
        if (!this.entries.size) {
            for (const publicKey of bootstrap.authorizedPublicKeys || []) {
                this.entries.set(assertPublicKey(publicKey), {
                    role: "orchestrator",
                    note: ""
                });
            }
            for (const publicKey of bootstrap.adminPublicKeys || []) {
                this.entries.set(assertPublicKey(publicKey), {
                    role: "admin",
                    note: ""
                });
            }
            this.persist();
        } else if (loadedVersion === 1) {
            this.persist();
        }
    }

    load() {
        if (!fs.existsSync(this.file)) return;
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (
            ![1, 2].includes(parsed.version) ||
            !Array.isArray(parsed.entries)
        ) {
            throw new Error("Unsupported authorization store");
        }
        if (parsed.version === 2) {
            if (typeof parsed.allowUnlistedOrchestrators !== "boolean") {
                throw new Error("Invalid authorization policy");
            }
            this.allowUnlistedOrchestrators = parsed.allowUnlistedOrchestrators;
        }
        for (const entry of parsed.entries) {
            const publicKey = assertPublicKey(entry.publicKey);
            if (!new Set(["orchestrator", "admin"]).has(entry.role)) {
                throw new Error("Invalid authorization role");
            }
            this.entries.set(publicKey, {
                role: entry.role,
                note: validateNote(entry.note)
            });
        }
        return parsed.version;
    }

    persist() {
        const temporary = `${this.file}.${process.pid}.tmp`;
        const entries = [...this.entries.entries()]
            .map(([publicKey, entry]) => ({ publicKey, ...entry }))
            .sort((left, right) =>
                left.publicKey.localeCompare(right.publicKey)
            );
        fs.writeFileSync(
            temporary,
            JSON.stringify(
                {
                    version: 2,
                    allowUnlistedOrchestrators: this.allowUnlistedOrchestrators,
                    entries
                },
                null,
                2
            ),
            { mode: 0o600 }
        );
        fs.renameSync(temporary, this.file);
        fs.chmodSync(this.file, 0o600);
    }

    authorize(publicKey) {
        const key = assertPublicKey(publicKey);
        const entry = this.entries.get(key);
        if (entry) return { accepted: true, mode: "allowlist", ...entry };
        return this.allowUnlistedOrchestrators
            ? { accepted: true, mode: "shared-secret-migration", role: null }
            : { accepted: false, mode: "allowlist-required", role: null };
    }

    policy() {
        return {
            publicKeyAuthorizationRequired: !this.allowUnlistedOrchestrators
        };
    }

    setPublicKeyAuthorizationRequired(required) {
        if (typeof required !== "boolean") {
            throw new Error("Public-key authorization policy must be boolean");
        }
        this.allowUnlistedOrchestrators = !required;
        this.persist();
        return this.policy();
    }

    isAdmin(publicKey) {
        return this.entries.get(assertPublicKey(publicKey))?.role === "admin";
    }

    list() {
        return [...this.entries.entries()]
            .map(([publicKey, entry]) => ({
                fingerprint: fingerprint(publicKey),
                ...entry
            }))
            .sort((left, right) =>
                left.fingerprint.localeCompare(right.fingerprint)
            );
    }

    add(publicKey, note = "", role = "orchestrator") {
        const key = assertPublicKey(publicKey);
        if (!new Set(["orchestrator", "admin"]).has(role)) {
            throw new Error("Authorization role must be orchestrator or admin");
        }
        if (this.entries.has(key))
            throw new Error("Public key is already authorized");
        this.entries.set(key, {
            role,
            note: validateNote(note)
        });
        this.persist();
        return { fingerprint: fingerprint(key), role, note };
    }

    remove(publicKey) {
        const key = assertPublicKey(publicKey);
        const entry = this.entries.get(key);
        if (!entry) throw new Error("Public key is not authorized");
        if (entry.role === "admin") {
            const admins = [...this.entries.values()].filter(
                (candidate) => candidate.role === "admin"
            );
            if (admins.length === 1)
                throw new Error("Cannot remove the final admin key");
        }
        this.entries.delete(key);
        this.persist();
        return { fingerprint: fingerprint(key), role: entry.role };
    }
}

module.exports = {
    AuthorizationStore,
    MAX_NOTE_BYTES,
    assertPublicKey,
    fingerprint,
    validateNote
};
