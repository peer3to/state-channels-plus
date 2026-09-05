// @spec-test-coverage-ignore: shared initial-sync staging exercised by mapped P2PManager declarations
import { expect } from "chai";

import { Status } from "@/types";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type HarnessControlRpc from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { MathStateMachine } from "@typechain-types";

import type { TestPeer } from "@test/harness/core/types";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { sleep } from "@/utils";

/** Keep the participants authoring through a fresh observer's spawn and test body. */
export async function withFreshInitialSyncObserver<
    TCustomRpc extends HarnessControlRpc
>(
    h: PeerTestHarness<TCustomRpc, MathStateMachine>,
    run: (observer: TestPeer<TCustomRpc, MathStateMachine>) => Promise<void>
): Promise<void> {
    await h.lifecycle.openChannelForParticipants([0, 1]);
    await h.network.joinSelectedKey([0, 1], String(h.channelId));
    // A slow spawn must not leave the first writer idle long enough to
    // open a timeout dispute before the observer begins its initial sync.
    let finished = false;
    const keepAlive = h.transition.keepAuthoringUntil({
        until: () => finished,
        waitForPeers: [0, 1],
        maximumBlocks: 40,
        txFn: (contract) => contract.add(1)
    });
    void keepAlive.catch(() => undefined);
    try {
        const observerIndex = h.peers.length;
        await h.createPeer(
            observerIndex,
            h.signerFor(slotAccountIndex(observerIndex))
        );
        await run(h.getPeer(observerIndex));
    } finally {
        finished = true;
        await keepAlive;
    }
}

/**
 * Open a two-participant channel, hold the participants' sync responses so
 * the observer's real initial sync request is in flight, abort the observer,
 * then release the held response as a success or a failure. The connect
 * settles `false` on the abort and the late result changes nothing.
 */
export async function assertLateSyncResultAfterAbortChangesNothing<
    TCustomRpc extends HarnessControlRpc
>(
    h: PeerTestHarness<TCustomRpc, MathStateMachine>,
    lateResult: "success" | "failure"
): Promise<void> {
    await withFreshInitialSyncObserver(h, async (observer) => {
        const observerIndex = observer.index;
        const releases = await Promise.all(
            [0, 1].map((index) =>
                h.rpcStub.holdSpectateResponses(index, lateResult === "failure")
            )
        );
        try {
            const connect = observer.p2pInstance.p2pSigner.connectToChannel(
                h.channelId
            );
            await h.event.waitUntilPeerStatus(observerIndex, Status.OPENED);
            // The observer's sync request has reached a participant and waits
            // on the held response.
            await waitFor(async () => {
                const counts = await Promise.all(
                    [0, 1].map((index) =>
                        h
                            .control(h.getPeer(index))
                            .stub.getHeldSpectateResponseCount()
                            .request()
                    )
                );
                return counts.some((count) => count >= 1);
            });
            await h.execOnHost(observer, async (sm) => {
                sm.abort();
                return true;
            });
            expect(await connect).to.equal(false);
            await waitFor(
                async () =>
                    await h.execOnHost(observer, async (sm) =>
                        Boolean(sm.isDisposed)
                    )
            );
            const statusAtAbort = await h
                .control(observer)
                .query.getStatus()
                .request();

            // The late result lands on a settled, disposed observer.
            await Promise.all(releases.map((release) => release()));
            await sleep(500);
            expect(
                await h.control(observer).query.getStatus().request()
            ).to.equal(statusAtAbort);
            expect(
                await h.execOnHost(observer, async (sm) =>
                    Boolean(sm.isDisposed)
                )
            ).to.equal(true);
            expect(
                await h.control(observer).query.getChannelId().request()
            ).to.equal(String(h.channelId));
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });
}
