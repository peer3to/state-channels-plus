// @spec-test-coverage-ignore: shared reduction disposal staging exercised by the mapped ReductionManager test declarations

import HarnessControlRpc from "./customRpc/harnessControl/HarnessControlRpc";
import { inlineHostFor, runtimeEndpointFor } from "./RuntimeRootObservation";
import { Status } from "@/types";
import { sleep } from "@/utils";
import { DetachedPromises } from "@/utils/DetachedPromises";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Stage a reducible disputed fork on peer 0, hold its reduction at `point`
 * (the attempt, or the genesis application's `setState`), abort while it is
 * held, and release it after the cut: the attempt runs on in the aborted
 * runtime and sends no transaction from peer 0.
 */
export async function assertAbortedReductionSendsNothing(
    h: MathPeerTestHarness,
    point: "attempt" | "setState"
): Promise<void> {
    const { sourceForkId } = await stageDisposalFork(h);
    const target = h.getPeer(0);
    const { host, sm, stub } = runtimeEndpointFor(target.p2pInstance);
    const hold =
        point === "attempt"
            ? await h.rpcStub.holdReductionAttempt(0, "attempt")
            : await h.rpcStub.holdReductionGenesisApplication(0, {
                  outcome: "hold",
                  at: "setState"
              });
    // through the control port, so the attempt is this peer's work
    await h.control(target).stub.startTryReduce(sourceForkId).request();
    await waitFor(
        async () => (await hold.entered()) === 1,
        h.event.protocolEventTimeoutMs()
    );
    const nonce = await h.provider.getTransactionCount(target.address);
    // the teardown parks after the cut, so the released attempt runs on a
    // live executor and provider and only the signer cut stops its send
    stub.stubHoldRuntimeDisposal();
    try {
        stub.abortDetached();
        await waitFor(async () => sm.isDisposed);
        if (point === "attempt") stub.restoreReductionAttempt();
        else stub.restoreReductionGenesisApplication();
        await sleep(1_000);
        expect(await h.provider.getTransactionCount(target.address)).to.equal(
            nonce
        );
    } finally {
        stub.releaseRuntimeDisposal();
        await host.dispose();
    }
}

/**
 * Stage a reducible disputed fork on peer 0 and make the selected read
 * reject after the canonical `setState`; the application aborts the runtime
 * without committing and the caller sees no rejection.
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
    await waitFor(async () => manager.stateManager.isDisposed);
    expect(stub.getHeldReductionGenesisApplicationCount()).to.equal(1);
    stub.restoreReductionGenesisApplication();

    // The application handles the failed read itself: it aborts the state
    // manager and commits nothing; the read error is not the caller's error.
    expect(stub.getTryReduceOutcome()?.settled).to.equal(false);
    expect(query.getForkId()).to.equal(sourceForkId);
    expect(query.getStatus()).to.equal(Status.OPENED);
    expect(h.event.getEventCallCount(0, "onSetState")).to.equal(setStateCalls);
    expect(query.getOutboundHead()).to.deep.equal(outboundHead);
    // Full root cleanup makes the executor unavailable in either placement.
    await waitFor(() => host.connections.size === 0);
    await expect(manager.stateManager.diamondStateMachine.getParticipants()).to
        .be.rejected;
}

/**
 * Stage a reducible disputed fork on peer 0, hold its reduce send after the
 * local install, abort while it is held, and release the send while the
 * teardown is parked before the chain provider closes. The released send
 * reaches the signer after the disposal cut-off: it is submitted once, never
 * broadcasts and never settles, with no rejection or reported failure.
 */
export async function assertDisposalDuringHeldReduceSend(
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await stageDisposalFork(h);
    const target = h.getPeer(0);
    const { host, sm, stub } = runtimeEndpointFor(target.p2pInstance);
    const executor = sm.reductionManager["reductionExecutor"];
    const submitDetached = executor["submitDetached"];
    const logFailure = executor["logUnclassifiedSubmissionFailure"];
    let reportedFailures = 0;
    let submission: Promise<unknown> | undefined;
    executor["logUnclassifiedSubmissionFailure"] = () => {
        reportedFailures++;
    };
    executor["submitDetached"] = (...args) => {
        const collect = DetachedPromises.collect;
        // kept out of the session's drain: the send freezes at the cut
        DetachedPromises.collect = (promise) => {
            submission = promise;
        };
        try {
            submitDetached.apply(executor, args);
        } finally {
            DetachedPromises.collect = collect;
        }
    };
    // stop() parks on the custom RPC disposal, after it set isDisposed and
    // before the root closes the chain provider
    const localRpc = sm.p2pManager.localRpc;
    const disposeLocalRpc = localRpc.dispose;
    let releaseTeardown!: () => void;
    const teardown = new Promise<void>((resolve) => {
        releaseTeardown = resolve;
    });
    localRpc.dispose = async () => {
        await teardown;
        return disposeLocalRpc.call(localRpc);
    };
    const hold = await h.rpcStub.holdReductionAttempt(0, "submit");
    try {
        stub.startTryReduce(sourceForkId);
        // the send is reached only after the local install
        await waitFor(async () => (await hold.entered()) === 1);
        await waitFor(async () => stub.getTryReduceOutcome()?.settled === true);
        expect(stub.getTryReduceOutcome()?.result).to.be.a("string");
        stub.abortDetached();
        await waitFor(async () => sm.isDisposed);
        stub.restoreReductionAttempt();
        // released after the cut, the send never broadcasts and never settles
        const isSettled = await Promise.race([
            submission!.then(
                () => true,
                () => true
            ),
            sleep(1_000).then(() => false)
        ]);
        expect(isSettled).to.equal(false);
        expect(stub.getReductionSubmitCallCount()).to.equal(1);
        expect(reportedFailures).to.equal(0);
    } finally {
        stub.restoreReductionAttempt();
        executor["submitDetached"] = submitDetached;
        executor["logUnclassifiedSubmissionFailure"] = logFailure;
        releaseTeardown();
        localRpc.dispose = disposeLocalRpc;
    }
    await host.dispose();
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
