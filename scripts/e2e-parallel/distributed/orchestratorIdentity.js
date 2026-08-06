const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const DHT = require("@hyperswarm/dht");

// A fresh keypair per run would announce a new orchestrator identity on every
// attempt: stale announcements from earlier runs linger in the DHT for
// minutes, so workers dialing back waste their discovery window on dead keys.
// Persisting one seed per machine keeps the announced identity stable, letting
// a worker's next topic refresh find and dial the live orchestrator
// immediately. One orchestrator run per machine at a time — two concurrent
// runs would share the identity and confuse the servers' per-peer dedupe.
function loadOrchestratorKeyPair(stateDir) {
    const seedPath = path.join(stateDir, "orchestrator-seed");
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    let seed = null;
    try {
        seed = Buffer.from(fs.readFileSync(seedPath, "utf8").trim(), "hex");
    } catch {}
    if (!seed || seed.length !== 32) {
        seed = crypto.randomBytes(32);
        fs.writeFileSync(seedPath, `${seed.toString("hex")}\n`, {
            mode: 0o600
        });
    }
    return DHT.keyPair(seed);
}

module.exports = { loadOrchestratorKeyPair };
