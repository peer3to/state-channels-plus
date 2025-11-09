import { Address, Bytes } from "@/types/types";
import { zeroHex } from "../../factory";
/**
 * Minimal test implementation of Diamond State Machine

 */
export class TestDiamondStateMachine {
    private state: Bytes = "0x";
    private nextToWrite: Address = zeroHex(20) as Address;
    private isForkDisputed_value: boolean = false;

    constructor(config?: { nextToWrite?: Address; initialState?: Bytes }) {
        this.nextToWrite = config?.nextToWrite || this.nextToWrite;
        this.state = config?.initialState || this.state;
    }

    async getNextToWrite(): Promise<Address> {
        return this.nextToWrite;
    }

    async setState(encoded: Bytes): Promise<void> {
        this.state = encoded;
    }

    async getState(): Promise<Bytes> {
        return this.state;
    }

    async getParticipants(): Promise<Address[]> {
        return [];
    }

    // For tests that need to simulate fork disputes
    setForkDisputed(value: boolean): void {
        this.isForkDisputed_value = value;
    }

    // Local diamond contract mock - minimal interface
    localDiamondContract = {
        isForkDisputed: async () => this.isForkDisputed_value,
        isBlockAuthentic: async () => true,
        getBlockCallDataCommitment: async () => zeroHex(32),
        getOnChainSlashedParticipantsUpToTimestamp: async () => []
    };
}
