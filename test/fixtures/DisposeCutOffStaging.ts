// @spec-test-coverage-ignore: shared staging for the mapped E2E-DisposeCutOff declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { signBlockVariant } from "./QueueAdmissionFixture";
import { clientRootFor, runtimeEndpointFor } from "./RuntimeRootObservation";
import { type DoubleSignatureReport, recoverSigner } from "@/cache";
import Clock from "@/Clock";
import type HostNonceManager from "@/evm/signer/HostNonceManager";
import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
import { isEngagedStatus } from "@/types/flags";
import { DetachedPromises, sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { getBytes, id, Wallet } from "ethers";

/** Long enough for released work to run on and send what it would send. */
const AFTER_CUT_WINDOW_MS = 1_000;

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
    point: "confirmationValidation" | "commit",
    inline: boolean
): Promise<void> {
    await h.lifecycle.start(3, 0, {
        configOverrides: { RUN_SDK_IN_THREAD: !inline }
    });
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
    await disposeAndRelease(h, peer, inline, {
        releaseInline: (stub) => stub.releaseBlockWorkHold(),
        release: () => held.release()
    });
    await write;
}

/**
 * A peer's dispute upload waits on its nonce mutex when its runtime is
 * disposed; the mutex is released after the cut. The upload never reaches
 * the chain: no dispute is committed and the peer's nonce is unchanged.
 */
export async function assertDisposeCutsHeldDisputeUpload(
    h: MathPeerTestHarness,
    inline: boolean
): Promise<void> {
    await h.lifecycle.start(3, 2, {
        configOverrides: { RUN_SDK_IN_THREAD: !inline }
    });
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
    await disposeAndRelease(h, peer, inline, {
        releaseInline: (stub) => stub.releaseNonceMutex(),
        release: () => control.releaseNonceMutex().request()
    });
    expect(await committedDisputes()).to.equal(disputesBefore);
}

/**
 * Inline peers share one process. A sibling's work that fails after the
 * disposed peer's grace period still surfaces in the session drain: it is
 * attributed to the sibling, not to the cut runtime.
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
    // after the disposed peer's grace
    const message = "sibling failure after the cut";
    const ingest = runtimeEndpointFor(sibling.p2pInstance).sm
        .blockIngestService;
    const onBlockConfirmation = ingest.onBlockConfirmation;
    let isCollected = false;
    ingest.onBlockConfirmation = (...args) => {
        ingest.onBlockConfirmation = onBlockConfirmation;
        DetachedPromises.collect(
            sleep(IN_FLIGHT_REPLY_DRAIN_MS + 1_000).then(() => {
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
 * Inline peers share one realm with its static Clock and signer recovery
 * cache. The Clock is handed the disposed peer's provider, so that provider
 * outlives it. While the disposal is held at its gas report (after its
 * children are gone) and after it, a timer it armed, the channel's chain
 * logs and a realm-wide double-signature report reach a live sibling and
 * never the disposed runtime. A test of inline mode's shared realm, kept
 * while the SDK supports inline mode.
 */
export async function assertDisposedInlineRuntimeFiresNothing(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 2, {
        configOverrides: { RUN_SDK_IN_THREAD: false }
    });
    const endpoints = h.peers.map((peer) => ({
        peer,
        sm: runtimeEndpointFor(peer.p2pInstance).sm
    }));
    const [disposed, live, disputer] = endpoints;
    // the realm's Clock reads through this peer's provider, as it keeps the
    // first runtime's provider outside the harness
    const provider = disposed.sm.stateChannelManagerContract.runner!.provider!;
    await Clock.init(provider);
    expect(Clock.ownsProvider(provider)).to.equal(true);
    const observe = (sm: typeof live.sm) => {
        const calls = { timer: 0, chainLogs: 0, doubleSignatures: 0 };
        sm.timeoutManager.scheduleTask(
            () => {
                calls.timer += 1;
            },
            AFTER_CUT_WINDOW_MS / 2,
            "dispose cut-off probe"
        );
        const sync = sm.eventSyncService;
        const schedule = sync.scheduleStreamedLog.bind(sync);
        sync.scheduleStreamedLog = (...args) => {
            calls.chainLogs += 1;
            return schedule(...args);
        };
        const p2pManager = sm.p2pManager;
        const onDoubleSignature =
            p2pManager["onDoubleSignature"].bind(p2pManager);
        Reflect.set(
            p2pManager,
            "onDoubleSignature",
            (report: DoubleSignatureReport) => {
                calls.doubleSignatures += 1;
                onDoubleSignature(report);
            }
        );
        return calls;
    };
    const disposedCalls = observe(disposed.sm);
    const liveCalls = observe(live.sm);
    // hold the disposal at its gas report, which runs after the children
    const { gasUsage } = Reflect.get(
        runtimeEndpointFor(disposed.peer.p2pInstance).host,
        "managedSigner"
    ) as HostNonceManager;
    const settledSnapshot = gasUsage.settledSnapshot.bind(gasUsage);
    let gasReportEntered = false;
    let releaseGasReport!: () => void;
    const gasReportHeld = new Promise<void>((resolve) => {
        releaseGasReport = resolve;
    });
    gasUsage.settledSnapshot = async (timeoutMs) => {
        gasReportEntered = true;
        await gasReportHeld;
        return settledSnapshot(timeoutMs);
    };
    const disposal = disposed.peer.p2pInstance.dispose();
    await waitFor(() => gasReportEntered, h.event.protocolEventTimeoutMs());

    // a chain log on the channel, a timer deadline and a double signature
    await h.execOnHost(disputer.peer, (sm) => {
        sm.disputeManager.requestDispute(sm.forkId);
        return true;
    });
    const wallet = Wallet.createRandom();
    const blockHash = id("disposed runtime double signature");
    for (const variant of [0, 1])
        expect(
            recoverSigner(
                getBytes(blockHash),
                signBlockVariant(wallet, blockHash, variant)
            )
        ).to.equal(wallet.address);
    await waitFor(
        () => liveCalls.chainLogs > 0 && liveCalls.timer > 0,
        h.event.protocolEventTimeoutMs()
    );
    await sleep(AFTER_CUT_WINDOW_MS);
    releaseGasReport();
    await disposal;

    expect(liveCalls.doubleSignatures).to.equal(1);
    expect(disposedCalls).to.deep.equal({
        timer: 0,
        chainLogs: 0,
        doubleSignatures: 0
    });
}

/**
 * Dispose `peer` while it holds work and release the work after the cut.
 * Nothing the peer does after `dispose()` reaches the other peers or the
 * chain, the disposal is not held by the work, and a fresh runtime for the
 * same signer engages again; the session's `afterEach` checks that nothing
 * failed unhandled. Inline, the release goes to the disposed runtime's
 * in-memory endpoint; in a worker, it follows the dispose request on the
 * host's port.
 */
export async function disposeAndRelease(
    h: MathPeerTestHarness,
    peer: Peer,
    inline: boolean,
    hold: {
        releaseInline: (
            stub: ReturnType<typeof runtimeEndpointFor>["stub"]
        ) => unknown;
        release: () => Promise<unknown>;
    }
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
    const endpoint = inline ? runtimeEndpointFor(peer.p2pInstance) : null;
    const hostRemote = clientRootFor(
        peer.p2pInstance
    ).p2pRuntimeHostRemoteRoot!;
    const nonce = await h.provider.getTransactionCount(peer.address);
    // the held peer sends nothing more until released
    const framesBeforeDisposal = await frameCounts();

    const startedAt = Date.now();
    const disposal = peer.p2pInstance.dispose();
    if (endpoint) {
        await waitFor(() => endpoint.host.isDisposing);
        hold.releaseInline(endpoint.stub);
    } else {
        await waitFor(() => hostRemote.isDisposing);
        void hold.release().catch(() => undefined);
    }
    await disposal;
    const disposalMs = Date.now() - startedAt;
    await sleep(AFTER_CUT_WINDOW_MS);

    expect(disposalMs).to.be.below(IN_FLIGHT_REPLY_DRAIN_MS);
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
