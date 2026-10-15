import { BlockHeight, Timestamp } from "./types";

export type TimeConfig = {
    p2pTime: Timestamp;
    agreementTime: Timestamp;
    chainFallbackTime: Timestamp;
    evidenceTime: Timestamp;
};

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
