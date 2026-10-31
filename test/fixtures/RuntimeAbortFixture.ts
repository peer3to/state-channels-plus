// @spec-test-coverage-ignore: shared abort assertions exercised by StateManagerAbort and P2PManager tests
import { clientRootFor, inlineHostFor } from "./RuntimeRootObservation";
import Clock from "@/Clock";
import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import { Status } from "@/types";
import { sleep } from "@/utils";
import { config } from "@/utils/config";
import { crashLogUploadOverrides } from "@test/fixtures/logging/crashLogConfig";
import {
    decodeUpload,
    type LogReceiver,
    type ReceivedUpload,
    startLogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import { DRAIN_WARNING } from "@test/fixtures/node/WorkerTeardownFixture";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { type HarnessOptions, MathTestSession } from "@test/harness";
import { deferred } from "@test/utils/deferred";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { type WebSocketProvider } from "ethers";

/** Longer than the first reconnect delay of a node that still reconnects. */
const RECONNECT_ABSENCE_WINDOW_MS = 1_000;

/** The abort's log-flush bound in the bounded-flush case: short, so the case is quick. */
const ABORT_FLUSH_MS = 3_000;

/** Longer than the rest of a worker host's disposal; time is the input. */
const HOST_UPLOAD_HOLD_MS = 2_000;

/** The line an aborting runtime logs before it flushes. */
const ABORT_LINE = "Aborting channel participation";

/** Starts four peers whose realms upload their logs to the receiver; peer 0 is the one to abort. */
async function startPeersUploadingTo(
    receiver: LogReceiver,
    configOverrides: HarnessOptions["configOverrides"]
): Promise<void> {
    await MathTestSession.getHarness().lifecycle.start(4, 0, {
        configOverrides: {
            ...crashLogUploadOverrides(receiver.url),
            ...configOverrides
        }
    });
}

/** Aborts peer 0 and waits until its client root closes; returns the time from the abort to the close. */
async function abortFirstPeerUntilClosed(): Promise<number> {
    const harness = MathTestSession.getHarness();
    const peer = harness.getPeer(0);
    const client = clientRootFor(peer.p2pInstance);
    const closed = new Promise<void>((resolve) => client.onClosed(resolve));
    await harness.control(peer).stub.abortDetached(true).request();
    await harness.event.waitForPeers("onAbort", [0], 1);
    const abortedAtMs = Date.now();
    await closed;
    return Date.now() - abortedAtMs;
}

function hasAbortLine(request: ReceivedUpload): boolean {
    return decodeUpload(request).some((entry) => entry.message === ABORT_LINE);
}

/** Every peer uploads to the same receiver, so a VM upload counts only from the aborting peer. */
function isVmUploadOf(request: ReceivedUpload, peerAddress: string): boolean {
    return request.threadName === "vm" && request.peerAddress === peerAddress;
}

/**
 * An aborting runtime uploads its realms' logs (its VM worker's included)
 * before disposal ends them, an upload that never answers holds the disposal
 * no longer than the bound, and the runtime's producers stop at once.
 */
export async function assertAbortUploadsLogsWithinBound(): Promise<void> {
    const held = deferred();
    // VM uploads answer, so the VM worker's own disposal drain ends at once:
    // only the abort flush can hold the close until the bound.
    const receiver = await startLogReceiver({
        respond: async (received) => {
            if (received.threadName !== "vm") await held.promise;
            return 200;
        }
    });
    try {
        await startPeersUploadingTo(receiver, {
            RUN_SDK_IN_THREAD: false,
            VM_DEDICATED_THREAD: true,
            CRASH_LOG_FLUSH_MS: ABORT_FLUSH_MS
        });
        const peer = MathTestSession.getHarness().getPeer(0);
        const stateManager = inlineHostFor(
            peer.p2pInstance
        ).hostRpc.requireManager().stateManager;
        let isTaskRun = false;
        // Due inside the bound, so it runs only if the flush held the producers; scheduled before
        // the abort request, it leaves that request most of the bound on a loaded worker.
        stateManager.timeoutManager.scheduleTask(
            () => {
                isTaskRun = true;
            },
            ABORT_FLUSH_MS - 500,
            "StateManagerAbort.test"
        );

        const elapsedMs = await abortFirstPeerUntilClosed();

        expect(receiver.requests.some(hasAbortLine)).to.equal(true);
        // The VM worker's logs too: the flush reached the thread disposal ends.
        expect(
            receiver.requests.some((request) =>
                isVmUploadOf(request, peer.address)
            )
        ).to.equal(true);
        // The uploads never answer: disposal waited for the bound, and no longer. The lower limit is
        // loose since the abort time follows the onAbort event round trip; the task check guards the wait.
        expect(elapsedMs).to.be.at.least(ABORT_FLUSH_MS / 2);
        // The main realm stops waiting at the deadline, so the close does not wait past it.
        expect(elapsedMs).to.be.below(ABORT_FLUSH_MS + 3_000);
        expect(isTaskRun).to.equal(false);
        await peer.p2pInstance.dispose();
    } finally {
        held.resolve();
        await receiver.close();
    }
}

/**
 * The aborting runtime's VM worker ends while its upload is still held: the
 * thread end cancels that upload, so the worker drains at once and the client
 * closes soon after the bound, without the parent's drain-timeout warning.
 */
export async function assertVmThreadEndCancelsHeldUpload(): Promise<void> {
    const held = deferred();
    let abortingAddress: string | undefined;
    // Only the aborting peer's VM uploads are held; they are still open when its VM worker ends.
    const receiver = await startLogReceiver({
        respond: async (received) => {
            if (abortingAddress && isVmUploadOf(received, abortingAddress))
                await held.promise;
            return 200;
        }
    });
    try {
        await startPeersUploadingTo(receiver, {
            RUN_SDK_IN_THREAD: false,
            VM_DEDICATED_THREAD: true,
            CRASH_LOG_FLUSH_MS: ABORT_FLUSH_MS
        });
        const peer = MathTestSession.getHarness().getPeer(0);
        abortingAddress = peer.address;
        // The inline host is the VM worker's parent: its store receives the drain warning.
        const hostLogs = inlineHostFor(peer.p2pInstance).rootLogger["logStore"];

        const elapsedMs = await abortFirstPeerUntilClosed();

        expect(
            receiver.requests.some((request) =>
                isVmUploadOf(request, peer.address)
            )
        ).to.equal(true);
        // The held upload kept the flush to its bound; the lower limit is loose as in the bound case.
        expect(elapsedMs).to.be.at.least(ABORT_FLUSH_MS / 2);
        // Without the cancel the VM worker's loop holds the close until its drain timeout.
        expect(elapsedMs).to.be.below(ABORT_FLUSH_MS + 1_000);
        expect(
            hostLogs
                .getAllLogs()
                .filter((entry) => entry.message === DRAIN_WARNING)
        ).to.deep.equal([]);
        await peer.p2pInstance.dispose();
    } finally {
        held.resolve();
        await receiver.close();
    }
}

/**
 * A runtime disposed right after an error: the error's upload reaches the VM worker, still in its
 * jitter wait when disposal ends that thread. The ending thread sends it first, so the VM
 * worker's logs reach the receiver.
 */
export async function assertDisposeAfterErrorUploadsVmLogs(): Promise<void> {
    const receiver = await startLogReceiver();
    try {
        await startPeersUploadingTo(receiver, {
            RUN_SDK_IN_THREAD: false,
            VM_DEDICATED_THREAD: true,
            // Far longer than the disposal: a thread end that cancels the upload loses it.
            CRASH_LOG_UPLOAD_JITTER_MAX_MS: 5_000
        });
        const peer = MathTestSession.getHarness().getPeer(0);
        // Only uploads the error starts count: startup may have sent VM logs already.
        const startupRequests = receiver.requests.length;

        inlineHostFor(peer.p2pInstance).rootLogger.error(
            "hit right before the dispose"
        );
        await peer.p2pInstance.dispose();

        await waitFor(() =>
            receiver.requests
                .slice(startupRequests)
                .some((request) => isVmUploadOf(request, peer.address))
        );
    } finally {
        await receiver.close();
    }
}

/**
 * An SDK host in a worker thread aborts while the receiver holds the host's
 * own abort-line upload: the client closes only after that upload is
 * answered, its abort line, the main thread's logs and its VM worker's logs
 * all reach the receiver, and the close does not wait for the bound.
 */
export async function assertWorkerHostAbortUploadsLogs(): Promise<void> {
    let releasedAtMs: number | undefined;
    const receiver = await startLogReceiver({
        respond: async (received) => {
            if (received.threadName === "sdk" && hasAbortLine(received)) {
                await sleep(HOST_UPLOAD_HOLD_MS);
                releasedAtMs = Date.now();
            }
            return 200;
        }
    });
    try {
        await startPeersUploadingTo(receiver, {
            RUN_SDK_IN_THREAD: true,
            VM_DEDICATED_THREAD: true
        });
        const peer = MathTestSession.getHarness().getPeer(0);
        // A main-thread line written just before the abort. The flush uploads it; an
        // error-level gossip upload could also carry it.
        const marker = `worker-host-abort-${Date.now()}`;
        peer.p2pInstance.logger.warn(marker);

        const elapsedMs = await abortFirstPeerUntilClosed();
        const closedAtMs = Date.now();

        // The host worker's own abort line: the client closed only after its upload was answered.
        expect(releasedAtMs).not.to.equal(undefined);
        expect(closedAtMs).to.be.at.least(releasedAtMs!);
        // The flush crossed up to the main thread and down to the VM worker.
        expect(
            receiver.requests.some(
                (request) =>
                    request.threadName === "main" &&
                    decodeUpload(request).some(
                        (entry) => entry.message === marker
                    )
            )
        ).to.equal(true);
        expect(
            receiver.requests.some((request) =>
                isVmUploadOf(request, peer.address)
            )
        ).to.equal(true);
        // Every other upload answered at once, so the close did not wait for the bound.
        expect(elapsedMs).to.be.below(config.CRASH_LOG_FLUSH_MS / 2);
        await peer.p2pInstance.dispose();
    } finally {
        await receiver.close();
    }
}

export async function assertAbortClosesRuntime(worker: boolean): Promise<void> {
    const harness = MathTestSession.getHarness();
    await harness.lifecycle.start(4, 0, {
        configOverrides: {
            RUN_SDK_IN_THREAD: worker,
            VM_DEDICATED_THREAD: worker
        }
    });
    const peer = harness.getPeer(0);
    const control = harness.control(peer);
    const participants = await control.query.getParticipants().request();
    const client = clientRootFor(peer.p2pInstance);
    const host = client.p2pRuntimeHostRemoteRoot!;
    const localHost = worker ? undefined : inlineHostFor(peer.p2pInstance);
    const localChildren = localHost
        ? [...localHost.connections.values()]
              .map((entry) => entry["localPeerRemoteRoot"]?.["owner"])
              .filter((root) => root !== undefined)
        : [];
    let rootClosures = 0;
    host.onClosed(() => {
        rootClosures++;
    });
    const closed = new Promise<void>((resolve) => client.onClosed(resolve));
    await control.stub.abortDetached(true).request();
    await harness.event.waitForPeers("onAbort", [0], 1);
    await closed;
    await peer.p2pInstance.dispose();
    expect(host.isClosed).to.equal(true);
    expect(rootClosures).to.equal(1);
    expect(peer.eventSpies.onAbort?.callCount).to.equal(1);
    expect(client.children.size).to.equal(0);
    expect(client.connections.size).to.equal(0);
    await expect(control.query.getParticipants().request()).to.be.rejected;
    await expect(control.query.getNextToWrite().request()).to.be.rejected;
    if (localHost) {
        expect(localHost.connections.size).to.equal(0);
        expect(RootCreationControl.roots.has(localHost)).to.equal(false);
        for (const child of localChildren) {
            expect(child.connections.size).to.equal(0);
            expect(RootCreationControl.roots.has(child)).to.equal(false);
        }
        // A queued network close callback can arrive after final host cleanup.
        expect(() =>
            localHost.hostRpc
                .requireManager()
                .stateManager.p2pEventHooks.onDisconnection?.(
                    harness.getPeer(1).address
                )
        ).not.to.throw();
    }
    expect(
        await harness
            .control(harness.getPeer(1))
            .query.getParticipants()
            .request()
    ).to.deep.equal(participants);
    await peer.p2pInstance.dispose();
}

export async function assertAbortCancelsTimeout(): Promise<void> {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(4, 0, {
        configOverrides: { RUN_SDK_IN_THREAD: false }
    });
    const peer = h.getPeer(0);
    const host = inlineHostFor(peer.p2pInstance);
    const sm = host.hostRpc.requireManager().stateManager;
    let taskRan = false;
    // The delay is the cancellation oracle, not a protocol timeout.
    sm.timeoutManager.scheduleTask(
        () => {
            taskRan = true;
        },
        100,
        "StateManagerAbort.test"
    );
    await h.control(peer).stub.abortDetached().request();
    await h.event.waitForPeers("onAbort", [0], 1);
    await waitFor(() => host.connections.size === 0);
    // Observe beyond the canceled task's 100 ms deadline; 200 ms gives it a
    // second full interval in which an incorrectly retained task could execute.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sm.status).to.equal(Status.OPENED);
    expect(taskRan).to.equal(false);
    expect(sm.p2pManager.getConnectedPeers().size).to.equal(0);
}

export async function assertProviderShutdownOrder(): Promise<void> {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(4, 0, {
        configOverrides: {
            RUN_SDK_IN_THREAD: false,
            VM_DEDICATED_THREAD: false
        }
    });
    const peer = h.getPeer(0);
    const host = inlineHostFor(peer.p2pInstance);
    const sm = host.hostRpc.requireManager().stateManager;
    const provider = sm.stateChannelManagerContract.runner!.provider!;
    if (!(provider instanceof MultiRpcProvider))
        throw new Error("Expected the host RPC node provider");
    // each node's open socket carries the channel's event subscription
    const sockets = provider.nodes.map((node) => {
        let socket: WebSocketProvider | undefined;
        node.watchSockets((open) => {
            socket = open;
        })();
        if (!socket) throw new Error("Expected every node to be connected");
        return socket;
    });
    const socketListenerCounts = await Promise.all(
        sockets.map((socket) => socket.listenerCount())
    );
    for (const count of socketListenerCounts)
        expect(count).to.be.greaterThan(0);
    await peer.p2pInstance.dispose();
    expect(provider.destroyed).to.equal(true);
    expect(await provider.listenerCount()).to.equal(0);
    expect(provider.nodes.map((node) => node.destroyed)).to.deep.equal(
        provider.nodes.map(() => true)
    );
    expect(sockets.map((socket) => socket.destroyed)).to.deep.equal(
        sockets.map(() => true)
    );
    expect(
        await Promise.all(sockets.map((socket) => socket.listenerCount()))
    ).to.deep.equal(sockets.map(() => 0));
    await peer.p2pInstance.dispose();
}

/**
 * A runtime whose provider the process-wide Clock reads through is disposed:
 * the provider stays open for the Clock, its nodes never reconnect, and the
 * Clock destroys it once a new provider replaces it.
 */
export async function assertClockOwnedProviderReleasedOnDispose(): Promise<void> {
    const h = MathTestSession.getHarness();
    const proxied = 2;
    await h.lifecycle.start(3, 0, {
        configOverrides: {
            RUN_SDK_IN_THREAD: false,
            VM_DEDICATED_THREAD: false
        },
        rpcNodeProxiesByPeer: { [proxied]: 1 }
    });
    const [proxy] = h.getRpcNodeProxies(proxied);
    const providerOf = (peerIndex: number) => {
        const provider = inlineHostFor(
            h.getPeer(peerIndex).p2pInstance
        ).hostRpc.requireManager().stateManager.stateChannelManagerContract
            .runner!.provider!;
        if (!(provider instanceof MultiRpcProvider))
            throw new Error("Expected the host RPC node provider");
        return provider;
    };
    const provider = providerOf(proxied);
    const replacement = providerOf(0);
    // this runtime's provider is now the one the Clock reads through
    await Clock.init(provider);

    await h.getPeer(proxied).p2pInstance.dispose();

    expect(provider.destroyed).to.equal(false);
    const [node] = provider.nodes;
    const chainIdReads = proxy.forwardedCount("eth_chainId");
    proxy.cut();
    await waitFor(() => !node.isConnected);
    proxy.restore();
    // time is the input: the first reconnect would come within 250 ms
    await sleep(RECONNECT_ABSENCE_WINDOW_MS);
    expect(node.isConnected).to.equal(false);
    expect(proxy.forwardedCount("eth_chainId")).to.equal(chainIdReads);

    await Clock.init(replacement);

    expect(provider.destroyed).to.equal(true);
    expect(provider.nodes.map((rpcNode) => rpcNode.destroyed)).to.deep.equal(
        provider.nodes.map(() => true)
    );
}
