import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Status } from "./types";
import { Address, ChannelId, Hash } from "./types/types";

type P2pEventHooks = {
    onConnection?: (address: Address, isChannelOpened: boolean) => void;
    onDisconnection?: (address: Address) => void;
    onTurn?: (
        address: Address,
        turnTime: number,
        agreementTime: number,
        chainFallbackTime: number,
        turnStartedAtBlockTimestamp?: number
    ) => void;
    onSetState?: () => void;
    onStatusChanged?: (oldStatus: Status, newStatus: Status) => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onDisputeStarted?: (maxDuration: number) => void;
    onInitiatingDispute?: (disputeHash: Hash, dispute: DisputeStruct) => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
    onCloseChannel?: (channelId: ChannelId) => void;
    onDisputeAcknowledgment?: (address: Address) => void;
    onBlockFinalized?: () => void;
};

export default P2pEventHooks;
