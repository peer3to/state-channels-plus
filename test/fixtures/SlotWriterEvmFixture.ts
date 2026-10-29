// @spec-test-coverage-ignore: shared fixture stages slot-writer contracts on a real createEvm EVM; executable evidence belongs to its calling test declarations
import { createEvm } from "@/evm/EvmFactory";
import { createLogger } from "@/utils";
import type { EVM } from "@ethereumjs/evm";
import type { DefaultStateManager } from "@ethereumjs/statemanager";
import {
    Address,
    type MapDB,
    bytesToBigInt,
    setLengthLeft
} from "@ethereumjs/util";
import { expect } from "chai";
import { ethers } from "ethers";

const logger = createLogger({}, {}, { level: "error" });

/** The number of storage slots the slot-writer code writes. */
export const SLOT_COUNT = 8;

/** Runtime code: SSTORE(slot, calldata word `slot`) for each slot, then STOP. */
const SLOT_WRITER_CODE = (() => {
    let code = "0x";
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
        code += `60${(slot * 32).toString(16).padStart(2, "0")}3560${slot.toString(16).padStart(2, "0")}55`;
    }
    return ethers.getBytes(`${code}00`);
})();

export function buildBlock() {
    const zeroAddress = Address.zero();

    return {
        header: {
            number: 0n,
            cliqueSigner: () => zeroAddress,
            coinbase: zeroAddress,
            timestamp: 0n,
            difficulty: 0n,
            prevRandao: new Uint8Array(32),
            gasLimit: 30_000_000n,
            baseFeePerGas: 0n,
            getBlobGasPrice: () => undefined
        }
    } as any;
}

/** Calldata for the slot-writer code: one random word per slot. */
export function randomSlotValues(): Uint8Array {
    return ethers.randomBytes(SLOT_COUNT * 32);
}

/** The slot values that `calldata` writes, in slot order. */
export function slotWords(calldata: Uint8Array): bigint[] {
    return Array.from({ length: SLOT_COUNT }, (_, slot) =>
        bytesToBigInt(calldata.subarray(slot * 32, (slot + 1) * 32))
    );
}

/**
 * A bare `createEvm` EVM (pruned state manager) whose contracts run the
 * slot-writer code.
 */
export class SlotWriterEvm {
    public readonly evm: EVM;

    private constructor(evm: EVM) {
        this.evm = evm;
    }

    public static async create(): Promise<SlotWriterEvm> {
        return new SlotWriterEvm(await createEvm({}, logger));
    }

    public get stateManager(): DefaultStateManager {
        return this.evm.stateManager as DefaultStateManager;
    }

    /** Entries in the trie database the account trie and every storage trie share. */
    public trieDatabaseSize(): number {
        const database = this.stateManager["_trie"].database().db as MapDB<
            string,
            Uint8Array
        >;
        return database._database.size;
    }

    public async deploy(contract: Address): Promise<void> {
        await this.stateManager.putContractCode(contract, SLOT_WRITER_CODE);
    }

    /** Calls `contract` with `calldata`; the call must not fail. */
    public async write(contract: Address, calldata: Uint8Array): Promise<void> {
        const result = await this.evm.runCall({
            to: contract,
            caller: Address.zero(),
            data: calldata,
            block: buildBlock()
        });
        expect(result.execResult.exceptionError).to.equal(undefined);
    }

    public stateRoot(): Promise<Uint8Array> {
        return this.stateManager.getStateRoot();
    }

    /**
     * Reads every slot of `contract` at the current state root through a
     * fresh state manager with the same options and empty caches, so only
     * the trie database answers: a missing trie node reads as zero or throws.
     */
    public async readSlotsFromTrie(contract: Address): Promise<bigint[]> {
        const root = await this.stateRoot();
        const reader = this.stateManager.shallowCopy(false);
        await reader.setStateRoot(root);
        const words: bigint[] = [];
        for (let slot = 0; slot < SLOT_COUNT; slot++) {
            const value = await reader.getContractStorage(
                contract,
                setLengthLeft(new Uint8Array([slot]), 32)
            );
            words.push(bytesToBigInt(value));
        }
        return words;
    }
}
