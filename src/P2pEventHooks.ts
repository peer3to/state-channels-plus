import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";
import { JoinChannelBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

type P2pEventHooks = {
    onConnection?: (address: string) => void;
    onTurn?: (address: string) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: () => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
    onJoinChannel?: (joinChannelBlock: JoinChannelBlockStruct) => void;
};

export default P2pEventHooks;
