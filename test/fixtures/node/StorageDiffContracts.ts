// @spec-test-coverage-ignore: storage diff service staging; executable evidence belongs to its calling test declarations
import type { AccountAddress } from "@/utils/node/storageDiff/blockStorageDiff";
import {
    SimpleNumberStorage__factory,
    type SimpleNumberStorage
} from "@typechain-types";
import {
    getAddress,
    id,
    toBeHex,
    type JsonRpcProvider,
    type JsonRpcSigner,
    type TransactionReceipt
} from "ethers";
import { gunzipSync } from "node:zlib";

/** `SimpleNumberStorage.value` lives in storage slot 0. */
export const VALUE_SLOT = toBeHex(0, 32);

export function storageWord(value: bigint): string {
    return toBeHex(value, 32);
}

export async function deployNumberStorage(
    signer: JsonRpcSigner
): Promise<SimpleNumberStorage> {
    const contract = await new SimpleNumberStorage__factory(signer).deploy();
    await contract.waitForDeployment();
    return contract;
}

export async function setValue(
    contract: SimpleNumberStorage,
    value: bigint
): Promise<TransactionReceipt> {
    const receipt = await (await contract.setValue(value)).wait();
    if (!receipt) throw new Error("setValue was not mined");
    return receipt;
}

/** The lower-case address the service keys records by. */
export async function recordKey(
    contract: SimpleNumberStorage
): Promise<AccountAddress> {
    return (await contract.getAddress()).toLowerCase();
}

/** `ValueSet(uint256)`, the event the log emitter fires. */
export const VALUE_SET_TOPIC = id("ValueSet(uint256)");

const EMIT_VALUE_SET =
    "600052" + // MSTORE(0, word)
    "7f" +
    VALUE_SET_TOPIC.slice(2) + // PUSH32 topic
    "60206000a1" + // LOG1(offset 0, size 32, topic)
    "00"; // STOP

// Runtime: slot 0 = calldata word; LOG1(topic ValueSet, data = that word).
const LOG_EMITTER_RUNTIME =
    "600035" + // CALLDATALOAD(0)
    "80600055" + // DUP1, SSTORE(0, word)
    EMIT_VALUE_SET;
// Runtime: LOG1(topic ValueSet, data = calldata word); no storage write.
const EVENT_ONLY_RUNTIME = "600035" + EMIT_VALUE_SET;

/**
 * Deploys a contract that stores its call's 32-byte word in slot 0 and emits
 * `ValueSet(word)`: a real event next to a touched slot.
 */
export async function deployLogEmitter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(signer, LOG_EMITTER_RUNTIME);
}

/** Like the log emitter, but it never writes storage: its calls leave no diff. */
export async function deployEventOnlyEmitter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(signer, EVENT_ONLY_RUNTIME);
}

export async function emitValue(
    signer: JsonRpcSigner,
    emitter: AccountAddress,
    value: bigint
): Promise<TransactionReceipt> {
    const response = await signer.sendTransaction({
        to: emitter,
        data: storageWord(value)
    });
    const receipt = await response.wait();
    if (!receipt) throw new Error("emitValue was not mined");
    return receipt;
}

// Runtime: SSTORE(calldata[0:32], calldata[32:64]); STOP.
const SLOT_WRITER_RUNTIME = "6020356000355500";

/** Deploys a contract that writes any slot to any value, from calldata. */
export async function deploySlotWriter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(signer, SLOT_WRITER_RUNTIME);
}

/** The 32-byte key of slot number `slot`. */
export function slotKey(slot: number): string {
    return toBeHex(slot, 32);
}

export async function writeSlot(
    signer: JsonRpcSigner,
    writer: AccountAddress,
    slot: number,
    value: bigint
): Promise<TransactionReceipt> {
    const receipt = await (
        await signer.sendTransaction({
            to: writer,
            data: slotKey(slot) + storageWord(value).slice(2)
        })
    ).wait();
    if (!receipt) throw new Error("writeSlot was not mined");
    return receipt;
}

/** An account as anvil's `anvil_dumpState` lists it: the test-only oracle of a complete cache. */
export async function dumpedAccount(
    provider: JsonRpcProvider,
    address: AccountAddress
): Promise<{
    balance: string;
    nonce: number;
    code: string;
    storage: Record<string, string>;
}> {
    const dump = (await provider.send("anvil_dumpState", [])) as string;
    const state = JSON.parse(
        gunzipSync(Buffer.from(dump.slice(2), "hex")).toString()
    );
    const account =
        state.accounts[address] ?? state.accounts[getAddress(address)];
    return account ?? { balance: "0x0", nonce: 0, code: "0x", storage: {} };
}

/** Deploys `runtime` (hex, no prefix) as a contract's code and returns its address. */
export async function deployRuntimeCode(
    signer: JsonRpcSigner,
    runtime: string
): Promise<AccountAddress> {
    // initcode copies the runtime after its own 11 bytes and returns it
    const initcode =
        "0x60" +
        (runtime.length / 2).toString(16).padStart(2, "0") +
        "80600b6000396000f3" +
        runtime;
    const receipt = await (
        await signer.sendTransaction({ data: initcode })
    ).wait();
    if (!receipt?.contractAddress) throw new Error("Runtime not deployed");
    return receipt.contractAddress.toLowerCase();
}

/** SSTORE(slot, value) for small numbers. */
function sstore(slot: number, value: number): string {
    return `60${value.toString(16).padStart(2, "0")}60${slot.toString(16).padStart(2, "0")}55`;
}

/** CALL to itself with `size` bytes of calldata, result dropped. */
function selfCall(size: number): string {
    return (
        `60006000${"60" + size.toString(16).padStart(2, "0")}6000600030` +
        "5af150"
    );
}

/**
 * Code that tells three frames apart by calldata size: empty is the parent, one
 * byte the child, two bytes the grandchild; the frames call each other as the
 * parts say.
 */
function threeFrames(
    parent: string,
    child: string,
    grandchild: string
): string {
    const dispatch = (parentAt: number, childAt: number) =>
        "3680" + // CALLDATASIZE, DUP1
        "15" + // ISZERO
        "60" +
        parentAt.toString(16).padStart(2, "0") +
        "57" + // JUMPI parent
        "80" +
        "6001" +
        "14" + // DUP1, size == 1
        "60" +
        childAt.toString(16).padStart(2, "0") +
        "57"; // JUMPI child
    const dispatchLength = dispatch(0, 0).length / 2;
    const childAt = dispatchLength + (grandchild + "00").length / 2;
    const parentAt = childAt + ("5b" + child).length / 2;
    return (
        dispatch(parentAt, childAt) +
        grandchild +
        "00" +
        "5b" +
        child +
        "5b" +
        parent
    );
}

/**
 * A contract whose parent frame writes slot 1 and calls its child, whose
 * frame writes slot 2, sends 1 wei to `recipient` and reverts: only slot 1
 * is written by the transaction.
 */
export async function deployRevertProbe(
    signer: JsonRpcSigner,
    recipient: AccountAddress
): Promise<AccountAddress> {
    return await deployRuntimeCode(
        signer,
        threeFrames(
            sstore(1, 1) + selfCall(1) + "00",
            sstore(2, 5) +
                "6000600060006000" +
                "6001" +
                "73" +
                recipient.slice(2) +
                "5af150" +
                "60006000fd",
            "00"
        )
    );
}

/**
 * A contract that writes slots 1 to 5 across three nested self-calls: the
 * parent slots 1 and 4, its child 2 and 5, the grandchild 3.
 */
export async function deployNestedWriter(
    signer: JsonRpcSigner
): Promise<AccountAddress> {
    return await deployRuntimeCode(
        signer,
        threeFrames(
            sstore(1, 1) + selfCall(1) + sstore(4, 4) + "00",
            sstore(2, 2) + selfCall(2) + sstore(5, 5) + "00",
            sstore(3, 3)
        )
    );
}

/** Whether a debug_traceBlockByNumber request asks for the call frames. */
export function asksCallFrames(params: unknown[]): boolean {
    return (params[1] as { tracer?: string }).tracer === "callTracer";
}

/** The call frames of a block with a failed frame in each transaction. */
export function withFailedFrames(result: unknown): unknown {
    return (result as { result: object }[]).map((entry) => ({
        ...entry,
        result: { ...entry.result, error: "execution reverted" }
    }));
}

/** The slots of `storage` that hold a value: a zero word and no entry are the same. */
export function nonZero(storage: Record<string, string> | undefined) {
    return Object.fromEntries(
        Object.entries(storage ?? {})
            .filter(([, word]) => BigInt(word) !== 0n)
            .map(([slot, word]) => [slot, storageWord(BigInt(word))])
    );
}
