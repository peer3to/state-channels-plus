// @spec-test-coverage-ignore: shared initial-sync staging exercised by mapped P2PManager declarations

import { clientRootFor } from "./RuntimeRootObservation";
import { Status } from "@/types";
import { sleep } from "@/utils";
import type HarnessControlRpc from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";

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
 * Open a two-participant channel, spawn an observer, start its connect and
 * abort the runtime as soon as the status is OPENED. `stage` runs on the
 * observer before the connect and decides which phase the abort lands in.
 * The connect must settle `false` within `settledWithinMs`, and the host root
 * must close afterwards.
 */
export async function assertObserverConnectSettlesFalseOnAbort<
    TCustomRpc extends HarnessControlRpc
>(
    h: PeerTestHarness<TCustomRpc, MathStateMachine>,
    options: {
        settledWithinMs: number;
        stage?: (
            observer: TestPeer<TCustomRpc, MathStateMachine>
        ) => Promise<void>;
    }
): Promise<void> {
    await h.lifecycle.openChannelForParticipants([0, 1]);
    await h.network.joinSelectedKey([0, 1], String(h.channelId));
    const observerIndex = h.peers.length;
    await h.createPeer(
        observerIndex,
        h.signerFor(slotAccountIndex(observerIndex))
    );
    const observer = h.getPeer(observerIndex);
    const host = clientRootFor(observer.p2pInstance).p2pRuntimeHostRemoteRoot!;
    await options.stage?.(observer);
    const startedAt = Date.now();
    const connect = observer.p2pInstance.p2pSigner.connectToChannel(
        h.channelId
    );
    await h.event.waitUntilPeerStatus(observerIndex, Status.OPENED);
    await h.control(observer).stub.abortDetached().request();
    expect(await connect).to.equal(false);
    expect(Date.now() - startedAt).to.be.lessThan(options.settledWithinMs);
    await waitFor(() => host.isClosed, h.event.protocolEventTimeoutMs());
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
        const root = clientRootFor(observer.p2pInstance);
        const host = root.p2pRuntimeHostRemoteRoot!;
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
            await h.control(observer).stub.abortDetached().request();
            expect(await connect).to.equal(false);
            await waitFor(() => host.isClosed);
            const syncedAtAbort = h.event.getEventCallCount(
                observerIndex,
                "onSetState"
            );

            // The late result lands on a settled, disposed observer.
            await Promise.all(releases.map((release) => release()));
            await sleep(500);
            expect(host.isClosed).to.equal(true);
            expect(root.connections.size).to.equal(0);
            expect(
                h.event.getEventCallCount(observerIndex, "onSetState")
            ).to.equal(syncedAtAbort);
            await expect(h.control(observer).query.getStatus().request()).to.be
                .rejected;
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });
}
