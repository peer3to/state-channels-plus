#!/usr/bin/env node

/**
 * Simple crash log server - not meant for production
 * Receives compressed crash logs and saves them to disk
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");

const PORT = process.env.CRASH_LOG_SERVER_PORT || 3001;
const LOG_DIR =
    process.env.CRASH_LOG_DIR || path.join(process.cwd(), "crash-logs");

const app = express();
const channelDirCache = new Map();

app.use(cors());
app.use(express.json());

function formatTimestamp() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, "0");
    const day = pad(now.getDate());
    const month = pad(now.getMonth() + 1);
    const year = now.getFullYear();
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    return `${day}-${month}-${year}#${hours}:${minutes}:${seconds}`;
}

async function ensureLogDir() {
    await fs.mkdir(LOG_DIR, { recursive: true });
}

async function listChannelDirs() {
    await ensureLogDir();
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

async function resolveChannelDir(channelId) {
    if (channelDirCache.has(channelId)) {
        const cached = channelDirCache.get(channelId);
        try {
            await fs.access(cached);
            return cached;
        } catch {
            channelDirCache.delete(channelId);
        }
    }

    const dirs = await listChannelDirs();
    const matching = dirs.filter((d) => d.startsWith(`${channelId}_`));
    if (matching.length > 0) {
        const withStats = await Promise.all(
            matching.map(async (dir) => {
                const full = path.join(LOG_DIR, dir);
                const stat = await fs.stat(full);
                return { dir, full, mtime: stat.mtimeMs };
            })
        );
        withStats.sort((a, b) => b.mtime - a.mtime);
        channelDirCache.set(channelId, withStats[0].full);
        return withStats[0].full;
    }

    const created = path.join(LOG_DIR, `${channelId}_${formatTimestamp()}`);
    await fs.mkdir(created, { recursive: true });
    channelDirCache.set(channelId, created);
    return created;
}

function sanitizeSegment(value) {
    return String(value).replace(/[\/]/g, "_");
}

app.post(
    "/logs/upload",
    express.raw({ type: "*/*", limit: "50mb" }),
    async (req, res) => {
        try {
            const { channelId, peerAddress, compressedLogs } = req.body || {};

            if (!channelId || !peerAddress || !compressedLogs) {
                res.status(400).json({
                    error: "Incorrect request data"
                });
                return;
            }

            const channelDir = await resolveChannelDir(channelId);
            const timestamp = formatTimestamp();
            const safePeer = sanitizeSegment(peerAddress);
            const filename = `${timestamp}_${safePeer}`;
            const filepath = path.join(channelDir, filename);

            await fs.writeFile(filepath, compressedLogs, "utf8");

            res.status(200).json({
                success: true,
                channelId,
                peerAddress,
                filename
            });
        } catch (err) {
            console.error("[CrashLogServer] Upload failed:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.get("/logs/index", async (_req, res) => {
    try {
        const dirs = await listChannelDirs();
        const response = {};

        for (const dir of dirs) {
            const channelId = dir.split("_")[0];
            const fullDir = path.join(LOG_DIR, dir);
            const files = await fs.readdir(fullDir);
            const peers = new Set();

            for (const file of files) {
                const parts = file.split("_");
                if (parts.length < 2) continue;
                const peer = parts.slice(1).join("_");
                peers.add(peer);
            }

            if (!response[channelId]) {
                response[channelId] = [];
            }
            response[channelId].push(...Array.from(peers));
        }

        res.status(200).json(response);
    } catch (err) {
        console.error("[CrashLogServer] Index failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/logs/:channelId/:peerAddress", async (req, res) => {
    try {
        const { channelId, peerAddress } = req.params;
        const channelDir = await resolveChannelDir(channelId);
        const files = await fs.readdir(channelDir);
        const safePeer = sanitizeSegment(peerAddress);
        const target = files.find((f) => f.endsWith(`_${safePeer}`));

        if (!target) {
            res.status(404).json({ error: "Log not found" });
            return;
        }

        const filepath = path.join(channelDir, target);
        const base64 = await fs.readFile(filepath, "utf8");
        res.setHeader("Content-Type", "text/plain");
        res.send(base64);
    } catch (err) {
        console.error("[CrashLogServer] Retrieve failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

async function start() {
    await ensureLogDir();
    app.listen(PORT, () => {
        console.log(
            `[CrashLogServer] Server running on http://localhost:${PORT}`
        );
    });
}

start().catch((err) => {
    console.error("[CrashLogServer] Failed to start:", err);
    process.exit(1);
});
