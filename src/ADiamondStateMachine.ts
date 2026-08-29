import {
    BalanceStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Address, Bytes } from "./types/types";

import type { LocalDiamondContract } from "./utils/localDiamond";
type TransitionResponse = {
    success: boolean;
    outboundMessages: MessageStruct[];
    successCallback: () => void;
};

abstract class ADiamondStateMachine {
    localDiamondContract: LocalDiamondContract;

    constructor(localDiamondContract: LocalDiamondContract) {
        this.localDiamondContract = localDiamondContract;
    }

    public abstract stateTransition(tx: any): Promise<TransitionResponse>;
    public abstract runView(tx: any): Promise<any>;
    public abstract getParticipants(): Promise<Address[]>;
    public abstract getNextToWrite(): Promise<Address>;
    public abstract peekNextToWrite(serializedState: Bytes): Promise<Address>;
    public abstract setState(serializedState: Bytes): Promise<any>;
    public abstract getState(): Promise<Bytes>;
    public abstract addBalance(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<BalanceStruct>;
    public abstract subtractBalance(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<BalanceStruct>;

    public abstract areBalancesEqual(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<boolean>;

    public abstract processInboundMessage(
        message: MessageStruct
    ): Promise<boolean>;

    public abstract getTotalStateBalance(): Promise<BalanceStruct>;

    public abstract getZeroBalance(): Promise<BalanceStruct>;

    public abstract dispose(): Promise<void> | void;

    /** The state machine's address in its executing EVM. */
    public abstract getStateMachineAddress(): Address;
}

export default ADiamondStateMachine;
