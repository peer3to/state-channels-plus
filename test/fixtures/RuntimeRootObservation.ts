// @spec-test-coverage-ignore: observations of real SDK roots for assertions after port cleanup
import HarnessControlRpc from "./customRpc/harnessControl/HarnessControlRpc";
import type { EventBus } from "@/events/EventBus";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";

export function clientRootFor(instance: { events: EventBus }) {
    const root = [...RootCreationControl.roots].find(
        (root): root is P2pRuntimeClientRoot =>
            root instanceof P2pRuntimeClientRoot &&
            root.events === instance.events
    );
    if (!root) throw new Error("Expected the SDK client root");
    return root;
}

/** For an initialized SDK, removal from the live root set means cleanup finished. */
export function runtimeIsClosed(instance: { events: EventBus }): boolean {
    const root = [...RootCreationControl.roots].find(
        (root): root is P2pRuntimeClientRoot =>
            root instanceof P2pRuntimeClientRoot &&
            root.events === instance.events
    );
    return !root || root.p2pRuntimeHostRemoteRoot?.isClosed === true;
}

/** Keep a local endpoint observation for assertions after its port closes. */
export function inlineHostFor(instance: { events: EventBus }) {
    const client = clientRootFor(instance);
    const connection = [...client.connections.values()].find(
        (entry) => entry === client.p2pRuntimeHostRemoteRoot
    );
    const root = connection?.["localPeerRemoteRoot"]?.["owner"];
    if (!(root instanceof P2pRuntimeHostRoot))
        throw new Error("Expected the SDK-owned inline host root");
    return root;
}

/** Inspect the real local endpoint after abort has removed its RPC connection. */
export function runtimeEndpointFor(instance: { events: EventBus }) {
    const host = inlineHostFor(instance);
    const manager = host.hostRpc.requireManager();
    const rpc = manager.localRpc;
    if (!(rpc instanceof HarnessControlRpc))
        throw new Error("Expected the real harness RPC root");
    return {
        host,
        sm: manager.stateManager,
        stub: rpc.stub.createRPCMethods(manager.loopbackTransport),
        query: rpc.query.createRPCMethods(manager.loopbackTransport)
    };
}

/** Observe real domain teardown without requesting a reply through the disposed network. */
export async function observeRuntimeDisposal(instance: { events: EventBus }) {
    const { sm } = runtimeEndpointFor(instance);
    const root = sm.p2pManager.localRpc;
    const originalDispose = root.dispose;
    let connectionsAtRootDispose = -1;
    root.dispose = async () => {
        connectionsAtRootDispose = sm.p2pManager.getConnectedPeers().size;
        await originalDispose.call(root);
    };
    let message = "";
    try {
        await sm.dispose();
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    } finally {
        root.dispose = originalDispose;
    }
    return {
        connectionsAtRootDispose,
        connectionsAfter: sm.p2pManager.getConnectedPeers().size,
        message
    };
}
