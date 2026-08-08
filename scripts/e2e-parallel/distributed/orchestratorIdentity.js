const { loadPersistentKeyPair } = require("./persistentIdentity");

// A fresh keypair per run would announce a new orchestrator identity on every
// attempt: stale announcements from earlier runs linger in the DHT for
// minutes, so workers dialing back waste their discovery window on dead keys.
// Persisting one seed per machine keeps the announced identity stable, letting
// a worker's next topic refresh find and dial the live orchestrator
// immediately. One orchestrator run per machine at a time — two concurrent
// runs would share the identity and confuse the servers' per-peer dedupe.
function loadOrchestratorKeyPair(stateDir) {
    return loadPersistentKeyPair(stateDir, "orchestrator-seed");
}

module.exports = { loadOrchestratorKeyPair };
