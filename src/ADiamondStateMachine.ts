import { Address, Bytes } from "./types/types";

import type { LocalDiamondContract } from "./utils/localDiamond";
import {
    BalanceStruct,
    MessageBlockStruct,
    MessageStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { BytesLike } from "ethers";
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

    public abstract isBalanceLesserThan(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<boolean>;

    public abstract processInboundMessage(
        message: MessageStruct
    ): Promise<boolean>;

    public abstract getTotalStateBalance(): Promise<BalanceStruct>;

    /**
     * Run `reduceAndFinalize` on the local diamond. True only when this call
     * committed the window's reduction, so it validated the inputs; false
     * when the window was already reduced to `expectedReducedForkId` or does
     * not exist. The window is the one `disputes[0]` names, so a caller must
     * check that the disputes name the window it means to reduce.
     */
    public abstract reduceAndFinalizeLocally(
        disputes: DisputeStruct[],
        stateSnapshot: StateSnapshotStruct,
        encodedStateMachineState: BytesLike,
        inboundMessageBlocks: MessageBlockStruct[],
        expectedReducedForkId: BytesLike
    ): Promise<boolean>;

    public abstract getZeroBalance(): Promise<BalanceStruct>;

    public async requirePositiveBalance(
        balance: BalanceStruct,
        label: string
    ): Promise<void> {
        const zeroBalance = await this.getZeroBalance();
        if (!(await this.isBalanceLesserThan(zeroBalance, balance))) {
            throw new Error(`${label} must be greater than zero`);
        }
    }

    public abstract dispose(): Promise<void> | void;

    /** The state machine's address in its executing EVM. */
    public abstract getStateMachineAddress(): Address;
}

export default ADiamondStateMachine;
