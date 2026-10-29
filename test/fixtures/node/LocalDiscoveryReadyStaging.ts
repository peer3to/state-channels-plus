import type P2PManager from "@/P2PManager";
import type { ChecksumAddress } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";
import { LocalDiscoveryServer } from "@/utils/node/LocalDiscoveryServer";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
// @spec-test-coverage-ignore: stages a real accepted socket before runtime disposal
import { once } from "node:events";
import WebSocket, { type WebSocketServer } from "ws";

/** A real private socket registry of the discovery server; read only. */
function discoverySockets<K extends "peerServers" | "activeClientConnections">(
    field: K
): Set<K extends "peerServers" ? WebSocketServer : WebSocket> {
    const sockets: unknown = Reflect.get(LocalDiscoveryServer, field);
    if (!(sockets instanceof Set))
        throw new Error(`LocalDiscoveryServer.${field} is not a Set`);
    return sockets as Set<
        K extends "peerServers" ? WebSocketServer : WebSocket
    >;
}

export async function stageLocalDiscoveryReady() {
    const servers = discoverySockets("peerServers");
    if (servers.size !== 1)
        throw new Error("Expected one local discovery listener");
    const server = [...servers][0];
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Expected a TCP listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    let messages = 0;
    socket.on("message", () => messages++);
    await once(socket, "open");
    return {
        async sendReady() {
            const closed = once(socket, "close");
            socket.send(
                `peer3:local-transport-client-ready:v2:${ethers.ZeroAddress}`
            );
            await closed;
            return messages;
        },
        dispose() {
            socket.terminate();
        }
    };
}

export function observeDiscoveryLogger() {
    const logger = Reflect.get(LocalDiscoveryServer, "_logger") as Logger;
    const service = logger.loggerService;
    const store = Reflect.get(logger, "logStore");
    return {
        assertActive() {
            expect(() =>
                logger.info("discovery after manager disposal")
            ).not.to.throw();
        },
        async cleanup() {
            const first = LocalDiscoveryServer.cleanup();
            const second = LocalDiscoveryServer.cleanup();
            expect(first === second).to.equal(true);
            await Promise.all([first, second]);
        },
        assertDisposed() {
            expect(() => logger.info("after discovery cleanup")).to.throw(
                "disposed"
            );
            expect(logger.loggerService).to.equal(undefined);
            if (service)
                expect(Reflect.get(service, "stores").has(store)).to.equal(
                    false
                );
        }
    };
}

/** The runtime among `managers` with a local dial in flight, once one has. */
export async function waitForPendingLocalDial(
    managers: P2PManager[]
): Promise<P2PManager> {
    // Read the real private topic sessions; do not replace their behavior.
    // Each runtime's sessions are keyed by rendezvous key (hex topic).
    const sessions = Reflect.get(
        LocalDiscoveryServer,
        "discoverySessions"
    ) as WeakMap<
        P2PManager,
        Map<string, { dialingPeers: Set<ChecksumAddress> }>
    >;
    let owner: P2PManager | undefined;
    await waitFor(() => {
        owner = managers.find((manager) =>
            [...(sessions.get(manager)?.values() ?? [])].some(
                (session) => session.dialingPeers.size > 0
            )
        );
        return owner !== undefined;
    });
    return owner!;
}

/**
 * Records the peer retries scheduled from now on: a retry writes its count
 * with its warning and its timer, and the count stays while the discovery
 * session does.
 */
export function observeLocalDialRetries() {
    const retryCounts = Reflect.get(
        LocalDiscoveryServer,
        "_peerRetryCount"
    ) as Map<string, number>;
    const before = new Map(retryCounts);
    return {
        scheduledSince(): string[] {
            return [...retryCounts.entries()]
                .filter(([key, count]) => before.get(key) !== count)
                .map(([key]) => key);
        }
    };
}

/** Replace a real listener while its old socket still owns dial admission. */
export async function assertDiscoveryEndpointReplacement(
    h: MathPeerTestHarness,
    pendingHandshake: boolean
) {
    await h.setup(2, {
        autoConnect: false,
        configOverrides: { RUN_SDK_IN_THREAD: false }
    });
    const dialer = h.getPeer(h.network.lobbyRoleIndices()[0]);
    const acceptor = h.getPeer(1 - dialer.index);
    const topic = ethers.id(
        `replacement-endpoint:${dialer.address}:${acceptor.address}`
    );
    await h.control(acceptor).network.joinSelectedKey(topic).request();
    // Observe the real private listener and registry sockets, without replacing
    // announcement handling, dial admission, handshakes, or retry behavior.
    const servers = discoverySockets("peerServers");
    const oldServer = [...servers][0];
    const oldAddress = oldServer.address();
    if (!oldAddress || typeof oldAddress === "string")
        throw new Error("Missing old listener");
    if (pendingHandshake)
        await h.rpcStub.stubHandshakeResponse(acceptor.index, {
            delayMs: 600_000
        });
    await h.control(dialer).network.joinSelectedKey(topic).request();
    const manager = runtimeEndpointFor(dialer.p2pInstance).sm.p2pManager;
    if (pendingHandshake) await waitForPendingLocalDial([manager]);
    else await h.network.waitForP2PConnections();

    const firstToken = await h
        .control(dialer)
        .network.getTransportToken(acceptor.address)
        .request();
    const registrySockets = discoverySockets("activeClientConnections");
    let announced = false;
    const observe = (data: WebSocket.RawData) => {
        const announcement = JSON.parse(data.toString());
        if (
            announcement.peerAddress === acceptor.address &&
            announcement.port !== oldAddress.port
        )
            announced = true;
    };
    const observedSockets = [...registrySockets];
    for (const socket of observedSockets) socket.on("message", observe);
    try {
        await h.control(acceptor).network.leaveSelectedKey(topic).request();
        if (pendingHandshake)
            await h.control(acceptor).stub.restoreHandshakeResponse().request();
        await h.control(acceptor).network.joinSelectedKey(topic).request();
        await waitFor(() => announced, h.event.protocolEventTimeoutMs());
        if (pendingHandshake) await waitForPendingLocalDial([manager]);
        // Close only the obsolete listener's actual sockets after the new
        // endpoint was announced; the real retry must reach its replacement.
        for (const socket of oldServer.clients) socket.terminate();
        await waitFor(async () => {
            const token = await h
                .control(dialer)
                .network.getTransportToken(acceptor.address)
                .request();
            return token !== null && token !== firstToken;
        }, h.event.protocolEventTimeoutMs());
        await h.network.waitForP2PConnections();
        expect(
            await h.control(dialer).query.getOpenConnectionCount().request()
        ).to.equal(1);
        expect(
            await h
                .control(dialer)
                .query.isBlacklisted(acceptor.address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(acceptor)
                .query.isBlacklisted(dialer.address)
                .request()
        ).to.equal(false);
    } finally {
        for (const socket of observedSockets) socket.off("message", observe);
        for (const socket of oldServer.clients) socket.terminate();
    }
}

/**
 * Stops every listener from reading its accepted sockets, so a dialer's close
 * of one of them completes only after `release`. `closingDials` counts the
 * peer dial sockets open at the hold that are still closing.
 */
export function holdAcceptedSocketReads() {
    // Pause the real private sockets; do not replace their behavior.
    const listeners = [...discoverySockets("peerServers")];
    const held = listeners.flatMap((server) => [...server.clients]);
    if (held.length === 0) throw new Error("No accepted socket to hold");
    // peer dials target a listener port; registry sockets do not
    const listenerPorts = new Set(
        listeners.map((server) => {
            const address = server.address();
            if (!address || typeof address === "string")
                throw new Error("Expected a TCP listener");
            return String(address.port);
        })
    );
    const outbound = [...discoverySockets("activeClientConnections")].filter(
        (socket) => listenerPorts.has(new URL(socket.url).port)
    );
    for (const socket of held) socket.pause();
    return {
        closingDials: () =>
            outbound.filter((socket) => socket.readyState === WebSocket.CLOSING)
                .length,
        release: () => {
            for (const socket of held) socket.resume();
        }
    };
}
