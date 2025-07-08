import { ExecutionFlags } from "@/types";
import { Timestamp } from "@/types/types";

/* subjective tolerances (BigInt seconds) */
export const TOLERANCE_PAST = 5n;
export const TOLERANCE_FUTURE = 10n;

/** ─────────────────────────────────────────────────────────────
 *  Subjective “too old / too far in the future” check
 */
export function subjectiveTimingFlag(
    blockTs: Timestamp,
    nowTs: Timestamp
): ExecutionFlags {
    const diff = BigInt(nowTs) - BigInt(blockTs);
    // Check if block is too old
    if (diff > TOLERANCE_PAST) return ExecutionFlags.NOT_ENOUGH_TIME;
    // Check if block is too far in the future
    if (diff < -TOLERANCE_FUTURE) return ExecutionFlags.DISPUTE;
    // ok
    return ExecutionFlags.SUCCESS;
}
