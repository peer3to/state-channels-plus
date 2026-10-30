// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import Clock from "@/Clock";
import { errorMessage } from "@/utils/errorMessage";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";

/**
 * An inline responder holds the join-signature handler of a joiner's
 * request, disposes, and then releases the handler into the disposed
 * runtime. Returns the error of each inbound dispatch of the responder
 * that rejected; a dispatch that resolved gives none.
 */
export async function releaseHeldHandlerIntoDisposedResponder(
    h: MathPeerTestHarness
): Promise<string[]> {
    await h.lifecycle.start(2, 0, {
        configOverrides: { RUN_SDK_IN_THREAD: false }
    });
    const joiner = await h.join.addSpectatorWait();
    await h.assert.sync.peersInSyncWait();
    const responder = h.getPeer(0);
    // kept for the assertions after the responder's port closes
    const runtime = runtimeEndpointFor(responder.p2pInstance);
    const router = runtime.sm.p2pManager.rpcRouter;
    const onRpc = router.onRpc;
    const dispatchErrors: Promise<unknown>[] = [];
    router.onRpc = (frame, transport) => {
        const dispatch = onRpc.call(router, frame, transport);
        dispatchErrors.push(
            dispatch.then(
                () => undefined,
                (error: unknown) => error
            )
        );
        return dispatch;
    };
    try {
        await h.control(responder).stub.holdJoinSignatureResponses().request();
        const chainTime = await Clock.getBlockchainTime();
        const collecting = joiner.p2pInstance.p2pSigner
            .collectJoinChannelConfirmation({
                participant: joiner.address,
                channelId: h.channelId,
                balance: { amount: 500n, data: "0x00" },
                deadlineTimestamp: BigInt(chainTime.timestamp + 120)
            })
            .then(
                () => undefined,
                () => undefined
            );
        await waitFor(
            async () =>
                (await h
                    .control(responder)
                    .stub.getJoinSignatureResponsesEntered()
                    .request()) > 0
        );
        await runtime.host.dispose();
        runtime.stub.releaseJoinSignatureResponses();
        await collecting;
        return (await Promise.all(dispatchErrors))
            .filter((error) => error !== undefined)
            .map(errorMessage);
    } finally {
        router.onRpc = onRpc;
    }
}
