// @spec-test-coverage-ignore: browser SDK fixture; declarations live in the browser runner
import { createBrowserSdkExecutor } from "./sdkSetup.js";
import { RuntimeRpcControl } from "../fixtures/runtimeRpc/RuntimeRpcControl.ts";
import { createRoot } from "@/rpc/internal/createRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { WebRTCMainThreadBridgeRoot } from "@/rpc/internal/roots/WebRTCMainThreadBridge";
import { WebRTCWorkerBridgeRoot } from "@/rpc/internal/roots/WebRTCWorkerBridgeRoot";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import { adaptPort } from "@platform/p2pRuntimeChannel";
import { ethers } from "ethers";

async function waitFor(predicate) {
    const deadline = Date.now() + 15_000;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error("Browser WebRTC condition timed out");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

export async function withBridge(operation, options = {}) {
    let owner;
    let host;
    const sdk = await createBrowserSdkExecutor({
        onRuntimeRoot(root) {
            if (root instanceof P2pRuntimeClientRoot) owner = root;
            if (root instanceof P2pRuntimeHostRoot) host = root;
        }
    });
    const ports = options.local ? undefined : new MessageChannel();
    const factory = options.local
        ? await host.hostRpc
              .requireManager()
              .localRpc.webRTCSetupService.getConnectionFactory()
        : new WorkerBridgeWebRTCConnectionFactory();
    if (ports)
        factory.attachBridge(
            await createRoot(WebRTCWorkerBridgeRoot, {
                parent: host,
                mode: "inline",
                args: undefined,
                local: { port: ports.port1, factory: factory }
            })
        );
    const connection =
        ports &&
        [...host.connections.values()].find(
            (entry) =>
                entry.localPeerRemoteRoot?.owner instanceof
                WebRTCWorkerBridgeRoot
        );
    const client = connection?.localPeerRemoteRoot.owner;
    const broker =
        ports &&
        (await createRoot(WebRTCMainThreadBridgeRoot, {
            parentPort: adaptPort(ports.port2),
            args: { ...options, logger: sdk.instance.logger }
        }));
    const brokerConnection =
        client &&
        [...client.connections.values()].find(
            (entry) => entry.remoteRelation === "child"
        );
    await brokerConnection?.awaitReady();
    const control =
        brokerConnection &&
        RuntimeRpcControl.attach(brokerConnection.transport);
    const peerAddress = ethers.Wallet.createRandom().address;
    let remote;
    try {
        return await operation({
            broker,
            factory,
            client,
            control,
            peerAddress,
            async connect(afterOpen, onExchange) {
                remote?.close();
                remote = new RTCPeerConnection();
                const incoming = [];
                const candidates = [];
                let localChannel;
                let remoteChannel;
                remote.onicecandidate = ({ candidate }) => {
                    if (candidate) candidates.push(candidate.toJSON());
                };
                remote.ondatachannel = ({ channel }) => {
                    remoteChannel = channel;
                    channel.onmessage = ({ data }) => incoming.push(data);
                };
                const localCandidates = [];
                const errors = [];
                const offer = await factory.createOffer(peerAddress, {
                    onDataChannel: (channel) => {
                        localChannel = channel;
                    },
                    onIceCandidate: (candidate) =>
                        localCandidates.push(candidate),
                    onConnectionStateChange: () => undefined,
                    onError: (error) => errors.push(error)
                });
                await remote.setRemoteDescription(offer);
                await remote.setLocalDescription(await remote.createAnswer());
                await factory.applyAnswer(
                    peerAddress,
                    remote.localDescription.toJSON()
                );
                await waitFor(
                    () => candidates.length && localCandidates.length
                );
                for (const candidate of localCandidates)
                    await remote.addIceCandidate(candidate);
                for (const candidate of candidates)
                    await factory.addIceCandidate(peerAddress, candidate);
                await waitFor(() => remoteChannel?.readyState === "open");
                await afterOpen?.();
                await waitFor(() => localChannel?.readyState === "open");
                if (errors.length) throw errors[0];
                const received = [];
                localChannel.onmessage = ({ data }) => received.push(data);
                localChannel.send("SDK bridge to provider");
                remoteChannel.send("provider to SDK bridge");
                await waitFor(
                    () =>
                        incoming.includes("SDK bridge to provider") &&
                        received.includes("provider to SDK bridge")
                );
                onExchange?.({
                    incoming: incoming.length,
                    received: received.length
                });
                return localChannel;
            },
            dispose() {
                return connection?.dispose();
            }
        });
    } finally {
        try {
            control?.release();
            remote?.close();
            if (options.local) await factory.close(peerAddress);
            await connection?.dispose();
        } finally {
            await sdk.dispose();
        }
    }
}

globalThis.runBrowserWebRTCReconnect = async () => {
    let exchanged = 0;
    await withBridge(async ({ factory, peerAddress, connect }) => {
        await connect();
        exchanged++;
        await factory.close(peerAddress);
        await connect();
        exchanged++;
    });
    return { exchanged };
};

globalThis.runBrowserWebRTCPendingDisposal = async () => {
    let message;
    let pending;
    let timers;
    await withBridge(
        async ({ factory, peerAddress, control, client, dispose }) => {
            const held = control.holdNextResponse("createOffer");
            const request = factory
                .createOffer(peerAddress, {
                    onDataChannel: () => undefined,
                    onIceCandidate: () => undefined,
                    onConnectionStateChange: () => undefined,
                    onError: (error) => {
                        throw error;
                    }
                })
                .catch((error) => {
                    message = error.message;
                });
            await held;
            await dispose();
            await request;
            pending = client.router.pendingRequestCount;
            timers = control.pendingTimers();
        }
    );
    return { message, pending, timers };
};

globalThis.runBrowserWebRTCAutoFallback = async () => {
    let cloneError;
    let firstProxy;
    let secondProxy;
    let transferAttempts;
    await withBridge(async ({ broker, factory, peerAddress, connect }) => {
        const control = RuntimeRpcControl.attach(
            [...broker.connections.keys()][0]
        );
        const postChannel = broker.postChannel.bind(broker);
        let held;
        broker.postChannel = (...args) => {
            held = args;
        };
        const first = await connect(() => {
            // This is the real provider channel, held until it is open. Sending
            // makes it non-transferable; the native post produces the failure.
            held[2].send("provider channel used before transfer");
            const probe = new MessageChannel();
            try {
                probe.port1.postMessage(held[2], [held[2]]);
            } catch (error) {
                cloneError = error.name;
            } finally {
                probe.port1.close();
                probe.port2.close();
            }
            if (cloneError !== "DataCloneError")
                throw new Error(
                    "Expected a real non-transferable RTCDataChannel"
                );
            broker.postChannel = postChannel;
            postChannel(...held);
        });
        firstProxy = !(first instanceof RTCDataChannel);
        await factory.close(peerAddress);
        const second = await connect();
        secondProxy = !(second instanceof RTCDataChannel);
        transferAttempts = control.sent.filter(
            (frame) => frame.method === "transferredChannel"
        ).length;
    });
    return { cloneError, firstProxy, secondProxy, transferAttempts };
};
