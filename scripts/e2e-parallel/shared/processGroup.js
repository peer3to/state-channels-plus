function killProcessGroup(child, signal) {
    if (!child?.pid) return;
    try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
    } catch {}
}

module.exports = { killProcessGroup };
