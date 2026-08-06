const crypto = require("crypto");
const fs = require("fs");
const { waitForMessage } = require("./protocol");
const { buildDeltaBundle } = require("./runtimeBundle");

async function sendBundle(
    peer,
    archivePath,
    manifest,
    chunkBytes = 256 * 1024,
    onNeed = () => {}
) {
    const { files, ...wireManifest } = manifest;
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
        throw new Error("Worker requested a file outside the offered manifest");
    }
    const delta = await buildDeltaBundle(manifest, need.changed, archivePath);
    onNeed({ ...need, ...delta });
    await peer.send("BUNDLE_META", {
        manifest: { ...wireManifest, ...delta }
    });
    let sequence = 0;
    let byteCount = 0;
    for await (const chunk of fs.createReadStream(archivePath, {
        highWaterMark: chunkBytes
    })) {
        byteCount += chunk.length;
        await peer.send("BUNDLE_CHUNK", { sequence: sequence++ }, chunk);
    }
    await peer.send("BUNDLE_END", {
        byteCount,
        sha256: delta.archiveSha256
    });
    return waitForMessage(peer, "PREPARED", 120000);
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
                const digest = transfer.hash.digest("hex");
                if (
                    message.header.byteCount !== transfer.bytes ||
                    message.header.sha256 !== digest
                )
                    throw new Error("Transferred bundle checksum mismatch");
                peer.off("message", onMessage);
                await onComplete(transfer.manifest);
                await peer.send("PREPARED");
            }
        } catch (error) {
            onError(error);
            peer.off("message", onMessage);
            if (transfer?.fd !== undefined) {
                try {
                    fs.closeSync(transfer.fd);
                } catch {}
            }
            peer.send("WORKER_ERROR", { message: error.message }).finally(() =>
                setTimeout(() => peer.close(), 250)
            );
        }
    };
    peer.on("message", onMessage);
    if (initialMessage) onMessage(initialMessage);
}

module.exports = { sendBundle, receiveBundle };
