import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Address, ChannelId, Hash } from "./types/types";

type P2pEventHooks = {
    onConnection?: (address: Address, isChannelOpened: boolean) => void;
    onTurn?: (
        address: Address,
        turnTime: number,
        agreementTime: number,
        chainFallbackTime: number
    ) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: (disputeHash: Hash, dispute: DisputeStruct) => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
    onCloseChannel?: (channelId: ChannelId) => void;
};

export default P2pEventHooks;
