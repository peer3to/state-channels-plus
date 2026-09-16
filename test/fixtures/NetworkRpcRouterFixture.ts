// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    protocolEventTimeoutMs,
    MIN_TEST_TIME_CONFIG
} from "../harness/core/testTimeConfig";
import { waitFor } from "../utils/waitFor";
import { withWebRTCBridge } from "./node/WebRTCBridgeFixture";
import {
    RecordingBannablePeerInfo,
    RecordingHolepunchSocket
} from "./P2PTransportFixture";
import { withRuntimeRpc } from "./RpcRouterFixture";
import type P2PManager from "@/P2PManager";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { WebRTCDataChannelLike } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import { ARpcRouter } from "@/rpc/router/ARpcRouter";
import { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import HolepunchTransport from "@/transport/HolepunchTransport";
import WebRTCTransport from "@/transport/WebRTCTransport";
import { Buffer } from "buffer";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertNetworkRouterOwnership(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected the real SDK host");
        const manager = host.hostRpc.requireManager();
        expect(
            // @ts-expect-error - internal transports are deliberately rejected by this network API.
            manager.profileManager.getProfileByTransport(sdk.parentTransport)
        ).to.equal(undefined);
        expect(manager instanceof ARpcRouter).to.equal(false);
        expect(manager.rpcRouter instanceof NetworkRpcRouter).to.equal(true);
        expect(manager.rpcRouter.p2pManager).to.equal(manager);
        expect(manager.loopbackTransport.router).to.equal(manager.rpcRouter);
        const service = manager.localRpc.initHandshakeService;
        const methods = service.createRPCMethods(manager.loopbackTransport);
        expect(methods.service).to.equal(service);
        expect(methods.p2pManager).to.equal(manager);
        expect(
            Object.prototype.hasOwnProperty.call(methods, "p2pManager")
        ).to.equal(false);
        expect(
            Object.values(manager.localRpc)
                .filter(
                    (value) =>
                        value &&
                        typeof value === "object" &&
                        "createRPCMethods" in value
                )
                .every(
                    (service) =>
                        Reflect.get(service, "router") === manager.rpcRouter
                )
        ).to.equal(true);
        expect(await sdk.instance.hostRpc.query.getForkId().request()).to.equal(
            manager.stateManager.forkId
        );
        expect(manager.rpcRouter.pendingRequestCount).to.equal(0);
    });
}

export async function assertNetworkByteForwarding(
    closeFirst: boolean
): Promise<void> {
    await withWebRTCBridge(async (bridge) => {
        const connected = await bridge.negotiate();
        const transport = new WebRTCTransport(
            connected.channel,
            bridge.manager.rpcRouter
        );
        const router = bridge.manager.rpcRouter;
        const original = router.onRpc;
        const observed: string[] = [];
        router.onRpc = (frame, sender) => {
            expect(sender).to.equal(transport);
            observed.push(frame);
            return original.call(router, frame, sender);
        };
        try {
            const response = JSON.stringify({
                rpcResponse: true,
                requestId: "unknown-network-response",
                ok: true,
                result: "é"
            });
            if (closeFirst) transport.close(true);
            const pendingBefore = router.pendingRequestCount;
            transport.onMessage(response);
            transport.onMessage(Buffer.from(response));
            transport.onMessage(new Uint8Array(Buffer.from(response)));
            expect(observed).to.deep.equal([response, response, response]);
            expect(router.pendingRequestCount).to.equal(pendingBefore);
        } finally {
            router.onRpc = original;
            transport.close(true);
        }
    });
}

export async function assertInternalClosedAdmission(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const transport = sdk.parentTransport;
        transport.close(true);
        let responses = 0;
        const original = transport.sendRpcResponse;
        transport.sendRpcResponse = (frame) => {
            responses++;
            original.call(transport, frame);
        };
        try {
            // A malformed correlatable request would produce a response on an open connection.
            transport.onMessage({
                service: "runtimeProbe",
                method: "echo",
                params: null,
                requestId: "late-internal"
            });
            sdk.clientRoot.router.onMessage(
                {
                    service: "runtimeProbe",
                    method: "echo",
                    params: null,
                    requestId: "late-router"
                },
                transport
            );
            expect(responses).to.equal(0);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            transport.sendRpcResponse = original;
        }
    });
}

export async function assertWebRTCTransportDelivery(
    mode: "queue" | "open" | "repeat" | "send" | "closed"
): Promise<void> {
    await withWebRTCBridge(async (bridge) => {
        const service = bridge.manager.localRpc.initHandshakeService;
        const original = service.initHandshake;
        let handshakes = 0;
        const order: string[] = [];
        service.initHandshake = function (transport) {
            handshakes++;
            order.push("handshake");
            return original.call(this, transport);
        };
        let transport: WebRTCTransport | undefined;
        let restoreSend: (() => void) | undefined;
        const first = JSON.stringify({
            rpcResponse: true,
            requestId: "transport-first",
            ok: true,
            result: 1
        });
        const second = JSON.stringify({
            rpcResponse: true,
            requestId: "transport-second",
            ok: true,
            result: 2
        });
        try {
            const observe = (channel: WebRTCDataChannelLike) => {
                const send = channel.send;
                channel.send = function (data) {
                    order.push(String(data));
                    return send.call(this, data);
                };
                restoreSend = () => {
                    channel.send = send;
                };
                transport = new WebRTCTransport(
                    channel,
                    bridge.manager.rpcRouter
                );
            };
            const connected = await bridge.negotiate(
                false,
                mode === "queue"
                    ? (channel) => {
                          expect(channel.readyState).to.equal("connecting");
                          observe(channel);
                          // A non-open channel must not send, handshake, or throw on construction.
                          expect(handshakes).to.equal(0);
                          transport!._send(first);
                          transport!._send(second);
                          expect(order).to.deep.equal([]);
                      }
                    : undefined
            );
            if (mode !== "queue") {
                if (mode === "closed") connected.channel.close();
                observe(connected.channel);
            }
            if (!transport) throw new Error("Expected actual WebRTC transport");
            if (mode === "queue") {
                // Once the channel opens, queued RPCs flush in order and the handshake starts.
                await waitFor(
                    () => connected.received.includes(second),
                    protocolEventTimeoutMs(MIN_TEST_TIME_CONFIG),
                    10
                );
                expect(order.slice(0, 3)).to.deep.equal([
                    first,
                    second,
                    "handshake"
                ]);
                expect(connected.received.indexOf(first)).to.be.lessThan(
                    connected.received.indexOf(second)
                );
                expect(handshakes).to.equal(1);
            } else if (mode === "repeat") {
                // Constructed open (handshake #1); a redundant open event must not re-handshake.
                connected.channel.onopen?.();
                expect(handshakes).to.equal(1);
            } else if (mode === "open") {
                expect(handshakes).to.equal(1);
                expect(transport.webRTCChannel.readyState).to.equal("open");
            } else if (mode === "send") {
                transport._send(first);
                await waitFor(
                    () => connected.received.includes(first),
                    protocolEventTimeoutMs(MIN_TEST_TIME_CONFIG),
                    10
                );
                expect(
                    order.filter((frame) => frame === first).length
                ).to.equal(1);
            } else {
                transport._send(first);
                expect(order).to.deep.equal([]);
                expect(handshakes).to.equal(0);
            }
        } finally {
            service.initHandshake = original;
            transport?.close(true);
            restoreSend?.();
        }
    });
}

/** An authenticated Holepunch peer whose socket and ban handle are observable. */
function connectAuthenticatedPeer(manager: P2PManager) {
    const peerInfo = new RecordingBannablePeerInfo();
    const socket = new RecordingHolepunchSocket();
    const transport = new HolepunchTransport(
        socket,
        peerInfo,
        manager.rpcRouter
    );
    const address = ethers.Wallet.createRandom().address;
    manager.addConnection(transport);
    if (!manager.profileManager.authenticateTransport(transport, address)) {
        throw new Error("Fixture transport was not admitted");
    }
    return { transport, socket, peerInfo, address };
}

/**
 * An unknown service or method is what a version skew between two SDK builds
 * looks like on the wire, so the router refuses the frame and closes without
 * escalating. A malformed envelope on the same router stays punitive.
 */
export async function assertUnknownServiceRefusedWithoutBlacklist(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected the real SDK host");
        const manager = host.hostRpc.requireManager();

        const skewed = connectAuthenticatedPeer(manager);
        await manager.rpcRouter.onRpc(
            JSON.stringify({
                service: "serviceFromANewerBuild",
                method: "unknownToThisBuild",
                params: []
            }),
            skewed.transport
        );
        expect(skewed.socket.destroyed).to.equal(true);
        expect(manager.isBlacklisted(skewed.address)).to.equal(false);
        expect(skewed.peerInfo.banCalls).to.deep.equal([]);

        const malformed = connectAuthenticatedPeer(manager);
        await manager.rpcRouter.onRpc(
            JSON.stringify({ notAnRpc: true }),
            malformed.transport
        );
        expect(malformed.socket.destroyed).to.equal(true);
        expect(manager.isBlacklisted(malformed.address)).to.equal(true);
    });
}

export async function assertUnauthenticatedTransportCleanup(): Promise<void> {
    await withWebRTCBridge(async (bridge) => {
        const { channel } = await bridge.negotiate();
        const transport = new WebRTCTransport(
            channel,
            bridge.manager.rpcRouter
        );
        expect(transport.peerAddress).to.equal(undefined);
        expect(
            bridge.manager.profileManager.getProfileByTransport(transport)
        ).not.to.equal(undefined);
        await bridge.manager.dispose();
        expect(transport.isClosed).to.equal(true);
        expect(
            bridge.manager.profileManager.getProfileByTransport(transport)
        ).to.equal(undefined);
    });
}
