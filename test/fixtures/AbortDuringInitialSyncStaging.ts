// @spec-test-coverage-ignore: shared initial-sync staging exercised by mapped P2PManager declarations

import { rejectionOf } from "./ProvenSubmissionFailureStaging";
import { clientRootFor } from "./RuntimeRootObservation";
import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
import { isRootDisposedError } from "@/rpc/internal/RemoteRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { Status } from "@/types";
import { sleep } from "@/utils";
import type { HarnessControlRpcShape } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { ParticipantCheckAnswer } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";

/** Keep the participants authoring through a fresh observer's spawn and test body. */
export async function withFreshInitialSyncObserver<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(
    h: PeerTestHarness<THost, MathStateMachine>,
    run: (observer: TestPeer<THost, MathStateMachine>) => Promise<void>
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

/** The observer's pre-request bound on its first participant handshake. */
export const INITIAL_SYNC_DEADLINE_TASK =
    "P2PManager - initial sync participant deadline";

/**
 * Hold the observer's handshake participant checks and its initial-sync
 * deadline, start its connect, wait until a check is held (exactly
 * `heldChecks` when given) and the deadline is held, then run the deadline
 * while the checks stay held. `run` gets the connect and a release of every
 * held check. Checks still held when `run` ends are released with "chain".
 */
export async function withInitialDeadlineElapsedDuringHeldChecks<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(
    h: PeerTestHarness<THost, MathStateMachine>,
    observer: TestPeer<THost, MathStateMachine>,
    options: { heldChecks?: number },
    run: (staged: {
        connect: Promise<boolean>;
        releaseChecks: (answer: ParticipantCheckAnswer) => Promise<number>;
    }) => Promise<void>
): Promise<void> {
    const stub = h.control(observer).stub;
    await stub.holdParticipantCheck().request();
    const deadline = await h.rpcStub.holdScheduledTasks(
        observer.index,
        INITIAL_SYNC_DEADLINE_TASK
    );
    let isReleased = false;
    let isDeadlineRun = false;
    try {
        const connect = observer.p2pInstance.p2pSigner.connectToChannel(
            h.channelId
        );
        await waitFor(async () => {
            const held = await stub.getHeldParticipantCheckCount().request();
            const isCheckHeld =
                options.heldChecks === undefined
                    ? held > 0
                    : held === options.heldChecks;
            return isCheckHeld && (await deadline.heldCount()) === 1;
        }, h.event.protocolEventTimeoutMs());
        // The pre-request deadline elapses while the checks are held.
        isDeadlineRun = true;
        expect(await deadline.runHeld()).to.deep.equal({
            ran: 1,
            errors: []
        });
        await run({
            connect,
            releaseChecks: async (answer) => {
                const released = await stub
                    .releaseParticipantCheck(answer)
                    .request();
                isReleased = true;
                return released;
            }
        });
    } finally {
        if (!isDeadlineRun) await deadline.release(false);
        if (!isReleased) await stub.releaseParticipantCheck("chain").request();
    }
}

/**
 * Open a two-participant channel, spawn an observer, start its connect and
 * abort (or dispose) the runtime as soon as the status is OPENED. `stage`
 * runs on the observer before the connect and decides which phase the end
 * lands in. The connect must reject with RootDisposedError within
 * `settledWithinMs`, the connect frozen at the cut must not hold the
 * disposal, and the host root must close afterwards.
 */
export async function assertObserverConnectRejectsOnEnd<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(
    h: PeerTestHarness<THost, MathStateMachine>,
    options: {
        settledWithinMs: number;
        end?: "abort" | "dispose";
        stage?: (observer: TestPeer<THost, MathStateMachine>) => Promise<void>;
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
    const endedAt = Date.now();
    // observed before the end: a dispose rejects the connect while it runs
    const rejection = rejectionOf(connect);
    if (options.end === "dispose") await observer.p2pInstance.dispose();
    else await h.control(observer).stub.abortDetached().request();
    expect(isRootDisposedError(await rejection)).to.equal(true);
    expect(Date.now() - startedAt).to.be.lessThan(options.settledWithinMs);
    expect(Date.now() - endedAt).to.be.below(IN_FLIGHT_REPLY_DRAIN_MS);
    await waitFor(() => host.isClosed, h.event.protocolEventTimeoutMs());
}

/**
 * Open a two-participant channel, hold the participants' sync responses so
 * the observer's real initial sync request is in flight, abort the observer,
 * then release the held response as a success or a failure. The cut fails
 * the in-flight sync request, so the connect answers `false`, and the late
 * result changes nothing.
 */
export async function assertLateSyncResultAfterAbortChangesNothing<
    THost extends P2pRuntimeHostRoot<HarnessControlRpcShape>
>(
    h: PeerTestHarness<THost, MathStateMachine>,
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
            // the cut fails the in-flight sync request: the sync-failure
            // path answers false before the port closes
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
