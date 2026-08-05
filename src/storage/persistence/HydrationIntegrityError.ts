import { ForkId, BlockHeight } from "@/types/types";

export type BlockHeightGap = {
    forkId: ForkId;
    missingHeight: BlockHeight;
    maxHeight: BlockHeight;
};

/**
 * Thrown by Storage.hydrate() when a safety-critical record failed to
 * decode/replay in a way that leaves a non-trailing gap in a fork's block
 * heights (see BlockStorage.checkHeightContiguity). Fail-closed: the caller
 * (P2pRuntimeHost.ensurePersistenceForChannel) lets this propagate so the
 * channel bind fails rather than joining the transport on a hydrated state
 * that can't be trusted.
 */
export class HydrationIntegrityError extends Error {
    public readonly violations: BlockHeightGap[];

    constructor(violations: BlockHeightGap[]) {
        super(
            `Hydration produced a non-contiguous block height gap: ${violations
                .map(
                    (v) =>
                        `fork ${v.forkId} missing height ${v.missingHeight} (max ${v.maxHeight})`
                )
                .join("; ")}`
        );
        this.name = "HydrationIntegrityError";
        this.violations = violations;
    }
}
