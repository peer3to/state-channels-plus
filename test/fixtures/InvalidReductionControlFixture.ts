// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { ReductionApplicationControl } from "./customRpc/harnessControl/services/stub/StubService";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

/** The payload is JSON as it would arrive over the control port. */
export async function assertInvalidReductionControl(
    payload: string
): Promise<void> {
    const h = TestSession.getHarness();
    await h.lifecycle.start(2, 0);
    const target = h.getPeer(0);
    const control: ReductionApplicationControl = JSON.parse(payload);
    let failure: unknown;
    try {
        await h
            .control(target)
            .stub.holdReductionGenesisApplication(control)
            .request();
    } catch (error) {
        failure = error;
    }
    expect((failure as Error).message).to.include(
        "Invalid reduction application control"
    );
    expect(
        await h
            .control(target)
            .stub.isReductionGenesisApplicationHeld()
            .request()
    ).to.equal(false);
    expect(
        await h
            .control(target)
            .stub.getHeldReductionGenesisApplicationCount()
            .request()
    ).to.equal(0);
}
