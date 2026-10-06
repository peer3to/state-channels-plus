// @spec-test-coverage-ignore: real handshake dispatch with a failing chain read or sync, observed at the runtime's host-error route
import type { RemoteRpcProxyType } from "@/rpc/network/RemoteRpcProxy";
import { Status } from "@/types";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { waitFor } from "@test/utils/waitFor";
import { MathStateMachine } from "@typechain-types";
import path from "node:path";

export type HandshakeFailureOutcome = {
    /** Errors the runtime reported to its top-level host-error handling. */
    hostErrors: Error[];
    /** Times the opener's onConnection hook ran. */
    hookCount: number;
    /** Whether the opener aborted. */
    aborted: boolean;
};

/**
 * Two worker-thread peers on an opened channel; peer 0 is put back to OPENED,
 * so a completed handshake makes it read whether peer 1 can participate in
 * disputes and then sync from it. Both peers join the channel topic, so the
 * real transport handshake dispatches `handshakeCompleted`.
 *
 * - `read`: peer 0's chain provider is closed before the handshake, so the
 *   participant read fails.
 * - `sync`: the read succeeds; peer 1 holds its sync response until peer 0's
 *   chain provider is closed, so the chain read that applies the response
 *   fails and the sync throws.
 * - `teardown`: peer 0 aborts and closes its provider while the participant
 *   read is in flight.
 */
export async function runHandshakeFailure(
    staging: "read" | "sync" | "teardown"
): Promise<HandshakeFailureOutcome> {
    const harness = new PeerTestHarness<PingPongRpc, MathStateMachine>({
        deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
    });
    const hostErrors: Error[] = [];
    let unsubscribe = () => {};
    try {
        await harness.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: true },
            customRpcManifest: {
                module: path.resolve(
                    __dirname,
                    "customRpc/PingPongRpcManifest.ts"
                )
            }
        });
        await harness.lifecycle.openChannel();
        const opener = harness.getPeer(0);
        const control = (index: number) =>
            harness.control(
                harness.getPeer(index)
            ) as RemoteRpcProxyType<PingPongRpc>;
        unsubscribe = opener.p2pInstance.onHostError((error) =>
            hostErrors.push(error)
        );
        harness.event.resetEventSpies(0);
        await control(0).stub.setPeerStatus(Status.OPENED).request();

        if (staging === "read")
            await control(0).p2pManagerProbe.closeChainProvider().request();
        if (staging === "sync")
            await control(1).stub.holdSpectateResponses().request();
        if (staging === "teardown")
            await control(0).p2pManagerProbe.abortOnNextHandshake().request();

        const topic = harness.channelId!.toString();
        await control(0).network.joinSelectedKey(topic).request();
        await control(1).network.joinSelectedKey(topic).request();

        const timeoutMs = harness.event.protocolEventTimeoutMs();
        if (staging === "sync") {
            await waitFor(
                async () =>
                    (await control(1)
                        .stub.getHeldSpectateResponseCount()
                        .request()) > 0,
                timeoutMs
            );
            await control(0).p2pManagerProbe.closeChainProvider().request();
            await control(1).stub.releaseSpectateResponses().request();
        }
        if (staging === "teardown")
            await waitFor(() => runtimeIsClosed(opener.p2pInstance), timeoutMs);
        else await waitFor(() => hostErrors.length > 0, timeoutMs);

        return {
            hostErrors: [...hostErrors],
            hookCount: opener.eventSpies.onConnection?.callCount ?? 0,
            aborted: (opener.eventSpies.onAbort?.callCount ?? 0) > 0
        };
    } finally {
        await harness.cleanup();
        unsubscribe();
    }
}
