// @spec-test-coverage-ignore: shared reduction disposal staging exercised by the mapped ReductionManager test declarations
import { expect } from "chai";

import { Status } from "@/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";

/**
 * Stage a reducible disputed fork on peer 0, hold the reduction genesis
 * application at `at`, abort while it is held, and prove the attempt settles
 * as cancelled while the hold is still closed and that nothing was committed.
 */
export async function assertDisposalDuringGenesisApplication(
    h: MathPeerTestHarness,
    at: "setState" | "getParticipants" | "getNextToWrite"
): Promise<void> {
    const { sourceForkId } = await stageDisposalFork(h);
    const target = h.getPeer(0);
    const setStateCalls = h.event.getEventCallCount(0, "onSetState");
    const outboundHead = await h
        .control(target)
        .query.getOutboundHead()
        .request();
    const hold = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "hold",
        at
    });
    try {
        await h.control(target).stub.startTryReduce(sourceForkId).request();
        await waitFor(async () => (await hold.entered()) === 1);
        await h.control(target).stub.abortDetached().request();
        await waitFor(
            async () =>
                await h.execOnHost(target, async (sm) => Boolean(sm.isDisposed))
        );
        // Disposal settles the caller while the VM call is still held: the
        // shared completion is the boundary, not the executor's return.
        await waitFor(
            async () =>
                (await h.control(target).stub.getTryReduceOutcome().request())
                    ?.settled === true
        );
        expect(
            await h.control(target).stub.getTryReduceOutcome().request()
        ).to.deep.equal({ settled: true, result: null, rejected: null });
    } finally {
        await hold.release();
    }

    expect(await h.control(target).query.getForkId().request()).to.equal(
        sourceForkId
    );
    expect(await h.control(target).query.getStatus().request()).to.equal(
        Status.OPENED
    );
    expect(h.event.getEventCallCount(0, "onSetState")).to.equal(setStateCalls);
    expect(
        await h
            .control(target)
            .query.getCompletedReductionForkId(sourceForkId)
            .request()
    ).to.equal(null);
    // The terminal outbound block persisted during candidate preparation may
    // remain readable by hash, but the outbound head never moved.
    expect(
        await h.control(target).query.getOutboundHead().request()
    ).to.deep.equal(outboundHead);
}

/**
 * Stage a reducible disputed fork on peer 0 and make the selected read
 * reject after the canonical `setState`; the application aborts the runtime
 * without committing and the caller settles as cancelled.
 */
export async function assertReadFailureDuringGenesisApplication(
    h: MathPeerTestHarness,
    at: "getParticipants" | "getNextToWrite"
): Promise<void> {
    const { sourceForkId } = await stageDisposalFork(h);
    const target = h.getPeer(0);
    const setStateCalls = h.event.getEventCallCount(0, "onSetState");
    const outboundHead = await h
        .control(target)
        .query.getOutboundHead()
        .request();
    const control = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "reject",
        at
    });
    await h.control(target).stub.startTryReduce(sourceForkId).request();
    await waitFor(
        async () =>
            (await h.control(target).stub.getTryReduceOutcome().request())
                ?.settled === true
    );
    expect(await control.entered()).to.equal(1);
    await control.release();

    // The application handles the failed read itself: it aborts the state
    // manager and commits nothing, and disposal settles the caller as a
    // cancellation; the read error is not the caller's error.
    expect(
        await h.control(target).stub.getTryReduceOutcome().request()
    ).to.deep.equal({ settled: true, result: null, rejected: null });
    expect(await h.control(target).query.getForkId().request()).to.equal(
        sourceForkId
    );
    expect(await h.control(target).query.getStatus().request()).to.equal(
        Status.OPENED
    );
    expect(h.event.getEventCallCount(0, "onSetState")).to.equal(setStateCalls);
    expect(
        await h.control(target).query.getOutboundHead().request()
    ).to.deep.equal(outboundHead);
    // The state manager aborted; once disposal completes, the VM no longer
    // serves the split state.
    await waitFor(
        async () =>
            await h.execOnHost(target, async (sm) => Boolean(sm.isDisposed))
    );
    expect(
        await h.execOnHost(target, async (sm) => {
            try {
                void (await sm.diamondStateMachine.getParticipants());
                return "served";
            } catch {
                return "rejected";
            }
        })
    ).to.equal("rejected");
}

async function stageDisposalFork(h: MathPeerTestHarness) {
    return await h.scenario.stageReducibleDisputedFork({
        peerCount: 4,
        maliciousPeerIndex: 1,
        disputingPeerIndices: [0],
        beforeDispute: async () => {
            // One real dispute supplies the reduction input. Other uploads
            // are unrelated to disposal and can outlive this short window.
            for (const peerIndex of [1, 2, 3]) {
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.stubSuppressDisputeInitiation()
                    .request();
            }
        }
    });
}
