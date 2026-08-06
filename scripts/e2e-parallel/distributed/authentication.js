const crypto = require("crypto");
const { PROTOCOL_VERSION, waitForMessage } = require("./protocol");

function derivePoolKeys(secret) {
    if (!secret) throw new Error("SCP_TEST_POOL_SECRET is required");
    return {
        topic: crypto
            .createHash("sha256")
            .update(`peer3:test-pool:topic:v${PROTOCOL_VERSION}\0${secret}`)
            .digest(),
        authKey: crypto
            .createHash("sha256")
            .update(`peer3:test-pool:auth:v${PROTOCOL_VERSION}\0${secret}`)
            .digest()
    };
}

function proof(authKey, role, clientNonce, serverNonce, clientKey, serverKey) {
    return crypto
        .createHmac("sha256", authKey)
        .update(
            Buffer.concat([
                Buffer.from(`${role}\0`),
                clientNonce,
                serverNonce,
                clientKey,
                serverKey
            ])
        )
        .digest("hex");
}

function matchesProof(actual, expected) {
    return (
        typeof actual === "string" &&
        actual.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    );
}

async function authenticateClient(peer, authKey, keys, timeoutMs) {
    const clientNonce = crypto.randomBytes(32);
    await peer.send("AUTH_HELLO", {
        nonce: clientNonce.toString("hex"),
        publicKey: keys.local.toString("hex")
    });
    const challenge = await waitForMessage(peer, "AUTH_CHALLENGE", timeoutMs);
    const serverNonce = Buffer.from(challenge.header.nonce, "hex");
    const serverKey = Buffer.from(challenge.header.publicKey, "hex");
    const expectedServerProof = proof(
        authKey,
        "server",
        clientNonce,
        serverNonce,
        keys.local,
        serverKey
    );
    if (!matchesProof(challenge.header.proof, expectedServerProof)) {
        peer.close();
        throw new Error("Pool server authentication failed");
    }
    await peer.send("AUTH_PROOF", {
        proof: proof(
            authKey,
            "client",
            clientNonce,
            serverNonce,
            keys.local,
            serverKey
        )
    });
    await waitForMessage(peer, "AUTH_OK", timeoutMs);
    return { remotePublicKey: serverKey };
}

async function authenticateServer(peer, authKey, keys, timeoutMs) {
    const hello = await waitForMessage(peer, "AUTH_HELLO", timeoutMs);
    const clientNonce = Buffer.from(hello.header.nonce, "hex");
    const clientKey = Buffer.from(hello.header.publicKey, "hex");
    const serverNonce = crypto.randomBytes(32);
    await peer.send("AUTH_CHALLENGE", {
        nonce: serverNonce.toString("hex"),
        publicKey: keys.local.toString("hex"),
        proof: proof(
            authKey,
            "server",
            clientNonce,
            serverNonce,
            clientKey,
            keys.local
        )
    });
    const response = await waitForMessage(peer, "AUTH_PROOF", timeoutMs);
    const expected = proof(
        authKey,
        "client",
        clientNonce,
        serverNonce,
        clientKey,
        keys.local
    );
    const actual = response.header.proof || "";
    if (!matchesProof(actual, expected)) {
        throw new Error("Pool authentication failed");
    }
    await peer.send("AUTH_OK");
    return { remotePublicKey: clientKey };
}

module.exports = { derivePoolKeys, authenticateClient, authenticateServer };
