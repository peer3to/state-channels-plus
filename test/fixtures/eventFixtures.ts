import { ethers } from "ethers";

import { EventBarrier } from "@/utils/EventBarrier";
import NoopEventProvider from "@/evm/signer/NoopEventProvider";
import { createLogger } from "@/utils";

export const EVENT_FIXTURE_ADDRESS =
    "0x1111111111111111111111111111111111111111";

export const ADDITION_EVENT_ABI = [
    "event Addition(uint256 a, uint256 b, uint256 result)"
];

/**
 * Ethers contract for event-bus component tests: NoopEventProvider lets
 * `contract.on(...)` register without a poll loop; events arrive only through
 * `attachContractEvents` — the production setup.
 */
export function createEventContract(abi: string[]): ethers.Contract {
    return new ethers.Contract(
        EVENT_FIXTURE_ADDRESS,
        abi,
        new NoopEventProvider()
    );
}

/** Barrier with an error-level logger for component tests. */
export function createTestEventBarrier(): EventBarrier {
    return new EventBarrier(createLogger({}, {}, { level: "error" }));
}

/**
 * Barrier whose logger records error messages (record-only wrapper around a
 * real logger) so tests can assert which timeout/missing-signal logs fired.
 */
export function createRecordingEventBarrier(): {
    barrier: EventBarrier;
    errorLogs: string[];
} {
    const logger = createLogger({}, {}, { level: "error" });
    const errorLogs: string[] = [];
    const originalError = logger.error.bind(logger);
    logger.error = (message, meta) => {
        errorLogs.push(String(message));
        return originalError(message, meta);
    };
    return { barrier: new EventBarrier(logger), errorLogs };
}
