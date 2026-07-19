import { TimeConfig, firstBlockGrace } from "@/types";

export const MIN_TEST_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 2,
    agreementTime: 3,
    chainFallbackTime: 3,
    evidenceTime: 6
});

export function resolveTestTimeConfig(
    overrides: Partial<TimeConfig> = {}
): TimeConfig {
    return { ...MIN_TEST_TIME_CONFIG, ...overrides };
}

export function participantTimeoutWaitMs(
    timeConfig: TimeConfig,
    blockHeight: number,
    settlementMarginSeconds: number = 1
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
    settlementMarginSeconds: number = 1
): number {
    return (timeConfig.evidenceTime + settlementMarginSeconds) * 1000;
}

export function protocolEventTimeoutMs(
    timeConfig: TimeConfig,
    blockHeight: number,
    settlementMarginSeconds: number = 4
): number {
    // After the timeout becomes eligible, allow the full evidence window for
    // the dispute upload, audit, fraud-proof transaction, and kill event.
    return (
        participantTimeoutWaitMs(timeConfig, blockHeight, 0) +
        evidencePeriodWaitMs(timeConfig, settlementMarginSeconds)
    );
}
