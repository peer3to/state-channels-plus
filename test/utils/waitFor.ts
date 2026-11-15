// @spec-test-coverage-ignore: shared polling utility exercised by owning mapped test declarations
import { waitForPlain } from "./waitForPlain";
import { deriveTimeConfig } from "@/types";
import { protocolEventTimeoutMs } from "@test/harness/core/testTimeConfig";

/** How often a wait re-checks its condition. */
export const WAIT_POLL_MS = 200;

/**
 * Poll `condition` until it holds. The default budget is the protocol event
 * timeout of the default test time model, so a wait on a protocol step (a
 * sync, a receipt, a block round) needs no case-by-case timeout; pass one
 * only for a deliberately short or longer wait.
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = protocolEventTimeoutMs(deriveTimeConfig()),
    pollIntervalMs: number = WAIT_POLL_MS
): Promise<void> {
    return waitForPlain(condition, timeoutMs, pollIntervalMs);
}
