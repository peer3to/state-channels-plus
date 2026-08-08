const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const DHT = require("@hyperswarm/dht");

function loadPersistentKeyPair(stateDir, seedFileName) {
    const seedPath = path.join(stateDir, seedFileName);
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
    fs.chmodSync(seedPath, 0o600);
    return DHT.keyPair(seed);
}

module.exports = { loadPersistentKeyPair };
