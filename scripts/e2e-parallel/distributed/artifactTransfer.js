const crypto = require("crypto");
const fs = require("fs");
const { waitForMessage } = require("./protocol");
const { buildDeltaBundle } = require("./runtimeBundle");

function waitForIdleMessage(
    peer,
    kind,
    idleTimeoutMs,
    activityKinds = new Set()
) {
    const pending = peer.takePending(kind);
    if (pending) return Promise.resolve(pending);
    return new Promise((resolve, reject) => {
        let timer;
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(
                () => done(new Error(`Timed out waiting for ${kind}`)),
                idleTimeoutMs
            );
        };
        const onMessage = (message) => {
            if (message.kind === kind) done(null, message);
            else if (activityKinds.has(message.kind)) arm();
        };
        const onClose = () =>
            done(new Error(`Connection closed waiting for ${kind}`));
        const done = (error, message) => {
            clearTimeout(timer);
            peer.off("message", onMessage);
            peer.off("close", onClose);
            if (error) reject(error);
            else resolve(message);
        };
        peer.on("message", onMessage);
        peer.once("close", onClose);
        arm();
    });
}

async function sendBundle(
    peer,
    archivePath,
    manifest,
    chunkBytes = 256 * 1024,
    onNeed = () => {}
) {
    // Concurrent workers request different deltas, so they cannot share one
    // archive path without overwriting each other's metadata and bytes.
    // Each peer gets its own delta file. Workers are onboarded concurrently and
    // a shared path would be rebuilt underneath another peer's in-flight read,
    // producing an archive that still matches its own manifest checksum but is
    // truncated gzip.
    const transferArchivePath = `${archivePath}.${crypto.randomUUID()}.delta.tgz`;
    const { files, ...wireManifest } = manifest;
    try {
        await peer.send(
            "WORKSPACE_OFFER",
            { manifest: wireManifest },
            Buffer.from(JSON.stringify(files))
        );
        const needMessage = await waitForMessage(peer, "WORKSPACE_NEED", 10000);
        const need = JSON.parse(needMessage.body.toString("utf8"));
        if (!Array.isArray(need.changed) || !Array.isArray(need.deleted)) {
            throw new Error("Worker returned an invalid workspace diff");
        }
        const offered = new Set(manifest.files.map((entry) => entry.path));
        if (
            need.changed.some(
                (entry) => typeof entry !== "string" || !offered.has(entry)
            )
        ) {
            throw new Error(
                "Worker requested a file outside the offered manifest"
            );
        }
        const delta = await buildDeltaBundle(
            manifest,
            need.changed,
            transferArchivePath
        );
        onNeed({ ...need, ...delta });
        await peer.send("BUNDLE_META", {
            manifest: { ...wireManifest, ...delta }
        });
        let sequence = 0;
        let byteCount = 0;
        for await (const chunk of fs.createReadStream(transferArchivePath, {
            highWaterMark: chunkBytes
        })) {
            byteCount += chunk.length;
            await peer.send("BUNDLE_CHUNK", { sequence: sequence++ }, chunk);
        }
        await peer.send("BUNDLE_END", {
            byteCount,
            sha256: delta.archiveSha256
        });
        return await waitForIdleMessage(
            peer,
            "PREPARED",
            120000,
            new Set(["INFRA_LOG", "WORKER_STATUS"])
        );
    } finally {
        fs.rmSync(transferArchivePath, { force: true });
    }
}

function receiveBundle(
    peer,
    archivePath,
    limits,
    onComplete,
    initialMessage,
    onError = () => {}
) {
    let transfer = null;
    let finished = false;
    const closeTransfer = () => {
        peer.off("message", onMessage);
        peer.off("close", onClose);
        if (transfer?.fd === undefined || transfer.fd === null) return;
        try {
            fs.closeSync(transfer.fd);
        } catch {}
        transfer.fd = null;
    };
    const onClose = () => {
        if (finished) return;
        finished = true;
        closeTransfer();
        onError(new Error("Bundle connection closed during transfer"));
    };
    const onMessage = async (message) => {
        try {
            if (message.kind === "BUNDLE_META") {
                if (transfer)
                    throw new Error("Bundle transfer already started");
                if (
                    message.header.manifest.archiveBytes >
                    limits.maxCompressedBytes
                )
                    throw new Error("Compressed bundle limit exceeded");
                transfer = {
                    manifest: message.header.manifest,
                    fd: fs.openSync(archivePath, "wx", 0o600),
                    sequence: 0,
                    bytes: 0,
                    hash: crypto.createHash("sha256")
                };
            } else if (message.kind === "BUNDLE_CHUNK") {
                if (
                    !transfer ||
                    message.header.sequence !== transfer.sequence++
                )
                    throw new Error("Out-of-order bundle chunk");
                transfer.bytes += message.body.length;
                if (transfer.bytes > limits.maxCompressedBytes)
                    throw new Error("Compressed bundle limit exceeded");
                transfer.hash.update(message.body);
                fs.writeSync(transfer.fd, message.body);
            } else if (message.kind === "BUNDLE_END") {
                if (!transfer)
                    throw new Error("Bundle transfer was not started");
                fs.fsyncSync(transfer.fd);
                fs.closeSync(transfer.fd);
                transfer.fd = null;
                const digest = transfer.hash.digest("hex");
                if (
                    message.header.byteCount !== transfer.bytes ||
                    message.header.sha256 !== digest
                )
                    throw new Error("Transferred bundle checksum mismatch");
                finished = true;
                closeTransfer();
                await onComplete(transfer.manifest);
                await peer.send("PREPARED");
            }
        } catch (error) {
            onError(error);
            finished = true;
            closeTransfer();
            await peer
                .send("PREPARATION_ERROR", {
                    message: error.message
                })
                .catch(() => {});
            setTimeout(
                () => peer.close("workspace preparation failed"),
                250
            ).unref();
        }
    };
    peer.on("message", onMessage);
    peer.once("close", onClose);
    if (initialMessage) onMessage(initialMessage);
}

module.exports = { receiveBundle, sendBundle, waitForIdleMessage };
