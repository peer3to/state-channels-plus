// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { LeasePoolHarness } from "../fixtures/distributed/leasePool";

const {
    AuthorizationStore
} = require("../../scripts/e2e-parallel/distributed/authorizationStore.js");
const {
    WorkerAuditLog,
    sanitizeRecord
} = require("../../scripts/e2e-parallel/distributed/auditLog.js");
const {
    loadOrchestratorKeyPair
} = require("../../scripts/e2e-parallel/distributed/orchestratorIdentity.js");

describe("distributed authorization and host audit", function () {
    it("prefers allowlisted transport keys and supports the migration fallback", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "authorization-"));
        try {
            const allowed = "a".repeat(64);
            const unlisted = "b".repeat(64);
            const store = new AuthorizationStore(root, {
                authorizedPublicKeys: [allowed]
            });
            expect(store.authorize(allowed)).to.deep.include({
                accepted: true,
                mode: "allowlist",
                role: "orchestrator"
            });
            expect(store.authorize(unlisted)).to.deep.include({
                accepted: true,
                mode: "shared-secret-migration"
            });
            store.setPublicKeyAuthorizationRequired(true);
            expect(store.authorize(unlisted)).to.deep.include({
                accepted: false,
                mode: "allowlist-required"
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("writes bounded host-owned records without source, secrets, paths, payloads, or guest logs", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-audit-"));
        try {
            const audit = new WorkerAuditLog(root);
            audit.append({
                action: "task-execution",
                accepted: true,
                callerFingerprint: "abc123",
                source: "untrusted source",
                secret: "pool secret",
                guestPath: "/environment/spool",
                taskPayload: { command: "do bad things" },
                rawLog: "unbounded"
            });
            const contents = audit.read();
            expect(contents).to.include("task-execution");
            expect(contents).to.include("abc123");
            expect(contents).not.to.include("untrusted source");
            expect(contents).not.to.include("pool secret");
            expect(contents).not.to.include("/environment/spool");
            expect(contents).not.to.include("do bad things");
            expect(contents).not.to.include("unbounded");
            const mode =
                fs.statSync(
                    path.join(root, "host-state", "audit", "worker-audit.jsonl")
                ).mode & 0o777;
            expect(mode).to.equal(0o600);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rotates the append-only audit trail at its configured bound", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-audit-"));
        try {
            const audit = new WorkerAuditLog(root, {
                maxBytes: 80,
                generations: 3
            });
            audit.append({ action: "connection", reason: "a".repeat(70) });
            audit.append({ action: "disconnect", reason: "b".repeat(70) });
            expect(
                fs.existsSync(
                    path.join(
                        root,
                        "host-state",
                        "audit",
                        "worker-audit.jsonl.1"
                    )
                )
            ).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("accepts only the audit schema's public summaries", function () {
        expect(
            sanitizeRecord({
                action: "lease-request",
                accepted: false,
                authorizationPolicy: {
                    publicKeyAuthorizationRequired: true,
                    injectedSecret: "never"
                },
                requestedProfile: { cpu: 8, injectedSecret: "never" },
                resolvedProfile: { cpu: 4 },
                privateKey: "never",
                source: "never"
            })
        ).to.deep.equal({
            action: "lease-request",
            accepted: false,
            authorizationPolicy: {
                publicKeyAuthorizationRequired: true
            },
            requestedProfile: { cpu: 8 },
            resolvedProfile: { cpu: 4 }
        });
    });

    it("records the full public transport key only for migration-fallback admission", async function () {
        const identityRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-audit-e2e-")
        );
        const pool = await LeasePoolHarness.create();
        try {
            const keyPair = loadOrchestratorKeyPair(identityRoot);
            const publicKey = keyPair.publicKey.toString("hex");
            const migrationWorker = await pool.startServer("worker-migration", {
                allowUnlistedOrchestrators: true
            });
            const allowlistedWorker = await pool.startServer(
                "worker-allowlist",
                {
                    authorizedPublicKeys: [publicKey],
                    allowUnlistedOrchestrators: false
                }
            );
            const orchestrator = await pool.startOrchestrator("audit-run", {
                keyPair
            });
            await Promise.all([
                orchestrator.waitFor(migrationWorker.name, "LEASE_GRANTED"),
                orchestrator.waitFor(allowlistedWorker.name, "LEASE_GRANTED")
            ]);

            const migrationRecords = fs
                .readFileSync(
                    path.join(
                        migrationWorker.workRoot,
                        "host-state",
                        "audit",
                        "worker-audit.jsonl"
                    ),
                    "utf8"
                )
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            const migration = migrationRecords.find(
                (record) =>
                    record.action === "connection" && record.accepted === true
            );
            expect(migration).to.include({
                authorizationMode: "shared-secret-migration",
                unlistedTransportKey: publicKey
            });

            const allowlistedAudit = fs.readFileSync(
                path.join(
                    allowlistedWorker.workRoot,
                    "host-state",
                    "audit",
                    "worker-audit.jsonl"
                ),
                "utf8"
            );
            const allowlisted = allowlistedAudit
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line))
                .find(
                    (record) =>
                        record.action === "connection" &&
                        record.accepted === true
                );
            expect(allowlisted.authorizationMode).to.equal("allowlist");
            expect(allowlisted).not.to.have.property("unlistedTransportKey");

            await Promise.all([
                orchestrator.send(migrationWorker.name, "RELEASE"),
                orchestrator.send(allowlistedWorker.name, "RELEASE")
            ]);
        } finally {
            await pool.close();
            fs.rmSync(identityRoot, { recursive: true, force: true });
        }
    });
});
