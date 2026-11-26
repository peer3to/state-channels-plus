import { Address } from "@/types/types";

/** A final-history counter the chain accepts, with its slash set and its size as one transaction. */
export type FinalHistoryCounter = {
    /** the addresses the kill slashes: they signed both conflicting final points */
    slashes: Address[];
    /** the calldata bytes of the kill sent alone */
    killBytes: number;
};

/**
 * The counter to send: among those whose kill fits `maxTransactionBytes`,
 * the one with the largest slash set; the earliest wins a tie. When none
 * fits, the one with the largest slash set, which is too large to send.
 * Undefined when there is no counter.
 */
export function chooseFinalHistoryCounter<T extends FinalHistoryCounter>(
    counters: T[],
    maxTransactionBytes: number
): T | undefined {
    const fitting = counters.filter(
        (counter) => counter.killBytes <= maxTransactionBytes
    );
    const pool = fitting.length > 0 ? fitting : counters;
    return pool.reduce<T | undefined>(
        (best, counter) =>
            !best || counter.slashes.length > best.slashes.length
                ? counter
                : best,
        undefined
    );
}
