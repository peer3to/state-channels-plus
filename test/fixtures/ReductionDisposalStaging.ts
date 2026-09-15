// @spec-test-coverage-ignore: shared reduction disposal staging exercised by the mapped ReductionManager test declarations

import HarnessControlRpc from "./customRpc/harnessControl/HarnessControlRpc";
import { inlineHostFor } from "./RuntimeRootObservation";
import { Status } from "@/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

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
    const host = inlineHostFor(target.p2pInstance);
    const manager = host.hostRpc.requireManager();
    const rpc = manager.localRpc;
    if (!(rpc instanceof HarnessControlRpc))
        throw new Error("Expected the real harness RPC root");
    const stub = rpc.stub.createRPCMethods(manager.loopbackTransport);
    const query = rpc.query.createRPCMethods(manager.loopbackTransport);
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
        await waitFor(async () => manager.stateManager.isDisposed);
        // Disposal settles the caller while the VM call is still held: the
        // shared completion is the boundary, not the executor's return.
        await waitFor(async () => stub.getTryReduceOutcome()?.settled === true);
        expect(stub.getTryReduceOutcome()).to.deep.equal({
            settled: true,
            result: null,
            rejected: null
        });
    } finally {
        stub.restoreReductionGenesisApplication();
    }

    expect(query.getForkId()).to.equal(sourceForkId);
    expect(query.getStatus()).to.equal(Status.OPENED);
    expect(h.event.getEventCallCount(0, "onSetState")).to.equal(setStateCalls);
    expect(query.getCompletedReductionForkId(sourceForkId)).to.equal(null);
    // The terminal outbound block persisted during candidate preparation may
    // remain readable by hash, but the outbound head never moved.
    expect(query.getOutboundHead()).to.deep.equal(outboundHead);
    await host.dispose();
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
    const host = inlineHostFor(target.p2pInstance);
    const manager = host.hostRpc.requireManager();
    const rpc = manager.localRpc;
    if (!(rpc instanceof HarnessControlRpc))
        throw new Error("Expected the real harness RPC root");
    const stub = rpc.stub.createRPCMethods(manager.loopbackTransport);
    const query = rpc.query.createRPCMethods(manager.loopbackTransport);
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
    await waitFor(async () => stub.getTryReduceOutcome()?.settled === true);
    expect(stub.getHeldReductionGenesisApplicationCount()).to.equal(1);
    stub.restoreReductionGenesisApplication();

    // The application handles the failed read itself: it aborts the state
    // manager and commits nothing, and disposal settles the caller as a
    // cancellation; the read error is not the caller's error.
    expect(stub.getTryReduceOutcome()).to.deep.equal({
        settled: true,
        result: null,
        rejected: null
    });
    expect(query.getForkId()).to.equal(sourceForkId);
    expect(query.getStatus()).to.equal(Status.OPENED);
    expect(h.event.getEventCallCount(0, "onSetState")).to.equal(setStateCalls);
    expect(query.getOutboundHead()).to.deep.equal(outboundHead);
    // Full root cleanup makes the executor unavailable in either placement.
    await waitFor(() => host.connections.size === 0);
    await expect(manager.stateManager.diamondStateMachine.getParticipants()).to
        .be.rejected;
}

export async function stageDisposalFork(h: MathPeerTestHarness) {
    return await h.scenario.stageReducibleDisputedFork({
        peerCount: 4,
        configOverrides: { RUN_SDK_IN_THREAD: false },
        maliciousPeerIndex: 1,
        disputingPeerIndices: [0],
        beforeDispute: async () => {
            // One real dispute supplies the reduction input. Other uploads
            // are unrelated to disposal and can outlive this short window.
            await h.dispute.suppressDisputeInitiation(
                [1, 2, 3].map((peerIndex) => h.getPeer(peerIndex).index)
            );
        }
    });
}
