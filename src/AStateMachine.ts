import { ExitChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Address, Bytes } from "./types/types";
type TransitionResponse = {
    success: boolean;
    exitChannels: ExitChannelStruct[];
    successCallback: () => void;
};
abstract class AStateMachine {
    public abstract stateTransition(tx: any): Promise<TransitionResponse>;
    public abstract runView(tx: any): Promise<any>;
    public abstract getParticipants(): Promise<Address[]>;
    public abstract getNextToWrite(): Promise<Address>;
    public abstract setState(serializedState: Bytes): Promise<any>;
    public abstract getState(): Promise<any>;
    public abstract getExitChannels(): Promise<ExitChannelStruct[]>;
}

export default AStateMachine;
