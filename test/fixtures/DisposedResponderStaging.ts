// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { runtimeIsClosed } from "./RuntimeRootObservation";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

/**
 * A responder holds the join-signature handler of a joiner's request, is
 * aborted, and releases the handler after the cut while its disposal is
 * held. The handler ends in the cut runtime: it answers nobody and no error
 * leaves the responder; the joiner's collection ends.
 */
export async function releaseHeldHandlerIntoDisposedResponder(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(2, 0);
    const joiner = await h.join.addSpectatorWait();
    await h.assert.sync.peersInSyncWait();
    const responder = h.getPeer(0);
    const stub = h.control(responder).stub;
    await stub.holdJoinSignatureResponses().request();
    const latest = await h.provider.getBlock("latest");
    if (!latest) throw new Error("Expected the latest block");
    const collecting = joiner.p2pInstance.p2pSigner
        .collectJoinChannelConfirmation({
            participant: joiner.address,
            channelId: h.channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(latest.timestamp + 120)
        })
        .then(
            () => undefined,
            () => undefined
        );
    await waitFor(
        async () =>
            (await stub.getJoinSignatureResponsesEntered().request()) > 0
    );
    // keeps the control RPC reachable after the abort
    const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(
        responder.index
    );
    try {
        await stub.abortDetached().request();
        await h.event.waitForPeers("onAbort", [responder.index], 1);
        await stub.releaseJoinSignatureResponses().request();
        await collecting;
        await TestSession.settleDetached();
    } finally {
        await releaseDisposal();
    }
    await waitFor(
        () => runtimeIsClosed(responder.p2pInstance),
        h.event.protocolEventTimeoutMs()
    );
}
