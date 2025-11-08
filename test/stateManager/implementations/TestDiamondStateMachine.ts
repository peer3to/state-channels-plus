import { Address, Bytes } from "@/types/types";

/**
 * Minimal test implementation of Diamond State Machine
 * Only implements what tests need - defaults to no-op or sensible defaults
 *
 * This is NOT a full implementation, just the methods StateManager uses in tests
 */
export class TestDiamondStateMachine {
    private state: Bytes = "0x";
    private nextToWrite: Address = "0x0000000000000000000000000000000000000000";
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

    // For tests that need to simulate fork disputes
    setForkDisputed(value: boolean): void {
        this.isForkDisputed_value = value;
    }

    // Local diamond contract mock - minimal interface
    localDiamondContract = {
        isForkDisputed: async () => this.isForkDisputed_value,
        isBlockAuthentic: async () => true
    };
}
