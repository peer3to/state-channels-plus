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

function parseArgValue(argv, name) {
    // Supports: --name value, --name=value
    const exactIdx = argv.indexOf(name);
    if (exactIdx !== -1) {
        const v = argv[exactIdx + 1];
        return v != null && !String(v).startsWith("--") ? String(v) : null;
    }
    const prefix = `${name}=`;
    const withEq = argv.find((a) => String(a).startsWith(prefix));
    if (withEq) return String(withEq).slice(prefix.length);
    return null;
}

function parseIntArg(argv, name) {
    const raw = parseArgValue(argv, name);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// CLI: --channelDirMaxAgeMs=300000 (default: 5 minutes)
const CHANNEL_DIR_MAX_AGE_MS =
    parseIntArg(process.argv, "--age") * 60 * 1000 ?? 5 * 60 * 1000;

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

function parseTimestamp(timestamp) {
    const m =
        /^([0-9]{2})-([0-9]{2})-([0-9]{4})#([0-9]{2}):([0-9]{2}):([0-9]{2})$/.exec(
            String(timestamp)
        );
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hours = Number(m[4]);
    const minutes = Number(m[5]);
    const seconds = Number(m[6]);
    const d = new Date(year, month - 1, day, hours, minutes, seconds);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
}

function extractChannelTimestampFromDirName(channelId, dirName) {
    const prefix = `${channelId}_`;
    if (!String(dirName).startsWith(prefix)) return null;
    const ts = String(dirName).slice(prefix.length);
    return ts || null;
}

async function ensureLogDir() {
    await fs.mkdir(LOG_DIR, { recursive: true });
}

async function listChannelDirs() {
    await ensureLogDir();
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

async function resolveChannelDir(channelId, options = {}) {
    const { rotateIfOld = false } = options;
    const nowMs = Date.now();
    const maxAgeMs = CHANNEL_DIR_MAX_AGE_MS;

    async function maybeRotate(dirName) {
        const ts = extractChannelTimestampFromDirName(channelId, dirName);
        const tsMs = ts ? parseTimestamp(ts) : null;
        if (!rotateIfOld) {
            return { dirName, timestamp: ts || formatTimestamp() };
        }
        if (tsMs == null || nowMs - tsMs <= maxAgeMs) {
            console.log(
                `Keeping old log dir ${dirName} for channel ${channelId} DeltaMs (${nowMs - tsMs}ms)`
            );
            return { dirName, timestamp: ts || formatTimestamp() };
        }
        console.log(
            `Renaming old log dir ${dirName} for channel ${channelId} DeltaMs (${nowMs - tsMs}ms)`
        );
        const newTimestamp = formatTimestamp();
        const oldFull = path.join(LOG_DIR, dirName);
        const newDirName = `${channelId}_${newTimestamp}`;
        const newFull = path.join(LOG_DIR, newDirName);

        await fs.rename(oldFull, newFull);
        return { dirName: newDirName, timestamp: newTimestamp };
    }

    if (channelDirCache.has(channelId)) {
        const cached = channelDirCache.get(channelId);
        const cachedDirName = cached && cached.dirName;
        const cachedFull = cached && cached.full;
        if (cachedDirName && cachedFull) {
            try {
                await fs.access(cachedFull);
                const rotated = await maybeRotate(cachedDirName);
                const full = path.join(LOG_DIR, rotated.dirName);
                channelDirCache.set(channelId, {
                    dirName: rotated.dirName,
                    full,
                    timestamp: rotated.timestamp
                });
                return { dir: full, timestamp: rotated.timestamp };
            } catch {
                channelDirCache.delete(channelId);
            }
        } else {
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
        const chosenDirName = withStats[0].dir;
        const rotated = await maybeRotate(chosenDirName);
        const full = path.join(LOG_DIR, rotated.dirName);
        channelDirCache.set(channelId, {
            dirName: rotated.dirName,
            full,
            timestamp: rotated.timestamp
        });
        return { dir: full, timestamp: rotated.timestamp };
    }

    const timestamp = formatTimestamp();
    const created = path.join(LOG_DIR, `${channelId}_${timestamp}`);
    await fs.mkdir(created, { recursive: true });
    channelDirCache.set(channelId, {
        dirName: `${channelId}_${timestamp}`,
        full: created,
        timestamp
    });
    return { dir: created, timestamp };
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

            const { dir: channelDir, timestamp } = await resolveChannelDir(
                channelId,
                { rotateIfOld: true }
            );
            const safePeer = sanitizeSegment(peerAddress);
            const filename = `${safePeer}`;
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
            const channelIdAndTimestamp = dir;
            const fullDir = path.join(LOG_DIR, dir);
            const files = await fs.readdir(fullDir);

            if (!response[channelIdAndTimestamp]) {
                response[channelIdAndTimestamp] = [];
            }
            response[channelIdAndTimestamp].push(...files);
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
        const { dir: channelDir } = await resolveChannelDir(channelId);
        const files = await fs.readdir(channelDir);
        const safePeer = sanitizeSegment(peerAddress);
        const target =
            files.find((f) => f === safePeer) ||
            files.find((f) => f.endsWith(`_${safePeer}`));

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
