import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Status } from "./types";
import { Address, ChannelId, ForkId, Hash } from "./types/types";

type P2pEventHooks = {
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
