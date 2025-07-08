import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Address } from "./types/types";

type P2pEventHooks = {
    onConnection?: (address: Address) => void;
    onTurn?: (address: Address) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: () => void;
    onDisputeUpdate?: (dispute: DisputeStruct) => void;
};

export default P2pEventHooks;
