// @spec-test-coverage-ignore: shared staging for lobby cleanup and handoff cases
import type { P2PManagerFixture } from "./P2PManagerFixture";
import { Status } from "@/types";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

/**
 * Plain discovery key used only to give the cases below real authenticated
 * transports. It is not a channel key: the peers select no channel ID, the
 * same state they are in while discovering a lobby.
 */
const CONNECT_KEY = ethers.id("lobby-cleanup-staging-connect-key");

/**
 * Grow the fixture to `peerCount` peers and connect them all to peer 0. The
 * key stays joined: leaving it closes dials that are still pending, which can
 * take down a transport a case is about to drive. A peer that redials after a
 * case closes its transport is refused by the lobby and changes nothing the
 * cases observe.
 */
export async function connectLobbyPeers(
    fixture: P2PManagerFixture,
    peerCount: number
): Promise<void> {
    const h = fixture.getHarness();
    while (h.peers.length < peerCount) {
        const index = h.peers.length;
        await h.createPeer(index, h.signerFor(slotAccountIndex(index)));
    }
    await Promise.all(
        h.peers.map((peer) =>
            h.execOnHost(
                peer,
                async (stateManager, args) => {
                    await stateManager.p2pManager.joinDiscoveryKey(
                        args.discoveryKey
                    );
                    return true;
                },
                { discoveryKey: CONNECT_KEY }
            )
        )
    );
    // Wait on the lookup the cases actually use: an open connection is not yet
    // a profile that answers to its peer's EVM address.
    const peerAddresses = h.peers
        .filter((peer) => peer.index !== 0)
        .map((peer) => peer.address);
    await waitFor(async () =>
        (
            await Promise.all(
                peerAddresses.map((peerAddress) =>
                    h
                        .control(h.getPeer(0))
                        .query.isTransportClosed(peerAddress)
                        .request()
                )
            )
        ).every((closed) => !closed)
    );
}

/**
 * One lobby session on peer 0 that is cancelled while its only session
 * transport is live. Reports what that transport observed at the moment the
 * matching cleanup closed it.
 */
export async function probeLobbyCleanupOrdering(fixture: P2PManagerFixture) {
    const h = fixture.getHarness();
    return h.execOnHost(
        h.getPeer(0),
        async (stateManager, args) => {
            const lobby = stateManager.p2pManager.localRpc.lobbyMatchingService;
            const transport =
                stateManager.p2pManager.profileManager.getTransportByEvmAddress(
                    args.peerAddress
                );
            if (!transport) {
                throw new Error(
                    `Lobby peer transport is missing for ${args.peerAddress}`
                );
            }
            const matchPromise = lobby.match(args.topic);
            await Promise.resolve();
            lobby.onAuthenticatedTransport(transport);
            let topicJoinedWhenSessionTransportClosed: boolean | undefined;
            const unsubscribe = transport.onClosed(() => {
                topicJoinedWhenSessionTransportClosed =
                    lobby.getAvailability().topicJoined;
            });
            const topicJoinedBeforeCancel = lobby.getAvailability().topicJoined;

            const cancelled = await lobby.cancelMatching(args.topic);
            const match = await matchPromise;
            unsubscribe();
            return {
                cancelled,
                matched: !!match,
                topicJoinedBeforeCancel,
                topicJoinedWhenSessionTransportClosed,
                sessionTransportClosed: transport.isClosed,
                topicJoinedAfterCancel: lobby.getAvailability().topicJoined
            };
        },
        {
            topic: ethers.id("lobby-cleanup-ordering"),
            peerAddress: fixture.address(1)
        }
    );
}

/**
 * One lobby session on peer 0 that commits to peer 1 while peer 2 is also a
 * session transport, then releases the handoff. With `failLeave` the
 * discovery leave rejects. Reports what the non-selected transport observed
 * at the moment it was closed and what the handoff kept.
 */
async function stageLobbyHandoff(
    fixture: P2PManagerFixture,
    failLeave: boolean
) {
    const h = fixture.getHarness();
    const label = failLeave ? "lobby-failed-leave" : "lobby-handoff-ordering";
    return h.execOnHost(
        h.getPeer(0),
        async (stateManager, args) => {
            const p2pManager = stateManager.p2pManager;
            const lobby = p2pManager.localRpc.lobbyMatchingService;
            const profiles = p2pManager.profileManager;
            const selected = profiles.getTransportByEvmAddress(
                args.selectedAddress
            );
            const nonSelected = profiles.getTransportByEvmAddress(
                args.nonSelectedAddress
            );
            if (!selected || !nonSelected) {
                throw new Error(
                    `Lobby peer transport is missing: selected ${args.selectedAddress}=${!!selected}, non-selected ${args.nonSelectedAddress}=${!!nonSelected}`
                );
            }
            const originalLeave = p2pManager.leaveDiscoveryKey.bind(p2pManager);
            let leaveAttempts = 0;
            if (args.failLeave) {
                p2pManager.leaveDiscoveryKey = async () => {
                    leaveAttempts += 1;
                    throw new Error("staged discovery leave failure");
                };
            }
            let topicJoinedWhenNonSelectedClosed: boolean | undefined;
            const unsubscribe = nonSelected.onClosed(() => {
                topicJoinedWhenNonSelectedClosed =
                    lobby.getAvailability().topicJoined;
            });
            try {
                const matchPromise = lobby.match(args.topic);
                await Promise.resolve();
                lobby.onAuthenticatedTransport(selected);
                lobby.onAuthenticatedTransport(nonSelected);
                lobby.receiveAvailability(selected, {
                    topic: args.topic,
                    role: "selector",
                    roleEpoch: 1,
                    available: false
                });
                const roleEpoch = lobby.getAvailability().roleEpoch;
                const pick = lobby.receivePick(
                    selected,
                    args.attemptNonce,
                    roleEpoch,
                    args.selectorChallenge
                );
                if (pick.status !== "accepted") {
                    throw new Error(
                        "Expected the staged lobby pick to be accepted"
                    );
                }
                const topicJoinedBeforeCommit =
                    lobby.getAvailability().topicJoined;
                lobby.receiveCommit(
                    selected,
                    args.attemptNonce,
                    roleEpoch,
                    args.selectorChallenge,
                    pick.advertiserChallenge
                );
                const match = await matchPromise;
                const result = {
                    matchedPeer: match?.peerAddress,
                    leaveAttempts,
                    topicJoinedBeforeCommit,
                    topicJoinedWhenNonSelectedClosed,
                    topicJoinedAfterHandoff:
                        lobby.getAvailability().topicJoined,
                    nonSelectedClosed: nonSelected.isClosed,
                    selectedClosedAfterHandoff: selected.isClosed,
                    selectedHandedOff: lobby.isHandedOffTransport(selected)
                };
                await lobby.releaseNegotiationHandoff(args.topic);
                return result;
            } finally {
                unsubscribe();
                if (args.failLeave) {
                    p2pManager.leaveDiscoveryKey = originalLeave;
                    await originalLeave(args.topic).catch(() => undefined);
                }
            }
        },
        {
            failLeave,
            topic: ethers.id(label),
            selectedAddress: fixture.address(1),
            nonSelectedAddress: fixture.address(2),
            attemptNonce: ethers.id(`${label}-nonce`),
            selectorChallenge: ethers.id(`${label}-challenge`)
        }
    );
}

/** The handoff with a working discovery leave. */
export function probeLobbyHandoffOrdering(fixture: P2PManagerFixture) {
    return stageLobbyHandoff(fixture, false);
}

/** The handoff with a discovery leave that rejects. */
export function probeLobbyFailedLeave(fixture: P2PManagerFixture) {
    return stageLobbyHandoff(fixture, true);
}

/**
 * A lobby session on peer 0 is cancelled while its topic leave is held, and
 * a second session on another topic is started under that cleanup, the way
 * a new lobby join would. Reports whether the second session waited for the
 * cleanup and what it kept once the leave was released.
 */
export async function probeLobbyCleanupOverlap(fixture: P2PManagerFixture) {
    const h = fixture.getHarness();
    return h.execOnHost(
        h.getPeer(0),
        async (stateManager, args) => {
            const p2pManager = stateManager.p2pManager;
            const lobby = p2pManager.localRpc.lobbyMatchingService;
            const profiles = p2pManager.profileManager;
            const firstTransport = profiles.getTransportByEvmAddress(
                args.firstPeerAddress
            );
            const secondTransport = profiles.getTransportByEvmAddress(
                args.secondPeerAddress
            );
            if (!firstTransport || !secondTransport) {
                throw new Error(
                    `Lobby peer transport is missing: first ${args.firstPeerAddress}=${!!firstTransport}, second ${args.secondPeerAddress}=${!!secondTransport}`
                );
            }
            const firstMatch = lobby.match(args.firstTopic);
            await Promise.resolve();
            lobby.onAuthenticatedTransport(firstTransport);

            let releaseLeave = () => {};
            const heldLeave = new Promise<void>((resolve) => {
                releaseLeave = resolve;
            });
            const originalLeave = p2pManager.leaveDiscoveryKey.bind(p2pManager);
            p2pManager.leaveDiscoveryKey = async (discoveryKey) => {
                await heldLeave;
                return originalLeave(discoveryKey);
            };
            try {
                const cancelled = lobby.cancelMatching(args.firstTopic);
                await Promise.resolve();
                // The new join sets its status before it asks for a session.
                stateManager.setStatus(args.discoveringStatus);
                const secondMatch = lobby.match(args.secondTopic);
                await Promise.resolve();
                await Promise.resolve();
                const secondStartedBeforeRelease =
                    lobby.getAvailability().topic === args.secondTopic;
                const firstTransportClosedBeforeRelease =
                    firstTransport.isClosed;

                releaseLeave();
                const cancelResult = await cancelled;
                const firstResult = await firstMatch;
                // Host code runs serialized, so it polls without the harness.
                for (
                    let attempt = 0;
                    attempt < 200 &&
                    lobby.getAvailability().topic !== args.secondTopic;
                    attempt += 1
                ) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                if (lobby.getAvailability().topic !== args.secondTopic) {
                    throw new Error("The second lobby session did not start");
                }
                lobby.onAuthenticatedTransport(secondTransport);
                const statusAfterSecondStart = stateManager.status;
                const secondTransportClosedByFirstCleanup =
                    secondTransport.isClosed;
                const secondCancelled = await lobby.cancelMatching(
                    args.secondTopic
                );
                const secondResult = await secondMatch;
                return {
                    cancelled: cancelResult,
                    firstMatched: !!firstResult,
                    secondStartedBeforeRelease,
                    firstTransportClosedBeforeRelease,
                    firstTransportClosed: firstTransport.isClosed,
                    secondTransportClosedByFirstCleanup,
                    statusAfterSecondStart,
                    secondCancelled,
                    secondMatched: !!secondResult
                };
            } finally {
                p2pManager.leaveDiscoveryKey = originalLeave;
            }
        },
        {
            firstTopic: ethers.id("lobby-cleanup-overlap-first"),
            secondTopic: ethers.id("lobby-cleanup-overlap-second"),
            firstPeerAddress: fixture.address(1),
            secondPeerAddress: fixture.address(2),
            // Host code runs serialized: enum values cross as arguments.
            discoveringStatus: Status.DISCOVERING
        }
    );
}
