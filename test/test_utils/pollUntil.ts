export interface PollUntilConfig {
    timeoutMs?: number;
    pollIntervalMs?: number;
    throwOnTimeout?: boolean;
    timeoutMessage?: string;
}

export async function pollUntil(
    condition: () => boolean | Promise<boolean>,
    config: PollUntilConfig = {}
): Promise<boolean> {
    const {
        timeoutMs = 1000,
        pollIntervalMs = 50,
        throwOnTimeout = true,
        timeoutMessage
    } = config;

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const result = await condition();
            if (result) {
                return true;
            }
        } catch (error) {
            console.error(error);
        }

        // Wait for the next poll
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    if (throwOnTimeout) {
        throw new Error(
            timeoutMessage || `Condition not met within ${timeoutMs}ms`
        );
    }

    return false;
}
