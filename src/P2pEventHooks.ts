import {
    DisputeStruct,
    DisputeData
} from "@typechain-types/contracts/V1/DisputeTypes";

type P2pEventHooks = {
    onConnection?: (address: string) => void;
    onTurn?: (address: string) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: (disputeData: DisputeData) => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
};

export default P2pEventHooks;
