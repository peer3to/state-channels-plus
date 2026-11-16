import type { BlockHeight, Timestamp } from "./types";

// peer3 chain values: the SDK targets peer3 chains only; the hardhat test chain mirrors the block time
// (interval mining) but has no per-transaction cap

// must equal the chain's block time (the parachain's MILLI_SECS_PER_BLOCK)
export const BLOCK_TIME_MS = 1000;

// must equal the chain's per-transaction gas cap (the parachain's MAX_TX_GAS)
export const MAX_TX_GAS = 8_916_000n;

export type TimeConfig = {
    p2pTime: Timestamp;
    agreementTime: Timestamp;
    chainFallbackTime: Timestamp;
    evidenceTime: Timestamp;
};

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

// Height-0 evidenceTime grace; must mirror the on-chain firstBlockGrace
// (DisputeFraudProofFacet._handleTimeoutTooEarly / FraudProofFacet._hasInvalidTimestamp)
export function firstBlockGrace(
    timeConfig: TimeConfig,
    blockHeight: BlockHeight
): Timestamp {
    return blockHeight === 0 ? timeConfig.evidenceTime : 0;
}

// full window a writer gets before it can be timed out at `blockHeight`
export function timeoutWaitTime(
    timeConfig: TimeConfig,
    blockHeight: BlockHeight
): Timestamp {
    return (
        timeConfig.p2pTime +
        timeConfig.agreementTime +
        timeConfig.chainFallbackTime +
        firstBlockGrace(timeConfig, blockHeight)
    );
}
