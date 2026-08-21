// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
    LeasePoolHarness,
    startLeaseWorkerServer
} from "../fixtures/distributed/leasePool";
import {
    createLocalDhtNetwork,
    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
} from "../fixtures/distributed/testTransport";

const {
    AuthorizationStore
} = require("../../scripts/e2e-parallel/distributed/authorizationStore.js");
const {
    loadOrchestratorKeyPair
} = require("../../scripts/e2e-parallel/distributed/orchestratorIdentity.js");
const {
    parseAdminArgs,
    runAdmin
} = require("../../scripts/e2e-parallel/distributed/distributedAdmin.js");

describe("distributed authorization administration", function () {
    it("prints the persistent orchestrator identity through its own CLI", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-identity-")
        );
        try {
            const identityCli = path.resolve(
                "scripts/e2e-parallel/distributed/distributedIdentity.js"
            );
            const publicKey = execFileSync(
                process.execPath,
                [identityCli, "--state-dir", root],
                { encoding: "utf8" }
            ).trim();
            expect(publicKey).to.equal(
                loadOrchestratorKeyPair(root).publicKey.toString("hex")
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps identity inspection out of the admin command namespace", function () {
        expect(() =>
            parseAdminArgs(["node", "distributedAdmin.js", "identity"])
        ).to.throw("Unknown distributed admin command: identity");
    });

    it("persists an added ordinary key and its bounded operator note", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-admin-")
        );
        try {
            const admin = "a".repeat(64);
            const ordinary = "b".repeat(64);
            const store = new AuthorizationStore(root, {
                adminPublicKeys: [admin]
            });
            store.add(ordinary, "CI orchestrator");
            const reloaded = new AuthorizationStore(root);
            expect(reloaded.list()).to.deep.include({
                fingerprint: ordinary.slice(0, 12),
                role: "orchestrator",
                note: "CI orchestrator"
            });
            expect(reloaded.isAdmin(admin)).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("removes an ordinary key for future admission while leaving prior decisions immutable", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-admin-")
        );
        try {
            const ordinary = "c".repeat(64);
            const store = new AuthorizationStore(root, {
                adminPublicKeys: ["a".repeat(64)],
                authorizedPublicKeys: [ordinary],
                allowUnlistedOrchestrators: false
            });
            const activeAdmission = store.authorize(ordinary);
            store.remove(ordinary);
            expect(activeAdmission.accepted).to.equal(true);
            expect(store.authorize(ordinary).accepted).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects malformed keys, duplicate adds, missing removals, and unsafe notes", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-admin-")
        );
        try {
            const ordinary = "d".repeat(64);
            const store = new AuthorizationStore(root, {
                adminPublicKeys: ["a".repeat(64)]
            });
            expect(() => store.add("not-a-key")).to.throw("Public key");
            store.add(ordinary);
            expect(() => store.add(ordinary)).to.throw("already authorized");
            expect(() => store.remove("e".repeat(64))).to.throw(
                "not authorized"
            );
            expect(() => store.add("f".repeat(64), "line\nbreak")).to.throw(
                "plain text"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("protects the final configured admin key", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-admin-")
        );
        try {
            const admin = "a".repeat(64);
            const store = new AuthorizationStore(root, {
                adminPublicKeys: [admin]
            });
            expect(() => store.remove(admin)).to.throw("final admin");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("persists public-key authorization policy changes", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-policy-")
        );
        try {
            const store = new AuthorizationStore(root, {
                adminPublicKeys: ["a".repeat(64)]
            });
            expect(store.policy()).to.deep.equal({
                publicKeyAuthorizationRequired: false
            });
            store.setPublicKeyAuthorizationRequired(true);
            expect(new AuthorizationStore(root).policy()).to.deep.equal({
                publicKeyAuthorizationRequired: true
            });
            expect(
                new AuthorizationStore(root).authorize("b".repeat(64)).accepted
            ).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("bootstraps the first admin idempotently and refuses replacement", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-bootstrap-")
        );
        const workerAdmin = path.resolve(
            "scripts/e2e-parallel/distributed/workerAdmin.js"
        );
        const admin = "a".repeat(64);
        try {
            const args = [
                workerAdmin,
                "authorization-bootstrap-admin",
                "--work-root",
                root,
                "--public-key",
                admin
            ];
            execFileSync(process.execPath, args);
            execFileSync(process.execPath, args);
            expect(new AuthorizationStore(root).isAdmin(admin)).to.equal(true);
            expect(() =>
                execFileSync(process.execPath, [
                    workerAdmin,
                    "authorization-bootstrap-admin",
                    "--work-root",
                    root,
                    "--public-key",
                    "b".repeat(64)
                ])
            ).to.throw();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("parses role-aware distributed admin commands", function () {
        const worker = "a".repeat(64);
        const publicKey = "b".repeat(64);
        expect(
            parseAdminArgs([
                "node",
                "distributedAdmin.js",
                "authorization-add",
                "--worker",
                worker,
                "--public-key",
                publicKey,
                "--role",
                "admin",
                "--note",
                "release operators"
            ])
        ).to.include({
            command: "authorization-add",
            worker,
            publicKey,
            role: "admin",
            note: "release operators"
        });
    });

    it("treats an omitted worker as a pool-wide admin operation", function () {
        const publicKey = "b".repeat(64);
        const parsed = parseAdminArgs([
            "node",
            "distributedAdmin.js",
            "authorization-add",
            "--public-key",
            publicKey,
            "--role",
            "orchestrator"
        ]);
        expect(parsed.worker).to.equal(undefined);
        expect(parsed.publicKey).to.equal(publicKey);
    });

    it("parses pool-wide public-key authorization policy changes", function () {
        const enabled = parseAdminArgs([
            "node",
            "distributedAdmin.js",
            "authorization-policy-set",
            "--require-public-key",
            "on"
        ]);
        expect(enabled).to.include({
            command: "authorization-policy-set",
            publicKeyAuthorizationRequired: true
        });
        expect(enabled.worker).to.equal(undefined);
        expect(() =>
            parseAdminArgs([
                "node",
                "distributedAdmin.js",
                "authorization-policy-set",
                "--require-public-key",
                "sometimes"
            ])
        ).to.throw("must be on or off");
    });

    it("sets and reports public-key authorization policy on every discovered worker", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-policy-client-")
        );
        const network = await createLocalDhtNetwork();
        const poolSecret = `policy-client-${process.pid}-${Date.now()}`;
        const adminKeyPair = loadOrchestratorKeyPair(path.join(root, "admin"));
        const adminPublicKey = adminKeyPair.publicKey.toString("hex");
        const firstRoot = path.join(root, "worker-one");
        const secondRoot = path.join(root, "worker-two");
        const first = await startLeaseWorkerServer({
            dht: network.createNode(),
            name: "worker-policy-one",
            poolSecret,
            workRoot: firstRoot,
            adminPublicKeys: [adminPublicKey],
            allowUnlistedOrchestrators: true
        });
        const second = await startLeaseWorkerServer({
            dht: network.createNode(),
            name: "worker-policy-two",
            poolSecret,
            workRoot: secondRoot,
            adminPublicKeys: [adminPublicKey],
            allowUnlistedOrchestrators: true
        });
        try {
            const changed = await runAdmin(
                {
                    command: "authorization-policy-set",
                    stateDir: path.join(root, "admin"),
                    discoveryTimeoutMs: TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS,
                    publicKeyAuthorizationRequired: true,
                    role: "orchestrator",
                    note: "",
                    poolSecret,
                    keyPair: adminKeyPair
                },
                { dht: network.createNode() }
            );
            expect(changed.results).to.have.length(2);
            expect(
                changed.results.every(
                    (entry: {
                        accepted: boolean;
                        authorizationPolicy: {
                            publicKeyAuthorizationRequired: boolean;
                        };
                    }) =>
                        entry.accepted &&
                        entry.authorizationPolicy.publicKeyAuthorizationRequired
                )
            ).to.equal(true);
            expect(new AuthorizationStore(firstRoot).policy()).to.deep.equal({
                publicKeyAuthorizationRequired: true
            });
            expect(new AuthorizationStore(secondRoot).policy()).to.deep.equal({
                publicKeyAuthorizationRequired: true
            });

            const listed = await runAdmin(
                {
                    command: "workers",
                    stateDir: path.join(root, "admin"),
                    discoveryTimeoutMs: TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS,
                    role: "orchestrator",
                    note: "",
                    poolSecret,
                    keyPair: adminKeyPair
                },
                { dht: network.createNode() }
            );
            expect(listed.workers).to.have.length(2);
            expect(
                listed.workers.every(
                    (worker: {
                        authorizationPolicy: {
                            publicKeyAuthorizationRequired: boolean;
                        };
                    }) =>
                        worker.authorizationPolicy
                            .publicKeyAuthorizationRequired
                )
            ).to.equal(true);
        } finally {
            await first.shutdown();
            await second.shutdown();
            await network.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("uses the persistent admin identity to add an admin key over worker discovery", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-admin-client-")
        );
        const network = await createLocalDhtNetwork();
        const poolSecret = `admin-client-${process.pid}-${Date.now()}`;
        const adminKeyPair = loadOrchestratorKeyPair(path.join(root, "admin"));
        const addedAdminKeyPair = loadOrchestratorKeyPair(
            path.join(root, "added-admin")
        );
        const workRoot = path.join(root, "worker");
        const worker = await startLeaseWorkerServer({
            dht: network.createNode(),
            name: "worker-admin-client",
            poolSecret,
            workRoot,
            adminPublicKeys: [adminKeyPair.publicKey.toString("hex")],
            allowUnlistedOrchestrators: false
        });
        try {
            const result = await runAdmin(
                {
                    command: "authorization-add",
                    stateDir: path.join(root, "admin"),
                    discoveryTimeoutMs: 5000,
                    publicKey: addedAdminKeyPair.publicKey.toString("hex"),
                    role: "admin",
                    note: "backup operator",
                    poolSecret,
                    keyPair: adminKeyPair
                },
                { dht: network.createNode() }
            );
            expect(result.results).to.deep.equal([
                {
                    worker: {
                        name: "worker-admin-client",
                        publicKey: worker.workerId
                    },
                    accepted: true,
                    entries: [
                        {
                            fingerprint: addedAdminKeyPair.publicKey
                                .toString("hex")
                                .slice(0, 12),
                            role: "admin",
                            note: "backup operator"
                        }
                    ]
                }
            ]);
            expect(
                new AuthorizationStore(workRoot).isAdmin(
                    addedAdminKeyPair.publicKey.toString("hex")
                )
            ).to.equal(true);
            const listed = await runAdmin(
                {
                    command: "authorization-list",
                    stateDir: path.join(root, "added-admin"),
                    discoveryTimeoutMs: 5000,
                    worker: worker.workerId,
                    role: "orchestrator",
                    note: "",
                    poolSecret,
                    keyPair: addedAdminKeyPair
                },
                { dht: network.createNode() }
            );
            expect(listed.entries).to.deep.include({
                fingerprint: addedAdminKeyPair.publicKey
                    .toString("hex")
                    .slice(0, 12),
                role: "admin",
                note: "backup operator"
            });
        } finally {
            await worker.shutdown();
            await network.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("lists, persists, removes, and applies worker-targeted authorization changes without ending an existing connection", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "authorization-e2e-")
        );
        const pool = await LeasePoolHarness.create();
        try {
            const adminKeyPair = loadOrchestratorKeyPair(
                path.join(root, "admin")
            );
            const ordinaryKeyPair = loadOrchestratorKeyPair(
                path.join(root, "ordinary")
            );
            const admin = await pool.startOrchestrator("admin", {
                keyPair: adminKeyPair
            });
            let worker = await pool.startServer("worker-a", {
                adminPublicKeys: [admin.publicKey()],
                allowUnlistedOrchestrators: false
            });
            await admin.waitFor(worker.name, "LEASE_GRANTED");
            const addCheckpoint = admin.checkpoint();
            await admin.send(worker.name, "AUTHORIZATION_ADD", {
                targetWorker: worker.workerId,
                requestId: "add-1",
                publicKey: ordinaryKeyPair.publicKey.toString("hex"),
                note: "ephemeral CI"
            });
            const added = await admin.waitFor(
                worker.name,
                "AUTHORIZATION_RESULT",
                { after: addCheckpoint }
            );
            expect(added.header.accepted).to.equal(true);

            const restartCheckpoint = admin.checkpoint();
            await pool.stopServer(worker);
            worker = await pool.startServer("worker-a", {
                adminPublicKeys: [admin.publicKey()],
                allowUnlistedOrchestrators: false
            });
            await admin.waitFor(worker.name, "LEASE_GRANTED", {
                after: restartCheckpoint
            });
            await admin.send(worker.name, "AUTHORIZATION_LIST", {
                targetWorker: worker.workerId,
                requestId: "list-1"
            });
            const listed = await admin.waitFor(
                worker.name,
                "AUTHORIZATION_RESULT",
                {
                    after: restartCheckpoint,
                    predicate: (event) => event.header.requestId === "list-1"
                }
            );
            expect(listed.header.entries).to.deep.include({
                fingerprint: ordinaryKeyPair.publicKey
                    .toString("hex")
                    .slice(0, 12),
                role: "orchestrator",
                note: "ephemeral CI"
            });

            const ordinary = await pool.startOrchestrator("ordinary", {
                keyPair: ordinaryKeyPair
            });
            await ordinary.waitFor(worker.name, "BUSY");
            const deniedCheckpoint = ordinary.checkpoint();
            await ordinary.send(worker.name, "AUTHORIZATION_ADD", {
                targetWorker: worker.workerId,
                requestId: "denied-add",
                publicKey: "f".repeat(64),
                note: "must not be added"
            });
            const denied = await ordinary.waitFor(
                worker.name,
                "AUTHORIZATION_RESULT",
                { after: deniedCheckpoint }
            );
            expect(denied.header.accepted).to.equal(false);
            const removeCheckpoint = admin.checkpoint();
            await admin.send(worker.name, "AUTHORIZATION_REMOVE", {
                targetWorker: worker.workerId,
                requestId: "remove-1",
                publicKey: ordinaryKeyPair.publicKey.toString("hex")
            });
            const removed = await admin.waitFor(
                worker.name,
                "AUTHORIZATION_RESULT",
                { after: removeCheckpoint }
            );
            expect(removed.header.accepted).to.equal(true);
            const promotionCheckpoint = ordinary.checkpoint();
            await admin.send(worker.name, "RELEASE");
            await ordinary.waitFor(worker.name, "LEASE_GRANTED", {
                after: promotionCheckpoint
            });
            await ordinary.send(worker.name, "RELEASE");
            await ordinary.waitFor(worker.name, "LEASE_CLEAN", {
                after: promotionCheckpoint
            });
            await pool.closeOrchestrator(ordinary);
            const reconnect = await pool.startOrchestrator("ordinary-again", {
                keyPair: ordinaryKeyPair
            });
            const auditPath = path.join(
                worker.workRoot,
                "host-state",
                "audit",
                "worker-audit.jsonl"
            );
            const expectedFingerprint = ordinaryKeyPair.publicKey
                .toString("hex")
                .slice(0, 12);
            const deadline = Date.now() + 5000;
            let deniedAdmission = false;
            while (!deniedAdmission && Date.now() < deadline) {
                const records = fs
                    .readFileSync(auditPath, "utf8")
                    .trim()
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => JSON.parse(line));
                deniedAdmission = records.some(
                    (record) =>
                        record.action === "connection" &&
                        record.accepted === false &&
                        record.callerFingerprint === expectedFingerprint
                );
                if (!deniedAdmission) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
            }
            expect(deniedAdmission).to.equal(true);
            expect(reconnect.connectedWorkerCount()).to.equal(0);
            expect(JSON.stringify(listed.header.entries)).not.to.include(
                ordinaryKeyPair.secretKey.toString("hex")
            );
        } finally {
            await pool.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
