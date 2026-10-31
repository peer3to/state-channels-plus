import type { Logger } from "@/utils/logging/Logger";
import { LocalDiscoveryServer } from "@/utils/node/LocalDiscoveryServer";
import { localDiscoverySockets } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
// @spec-test-coverage-ignore: stages a real accepted socket before runtime disposal
import { once } from "node:events";
import WebSocket from "ws";

type Peer = MathPeerTestHarness["peers"][number];

export async function stageLocalDiscoveryReady() {
    const servers = localDiscoverySockets("peerServers");
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
            expect(logger.isDisposed).to.equal(true);
            // a released logger still writes to its console, never fails
            logger.info("after discovery cleanup");
            expect(logger.loggerService).to.equal(undefined);
            if (service)
                expect(Reflect.get(service, "stores").has(store)).to.equal(
                    false
                );
        }
    };
}

/** The peer among `peers` with a local dial in flight, once one has. */
export async function waitForPendingLocalDial(
    h: MathPeerTestHarness,
    peers: Peer[]
): Promise<Peer> {
    let owner: Peer | undefined;
    await waitFor(async () => {
        for (const peer of peers)
            if (await h.control(peer).stub.hasPendingLocalDial().request())
                owner = peer;
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
    await h.setup(2, { autoConnect: false });
    const dialer = h.getPeer(h.network.lobbyRoleIndices()[0]);
    const acceptor = h.getPeer(1 - dialer.index);
    const topic = ethers.id(
        `replacement-endpoint:${dialer.address}:${acceptor.address}`
    );
    await h.control(acceptor).network.joinSelectedKey(topic).request();
    // Observe the real private listener and registry sockets, without replacing
    // announcement handling, dial admission, handshakes, or retry behavior.
    const [oldPort] = await h
        .control(acceptor)
        .stub.getLocalDiscoveryListenerPorts()
        .request();
    if (oldPort === undefined) throw new Error("Missing old listener");
    if (pendingHandshake)
        await h.rpcStub.stubHandshakeResponse(acceptor.index, {
            delayMs: 600_000
        });
    await h.control(dialer).network.joinSelectedKey(topic).request();
    if (pendingHandshake) await waitForPendingLocalDial(h, [dialer]);
    else await h.network.waitForP2PConnections();

    const firstToken = await h
        .control(dialer)
        .network.getTransportToken(acceptor.address)
        .request();
    await h
        .control(dialer)
        .stub.observeLocalDiscoveryAnnouncements(acceptor.address)
        .request();
    try {
        await h.control(acceptor).network.leaveSelectedKey(topic).request();
        if (pendingHandshake)
            await h.control(acceptor).stub.restoreHandshakeResponse().request();
        await h.control(acceptor).network.joinSelectedKey(topic).request();
        await waitFor(
            async () =>
                (
                    await h
                        .control(dialer)
                        .stub.getLocalDiscoveryAnnouncedPorts()
                        .request()
                ).some((port) => port !== oldPort),
            h.event.protocolEventTimeoutMs()
        );
        if (pendingHandshake) await waitForPendingLocalDial(h, [dialer]);
        // Close only the obsolete listener's actual sockets after the new
        // endpoint was announced; the real retry must reach its replacement.
        await h
            .control(acceptor)
            .stub.terminateLocalDiscoveryListenerClients(oldPort)
            .request();
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
        await h
            .control(dialer)
            .stub.restoreLocalDiscoveryAnnouncements()
            .request();
        await h
            .control(acceptor)
            .stub.terminateLocalDiscoveryListenerClients(oldPort)
            .request();
    }
}

/**
 * Stops every listener from reading its accepted sockets, so a dialer's close
 * of one of them completes only after `release`. `closingDials` counts the
 * peer dial sockets to a listener open at the hold that are still closing.
 */
export async function holdAcceptedSocketReads(h: MathPeerTestHarness) {
    // Pause the real private sockets; do not replace their behavior.
    const listenerPorts: number[] = [];
    for (const peer of h.peers)
        listenerPorts.push(
            ...(await h
                .control(peer)
                .stub.getLocalDiscoveryListenerPorts()
                .request())
        );
    let held = 0;
    for (const peer of h.peers)
        held += await h.control(peer).stub.holdAcceptedSocketReads().request();
    if (held === 0) throw new Error("No accepted socket to hold");
    return {
        closingDials: async () => {
            let closing = 0;
            for (const peer of h.peers)
                closing += await h
                    .control(peer)
                    .stub.getClosingLocalDialCount(listenerPorts)
                    .request();
            return closing;
        },
        release: async () => {
            for (const peer of h.peers)
                await h
                    .control(peer)
                    .stub.releaseAcceptedSocketReads()
                    .request();
        }
    };
}
