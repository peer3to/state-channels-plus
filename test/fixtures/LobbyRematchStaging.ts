// @spec-test-coverage-ignore: shared staging for lobby do-not-rematch cases
import type { P2PManagerFixture } from "./P2PManagerFixture";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

/**
 * Plain discovery key used only to give the cases below real authenticated
 * transports. It is not a channel key: the peers select no channel ID, the
 * same state they are in while discovering a lobby.
 */
const CONNECT_KEY = ethers.id("lobby-rematch-staging-connect-key");

/**
 * Grow the fixture to `peerCount` peers and connect them all to peer 0, then
 * leave the key again so nothing redials a transport a case closes.
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
    await waitFor(
        async () => (await h.query.getConnectionCount(0)) === peerCount - 1
    );
    await Promise.all(
        h.peers.map((peer) =>
            h.execOnHost(
                peer,
                async (stateManager, args) => {
                    await stateManager.p2pManager.leaveDiscoveryKey(
                        args.discoveryKey
                    );
                    return true;
                },
                { discoveryKey: CONNECT_KEY }
            )
        )
    );
}

/**
 * One lobby session on peer 0 that excludes its only candidate from
 * rematching, then ends. Drives the real service entry points over the real
 * transport to peer 1.
 */
export async function probeLobbyRematchAdmission(fixture: P2PManagerFixture) {
    const h = fixture.getHarness();
    return h.execOnHost(
        h.getPeer(0),
        async (stateManager, args) => {
            const lobby = stateManager.p2pManager.localRpc.lobbyMatchingService;
            const transport =
                stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                    args.peerAddress
                )?.transport;
            if (!transport) throw new Error("Lobby peer transport is missing");
            const matchPromise = lobby.match(args.topic);
            await Promise.resolve();
            lobby.onAuthenticatedTransport(transport);
            // A peer announcing the selector role bootstraps us as advertiser,
            // which is the role that answers a pick.
            lobby.receiveAvailability(transport, {
                topic: args.topic,
                role: "selector",
                roleEpoch: 1,
                available: false
            });
            const roleBeforeExclusion = lobby.getAvailability().role;

            lobby.excludeFromRematch(args.peerAddress);
            const pick = lobby.receivePick(
                transport,
                args.attemptNonce,
                lobby.getAvailability().roleEpoch,
                args.selectorChallenge
            );
            const reservedAfterPick = lobby.getAvailability().reserved;
            lobby.receiveAvailability(transport, {
                topic: args.topic,
                role: "advertiser",
                roleEpoch: 2,
                available: true
            });
            const availabilityAfterExclusion = lobby.getAvailability();

            const cancelled = await lobby.cancelMatching(args.topic);
            const match = await matchPromise;
            return {
                roleBeforeExclusion,
                pickStatus: pick.status,
                reservedAfterPick,
                candidateCountAfterExclusion:
                    availabilityAfterExclusion.candidateCount,
                excludedDuringSession:
                    availabilityAfterExclusion.excludedPeerCount,
                cancelled,
                matched: !!match,
                excludedAfterSessionEnd:
                    lobby.getAvailability().excludedPeerCount
            };
        },
        {
            topic: ethers.id("lobby-rematch-admission"),
            peerAddress: fixture.address(1),
            attemptNonce: ethers.id("lobby-rematch-admission-nonce"),
            selectorChallenge: ethers.id("lobby-rematch-admission-challenge")
        }
    );
}

/**
 * One lobby session on peer 0 that commits to peer 1 while peer 2 is also a
 * session transport, then releases the handoff. Reports what the non-selected
 * transport observed at the moment it was closed.
 */
export async function probeLobbyHandoffOrdering(fixture: P2PManagerFixture) {
    const h = fixture.getHarness();
    return h.execOnHost(
        h.getPeer(0),
        async (stateManager, args) => {
            const lobby = stateManager.p2pManager.localRpc.lobbyMatchingService;
            const profiles = stateManager.p2pManager.profileManager;
            const selected = profiles.getProfileByEvmAddress(
                args.selectedAddress
            )?.transport;
            const nonSelected = profiles.getProfileByEvmAddress(
                args.nonSelectedAddress
            )?.transport;
            if (!selected || !nonSelected) {
                throw new Error("Lobby peer transport is missing");
            }
            const matchPromise = lobby.match(args.topic);
            await Promise.resolve();
            lobby.onAuthenticatedTransport(selected);
            lobby.onAuthenticatedTransport(nonSelected);
            let topicJoinedWhenNonSelectedClosed: boolean | undefined;
            const unsubscribe = nonSelected.onClosed(() => {
                topicJoinedWhenNonSelectedClosed =
                    lobby.getAvailability().topicJoined;
            });

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
                unsubscribe();
                throw new Error("Expected the staged lobby pick to be accepted");
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
            unsubscribe();
            const topicJoinedAfterHandoff =
                lobby.getAvailability().topicJoined;
            const selectedClosedAfterHandoff = selected.isClosed;
            const selectedHandedOff = lobby.isHandedOffTransport(selected);

            lobby.excludeFromRematch(args.nonSelectedAddress);
            const excludedAfterHandoff =
                lobby.getAvailability().excludedPeerCount;
            await lobby.releaseNegotiationHandoff(args.topic);
            return {
                matchedPeer: match?.peerAddress,
                topicJoinedBeforeCommit,
                topicJoinedWhenNonSelectedClosed,
                topicJoinedAfterHandoff,
                nonSelectedClosed: nonSelected.isClosed,
                selectedClosedAfterHandoff,
                selectedHandedOff,
                excludedAfterHandoff,
                excludedAfterHandoffRelease:
                    lobby.getAvailability().excludedPeerCount
            };
        },
        {
            topic: ethers.id("lobby-handoff-ordering"),
            selectedAddress: fixture.address(1),
            nonSelectedAddress: fixture.address(2),
            attemptNonce: ethers.id("lobby-handoff-ordering-nonce"),
            selectorChallenge: ethers.id("lobby-handoff-ordering-challenge")
        }
    );
}
