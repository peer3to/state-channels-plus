// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { waitFor } from "../../utils/waitFor";
import { withRuntimeRpc } from "../RpcRouterFixture";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
import type P2PManager from "@/P2PManager";
import { createRoot } from "@/rpc/internal/createRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { WebRTCMainThreadBridgeRoot } from "@/rpc/internal/roots/WebRTCMainThreadBridge";
import { WebRTCWorkerBridgeRoot } from "@/rpc/internal/roots/WebRTCWorkerBridgeRoot";
import LocalWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory";
import type {
    WebRTCConnectionCallbacks,
    WebRTCDataChannelLike
} from "@/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import { adaptPort } from "@platform/p2pRuntimeChannel";
import { expect } from "chai";
import { ethers } from "ethers";

export async function withWebRTCBridge(
    operation: (bridge: {
        factory: WorkerBridgeWebRTCConnectionFactory;
        manager: P2PManager;
        client: WebRTCWorkerBridgeRoot;
        control: RuntimeRpcControl;
        brokerRemoteRoot: RemoteRoot<WebRTCMainThreadBridgeRoot>;
        peerAddress: string;
        callbacks: WebRTCConnectionCallbacks;
        negotiate(
            acceptRemoteOffer?: boolean,
            onChannel?: (channel: WebRTCDataChannelLike) => void
        ): Promise<{
            channel: WebRTCDataChannelLike;
            received: unknown[];
            candidates: RTCIceCandidateInit[];
            states: string[];
            answer: RTCSessionDescriptionInit;
        }>;
        dispose(): Promise<void>;
        addOwner(): Promise<{
            factory: WorkerBridgeWebRTCConnectionFactory;
            dispose(): Promise<void>;
        }>;
        captureCurrentChannelCallbacks(): () => void;
    }) => Promise<void>
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected an actual SDK host root");
        const channel = new MessageChannel();
        const factory = new WorkerBridgeWebRTCConnectionFactory();
        factory.attachBridge(
            await createRoot(WebRTCWorkerBridgeRoot, {
                parent: host,
                mode: "inline",
                args: undefined,
                local: { port: channel.port1, factory: factory }
            })
        );
        const remoteRoot = [...host.connections.values()].find(
            (entry) =>
                entry["localPeerRemoteRoot"]?.["owner"] instanceof
                WebRTCWorkerBridgeRoot
        )!;
        const client = remoteRoot["localPeerRemoteRoot"]![
            "owner"
        ] as WebRTCWorkerBridgeRoot;
        const broker = await createRoot(WebRTCMainThreadBridgeRoot, {
            parentPort: adaptPort(channel.port2),
            args: { channelMode: "proxy", logger: sdk.logger }
        });
        const brokerConnection = [...client.connections.values()].find(
            (entry) => entry.remoteRelation === "child"
        )!;
        const brokerRemoteRoot =
            brokerConnection as RemoteRoot<WebRTCMainThreadBridgeRoot>;
        await brokerRemoteRoot.awaitReady();
        const control = RuntimeRpcControl.attachTo(brokerConnection);
        const peerAddress = ethers.Wallet.createRandom().address;
        const localAddress = await sdk.instance.p2pSigner.getAddress();
        const local = new LocalWebRTCConnectionFactory();
        const errors: Error[] = [];
        const candidates: RTCIceCandidateInit[] = [];
        const states: string[] = [];
        let remoteChannel: WebRTCDataChannelLike | undefined;
        let onRemoteChannel:
            | ((channel: WebRTCDataChannelLike) => void)
            | undefined;
        let localChannel: WebRTCDataChannelLike | undefined;
        const received: unknown[] = [];
        const callbacks: WebRTCConnectionCallbacks = {
            onIceCandidate: (candidate) => {
                candidates.push(candidate);
            },
            onDataChannel: (created) => {
                remoteChannel = created;
                onRemoteChannel?.(created);
            },
            onConnectionStateChange: (state) => {
                states.push(state.connectionState);
            },
            onError: (error) => {
                errors.push(error);
            }
        };
        const localCandidates: RTCIceCandidateInit[] = [];
        const dispose = () => remoteRoot.dispose();
        try {
            await operation({
                factory,
                manager: host.hostRpc.requireManager(),
                client,
                control,
                brokerRemoteRoot,
                peerAddress,
                callbacks,
                dispose,
                captureCurrentChannelCallbacks() {
                    // Retain callbacks from the actual provider channel before retirement.
                    const records = Reflect.get(
                        broker,
                        "connectionsByPeerAddress"
                    ) as Map<
                        string,
                        { proxiedChannel?: WebRTCDataChannelLike }
                    >;
                    const actual = records.get(peerAddress)?.proxiedChannel;
                    if (!actual)
                        throw new Error(
                            "Expected an actual proxied provider channel"
                        );
                    const { onmessage, onopen, onclose, onerror } = actual;
                    return () => {
                        onmessage?.({ data: "late provider message" });
                        onopen?.();
                        onclose?.();
                        onerror?.(new Error("late provider error"));
                    };
                },
                async addOwner() {
                    const additional = new MessageChannel();
                    const additionalFactory =
                        new WorkerBridgeWebRTCConnectionFactory();
                    const previous = new Set(host.children);
                    additionalFactory.attachBridge(
                        await createRoot(WebRTCWorkerBridgeRoot, {
                            parent: host,
                            mode: "inline",
                            args: undefined,
                            local: {
                                port: additional.port1,
                                factory: additionalFactory
                            }
                        })
                    );
                    await createRoot(WebRTCMainThreadBridgeRoot, {
                        parentPort: adaptPort(additional.port2),
                        args: { channelMode: "proxy", logger: sdk.logger }
                    });
                    const root = [...host.children].find(
                        (child) => !previous.has(child)
                    )!;
                    return {
                        factory: additionalFactory,
                        dispose: () => root.dispose()
                    };
                },
                async negotiate(acceptRemoteOffer = false, onChannel) {
                    onRemoteChannel = onChannel;
                    const localCallbacks: WebRTCConnectionCallbacks = {
                        onIceCandidate: (candidate) => {
                            localCandidates.push(candidate);
                        },
                        onDataChannel: (created) => {
                            localChannel = created;
                            created.onmessage = (event) => {
                                received.push(event.data);
                            };
                        },
                        onConnectionStateChange: () => undefined,
                        onError: (error) => {
                            errors.push(error);
                        }
                    };
                    const offer = acceptRemoteOffer
                        ? await local.createOffer(localAddress, localCallbacks)
                        : await factory.createOffer(peerAddress, callbacks);
                    expect(offer.type).to.equal("offer");
                    expect(offer.sdp).to.include("m=application");
                    const answer = acceptRemoteOffer
                        ? await factory.acceptOffer(
                              peerAddress,
                              offer,
                              callbacks
                          )
                        : await local.acceptOffer(
                              localAddress,
                              offer,
                              localCallbacks
                          );
                    if (acceptRemoteOffer)
                        await local.applyAnswer(localAddress, answer);
                    else await factory.applyAnswer(peerAddress, answer);
                    for (const candidate of candidates)
                        await local.addIceCandidate(localAddress, candidate);
                    for (const candidate of localCandidates)
                        await factory.addIceCandidate(peerAddress, candidate);
                    // Native ICE and DTLS establishment can span several retries.
                    await waitFor(
                        () =>
                            remoteChannel?.readyState === "open" &&
                            localChannel?.readyState === "open",
                        15_000,
                        20
                    );
                    if (errors.length) throw errors[0];
                    return {
                        channel: remoteChannel!,
                        received,
                        candidates,
                        states,
                        answer
                    };
                }
            });
        } finally {
            control.release();
            await local.close(localAddress);
            await dispose();
        }
    });
}

export async function assertDelayedBridgeAttachment(
    attach: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        )!;
        const channel = new MessageChannel();
        const before = new Set(host.children);
        const factory = new WorkerBridgeWebRTCConnectionFactory();
        // No broker exists yet: installing forwarding endpoints must still finish.
        factory.attachBridge(
            await createRoot(WebRTCWorkerBridgeRoot, {
                parent: host,
                mode: "inline",
                args: undefined,
                local: { port: channel.port1, factory: factory }
            })
        );
        const workerBridge = [...host.children].find(
            (child) => !before.has(child)
        )!;
        await workerBridge.awaitReady();
        const errors: Error[] = [];
        let settled = false;
        const offer = factory
            .createOffer(ethers.Wallet.createRandom().address, {
                onIceCandidate: () => undefined,
                onDataChannel: () => undefined,
                onConnectionStateChange: () => undefined,
                onError: (error) => errors.push(error)
            })
            .then(
                (value) => {
                    settled = true;
                    return value;
                },
                (error: Error) => {
                    settled = true;
                    return error;
                }
            );
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).to.equal(false);
        try {
            if (attach) {
                const broker = await createRoot(WebRTCMainThreadBridgeRoot, {
                    parentPort: adaptPort(channel.port2),
                    args: { channelMode: "proxy", logger: sdk.logger }
                });
                const result = await offer;
                if (result instanceof Error) throw result;
                expect(result.type).to.equal("offer");
                await workerBridge.dispose();
                expect(broker.isDisposing).to.equal(true);
            } else {
                await workerBridge.dispose();
                expect((await offer) instanceof Error).to.equal(true);
            }
            expect(workerBridge.isClosed).to.equal(true);
            expect(host.children.has(workerBridge)).to.equal(false);
            expect(errors).to.have.length(0);
            expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(
                5
            );
        } finally {
            await workerBridge.dispose();
            channel.port2.close();
        }
    });
}

export async function assertAbnormalBridgeError(): Promise<void> {
    await withWebRTCBridge(async (bridge) => {
        const errors: Error[] = [];
        bridge.factory.setCallbacks(bridge.peerAddress, {
            ...bridge.callbacks,
            onError: (error) => errors.push(error)
        });
        await bridge.client.webRTCBridge.runRPC(
            {
                service: "webRTCBridge",
                method: "error",
                params: [
                    bridge.peerAddress,
                    { name: "Error", message: "broker provider failure" }
                ]
            },
            bridge.brokerRemoteRoot["transport"]
        );
        expect(errors.map((error) => error.message)).to.deep.equal([
            "broker provider failure"
        ]);
        bridge.factory["workerBridgeRemoteRoot"]!.close();
        expect(errors.map((error) => error.message)).to.deep.equal([
            "broker provider failure",
            "WebRTC bridge closed"
        ]);
    });
}
