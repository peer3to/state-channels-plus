const path = require("path");
const { loadPersistentKeyPair } = require("./persistentIdentity");

// Restarting with a fresh transport key leaves stale worker announcements in
// the DHT. Persist one identity per worker name so discovery keeps finding the
// live process instead of dialing keys from previous processes.
function loadWorkerKeyPair(workRoot, workerName) {
    return loadPersistentKeyPair(
        path.join(workRoot, "worker-identities"),
        `${workerName}-seed`
    );
}

module.exports = { loadWorkerKeyPair };
