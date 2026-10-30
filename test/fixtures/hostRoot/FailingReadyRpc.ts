// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { ProbeRpc } from "./ProbeRpc";

export const FAILING_READY_MESSAGE = "probe readiness failed at";

/**
 * The probe application whose readiness fails, like a crypto worker that
 * cannot start. The message carries the failure time, so a test measures how
 * long the failed setup took to answer.
 */
export class FailingReadyRpc extends ProbeRpc {
    public override ready(): Promise<void> {
        return Promise.reject(
            new Error(`${FAILING_READY_MESSAGE} ${Date.now()}`)
        );
    }
}
