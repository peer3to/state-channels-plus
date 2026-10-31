// @spec-test-coverage-ignore: shared staging for the mapped E2E-DisposeCutOff declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import {
    clientRootFor,
    runtimeEndpointFor,
    runtimeIsClosed
} from "./RuntimeRootObservation";
import { isEngagedStatus } from "@/types/flags";
import { DetachedPromises, sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Long enough for released work to run on and send what it would send. */
const AFTER_CUT_WINDOW_MS = 1_000;

/** A probe timer's delay: due long after the disposal cancels its timers. */
const PROBE_TIMER_MS = 3_000;

type Peer = MathPeerTestHarness["peers"][number];

/**
 * One peer's runtime is disposed while it holds block work at `point`:
 * `confirmationValidation` holds a participant's ingest of the writer's
 * gossiped block, `commit` holds the writer between signing its block and
 * gossiping it. The held work is released after the cut, so it runs on in
 * the disposed runtime (see `disposeAndRelease` for the oracle).
 */
export async function assertDisposeCutsHeldBlockWork(
    h: MathPeerTestHarness,
    point: "confirmationValidation" | "commit"
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const writer = h.getPeer((await h.query.getNextPeerToWrite()).index);
    const peer =
        point === "commit"
            ? writer
            : h.peers.find((candidate) => candidate !== writer)!;
    const held = await h.rpcStub.holdBlockWork(peer.index, point);
    // the writer's own call is a request this peer's disposal answers
    const write = h.transition
        .submit(writer, (contract) => contract.add(1), { waitForSync: false })
        .catch(() => undefined);
    await held.waitUntilEntered();
    await disposeAndRelease(h, peer, () => held.release());
    await write;
}

/**
 * A peer's dispute upload waits on its nonce mutex when its runtime is
 * disposed; the mutex is released after the cut. The upload never reaches
 * the chain: no dispute is committed and the peer's nonce is unchanged.
 */
export async function assertDisposeCutsHeldDisputeUpload(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 2);
    const peer = h.getPeer(0);
    const control = h.control(peer).stub;
    const committedDisputes = async () =>
        (
            await h.channelManager.queryFilter(
                h.channelManager.filters.DisputeCommitted(h.channelId)
            )
        ).length;
    const disputesBefore = await committedDisputes();
    await control.holdNonceMutex().request();
    await h.execOnHost(peer, (sm) => {
        sm.disputeManager.requestDispute(sm.forkId);
        return true;
    });
    await waitFor(
        async () => (await control.getNonceMutexWaiterCount().request()) > 0,
        h.event.protocolEventTimeoutMs()
    );
    await disposeAndRelease(h, peer, () =>
        control.releaseNonceMutex().request()
    );
    expect(await committedDisputes()).to.equal(disputesBefore);
}

/**
 * Inline peers share one process. A sibling's work that fails after a
 * peer's disposal ended still surfaces in the session drain: it is
 * attributed to the sibling, not to the cut runtime. A test of inline
 * mode's shared realm, kept while the SDK supports inline mode.
 */
export async function assertInlineSiblingFailureAfterCutSurfaces(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 0, {
        configOverrides: { RUN_SDK_IN_THREAD: false }
    });
    const writer = h.getPeer((await h.query.getNextPeerToWrite()).index);
    const [disposed, sibling] = h.peers.filter(
        (candidate) => candidate !== writer
    );
    await disposed.p2pInstance.dispose();

    // the sibling's ingest of the writer's next block starts work that fails
    // after the disposed peer's disposal ended
    const message = "sibling failure after the cut";
    const ingest = runtimeEndpointFor(sibling.p2pInstance).sm
        .blockIngestService;
    const onBlockConfirmation = ingest.onBlockConfirmation;
    let isCollected = false;
    ingest.onBlockConfirmation = (...args) => {
        ingest.onBlockConfirmation = onBlockConfirmation;
        DetachedPromises.collect(
            sleep(AFTER_CUT_WINDOW_MS).then(() => {
                throw new Error(message);
            })
        );
        isCollected = true;
        return onBlockConfirmation.apply(ingest, args);
    };
    try {
        void h.transition
            .submit(writer, (contract) => contract.add(1), {
                waitForSync: false
            })
            .catch(() => undefined);
        await waitFor(() => isCollected, h.event.protocolEventTimeoutMs());
    } finally {
        ingest.onBlockConfirmation = onBlockConfirmation;
    }
    await TestSession.settleDetached({ expectedErrorIncludes: message });
}

/**
 * A worker realm keeps its static Clock and signer recovery cache until its
 * thread ends, and its Clock reads through the runtime's provider. The
 * disposal is held after its children, once the listeners are off that
 * provider; meanwhile a timer the runtime armed, the channel's chain logs
 * and a realm-wide double-signature report reach a live peer and never the
 * disposed runtime.
 */
export async function assertDisposedRuntimeFiresNothing(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 2);
    const [disposed, live, disputer] = h.peers;
    for (const peer of [disposed, live]) {
        const stub = h.control(peer).stub;
        await stub.observeRuntimeCallbacks(PROBE_TIMER_MS).request();
        await stub.observeDoubleSignatureLogs().request();
    }
    const disposedStub = h.control(disposed).stub;
    const liveStub = h.control(live).stub;
    const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(
        disposed.index,
        "providerRelease"
    );
    try {
        await disposedStub.abortDetached().request();
        await waitFor(
            async () =>
                (await disposedStub
                    .getRuntimeDisposalHoldEntered()
                    .request()) === 1,
            h.event.protocolEventTimeoutMs()
        );

        // a chain log on the channel, a timer deadline and a double signature
        await h.execOnHost(disputer, (sm) => {
            sm.disputeManager.requestDispute(sm.forkId);
            return true;
        });
        for (const peer of [disposed, live])
            await h.control(peer).stub.recoverDoubleSignature().request();
        await waitFor(async () => {
            const calls = await liveStub.getRuntimeCallbacks().request();
            return calls.chainLogs > 0 && calls.timer > 0;
        }, h.event.protocolEventTimeoutMs());
        await sleep(AFTER_CUT_WINDOW_MS);

        expect(
            await liveStub.getDoubleSignatureLogs().request()
        ).to.have.length(1);
        expect(
            await disposedStub.getRuntimeCallbacks().request()
        ).to.deep.equal({ timer: 0, chainLogs: 0 });
        expect(
            await disposedStub.getDoubleSignatureLogs().request()
        ).to.deep.equal([]);
    } finally {
        await releaseDisposal();
    }
    await waitFor(
        () => runtimeIsClosed(disposed.p2pInstance),
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * Dispose `peer` while it holds work and release the work after the cut.
 * Nothing the peer does after `dispose()` reaches the other peers or the
 * chain, the disposal is not held by the work, and a fresh runtime for the
 * same signer engages again; the session's `afterEach` checks that nothing
 * failed unhandled. The release follows the dispose request on the host's
 * port.
 */
export async function disposeAndRelease(
    h: MathPeerTestHarness,
    peer: Peer,
    release: () => Promise<unknown>
): Promise<void> {
    const others = h.peers.filter((candidate) => candidate !== peer);
    for (const other of others)
        await h
            .control(other)
            .stub.stubCaptureInboundRequestFrames({
                senderAddress: peer.address
            })
            .request();
    const frameCounts = () =>
        Promise.all(
            others.map((other) =>
                h.control(other).stub.getCapturedFrameCount().request()
            )
        );
    const hostRemote = clientRootFor(
        peer.p2pInstance
    ).p2pRuntimeHostRemoteRoot!;
    const nonce = await h.provider.getTransactionCount(peer.address);
    // the held peer sends nothing more until released
    const framesBeforeDisposal = await frameCounts();

    const startedAt = Date.now();
    const disposal = peer.p2pInstance.dispose();
    await waitFor(() => hostRemote.isDisposing);
    void release().catch(() => undefined);
    await disposal;
    const disposalMs = Date.now() - startedAt;
    await sleep(AFTER_CUT_WINDOW_MS);

    // not held by the work
    expect(disposalMs).to.be.below(5_000);
    expect(await frameCounts()).to.deep.equal(framesBeforeDisposal);
    expect(await h.provider.getTransactionCount(peer.address)).to.equal(nonce);
    for (const other of others)
        await h.control(other).stub.restoreInboundRequestFrames().request();

    // a fresh runtime for the same signer comes back
    peer.logger.dispose();
    await h.createPeer(peer.index, peer.signer);
    const rebuilt = h.getPeer(peer.index);
    await h.join.connectSpectator(rebuilt);
    await waitFor(
        async () =>
            isEngagedStatus(
                await h.control(rebuilt).query.getStatus().request()
            ),
        h.event.protocolEventTimeoutMs()
    );
}
