#!/usr/bin/env node

/**
 * Simple crash log server - not meant for production
 * Receives compressed crash logs and saves them to disk
 */

const http = require("http");
const fs = require("fs").promises;
const path = require("path");

const PORT = process.env.CRASH_LOG_SERVER_PORT || 3001;
const LOG_DIR =
    process.env.CRASH_LOG_DIR || path.join(process.cwd(), "crash-logs");

// Ensure log directory exists
async function ensureLogDir() {
    try {
        await fs.mkdir(LOG_DIR, { recursive: true });
        console.log(`[CrashLogServer] Log directory: ${LOG_DIR}`);
    } catch (err) {
        console.error(`[CrashLogServer] Failed to create log directory:`, err);
        process.exit(1);
    }
}

const server = http.createServer(async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[CrashLogServer] [${requestId}] Request received`, {
        method: req.method,
        url: req.url,
        headers: {
            "content-type": req.headers["content-type"],
            "content-encoding": req.headers["content-encoding"],
            "x-filename": req.headers["x-filename"],
            "x-metadata": req.headers["x-metadata"] ? "present" : "missing"
        }
    });

    // CORS headers for browser requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Content-Encoding, Authorization, X-Filename, X-Metadata"
    );

    // Handle preflight
    if (req.method === "OPTIONS") {
        console.log(
            `[CrashLogServer] [${requestId}] OPTIONS preflight request`
        );
        res.writeHead(200);
        res.end();
        return;
    }

    // Only accept POST requests
    if (req.method !== "POST") {
        console.log(
            `[CrashLogServer] [${requestId}] Method not allowed: ${req.method}`
        );
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
    }

    console.log(`[CrashLogServer] [${requestId}] Processing POST request`);

    try {
        // Get filename from header or generate one
        const filename =
            req.headers["x-filename"] ||
            `crash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson.gz`;
        console.log(`[CrashLogServer] [${requestId}] Filename: ${filename}`);

        // Get metadata if provided
        const metadataHeader = req.headers["x-metadata"];
        let metadata = null;
        if (metadataHeader) {
            try {
                metadata = JSON.parse(
                    Buffer.from(metadataHeader, "base64").toString()
                );
                console.log(
                    `[CrashLogServer] [${requestId}] Metadata parsed:`,
                    {
                        errorName: metadata.errorName,
                        errorMessage: metadata.errorMessage?.substring(0, 50),
                        timestamp: metadata.timestamp
                            ? new Date(metadata.timestamp).toISOString()
                            : "missing"
                    }
                );
            } catch (err) {
                console.warn(
                    `[CrashLogServer] [${requestId}] Failed to parse metadata:`,
                    err
                );
            }
        } else {
            console.log(
                `[CrashLogServer] [${requestId}] No metadata header provided`
            );
        }

        // Read request body
        console.log(`[CrashLogServer] [${requestId}] Reading request body...`);
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of req) {
            chunks.push(chunk);
            totalSize += chunk.length;
            if (chunks.length % 100 === 0) {
                console.log(
                    `[CrashLogServer] [${requestId}] Received ${chunks.length} chunks, ${totalSize} bytes so far`
                );
            }
        }
        const buffer = Buffer.concat(chunks);
        console.log(
            `[CrashLogServer] [${requestId}] Body read complete: ${buffer.length} bytes (${chunks.length} chunks)`
        );

        // Save to file
        const filepath = path.join(LOG_DIR, filename);
        console.log(
            `[CrashLogServer] [${requestId}] Writing to file: ${filepath}`
        );
        await fs.writeFile(filepath, buffer);
        console.log(
            `[CrashLogServer] [${requestId}] File written successfully`
        );

        console.log(
            `[CrashLogServer] [${requestId}] ✅ Saved crash log: ${filepath} (${buffer.length} bytes)`
        );
        if (metadata) {
            console.log(`[CrashLogServer] [${requestId}] Metadata:`, {
                errorName: metadata.errorName,
                errorMessage: metadata.errorMessage?.substring(0, 50),
                timestamp: new Date(metadata.timestamp).toISOString(),
                userAgent: metadata.userAgent?.substring(0, 50),
                url: metadata.url
            });
        }

        // Respond with success
        const response = {
            success: true,
            filename,
            size: buffer.length,
            requestId
        };
        console.log(
            `[CrashLogServer] [${requestId}] Sending success response:`,
            response
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        console.log(
            `[CrashLogServer] [${requestId}] ✅ Request completed successfully`
        );
    } catch (err) {
        console.error(
            `[CrashLogServer] [${requestId}] ❌ Error processing request:`,
            err
        );
        console.error(
            `[CrashLogServer] [${requestId}] Error stack:`,
            err.stack
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error", requestId }));
    }
});

async function start() {
    await ensureLogDir();

    server.listen(PORT, () => {
        console.log(
            `[CrashLogServer] Server running on http://localhost:${PORT}`
        );
        console.log(`[CrashLogServer] Ready to receive crash logs`);
    });

    server.on("error", (err) => {
        console.error("[CrashLogServer] Server error:", err);
        process.exit(1);
    });
}

start().catch((err) => {
    console.error("[CrashLogServer] Failed to start:", err);
    process.exit(1);
});
