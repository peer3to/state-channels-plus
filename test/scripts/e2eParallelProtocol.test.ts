// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { EventEmitter } from "events";

const {
    waitForEnvironmentFrame
} = require("./fixtures/environmentFrameWait.js");
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { setImmediate } from "node:timers";
import { spawn } from "node:child_process";
import * as tar from "tar";
import { createSocketPair } from "../fixtures/distributed/testTransport";

const {
    loadOrchestratorKeyPair
} = require("../../scripts/e2e-parallel/distributed/orchestratorIdentity.js");
const {
    loadWorkerKeyPair
} = require("../../scripts/e2e-parallel/distributed/workerIdentity.js");
const {
    ProtocolPeer,
    waitForMessage
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    closeOwner,
    flushAnnouncements,
    guardConnectionErrors
} = require("../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    closeStream,
    connectionHash,
    localCloseReason,
    selectLowerHash
} = require("../../scripts/e2e-parallel/distributed/connectionLifecycle.js");
const {
    derivePoolKeys,
    authenticateClient,
    authenticateServer
} = require("../../scripts/e2e-parallel/distributed/authentication.js");
const {
    discoveryConfigurations
} = require("../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    EnvironmentFrameParser,
    GUEST_KINDS,
    HOST_KINDS,
    encodeEnvironmentFrame
} = require("../../scripts/e2e-parallel/distributed/environmentProtocol.js");
const {
    formatBusyStatus,
    isRoutineDiscoveryFailure: isRoutineOrchestratorFailure
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    waitForIdleMessage
} = require("../../scripts/e2e-parallel/distributed/artifactTransfer.js");
const {
    isRoutineDiscoveryFailure: isRoutineServerFailure,
    requireTransportPublicKey
} = require("../../scripts/e2e-parallel/distributed/server.js");

describe("distributed protocol", function () {
    it("rejects a server connection without an authenticated transport key", function () {
        expect(() => requireTransportPublicKey({})).to.throw(
            "Authenticated transport key is required"
        );
        expect(
            requireTransportPublicKey({ publicKey: Buffer.alloc(32, 1) })
        ).to.equal(Buffer.alloc(32, 1).toString("hex"));
    });

    it("selects the lower authenticated Noise handshake hash", function () {
        const higher = { connectionHash: "f".repeat(64) };
        const lower = { connectionHash: "0".repeat(64) };
        expect(selectLowerHash(higher, lower)).to.equal(lower);
        expect(selectLowerHash(lower, higher)).to.equal(lower);
        expect(
            connectionHash({ handshakeHash: Buffer.from("shared-session") })
        ).to.equal(Buffer.from("shared-session").toString("hex"));
    });

    it("attributes local, Hyperswarm, and transport closes", function () {
        const stream = {
            destroyed: false,
            destroying: false,
            destroy() {
                this.destroyed = true;
            }
        };
        expect(closeStream(stream, "protocol deduplication")).to.equal(true);
        expect(localCloseReason(stream)).to.equal("protocol deduplication");
        expect(closeOwner(localCloseReason(stream), null)).to.equal(
            "application closed: protocol deduplication"
        );
        expect(closeOwner(null, new Error("Duplicate connection"))).to.equal(
            "Hyperswarm deduplicated"
        );
        expect(
            closeOwner(
                null,
                Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })
            )
        ).to.equal(
            "Hyperswarm/UDX transport timed out; no local application close"
        );
        expect(
            closeOwner(
                null,
                Object.assign(new Error("reset"), { code: "ECONNRESET" })
            )
        ).to.equal("transport reported ECONNRESET; no local application close");
        expect(closeOwner(null, null)).to.include("no local application close");
    });

    it("keeps the workspace wait alive while the worker sends heartbeats", async function () {
        const pair = await createSocketPair();
        const sender = new ProtocolPeer(pair.client);
        const receiver = new ProtocolPeer(pair.server);
        try {
            const waiting = waitForIdleMessage(
                sender,
                "WORKSPACE_NEED",
                100,
                new Set(["HEARTBEAT"])
            );
            setTimeout(() => receiver.send("HEARTBEAT"), 50);
            setTimeout(
                () =>
                    receiver.send(
                        "WORKSPACE_NEED",
                        {},
                        Buffer.from('{"changed":[],"deleted":[]}')
                    ),
                125
            );

            expect((await waiting).kind).to.equal("WORKSPACE_NEED");
        } finally {
            await pair.close();
        }
    });

    it("tolerates a transport reset before protocol ownership is installed", function () {
        const stream = new EventEmitter();
        guardConnectionErrors(stream);

        expect(() =>
            stream.emit(
                "error",
                Object.assign(new Error("reset"), {
                    code: "ECONNRESET"
                })
            )
        ).not.to.throw();
    });

    it("gates readiness on announcements without waiting for lookups", async function () {
        let announcementFlushed = false;
        let lookupFlushed = false;
        await flushAnnouncements([
            {
                config: { server: true },
                discovery: {
                    flushed: async () => {
                        announcementFlushed = true;
                    }
                }
            },
            {
                config: { server: false },
                discovery: {
                    flushed: async () => {
                        lookupFlushed = true;
                    }
                }
            }
        ]);

        expect(announcementFlushed).to.equal(true);
        expect(lookupFlushed).to.equal(false);
    });
    it("keeps worker and orchestrator discovery roles on separate topics", function () {
        const keys = derivePoolKeys("role-specific-topics");
        expect(keys.workerTopic.equals(keys.orchestratorTopic)).to.equal(false);
        expect(
            discoveryConfigurations({
                announceTopics: [keys.workerTopic],
                lookupTopics: [keys.orchestratorTopic]
            })
        ).to.deep.equal([
            {
                topic: keys.workerTopic,
                server: true,
                client: false
            },
            {
                topic: keys.orchestratorTopic,
                server: false,
                client: true
            }
        ]);
    });

    it("persists one orchestrator identity per state directory", function () {
        const stateDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-identity-")
        );
        try {
            const first = loadOrchestratorKeyPair(stateDir);
            const second = loadOrchestratorKeyPair(stateDir);
            expect(second.publicKey.equals(first.publicKey)).to.equal(true);
            expect(second.secretKey.equals(first.secretKey)).to.equal(true);

            // A corrupt seed regenerates a fresh identity instead of throwing.
            fs.writeFileSync(
                path.join(stateDir, "orchestrator-seed"),
                "not-hex"
            );
            const third = loadOrchestratorKeyPair(stateDir);
            expect(third.publicKey.equals(first.publicKey)).to.equal(false);
            expect(
                loadOrchestratorKeyPair(stateDir).publicKey.equals(
                    third.publicKey
                )
            ).to.equal(true);
        } finally {
            fs.rmSync(stateDir, { recursive: true, force: true });
        }
    });

    it("uses one explicit orchestrator seed across fresh state directories", function () {
        const firstStateDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-explicit-seed-a-")
        );
        const secondStateDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-explicit-seed-b-")
        );
        const seed = "a".repeat(64);
        try {
            const first = loadOrchestratorKeyPair(firstStateDir, seed);
            const second = loadOrchestratorKeyPair(secondStateDir, seed);
            expect(second.publicKey.equals(first.publicKey)).to.equal(true);
            expect(second.secretKey.equals(first.secretKey)).to.equal(true);
            expect(fs.readdirSync(firstStateDir)).to.be.empty;
            expect(fs.readdirSync(secondStateDir)).to.be.empty;
            expect(() =>
                loadOrchestratorKeyPair(firstStateDir, "not-a-seed")
            ).to.throw("64-character lowercase hex");
        } finally {
            fs.rmSync(firstStateDir, { recursive: true, force: true });
            fs.rmSync(secondStateDir, { recursive: true, force: true });
        }
    });

    it("persists one transport identity per worker name", function () {
        const workRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), "worker-identity-")
        );
        try {
            const first = loadWorkerKeyPair(workRoot, "server-1");
            const restarted = loadWorkerKeyPair(workRoot, "server-1");
            const otherWorker = loadWorkerKeyPair(workRoot, "server-2");

            expect(restarted.publicKey.equals(first.publicKey)).to.equal(true);
            expect(restarted.secretKey.equals(first.secretKey)).to.equal(true);
            expect(otherWorker.publicKey.equals(first.publicKey)).to.equal(
                false
            );
        } finally {
            fs.rmSync(workRoot, { recursive: true, force: true });
        }
    });

    it("silences abandoned discovery authentication handshakes", function () {
        for (const message of [
            "Connection closed waiting for AUTH_HELLO",
            "Timed out waiting for AUTH_CHALLENGE",
            "Timed out waiting for AUTH_PROOF",
            "Connection closed waiting for AUTH_OK"
        ]) {
            expect(isRoutineOrchestratorFailure(new Error(message))).to.equal(
                true
            );
            expect(isRoutineServerFailure(new Error(message))).to.equal(true);
        }
        expect(
            isRoutineOrchestratorFailure(
                new Error("Pool server authentication failed")
            )
        ).to.equal(false);
    });

    it("preserves framed binary messages over a real fragmented socket", async function () {
        const pair = await createSocketPair();
        try {
            const sender = new ProtocolPeer(pair.client, { maxFrame: 1024 });
            const receiver = new ProtocolPeer(pair.server, { maxFrame: 1024 });
            const received = waitForMessage(receiver, "LOG_CHUNK");
            const body = Buffer.from([0, 27, 255, 1, 2, 3]);
            await sender.send("LOG_CHUNK", { sequence: 0 }, body);
            const message = await received;
            expect(message.header.sequence).to.equal(0);
            expect([...message.body]).to.deep.equal([...body]);
        } finally {
            await pair.close();
        }
    });

    it("authenticates both peers without putting the secret on the wire", async function () {
        const pair = await createSocketPair();
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const keys = derivePoolKeys("correct horse battery staple");
            const clientKey = crypto.randomBytes(32);
            const serverKey = crypto.randomBytes(32);
            const [clientResult, serverResult] = await Promise.all([
                authenticateClient(
                    client,
                    keys.authKey,
                    { local: clientKey },
                    1000
                ),
                authenticateServer(
                    server,
                    keys.authKey,
                    { local: serverKey },
                    1000
                )
            ]);
            expect(clientResult.remotePublicKey.equals(serverKey)).to.equal(
                true
            );
            expect(serverResult.remotePublicKey.equals(clientKey)).to.equal(
                true
            );
        } finally {
            await pair.close();
        }
    });

    it("rejects a peer-claimed authentication key that differs from the Noise transport key", async function () {
        const pair = await createSocketPair();
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const keys = derivePoolKeys("transport-binding");
            const clientKey = crypto.randomBytes(32);
            const claimedTransportKey = crypto.randomBytes(32);
            const serverAuthentication = authenticateServer(
                server,
                keys.authKey,
                {
                    local: crypto.randomBytes(32),
                    remote: claimedTransportKey
                },
                1000
            );
            await client.send("AUTH_HELLO", {
                nonce: crypto.randomBytes(32).toString("hex"),
                publicKey: clientKey.toString("hex")
            });
            let error: Error | undefined;
            try {
                await serverAuthentication;
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include("Noise connection");
        } finally {
            await pair.close();
        }
    });

    it("closes a server that cannot prove pool membership", async function () {
        const pair = await createSocketPair();
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            const keys = derivePoolKeys("trusted pool");
            const serverClosed = new Promise<void>((resolve) =>
                server.once("close", resolve)
            );
            server.on("message", async (message: { kind: string }) => {
                if (message.kind !== "AUTH_HELLO") return;
                await server.send("AUTH_CHALLENGE", {
                    nonce: crypto.randomBytes(32).toString("hex"),
                    publicKey: crypto.randomBytes(32).toString("hex"),
                    proof: "0".repeat(64)
                });
            });

            let error: Error | undefined;
            try {
                await authenticateClient(
                    client,
                    keys.authKey,
                    { local: crypto.randomBytes(32) },
                    1000
                );
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include("server authentication failed");
            await serverClosed;
            expect(server.takePending("AUTH_PROOF")).to.equal(null);
        } finally {
            await pair.close();
        }
    });

    it("retains a follow-up frame that arrives before its waiter is installed", async function () {
        const pair = await createSocketPair();
        try {
            const client = new ProtocolPeer(pair.client);
            const server = new ProtocolPeer(pair.server);
            await server.send("AUTH_OK");
            await server.send("SERVER_READY", {
                name: "worker-one",
                capabilities: {}
            });
            await waitForMessage(client, "AUTH_OK", 1000);
            await new Promise((resolve) => setImmediate(resolve));
            const ready = await waitForMessage(client, "SERVER_READY", 1000);
            expect(ready.header.name).to.equal("worker-one");
        } finally {
            await pair.close();
        }
    });

    it("transfers concise worker status updates", async function () {
        const pair = await createSocketPair();
        try {
            const sender = new ProtocolPeer(pair.client);
            const receiver = new ProtocolPeer(pair.server);
            const received = waitForMessage(receiver, "WORKER_STATUS", 1000);
            await sender.send("WORKER_STATUS", {
                status: "Installing dependencies"
            });
            expect((await received).header.status).to.equal(
                "Installing dependencies"
            );
        } finally {
            await pair.close();
        }
    });

    it("transfers infrastructure diagnostics with their process failure", async function () {
        const pair = await createSocketPair();
        try {
            const sender = new ProtocolPeer(pair.client);
            const receiver = new ProtocolPeer(pair.server);
            const received = waitForMessage(
                receiver,
                "INFRA_PROCESS_LOG",
                1000
            );
            await sender.send(
                "INFRA_PROCESS_LOG",
                {
                    processKind: "hardhat",
                    slotId: 2,
                    trigger: "hardhat process exited",
                    processFailure:
                        "slot 2 hardhat node exited (signal SIGKILL)",
                    uploadId: "upload-1",
                    sequence: 0,
                    chunkCount: 1
                },
                Buffer.from("hardhat output\n")
            );
            const message = await received;
            expect(message.header).to.deep.include({
                processKind: "hardhat",
                slotId: 2,
                trigger: "hardhat process exited",
                processFailure: "slot 2 hardhat node exited (signal SIGKILL)",
                uploadId: "upload-1",
                sequence: 0,
                chunkCount: 1
            });
            expect(message.body.toString()).to.equal("hardhat output\n");
        } finally {
            await pair.close();
        }
    });

    it("transfers workspace preparation failures explicitly", async function () {
        const pair = await createSocketPair();
        try {
            const sender = new ProtocolPeer(pair.client);
            const receiver = new ProtocolPeer(pair.server);
            const received = new Promise<{
                kind: string;
                header: { message: string };
            }>((resolve) => receiver.once("message", resolve));

            await sender.send("PREPARATION_ERROR", {
                message: "TypeScript compilation failed"
            });

            const message = await received;
            expect(message).to.deep.include({
                kind: "PREPARATION_ERROR"
            });
            expect(message.header.message).to.equal(
                "TypeScript compilation failed"
            );
        } finally {
            await pair.close();
        }
    });

    it("transfers a faulted worker restart reason", async function () {
        const pair = await createSocketPair();
        try {
            const sender = new ProtocolPeer(pair.client);
            const receiver = new ProtocolPeer(pair.server);
            const received = waitForMessage(receiver, "FAULTED", 1000);

            await sender.send("FAULTED", {
                message: "administrator must restart this worker"
            });

            expect((await received).header.message).to.equal(
                "administrator must restart this worker"
            );
        } finally {
            await pair.close();
        }
    });

    it("formats queued progress and its estimated wait", function () {
        expect(
            formatBusyStatus({
                state: "running",
                position: 1,
                status: "Running tests",
                completedTasks: 4,
                totalTasks: 10,
                estimatedWaitMs: 30000
            })
        ).to.equal(
            "Busy (Running tests; queue position 1; progress 4/10; estimated wait 30s)"
        );
    });

    it("rejects oversized and truncated frames", async function () {
        const pair = await createSocketPair();
        try {
            const receiver = new ProtocolPeer(pair.server, { maxFrame: 8 });
            const error = new Promise<Error>((resolve) =>
                receiver.once("protocolError", resolve)
            );
            const prefix = new Uint8Array([0, 0, 0, 9]);
            pair.client.write(prefix);
            expect((await error).message).to.include("too large");
        } finally {
            await pair.close();
        }
    });

    it("rejects unknown message kinds before they reach a lease owner", async function () {
        const pair = await createSocketPair();
        try {
            const sender = new ProtocolPeer(pair.client);
            let error: Error | undefined;
            try {
                await sender.send("UNKNOWN_KIND");
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include("Invalid message kind");
        } finally {
            await pair.close();
        }
    });

    it("parses bounded private environment frames without deserializing executable objects", async function () {
        const parser = new EnvironmentFrameParser({
            allowedKinds: GUEST_KINDS
        });
        const received = new Promise<{
            kind: string;
            payload: { message: { kind: string } };
            body: Buffer;
        }>((resolve) => parser.once("frame", resolve));
        const frame = encodeEnvironmentFrame(
            "WORKER_EVENT",
            { message: { kind: "INFRA_LOG" } },
            Buffer.from("data")
        );
        parser.consume(frame.subarray(0, 7));
        parser.consume(frame.subarray(7));
        const parsed = await received;
        expect(parsed.kind).to.equal("WORKER_EVENT");
        expect(parsed.payload.message.kind).to.equal("INFRA_LOG");
        expect(parsed.body.toString()).to.equal("data");
    });

    it("rejects unknown, malformed, oversized, and version-mismatched environment frames", async function () {
        const invalidFrames = [
            Buffer.from(
                `${JSON.stringify({ version: 1, kind: "SHELL", payload: {}, body: "" })}\n`
            ),
            Buffer.from("not-json\n"),
            Buffer.from(
                `${JSON.stringify({ version: 2, kind: "STATUS", payload: {}, body: "" })}\n`
            ),
            Buffer.from(
                `${JSON.stringify({ version: 1, kind: "STATUS", payload: { status: "ready", command: "id" }, body: "" })}\n`
            )
        ];
        for (const invalid of invalidFrames) {
            const parser = new EnvironmentFrameParser({
                allowedKinds: GUEST_KINDS
            });
            const error = new Promise<Error>((resolve) =>
                parser.once("error", resolve)
            );
            parser.consume(invalid);
            expect((await error).message).to.match(
                /Unknown environment|Unknown STATUS|Unexpected token|version mismatch/
            );
        }
        const oversized = new EnvironmentFrameParser({
            allowedKinds: GUEST_KINDS,
            maxFrameBytes: 4
        });
        const error = new Promise<Error>((resolve) =>
            oversized.once("error", resolve)
        );
        oversized.consume(Buffer.from("12345"));
        expect((await error).message).to.include("too large");
    });

    it("rejects out-of-order private environment messages before guest work starts", async function () {
        const parser = new EnvironmentFrameParser({
            allowedKinds: new Set(["SOURCE_CHUNK"]),
            direction: "host"
        });
        const error = new Promise<Error>((resolve) =>
            parser.once("error", resolve)
        );
        parser.consume(
            Buffer.from(
                `${JSON.stringify({ version: 1, kind: "SOURCE_CHUNK", payload: { sequence: 0 }, body: "" })}\n`
            )
        );
        expect((await error).message).to.include("Out-of-order");
    });

    it("bounds each private frame without rejecting coalesced valid frames", function () {
        const parser = new EnvironmentFrameParser({
            allowedKinds: GUEST_KINDS,
            maxFrameBytes: 80
        });
        const received: string[] = [];
        parser.on("frame", (frame: { payload: { status: string } }) =>
            received.push(frame.payload.status)
        );
        parser.consume(
            Buffer.concat([
                encodeEnvironmentFrame("STATUS", { status: "one" }),
                encodeEnvironmentFrame("STATUS", { status: "two" })
            ])
        );
        expect(received).to.deep.equal(["one", "two"]);
    });

    it("sends a large source manifest once while every source chunk stays bounded", function () {
        const manifest = {
            files: Array.from({ length: 6000 }, (_, index) => ({
                path: `repository/source-${index.toString().padStart(5, "0")}-${"x".repeat(24)}.ts`,
                sha256: "a".repeat(64)
            }))
        };
        expect(Buffer.byteLength(JSON.stringify(manifest))).to.be.greaterThan(
            512 * 1024
        );
        const frames = [
            encodeEnvironmentFrame("TRUSTED_RUNNER", { version: 1 }),
            encodeEnvironmentFrame("ENVIRONMENT_SETUP", {
                environmentKey: "a".repeat(64),
                orchestratorPublicKey: "b".repeat(64),
                profile: {},
                limits: {}
            }),
            encodeEnvironmentFrame("WORKSPACE_OFFER", { manifest: {} }),
            encodeEnvironmentFrame("SOURCE_BEGIN", { manifest }),
            encodeEnvironmentFrame(
                "SOURCE_CHUNK",
                { sequence: 0 },
                Buffer.alloc(256 * 1024)
            ),
            encodeEnvironmentFrame("SOURCE_COMPLETE", {
                byteCount: 256 * 1024,
                sha256: "c".repeat(64)
            })
        ];
        expect(frames.every((frame) => frame.length <= 1024 * 1024)).to.equal(
            true
        );
        expect(frames[4].toString()).not.to.include("source-00000");
        const parser = new EnvironmentFrameParser({
            allowedKinds: HOST_KINDS,
            direction: "host"
        });
        expect(() =>
            frames.forEach((frame) => parser.consume(frame))
        ).not.to.throw();
    });

    it("settles a guest frame wait once and removes its listeners on success", async function () {
        const notifications = new EventEmitter();
        const child = new EventEmitter();
        const waiting = waitForEnvironmentFrame(
            [],
            notifications,
            child,
            "PREPARED",
            100
        );
        notifications.emit("frame", { kind: "PREPARED", payload: {} });
        expect((await waiting).kind).to.equal("PREPARED");
        expect(notifications.listenerCount("frame")).to.equal(0);
        expect(child.listenerCount("exit")).to.equal(0);
    });

    it("reports an ERROR frame immediately while awaiting guest success", async function () {
        const notifications = new EventEmitter();
        const child = new EventEmitter();
        const waiting = waitForEnvironmentFrame(
            [],
            notifications,
            child,
            "PREPARED",
            100
        );
        notifications.emit("frame", {
            kind: "ERROR",
            payload: { message: "invalid runner repository" }
        });
        let failure: Error | null = null;
        try {
            await waiting;
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.equal("invalid runner repository");
        expect(notifications.listenerCount("frame")).to.equal(0);
    });

    it("reports PREPARATION_FAILED immediately while awaiting guest success", async function () {
        const notifications = new EventEmitter();
        const child = new EventEmitter();
        const waiting = waitForEnvironmentFrame(
            [],
            notifications,
            child,
            "PREPARED",
            100
        );
        notifications.emit("frame", {
            kind: "PREPARATION_FAILED",
            payload: { message: "cached preparation failed" }
        });
        let failure: Error | null = null;
        try {
            await waiting;
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.equal("cached preparation failed");
        expect(child.listenerCount("exit")).to.equal(0);
    });

    it("reports a guest child exit while awaiting a frame", async function () {
        const notifications = new EventEmitter();
        const child = new EventEmitter();
        const waiting = waitForEnvironmentFrame(
            [],
            notifications,
            child,
            "PREPARED",
            100
        );
        child.emit("exit", 1, null);
        let failure: Error | null = null;
        try {
            await waiting;
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.include("Guest exited");
        expect(notifications.listenerCount("frame")).to.equal(0);
    });

    it("times out a silent guest wait and removes its listeners", async function () {
        const notifications = new EventEmitter();
        const child = new EventEmitter();
        let failure: Error | null = null;
        try {
            await waitForEnvironmentFrame(
                [],
                notifications,
                child,
                "PREPARED",
                10
            );
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.equal("Timed out waiting for PREPARED");
        expect(notifications.listenerCount("frame")).to.equal(0);
        expect(child.listenerCount("exit")).to.equal(0);
    });

    it("reports an invalid runner repository without waiting for the guest timeout", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "invalid-runner-repository-")
        );
        const archiveRoot = path.join(root, "archive");
        const archivePath = path.join(root, "source.tgz");
        const guestRoot = path.join(root, "guest");
        fs.mkdirSync(path.join(archiveRoot, "project"), { recursive: true });
        const packageJson = Buffer.from(
            JSON.stringify({ name: "invalid-runner", version: "1.0.0" })
        );
        fs.writeFileSync(
            path.join(archiveRoot, "project", "package.json"),
            packageJson
        );
        await tar.c(
            { cwd: archiveRoot, file: archivePath, gzip: true, portable: true },
            ["project/package.json"]
        );
        const archive = fs.readFileSync(archivePath);
        const archiveSha256 = crypto
            .createHash("sha256")
            .update(archive)
            .digest("hex");
        const child = spawn(
            process.execPath,
            [path.resolve("scripts/e2e-parallel/distributed/isolatedGuest.js")],
            {
                env: {
                    ...process.env,
                    SCP_ISOLATED_ROOT: guestRoot
                },
                stdio: ["pipe", "pipe", "pipe"]
            }
        );
        const parser = new EnvironmentFrameParser({
            allowedKinds: GUEST_KINDS
        });
        const received: Array<{
            kind: string;
            payload: Record<string, unknown>;
        }> = [];
        const notifications = new EventEmitter();
        parser.on(
            "frame",
            (frame: { kind: string; payload: Record<string, unknown> }) => {
                received.push(frame);
                notifications.emit("frame", frame);
            }
        );
        child.stdout.on("data", (chunk) => parser.consume(chunk));
        const waitFrame = (kind: string) =>
            waitForEnvironmentFrame(received, notifications, child, kind);
        try {
            await waitFrame("READY");
            child.stdin.write(
                encodeEnvironmentFrame("TRUSTED_RUNNER", { version: 1 })
            );
            child.stdin.write(
                encodeEnvironmentFrame("ENVIRONMENT_SETUP", {
                    environmentKey: "a".repeat(64),
                    orchestratorPublicKey: "b".repeat(64),
                    profile: { diskBytes: 1024 ** 2, pidsLimit: 64 },
                    limits: {
                        maxCompressedBytes: 1024 ** 2,
                        maxExpandedBytes: 1024 ** 2,
                        maxAttemptSpoolBytes: 1024
                    }
                })
            );
            child.stdin.write(
                encodeEnvironmentFrame("WORKSPACE_OFFER", {
                    manifest: {
                        version: 3,
                        packageManager: "pnpm",
                        workspaceId: "c".repeat(64),
                        sourceDigest: "d".repeat(64),
                        rootProjectPath: "project",
                        runnerEntry:
                            "project/scripts/e2e-parallel/distributed/worker.js",
                        repositories: [],
                        files: [
                            {
                                path: "project/package.json",
                                bytes: packageJson.length,
                                sha256: crypto
                                    .createHash("sha256")
                                    .update(packageJson)
                                    .digest("hex"),
                                mode: 420
                            }
                        ],
                        fileCount: 1,
                        expandedBytes: packageJson.length
                    }
                })
            );
            await waitFrame("WORKSPACE_NEED");
            child.stdin.write(
                encodeEnvironmentFrame("SOURCE_BEGIN", {
                    manifest: {
                        version: 3,
                        packageManager: "pnpm",
                        archiveBytes: archive.length,
                        archiveSha256,
                        expandedBytes: packageJson.length,
                        fileCount: 1,
                        repositories: []
                    }
                })
            );
            child.stdin.write(
                encodeEnvironmentFrame("SOURCE_CHUNK", { sequence: 0 }, archive)
            );
            child.stdin.write(
                encodeEnvironmentFrame("SOURCE_COMPLETE", {
                    byteCount: archive.length,
                    sha256: archiveSha256
                })
            );
            const startedAt = Date.now();
            let failure: Error | null = null;
            try {
                await waitFrame("PREPARED");
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include(
                "Distributed runner repository is missing"
            );
            expect(Date.now() - startedAt).to.be.lessThan(2000);
        } finally {
            child.kill("SIGKILL");
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("extracts a chunked source transfer with a manifest larger than 512 KiB", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "large-source-frame-")
        );
        const archiveRoot = path.join(root, "archive");
        const archivePath = path.join(root, "source.tgz");
        const guestRoot = path.join(root, "guest");
        const environmentKey = crypto
            .createHash("sha256")
            .update("b".repeat(64))
            .update("\0")
            .update("c".repeat(64))
            .digest("hex");
        const environmentRoot = path.join(
            guestRoot,
            "environments",
            environmentKey
        );
        fs.mkdirSync(path.join(environmentRoot, "workspace"), {
            recursive: true
        });
        fs.writeFileSync(
            path.join(environmentRoot, "source-manifest.json"),
            JSON.stringify({ sourceDigest: "d".repeat(64), files: [] })
        );
        fs.writeFileSync(
            path.join(environmentRoot, "prepared.json"),
            JSON.stringify({
                sourceDigest: "d".repeat(64),
                preparationVersion: 2
            })
        );
        fs.mkdirSync(path.join(archiveRoot, "project"), { recursive: true });
        const payload = crypto.randomBytes(600 * 1024);
        const packageJson = Buffer.from(
            JSON.stringify({ name: "large-source-frame", version: "1.0.0" })
        );
        fs.writeFileSync(
            path.join(archiveRoot, "project", "payload.bin"),
            payload
        );
        fs.writeFileSync(
            path.join(archiveRoot, "project", "package.json"),
            packageJson
        );
        await tar.c(
            { cwd: archiveRoot, file: archivePath, gzip: true, portable: true },
            ["project/payload.bin", "project/package.json"]
        );
        const archive = fs.readFileSync(archivePath);
        const deltaManifest = {
            version: 3,
            packageManager: "pnpm",
            archiveBytes: archive.length,
            archiveSha256: crypto
                .createHash("sha256")
                .update(archive)
                .digest("hex"),
            expandedBytes: payload.length + packageJson.length,
            fileCount: 2,
            repositories: [],
            padding: "x".repeat(540 * 1024)
        };
        expect(
            Buffer.byteLength(JSON.stringify(deltaManifest))
        ).to.be.greaterThan(512 * 1024);
        const child = spawn(
            process.execPath,
            [path.resolve("scripts/e2e-parallel/distributed/isolatedGuest.js")],
            {
                env: {
                    ...process.env,
                    SCP_ISOLATED_ROOT: guestRoot
                },
                stdio: ["pipe", "pipe", "pipe"]
            }
        );
        const parser = new EnvironmentFrameParser({
            allowedKinds: GUEST_KINDS
        });
        const received: Array<{
            kind: string;
            payload: Record<string, unknown>;
        }> = [];
        const notifications = new EventEmitter();
        parser.on(
            "frame",
            (frame: { kind: string; payload: Record<string, unknown> }) => {
                received.push(frame);
                notifications.emit("frame", frame);
            }
        );
        child.stdout.on("data", (chunk) => parser.consume(chunk));
        const waitFrame = (kind: string) =>
            waitForEnvironmentFrame(received, notifications, child, kind);
        try {
            await waitFrame("READY");
            child.stdin.write(
                encodeEnvironmentFrame("TRUSTED_RUNNER", { version: 1 })
            );
            child.stdin.write(
                encodeEnvironmentFrame("ENVIRONMENT_SETUP", {
                    environmentKey: "a".repeat(64),
                    orchestratorPublicKey: "b".repeat(64),
                    profile: { diskBytes: 2 * 1024 ** 2, pidsLimit: 64 },
                    limits: {
                        maxCompressedBytes: 2 * 1024 ** 2,
                        maxExpandedBytes: 2 * 1024 ** 2,
                        maxAttemptSpoolBytes: 1024
                    }
                })
            );
            child.stdin.write(
                encodeEnvironmentFrame("WORKSPACE_OFFER", {
                    manifest: {
                        version: 3,
                        packageManager: "pnpm",
                        workspaceId: "c".repeat(64),
                        sourceDigest: "d".repeat(64),
                        rootProjectPath: "project",
                        runnerEntry:
                            "project/scripts/e2e-parallel/distributed/worker.js",
                        repositories: [
                            {
                                path: "project",
                                name: "large-source-frame",
                                prepareScript: null,
                                cachedPrepareScript: null,
                                contractCompileInputs: [],
                                verifyNativeModules: [],
                                hasPnpmLock: false,
                                hasYarnLock: false
                            }
                        ],
                        files: [],
                        fileCount: 0,
                        expandedBytes: 0
                    }
                })
            );
            await waitFrame("WORKSPACE_NEED");
            const begin = encodeEnvironmentFrame("SOURCE_BEGIN", {
                manifest: deltaManifest
            });
            expect(begin.length).to.be.lessThan(1024 * 1024);
            child.stdin.write(begin);
            let sequence = 0;
            for (
                let offset = 0;
                offset < archive.length;
                offset += 256 * 1024
            ) {
                const frame = encodeEnvironmentFrame(
                    "SOURCE_CHUNK",
                    { sequence: sequence++ },
                    archive.subarray(offset, offset + 256 * 1024)
                );
                expect(frame.length).to.be.lessThan(1024 * 1024);
                child.stdin.write(frame);
            }
            child.stdin.write(
                encodeEnvironmentFrame("SOURCE_COMPLETE", {
                    byteCount: archive.length,
                    sha256: deltaManifest.archiveSha256
                })
            );
            await waitFrame("PREPARED");
            expect(
                fs.existsSync(
                    path.join(
                        root,
                        "guest",
                        "environments",
                        environmentKey,
                        "workspace",
                        "project",
                        "payload.bin"
                    )
                )
            ).to.equal(true);
            child.stdin.write(encodeEnvironmentFrame("STOP"));
            await waitFrame("STOPPED");
        } finally {
            child.kill("SIGKILL");
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
