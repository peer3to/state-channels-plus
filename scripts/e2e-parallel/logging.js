/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { DEFAULT_LOG_DIR } = require("./constants");

function formatDurationMs(durationMs) {
    return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatResultLine({
    phase,
    code,
    label,
    durationMs,
    completed,
    total,
    rerunAttempt,
    slotId
}) {
    const status = code === 0 ? "PASS" : "FAIL";
    // e.g. "run#s3" for initial runs, "rerun#1#s-" for reruns with placeholder slot
    const slotSuffix = slotId !== undefined ? `#s${slotId}` : "";
    const phaseTag = rerunAttempt
        ? `${phase}#${rerunAttempt}${slotSuffix}`
        : `${phase}${slotSuffix}`;
    const duration = formatDurationMs(durationMs);
    if (code === 0) {
        return `[${completed}/${total}] ${phaseTag} ${status} (${duration})`;
    }
    return `[${completed}/${total}] ${phaseTag} ${status} ${label} (${duration})`;
}

function safeEmptyDir(dirPath, allowLogdirPurge) {
    const resolved = path.resolve(dirPath);
    const expected = path.resolve(DEFAULT_LOG_DIR);

    // Safety: only auto-purge the default ./logs directory unless explicitly allowed.
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping purge of ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    fs.mkdirSync(resolved, { recursive: true });
    for (const entry of fs.readdirSync(resolved)) {
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function cleanupNonErrorLogs(logDir, allowLogdirPurge) {
    const resolved = path.resolve(logDir);
    const expected = path.resolve(DEFAULT_LOG_DIR);
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping end-of-run cleanup in ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    if (!fs.existsSync(resolved)) return;
    for (const entry of fs.readdirSync(resolved)) {
        if (entry.startsWith("error_")) continue;
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function getLogPath(logDir, logName) {
    return path.resolve(path.join(logDir, `${logName}.ansi`));
}

function markLogAsError(logDir, logName) {
    const src = getLogPath(logDir, logName);
    const dst = path.resolve(path.join(logDir, `error_${logName}.ansi`));
    if (!fs.existsSync(src)) return;
    try {
        fs.renameSync(src, dst);
    } catch (err) {
        console.error(`Failed to rename log file ${src} -> ${dst}:`, err);
    }
}

module.exports = {
    formatDurationMs,
    formatResultLine,
    safeEmptyDir,
    cleanupNonErrorLogs,
    getLogPath,
    markLogAsError
};
