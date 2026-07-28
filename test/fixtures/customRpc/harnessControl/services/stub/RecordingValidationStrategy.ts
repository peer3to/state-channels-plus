import type AValidationStrategy from "@/stateManager/validationStrategy/AValidationStrategy";
import { BlockValidationResult } from "@/types";

export const NO_BOUNDARY_REACHED = "SUCCESS";

/**
 * Wraps a live validation strategy and records the first hook it calls,
 * suppressing that hook's side effect - so a probe can drive the real
 * validateBlockConfirmation without disconnecting peers or opening disputes.
 */
export function recordValidationBoundary(target: AValidationStrategy) {
    const result = { reached: NO_BOUNDARY_REACHED };
    const strategy = new Proxy(target, {
        get(t, prop) {
            const value = Reflect.get(t, prop, t);
            if (typeof value !== "function") return value;
            return () => {
                if (result.reached === NO_BOUNDARY_REACHED) {
                    result.reached = String(prop);
                }
                return Promise.resolve(BlockValidationResult.DISCONNECT);
            };
        }
    });
    return { strategy, result };
}
