import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Status } from "./types";
import { Address, ChannelId, ForkId, Hash } from "./types/types";

type P2pEventHooks = {
    /** Fires after a peer's identity is verified and its profile is registered. */
    handshakeCompleted?: (address: Address) => void;

    /** Fires after a peer transport joins the active connection set. */
    onConnection?: (address: Address, isChannelOpened: boolean) => void;

    /** Fires when a peer transport closes unexpectedly. */
    onDisconnection?: (address: Address) => void;

    /** Fires after applied state selects the author and timing for the next block. */
    onTurn?: (
        address: Address,
        // nominal p2p turn window; height-0 evidenceTime grace is not included
        turnTime: number,
        agreementTime: number,
        chainFallbackTime: number,
        turnStartedAtBlockTimestamp?: number
    ) => void;

    /** Fires instead of onTurn when this pending-leave peer can author its exit. */
    onLeaveTurn?: () => void;

    /** Fires after a state snapshot is applied to the local fork. */
    onSetState?: (forkId: ForkId) => void;

    /** Fires when participation aborts before the runtime starts disposal. */
    onAbort?: () => void;

    /** Fires whenever the local channel lifecycle status changes. */
    onStatusChanged?: (oldStatus: Status, newStatus: Status) => void;

    /** Fires before this peer submits incomplete block calldata on-chain. */
    onPostingCalldata?: () => void;

    /** Fires after posted block calldata is observed and applied locally. */
    onPostedCalldata?: () => void;

    /** Fires when the first relevant commitment starts a dispute window. */
    onDisputeStarted?: (maxDuration: number) => void;

    /** Fires after this peer submits a dispute and before its receipt settles. */
    onInitiatingDispute?: (disputeHash: Hash, dispute: DisputeStruct) => void;

    /** Fires after a dispute update, with its slashes or earliest timeout target. */
    onDisputeUpdate?: (slashes: Address[], timeout?: Address) => void;

    /** Fires when a settled empty participant set closes the local channel. */
    onCloseChannel?: (channelId: ChannelId) => void;

    /** Fires when a remote peer acknowledges that the current fork is disputed. */
    onDisputeAcknowledgment?: (address: Address) => void;

    /** Fires when a block commit or signature merge finds all required signatures. */
    onBlockFinalized?: () => void;

    /** Fires after an inbound block confirmation is accepted or rejected. */
    onBlockConfirmationProcessed?: (
        blockHash: Hash,
        keepConnection: boolean
    ) => void;
};

export default P2pEventHooks;
