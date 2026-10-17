// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

/** The application events the probe application declares. */
export type ProbeEvents = {
    probeEvent: [label: string, count: number];
};

/**
 * The test application's network root: the harness control surface, the
 * declaration of the application's events, and the owner that emits them.
 */
export class ProbeRpc extends HarnessControlRpc<ProbeEvents> {
    public emitProbeEvent(label: string, count: number): void {
        this.applicationEvents.emit("application", "probeEvent", [
            label,
            count
        ]);
    }
}
