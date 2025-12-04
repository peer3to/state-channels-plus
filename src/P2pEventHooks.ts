import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Address, ChannelId, Hash } from "./types/types";

type P2pEventHooks = {
    onConnection?: (address: Address) => void;
    onTurn?: (address: Address) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: (disputeHash: Hash, dispute: DisputeStruct) => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
    onCloseChannel?: (channelId: ChannelId) => void;
};

export default P2pEventHooks;
