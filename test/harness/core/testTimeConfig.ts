import { TimeConfig, firstBlockGrace } from "@/types";

export const MIN_TEST_TIME_CONFIG: Readonly<TimeConfig> = Object.freeze({
    p2pTime: 1,
    agreementTime: 2,
    chainFallbackTime: 2,
    evidenceTime: 3
});

export function resolveTestTimeConfig(
    overrides: Partial<TimeConfig> = {}
): TimeConfig {
    return { ...MIN_TEST_TIME_CONFIG, ...overrides };
}

export function protocolEventTimeoutMs(
    timeConfig: TimeConfig,
    blockHeight: number,
    settlementMarginSeconds: number = 4
): number {
    const triggerSeconds =
        timeConfig.p2pTime +
        timeConfig.agreementTime +
        timeConfig.chainFallbackTime +
        firstBlockGrace(timeConfig, blockHeight);
    return (triggerSeconds + settlementMarginSeconds) * 1000;
}
