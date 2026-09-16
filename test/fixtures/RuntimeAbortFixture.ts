import { clientRootFor, inlineHostFor } from "./RuntimeRootObservation";
// @spec-test-coverage-ignore: shared abort assertions exercised by StateManagerAbort and P2PManager tests
import { Status } from "@/types";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { WebSocketProvider } from "ethers";

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
    if (!(provider instanceof WebSocketProvider))
        throw new Error("Expected the host WebSocket provider");
    const listenerCount = await provider.listenerCount();
    expect(listenerCount).to.be.greaterThan(0);
    await sm.stop();
    expect(provider.destroyed).to.equal(false);
    expect(await provider.listenerCount()).to.equal(listenerCount);
    await peer.p2pInstance.dispose();
    expect(provider.destroyed).to.equal(true);
    expect(await provider.listenerCount()).to.equal(0);
    await peer.p2pInstance.dispose();
}
