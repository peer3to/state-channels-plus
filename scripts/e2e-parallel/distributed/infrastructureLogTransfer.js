const INFRA_PROCESS_LOG_CHUNK_BYTES = 512 * 1024;

function createInfrastructureProcessLogChunks(
    log,
    chunkBytes = INFRA_PROCESS_LOG_CHUNK_BYTES
) {
    const body = Buffer.from(log);
    const chunkCount = Math.max(1, Math.ceil(body.length / chunkBytes));
    const chunks = [];
    for (let sequence = 0; sequence < chunkCount; sequence++) {
        const offset = sequence * chunkBytes;
        chunks.push({
            sequence,
            chunkCount,
            logChunk: body
                .subarray(offset, Math.min(body.length, offset + chunkBytes))
                .toString("base64")
        });
    }
    return chunks;
}

function unpackInfrastructureProcessLogChunk(message) {
    if (typeof message?.logChunk !== "string") {
        throw new Error("Infrastructure process log chunk is missing");
    }
    const { logChunk, ...safeMessage } = message;
    return {
        message: safeMessage,
        body: Buffer.from(logChunk, "base64")
    };
}

module.exports = {
    INFRA_PROCESS_LOG_CHUNK_BYTES,
    createInfrastructureProcessLogChunks,
    unpackInfrastructureProcessLogChunk
};
