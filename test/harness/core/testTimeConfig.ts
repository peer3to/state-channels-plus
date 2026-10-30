// @spec-test-coverage-ignore: shared harness support; executable evidence belongs to its calling test declarations
import { TimeConfig, firstBlockGrace } from "@/types";

// p2pTime 5: under load a staging step (a join, a snapshot post) can idle
// the table longer than p2pTime + agreementTime, and the next block then
// fails the receivers' time check. evidenceTime 10: an honest auditor's kill
// under farm load must land inside the kill period (FIND-DISPUTE-5).
export const MIN_TEST_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 5,
    agreementTime: 3,
    chainFallbackTime: 3,
    evidenceTime: 10
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

export const INBOUND_GAP_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 2,
    agreementTime: 8,
    chainFallbackTime: 4,
    evidenceTime: 8
});
