import type { ProvenAccount } from "./AAccountProofVerifier";
import type { StorageSlot } from "./AStorageProofVerifier";
import type { ChecksumAddress } from "@/types/types";

/** One JSON-RPC request to a node: the `result` of `method`. */
export type NodeRequest = (
    method: string,
    params: unknown[]
) => Promise<unknown>;

/**
 * A read proof of `keys` at `block` that also asks the serving node to keep
 * them current for the participant; undefined when no subscription can take
 * them, and the keys are then proven by a plain request.
 */
export type WatchRequest = (
    keys: string[],
    block: ProvenBlock
) => Promise<{ proof: unknown } | undefined>;

/** A block whose state root proofs are checked against. */
export type ProvenBlock = {
    number: number;
    /** The hash the node knows the block by. */
    hash: string;
    /** The block's Ethereum hash, which on a Substrate chain is not `hash`. */
    ethereumBlockHash: string;
    stateRoot: string;
};

/** The block values a contract call can read. */
export type BlockEnvironment = {
    number: bigint;
    /** Seconds. */
    timestamp: bigint;
    coinbase: string;
    gasLimit: bigint;
    difficulty: bigint;
    prevRandao: string;
    baseFeePerGas: bigint;
};

/** What a read asks of one account. */
export type AccountStateRead = {
    address: ChecksumAddress;
    /** Storage slots of the contract at `address`. */
    slots: StorageSlot[];
    /** Whether the nonce and balance are asked. */
    account: boolean;
    code: boolean;
};

/** What a read proved of one account: only what was asked of it. */
export type ProvenAccountState = {
    address: ChecksumAddress;
    /** The 32-byte values of the asked slots, in the order asked. */
    storage: string[];
    account?: ProvenAccount;
    code?: string;
};

/**
 * Reads state from a node together with its proof and returns only what the
 * proof decides. Each kind of node serves proofs through its own methods: one
 * subclass per representation.
 */
export default abstract class AProvenStateReader {
    /**
     * The node's best block. The block is taken as the chain's on the node's
     * word; its hash is computed here, not taken from the node.
     */
    abstract head(): Promise<ProvenBlock>;

    /**
     * The values a contract call reads of `block`, as `block` commits to
     * them. Throws {@link StorageProofError} when the node does not prove
     * them.
     */
    abstract environment(block: ProvenBlock): Promise<BlockEnvironment>;

    /**
     * What `reads` ask, as `block`'s state root commits to it, in the order
     * of `reads`. Throws {@link StorageProofError} when the node's proof does
     * not decide everything asked.
     */
    abstract read(
        block: ProvenBlock,
        reads: AccountStateRead[]
    ): Promise<ProvenAccountState[]>;
}
