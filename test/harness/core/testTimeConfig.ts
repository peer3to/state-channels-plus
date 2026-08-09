import { TimeConfig, firstBlockGrace } from "@/types";

export const MIN_TEST_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 2,
    agreementTime: 3,
    chainFallbackTime: 3,
    evidenceTime: 6
});

// join staging runs for seconds between two authored blocks -> the write
// window has to cover it or the block is clamped and rejected. worst gap 12s
export const JOIN_STAGING_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 12,
    agreementTime: 4,
    chainFallbackTime: 4,
    evidenceTime: 6
});

// same overrun for a test that holds the channel open without authoring ->
// the next writer gets timed out and the fork disputed. worst stretch 22s
export const IDLE_CHANNEL_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 15,
    agreementTime: 8,
    chainFallbackTime: 4,
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
    {
        withFirstBlockGrace = false,
        settlementMarginSeconds = 4
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
