import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { JoinChannelBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Address, ChannelId } from "./types/types";

type P2pEventHooks = {
    onConnection?: (address: Address) => void;
    onTurn?: (address: Address) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: () => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
    onJoinChannel?: (joinChannelBlock: JoinChannelBlockStruct) => void;
    onChannelClosed?: (channelId: ChannelId) => void;
};

export default P2pEventHooks;
