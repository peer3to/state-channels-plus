const localCloseReasons = new WeakMap();

function connectionHash(stream) {
    const hash = stream?.handshakeHash;
    if (!hash) throw new Error("Authenticated stream has no handshake hash");
    return Buffer.from(hash).toString("hex");
}

function shortConnectionHash(streamOrHash) {
    const hash =
        typeof streamOrHash === "string"
            ? streamOrHash
            : streamOrHash?.handshakeHash
              ? Buffer.from(streamOrHash.handshakeHash).toString("hex")
              : null;
    return hash ? hash.slice(0, 12) : "unknown";
}

function selectLowerHash(existing, candidate) {
    return existing.connectionHash.localeCompare(candidate.connectionHash) <= 0
        ? existing
        : candidate;
}

function closeStream(stream, reason) {
    if (!stream || stream.destroyed || stream.destroying) return false;
    localCloseReasons.set(stream, reason || "application requested close");
    stream.destroy();
    return true;
}

function localCloseReason(stream) {
    return localCloseReasons.get(stream) || null;
}

module.exports = {
    closeStream,
    connectionHash,
    localCloseReason,
    selectLowerHash,
    shortConnectionHash
};
