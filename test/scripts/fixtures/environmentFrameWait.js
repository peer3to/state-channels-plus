// @spec-test-coverage-ignore: test-only distributed control fixture; no SDK behavior applies
function waitForEnvironmentFrame(
    received,
    notifications,
    child,
    kind,
    timeoutMs = 10000
) {
    const existing = received.find(
        (frame) =>
            frame.kind === kind ||
            frame.kind === "ERROR" ||
            frame.kind === "PREPARATION_FAILED"
    );
    if (existing?.kind === "ERROR" || existing?.kind === "PREPARATION_FAILED") {
        return Promise.reject(
            new Error(String(existing.payload.message || existing.kind))
        );
    }
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            notifications.off("frame", onFrame);
            child.off("exit", onExit);
        };
        const settleError = (error) => {
            cleanup();
            reject(error);
        };
        const onFrame = (frame) => {
            if (frame.kind === "ERROR" || frame.kind === "PREPARATION_FAILED") {
                settleError(
                    new Error(String(frame.payload.message || frame.kind))
                );
                return;
            }
            if (frame.kind !== kind) return;
            cleanup();
            resolve(frame);
        };
        const onExit = (code, signal) =>
            settleError(
                new Error(
                    `Guest exited while waiting for ${kind}: ${code ?? signal}`
                )
            );
        const timer = setTimeout(
            () => settleError(new Error(`Timed out waiting for ${kind}`)),
            timeoutMs
        );
        notifications.on("frame", onFrame);
        child.once("exit", onExit);
    });
}

module.exports = { waitForEnvironmentFrame };
