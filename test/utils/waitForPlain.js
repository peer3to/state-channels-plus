// @spec-test-coverage-ignore: shared browser-loadable polling loop exercised by its callers
export async function waitForPlain(condition, timeoutMs, pollIntervalMs) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const result = await condition();
            if (result) {
                return;
            }
        } catch {
            // Continue polling even if condition throws
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
}
