import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Status } from "./types";
import { Address, ChannelId, ForkId, Hash } from "./types/types";

type P2pEventHooks = {
    /**
     * Fires once a peer's identity is verified and its `ProfileManager`
     * profile is registered/updated - handshake completion only, nothing
     * about channel membership. `ProfileManager` tracks identity/transport;
     * `P2PManager.openConnections` is the broadcast/`getConnectedPeers`/
     * cleanup set, and registering a profile must NOT imply the peer
     * receives channel traffic. Carries only the verified address (like
     * every other hook here) so it stays cross-realm safe: this hook crosses
     * the runtime port, which structured-clones every payload, so it can
     * never carry a live `ATransport`. Whoever owns the transport (e.g. the
     * channel-connection path) decides whether to promote it into
     * `openConnections` by subscribing to this hook and resolving the
     * transport itself via `ProfileManager` (host-side, same realm).
     */
    handshakeCompleted?: (address: Address) => void;
    onConnection?: (address: Address, isChannelOpened: boolean) => void;
    onDisconnection?: (address: Address) => void;
    onTurn?: (
        address: Address,
        // nominal p2p turn window; height-0 evidenceTime grace is not included
        turnTime: number,
        agreementTime: number,
        chainFallbackTime: number,
        turnStartedAtBlockTimestamp?: number
    ) => void;
    onSetState?: (forkId: ForkId) => void;
    onAbort?: () => void;
    onStatusChanged?: (oldStatus: Status, newStatus: Status) => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onDisputeStarted?: (maxDuration: number) => void;
    onInitiatingDispute?: (disputeHash: Hash, dispute: DisputeStruct) => void;
    onDisputeUpdate?: (slashes: Address[], timeout?: Address) => void;
    onCloseChannel?: (channelId: ChannelId) => void;
    onDisputeAcknowledgment?: (address: Address) => void;
    onBlockFinalized?: () => void;
    onBlockConfirmationProcessed?: (
        blockHash: Hash,
        keepConnection: boolean
    ) => void;
};

export default P2pEventHooks;
