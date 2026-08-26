const { loadPersistentKeyPair } = require("./persistentIdentity");
const DHT = require("@hyperswarm/dht");

function keyPairFromSeed(seedHex) {
    if (!/^[a-f0-9]{64}$/.test(seedHex || "")) {
        throw new Error(
            "SCP_TEST_ORCHESTRATOR_SEED must be a 64-character lowercase hex value"
        );
    }
    return DHT.keyPair(Buffer.from(seedHex, "hex"));
}

// A fresh keypair per run would announce a new orchestrator identity on every
// attempt: stale announcements from earlier runs linger in the DHT for
// minutes, so workers dialing back waste their discovery window on dead keys.
// Persisting one seed per machine keeps the announced identity stable, letting
// a worker's next topic refresh find and dial the live orchestrator
// immediately. One orchestrator run per machine at a time — two concurrent
// runs would share the identity and confuse the servers' per-peer dedupe.
function loadOrchestratorKeyPair(stateDir, seedHex) {
    if (seedHex !== undefined && seedHex !== null) {
        return keyPairFromSeed(seedHex);
    }
    return loadPersistentKeyPair(stateDir, "orchestrator-seed");
}

module.exports = { keyPairFromSeed, loadOrchestratorKeyPair };
