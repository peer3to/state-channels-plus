import { ExitChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Address, Bytes, ChannelId, ForkId } from "./types/types";
import { BalanceStruct } from "@typechain-types/contracts/V1/AStateMachine";
type TransitionResponse = {
    success: boolean;
    exitChannels: ExitChannelStruct[];
    successCallback: () => void;
};
abstract class ADiamondStateMachine {
    public abstract stateTransition(tx: any): Promise<TransitionResponse>;
    public abstract runView(tx: any): Promise<any>;
    public abstract getParticipants(): Promise<Address[]>;
    public abstract getNextToWrite(): Promise<Address>;
    public abstract setState(serializedState: Bytes): Promise<any>;
    public abstract getState(): Promise<any>;
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
}

export default ADiamondStateMachine;
