// @spec-test-coverage-ignore: shared harness support; executable evidence belongs to its calling test declarations
import { TimeConfig, firstBlockGrace } from "@/types/time";

// the parachain's block time; Hardhat interval mining mirrors it
export const BLOCK_TIME_MS = 2000;

/** A block count per protocol window, for {@link deriveTimeConfig}. */
export type TimeBlocks = Partial<Record<keyof TimeConfig, number>>;

// seconds per field = blocks × block time + floor
const TIME_CONFIG_SHAPE = {
    p2pTime: { blocks: 0, floorSeconds: 5 },
    agreementTime: { blocks: 2, floorSeconds: 1 },
    chainFallbackTime: { blocks: 3, floorSeconds: 2 },
    evidenceTime: { blocks: 10, floorSeconds: 10 }
};

/** The protocol windows for BLOCK_TIME_MS; `blocks` replaces a field with that many block times. */
export function deriveTimeConfig(blocks: TimeBlocks = {}): TimeConfig {
    const seconds = (field: keyof TimeConfig) => {
        const { blocks: k, floorSeconds } = TIME_CONFIG_SHAPE[field];
        const count = blocks[field];
        return count === undefined
            ? (k * BLOCK_TIME_MS) / 1000 + floorSeconds
            : (count * BLOCK_TIME_MS) / 1000;
    };
    return {
        p2pTime: seconds("p2pTime"),
        agreementTime: seconds("agreementTime"),
        chainFallbackTime: seconds("chainFallbackTime"),
        evidenceTime: seconds("evidenceTime")
    };
}

// one block: the chain includes a transaction in the next block
const BLOCK_SECONDS = BLOCK_TIME_MS / 1000;

/**
 * Windows in block counts that keep agreement, fallback and evidence near
 * their seconds at one-second blocks, for a test that waits out several
 * writer turns and a dispute within the test timeout.
 */
export const SHORT_TIME_BLOCKS: TimeBlocks = {
    agreementTime: 2,
    chainFallbackTime: 3,
    evidenceTime: 10
};

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
