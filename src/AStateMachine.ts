import { ExitChannelStruct } from "@typechain-types/contracts/V1/DataTypes";

type TransitionResponse = {
    success: boolean;
    exitChannels: ExitChannelStruct[];
    successCallback: () => void;
};
abstract class AStateMachine {
    public abstract stateTransition(tx: any): Promise<TransitionResponse>;
    public abstract runView(tx: any): Promise<any>;
    public abstract getParticipants(): Promise<any[]>;
    public abstract getNextToWrite(): Promise<string>;
    public abstract setState(serializedState: any): Promise<any>;
    public abstract getExitChannels(): Promise<ExitChannelStruct[]>;
    public abstract getState(): Promise<any>;
}

export default AStateMachine;
