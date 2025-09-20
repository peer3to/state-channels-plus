import { ExitChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Address, Bytes, ChannelId, Hash } from "./types/types";
import { BalanceStruct } from "@typechain-types/contracts/V1/AStateMachine";
import { LocalDiamond } from "@typechain-types/index";
import {
    DisputeAuditingDataStruct,
    DisputeInputStruct,
    DisputeStruct,
    SnapshotDataStruct,
    StateSnapshotStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/StateChannelManagerEvents";
type TransitionResponse = {
    success: boolean;
    exitChannels: ExitChannelStruct[];
    successCallback: () => void;
};
abstract class ADiamondStateMachine {
    localDiamondContract: LocalDiamond;

    constructor(localDiamondContract: LocalDiamond) {
        this.localDiamondContract = localDiamondContract;
    }

    public abstract stateTransition(tx: any): Promise<TransitionResponse>;
    public abstract runView(tx: any): Promise<any>;
    public abstract getParticipants(): Promise<Address[]>;
    public abstract getNextToWrite(): Promise<Address>;
    public abstract peekNextToWrite(serializedState: Bytes): Promise<Address>;
    public abstract setState(serializedState: Bytes): Promise<any>;
    public abstract getState(): Promise<Bytes>;
    public abstract getExitChannels(): Promise<ExitChannelStruct[]>;
    public abstract addBalance(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<BalanceStruct>;
    public abstract subtractBalance(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<BalanceStruct>;

    public abstract getTotalStateBalance(): Promise<BalanceStruct>;

    public abstract getZeroBalance(): Promise<BalanceStruct>;
    public abstract computeDisputeOutputSnapshotData(
        disputeInput: DisputeInputStruct,
        latestStateSnapshot: StateSnapshotStruct,
        latestStateMachineState: Bytes,
        latestJoinChannelBlockHash: Hash
    ): Promise<SnapshotDataStruct>;
    public abstract isDisputeOutputCorrect(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean>;
}

export default ADiamondStateMachine;
