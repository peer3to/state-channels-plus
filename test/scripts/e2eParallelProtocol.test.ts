import { expect } from "chai";
import crypto from "crypto";
import { createSocketPair } from "../fixtures/distributed/testTransport";

const {
    ProtocolPeer,
    waitForMessage
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    derivePoolKeys,
    authenticateClient,
    authenticateServer
} = require("../../scripts/e2e-parallel/distributed/authentication.js");
const {
    matchesConnectionRole
} = require("../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    isRoutineDiscoveryFailure: isRoutineOrchestratorFailure
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    isRoutineDiscoveryFailure: isRoutineServerFailure
} = require("../../scripts/e2e-parallel/distributed/server.js");

describe("distributed protocol", function () {
    it("rejects Hyperswarm connections opened in the wrong local role", function () {
        expect(matchesConnectionRole({ client: true }, true)).to.equal(true);
        expect(matchesConnectionRole({ client: false }, false)).to.equal(true);
        expect(matchesConnectionRole({ client: false }, true)).to.equal(false);
        expect(matchesConnectionRole({ client: true }, false)).to.equal(false);
        expect(matchesConnectionRole({}, true)).to.equal(true);
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
            expect(Buffer.compare(message.body, body)).to.equal(0);
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

    it("rejects oversized and truncated frames", async function () {
        const pair = await createSocketPair();
        try {
            const receiver = new ProtocolPeer(pair.server, { maxFrame: 8 });
            const error = new Promise<Error>((resolve) =>
                receiver.once("protocolError", resolve)
            );
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32BE(9);
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
});
