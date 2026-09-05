// @spec-test-coverage-ignore: shared polling utility exercised by owning mapped test declarations
import {
    protocolEventTimeoutMs,
    resolveTestTimeConfig
} from "@test/harness/core/testTimeConfig";

/**
 * Poll `condition` until it holds. The default budget is the protocol event
 * timeout of the default test time model, so a wait on a protocol step (a
 * sync, a receipt, a block round) needs no case-by-case timeout; pass one
 * only for a deliberately short or longer wait.
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = protocolEventTimeoutMs(resolveTestTimeConfig()),
    pollIntervalMs: number = 200
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
