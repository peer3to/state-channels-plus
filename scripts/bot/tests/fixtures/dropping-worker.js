const DHT = require("hyperdht");

/**
 * A review-topic peer that dials the caller directly, keeps each stream open
 * for `holdMs` without answering authentication, closes it, and dials again.
 * Hyperswarm's own retry backoff is at least one second, so a direct dial is
 * the only way to drop streams faster than a short connect deadline.
 */
async function streamDroppingWorker({
    dht,
    callerKey,
    holdMs = 50,
    redialMs = 50
}) {
    const keyPair = DHT.keyPair();
    const sockets = new Set();
    // Times (ms since epoch) at which an opened stream was closed by the worker.
    const drops = [];
    let stopped = false,
        redialTimer;
    const dial = () => {
        if (stopped) return;
        const socket = dht.connect(callerKey, { keyPair });
        sockets.add(socket);
        socket.on("error", () => {});
        socket.once("open", () =>
            setTimeout(() => {
                drops.push(Date.now());
                socket.destroy();
            }, holdMs)
        );
        socket.once("close", () => {
            sockets.delete(socket);
            if (!stopped) redialTimer = setTimeout(dial, redialMs);
        });
    };
    dial();
    return {
        publicKey: keyPair.publicKey,
        drops,
        async close() {
            stopped = true;
            clearTimeout(redialTimer);
            for (const socket of sockets) socket.destroy();
            await dht.destroy();
        }
    };
}
module.exports = { streamDroppingWorker };
