export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 1000,
    pollIntervalMs: number = 100
): Promise<void> {
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
