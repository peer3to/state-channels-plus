import { expect } from "chai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createSocketPair } from "../fixtures/distributed/testTransport";

const {
    ProtocolPeer
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    derivePoolKeys,
    authenticateClient,
    authenticateServer
} = require("../../scripts/e2e-parallel/distributed/authentication.js");
const {
    WorkerLeaseManager
} = require("../../scripts/e2e-parallel/distributed/workerLeaseManager.js");
const {
    WorkerAttemptSpool
} = require("../../scripts/e2e-parallel/distributed/workerAttemptSpool.js");
const {
    OrchestratorLogStore
} = require("../../scripts/e2e-parallel/distributed/orchestratorLogStore.js");
const {
    sendBundle
} = require("../../scripts/e2e-parallel/distributed/artifactTransfer.js");

describe("distributed parallel runner", function () {
    it("rejects a wrong-secret client before it can request a lease", async function () {
        const pair = await createSocketPair();
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            let leaseRequested = false;
            server.on("message", (message: { kind: string }) => {
                if (message.kind === "LEASE_REQUEST") leaseRequested = true;
            });
            const clientKeys = derivePoolKeys("wrong secret");
            const serverKeys = derivePoolKeys("right secret");
            const results = await Promise.allSettled([
                authenticateClient(
                    client,
                    clientKeys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                ),
                authenticateServer(
                    server,
                    serverKeys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                )
            ]);
            expect(results[0].status).to.equal("rejected");
            expect(leaseRequested).to.equal(false);
        } finally {
            await pair.close();
        }
    });

    it("rejects source paths not present in the offered manifest", async function () {
        const pair = await createSocketPair();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-request-"));
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const source = path.join(root, "source.ts");
            fs.writeFileSync(source, "source");
            const manifest = {
                version: 3,
                packageManager: "pnpm",
                workspaceId: "1".repeat(64),
                sourceDigest: "source",
                rootProjectPath: ".",
                runnerEntry: "runner.js",
                repositories: [],
                files: [
                    {
                        path: "source.ts",
                        bytes: 6,
                        sha256: crypto
                            .createHash("sha256")
                            .update("source")
                            .digest("hex"),
                        mode: 420
                    }
                ],
                fileCount: 1,
                expandedBytes: 6
            };
            Object.defineProperty(manifest, "localWorkspaceRoot", {
                value: root
            });
            server.on("message", (message: { kind: string }) => {
                if (message.kind === "WORKSPACE_OFFER") {
                    server.send(
                        "WORKSPACE_NEED",
                        {},
                        Buffer.from(
                            JSON.stringify({
                                changed: ["../outside"],
                                deleted: []
                            })
                        )
                    );
                }
            });

            let error: Error | undefined;
            try {
                await sendBundle(
                    client,
                    path.join(root, "delta.tgz"),
                    manifest
                );
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include("outside the offered manifest");
        } finally {
            await pair.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("moves an authenticated attempt log over a real socket and releases the lease", async function () {
        const pair = await createSocketPair();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-wire-")
        );
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const keys = derivePoolKeys(`fixture-${process.pid}`);
            await Promise.all([
                authenticateClient(
                    client,
                    keys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                ),
                authenticateServer(
                    server,
                    keys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                )
            ]);

            const connection = { sessionId: "orchestrator" };
            const leases = new WorkerLeaseManager();
            expect(leases.request(connection).kind).to.equal("LEASE_GRANTED");
            leases.markRunning(connection);

            const received = path.join(root, "attempt.ansi");
            const store = new OrchestratorLogStore(root);
            store.begin("attempt", received);
            server.on(
                "message",
                (message: {
                    kind: string;
                    header: Record<string, unknown>;
                    body: Buffer;
                }) => {
                    if (message.kind === "LOG_CHUNK") {
                        store.append(
                            "attempt",
                            message.header.sequence as number,
                            message.body,
                            message.header.stream
                        );
                    } else if (message.kind === "LOG_END") {
                        store.commit("attempt", message.header);
                    }
                }
            );

            const spool = new WorkerAttemptSpool(
                path.join(root, "attempt.spool"),
                1024
            );
            spool.write("stdout", Buffer.from("pass\n"));
            spool.write(
                "stderr",
                Buffer.from("\u001b[31mdiagnostic\u001b[0m\n")
            );
            await spool.send(client, { taskId: "1", attemptId: "1" }, 4);
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(fs.readFileSync(received, "utf8")).to.equal(
                "pass\n\u001b[31mdiagnostic\u001b[0m\n"
            );
            await leases.release(connection, async () => spool.remove());
            expect(leases.state).to.equal("idle");
            expect(fs.existsSync(path.join(root, "attempt.spool"))).to.equal(
                false
            );
        } finally {
            await pair.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
