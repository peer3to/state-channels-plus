// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { runtimeIsClosed } from "./RuntimeRootObservation";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

/**
 * Work in flight when the root disposes and failing afterwards is the
 * disposal's outcome: the session drain of the held disposal finds no
 * rejection and no detached error leaves the runtime.
 */
export async function assertDetachedFailureAfterRootDisposalIsSettled(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(2, 0);
    const peer = h.getPeer(0);
    const stub = h.control(peer).stub;
    await stub.collectHeldDetachedWork().request();
    // the disposal adopts the work in flight before its first release
    const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(0);
    try {
        await stub.abortDetached().request();
        await waitFor(
            async () =>
                (await stub.getRuntimeDisposalHoldEntered().request()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        await stub
            .rejectHeldDetachedWork("dependency torn down by disposal")
            .request();
        await TestSession.settleDetached();
    } finally {
        await releaseDisposal();
    }
    await waitFor(
        () => runtimeIsClosed(peer.p2pInstance),
        h.event.protocolEventTimeoutMs()
    );
}

/** Before disposal the same failure stays a real rejection in the drain. */
export async function assertDetachedFailureBeforeRootDisposalSurfaces(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(2, 0);
    const stub = h.control(h.getPeer(0)).stub;
    await stub.collectHeldDetachedWork().request();
    const message = "detached work failed";
    await stub.rejectHeldDetachedWork(message).request();
    await TestSession.settleDetached({ expectedErrorIncludes: message });
}
