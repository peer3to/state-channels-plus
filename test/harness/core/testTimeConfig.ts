// @spec-test-coverage-ignore: shared harness support; executable evidence belongs to its calling test declarations
import { BLOCK_TIME_MS, TimeConfig, firstBlockGrace } from "@/types";

// one block: the chain includes a transaction in the next block
const BLOCK_SECONDS = BLOCK_TIME_MS / 1000;

export function participantTimeoutWaitMs(
    timeConfig: TimeConfig,
    blockHeight: number,
    settlementMarginSeconds: number = BLOCK_SECONDS
): number {
    return (
        (timeConfig.p2pTime +
            timeConfig.agreementTime +
            timeConfig.chainFallbackTime +
            firstBlockGrace(timeConfig, blockHeight) +
            settlementMarginSeconds) *
        1000
    );
}

export function evidencePeriodWaitMs(
    timeConfig: TimeConfig,
    settlementMarginSeconds: number = BLOCK_SECONDS
): number {
    return (timeConfig.evidenceTime + settlementMarginSeconds) * 1000;
}

export function protocolEventTimeoutMs(
    timeConfig: TimeConfig,
    {
        withFirstBlockGrace = false,
        settlementMarginSeconds = 4 * BLOCK_SECONDS
    }: {
        withFirstBlockGrace?: boolean;
        settlementMarginSeconds?: number;
    } = {}
): number {
    // After the timeout becomes eligible, allow the full evidence window for
    // the dispute upload, audit, fraud-proof transaction, and kill event.
    return (
        participantTimeoutWaitMs(timeConfig, withFirstBlockGrace ? 0 : 1, 0) +
        evidencePeriodWaitMs(timeConfig, settlementMarginSeconds)
    );
}
